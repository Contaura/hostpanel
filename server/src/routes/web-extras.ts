import { Router, Request, Response } from 'express';
import { runFile } from '../utils/process-runner';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';

const router = Router();
const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';
const WEBROOT   = process.env.WEBROOT   || '/var/www';
const CERT_DIR  = '/etc/letsencrypt/live';

/* ── Hotlink Protection ──────────────────────────────────── */

const HOTLINK_CONF = path.join(VHOST_DIR, 'hotlink_protection.conf');

router.get('/hotlink', (_req: Request, res: Response) => {
  if (!existsSync(HOTLINK_CONF)) return res.json({ enabled: false, allowed_domains: [], blocked_extensions: 'jpg,jpeg,png,gif,webp,mp4,mp3,pdf' });
  const raw = readFileSync(HOTLINK_CONF, 'utf8');
  const enabled = raw.includes('RewriteEngine On');
  const m = raw.match(/RewriteCond %\{HTTP_REFERER\} !www\.(.+) \[NC\]/);
  const m2 = raw.match(/RewriteRule \.\((.+?)\)\$/);
  res.json({
    enabled,
    allowed_domains: m ? [m[1]] : [],
    blocked_extensions: m2 ? m2[1].replace(/\|/g, ',') : 'jpg,jpeg,png,gif,webp,mp4,mp3,pdf',
  });
});

router.put('/hotlink', async (req: Request, res: Response) => {
  const { enabled, allowed_domains = [], blocked_extensions = 'jpg,jpeg,png,gif,webp' } = req.body;
  try {
    if (!enabled) {
      writeFileSync(HOTLINK_CONF, '# Hotlink protection disabled\n');
    } else {
      const exts = (blocked_extensions as string).replace(/,/g, '|');
      const domains = (allowed_domains as string[]).map(d => `RewriteCond %{HTTP_REFERER} !www.${d} [NC]`).join('\n');
      writeFileSync(HOTLINK_CONF, `
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteCond %{HTTP_REFERER} !^$
  ${domains}
  RewriteCond %{HTTP_REFERER} !^https?://(%{HTTP_HOST})/ [NC]
  RewriteRule \\.(${exts})$ - [F,L]
</IfModule>
`.trim() + '\n');
    }
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── MIME Types ──────────────────────────────────────────── */

const MIME_CONF = path.join(VHOST_DIR, 'custom_mime_types.conf');

router.get('/mime', (_req: Request, res: Response) => {
  if (!existsSync(MIME_CONF)) return res.json([]);
  const types = readFileSync(MIME_CONF, 'utf8')
    .split('\n')
    .filter(l => l.trim().startsWith('AddType'))
    .map(l => {
      const m = l.match(/AddType\s+(\S+)\s+(.+)/);
      return m ? { mime: m[1], extensions: m[2].trim() } : null;
    }).filter(Boolean);
  res.json(types);
});

router.post('/mime', async (req: Request, res: Response) => {
  const { mime, extensions } = req.body;
  if (!mime || !extensions) return res.status(400).json({ error: 'mime and extensions required' });
  if (!/^[a-z0-9!#$&\-^_]+\/[a-z0-9!#$&\-^_.+]+$/.test(mime)) return res.status(400).json({ error: 'Invalid MIME type format' });
  try {
    const existing = existsSync(MIME_CONF) ? readFileSync(MIME_CONF, 'utf8') : '# Managed by HostPanel\n';
    writeFileSync(MIME_CONF, existing.trimEnd() + `\nAddType ${mime} ${extensions}\n`);
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/mime', async (req: Request, res: Response) => {
  const { mime } = req.body;
  if (!existsSync(MIME_CONF)) return res.json({ success: true });
  try {
    const lines = readFileSync(MIME_CONF, 'utf8').split('\n').filter(l => !l.includes(`AddType ${mime} `));
    writeFileSync(MIME_CONF, lines.join('\n'));
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Disk Usage ──────────────────────────────────────────── */

router.get('/diskusage', async (req: Request, res: Response) => {
  const raw = (req.query.path as string) || WEBROOT;
  // Resolve and anchor the prefix check on a path separator (so /var/wwwx doesn't pass /var/www),
  // and reject any path containing shell metacharacters before interpolating into a command line.
  const resolved = path.resolve(raw);
  const base = path.resolve(WEBROOT);
  const allowed = resolved === '/' || resolved === base || resolved.startsWith(base + path.sep);
  if (!allowed) return res.status(400).json({ error: 'Path not allowed' });
  if (/[$`"'\\;&|<>\n*?(){}[\]!]/.test(resolved)) {
    return res.status(400).json({ error: 'Path contains invalid characters' });
  }
  try {
    const duResult = await runFile('du', ['-sh', '--', resolved]).catch(() => ({ stdout: '', stderr: '' }));
    const stdout = duResult.stdout;
    const items = stdout.trim().split('\n').filter(Boolean).map(l => {
      const [size, ...rest] = l.split('\t');
      return { path: rest.join('\t'), size };
    });
    const dfResult = await runFile('df', ['-h', '--', resolved]).catch(() => ({ stdout: '', stderr: '' }));
    const totalLines = dfResult.stdout.trim().split('\n');
    const total = totalLines[totalLines.length - 1] || '';
    const parts = total.trim().split(/\s+/);
    res.json({ items, disk: { total: parts[1], used: parts[2], available: parts[3], percent: parts[4] } });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Bandwidth / Traffic Stats ───────────────────────────── */

router.get('/bandwidth', async (req: Request, res: Response) => {
  try {
    // Try vnstat first
    const { stdout: vnstat } = await runFile('vnstat', ['--json']).catch(() => ({ stdout: '', stderr: '' }));
    if (vnstat) {
      const data = JSON.parse(vnstat);
      const iface = data.interfaces?.[0];
      if (iface) {
        const monthly = iface.traffic?.month?.slice(-6).map((m: any) => ({
          month: `${m.date.year}-${String(m.date.month).padStart(2, '0')}`,
          rx: m.rx,
          tx: m.tx,
        })) || [];
        return res.json({ source: 'vnstat', monthly, interface: iface.name });
      }
    }
  } catch (_) {}

  try {
    // Fall back to Apache access log
    const LOG = '/var/log/httpd/access_log';
    if (!existsSync(LOG)) return res.json({ source: 'none', monthly: [] });
    const log = readFileSync(LOG, 'utf8').split('\n').slice(-20000);
    const sums: Record<string, number> = {};
    for (const line of log) {
      const parts = line.trim().split(/\s+/);
      const route = parts[6]; const bytes = parts[9];
      if (route && /^[0-9]+$/.test(bytes)) sums[route] = (sums[route] || 0) + parseInt(bytes);
    }
    const raw = Object.entries(sums).sort((a,b)=>b[1]-a[1]).slice(0, 20).map(([k,v]) => `${k} ${v}`);
    res.json({ source: 'apache', raw });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── SSL Certificates ────────────────────────────────────── */

router.get('/ssl', async (_req: Request, res: Response) => {
  const certs: any[] = [];

  // Let's Encrypt certs
  if (existsSync(CERT_DIR)) {
    const domains = readdirSync(CERT_DIR);
    for (const domain of domains) {
      const certPath = path.join(CERT_DIR, domain, 'fullchain.pem');
      if (!existsSync(certPath)) continue;
      try {
        const { stdout } = await runFile('openssl', ['x509', '-in', certPath, '-noout', '-subject', '-dates', '-issuer']);
        const notAfter  = stdout.match(/notAfter=(.+)/)?.[1]?.trim() ?? '';
        const notBefore = stdout.match(/notBefore=(.+)/)?.[1]?.trim() ?? '';
        const issuer    = stdout.match(/issuer=(.+)/)?.[1]?.trim() ?? '';
        const expires   = notAfter ? new Date(notAfter) : null;
        const daysLeft  = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : null;
        certs.push({ domain, certPath, notBefore, notAfter, issuer, daysLeft, type: 'letsencrypt' });
      } catch (_) {}
    }
  }

  // Vhost-referenced certs
  try {
    const grepRes = await runFile('grep', ['-r', 'SSLCertificateFile', VHOST_DIR]).catch(() => ({ stdout: '', stderr: '' }));
    const stdout = grepRes.stdout;
    for (const line of stdout.split('\n').filter(Boolean)) {
      const m = line.match(/SSLCertificateFile\s+(\S+)/);
      if (!m) continue;
      const certPath = m[1];
      if (!existsSync(certPath) || certs.find(c => c.certPath === certPath)) continue;
      const { stdout: info } = await runFile('openssl', ['x509', '-in', certPath, '-noout', '-subject', '-dates', '-issuer']).catch(() => ({ stdout: '', stderr: '' }));
      const notAfter  = info.match(/notAfter=(.+)/)?.[1]?.trim() ?? '';
      const issuer    = info.match(/issuer=(.+)/)?.[1]?.trim() ?? '';
      const expires   = notAfter ? new Date(notAfter) : null;
      const daysLeft  = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : null;
      certs.push({ domain: path.basename(certPath, '.pem'), certPath, notAfter, issuer, daysLeft, type: 'custom' });
    }
  } catch (_) {}

  res.json(certs);
});

/* ── Index Manager ────────────────────────────────────────── */
// Enable or disable directory listing per domain by toggling Options Indexes in .htaccess

router.get('/index-manager', async (_req: Request, res: Response) => {
  const domains: { domain: string; listing: boolean }[] = [];
  try {
    if (!existsSync(WEBROOT)) return res.json([]);
    const dirs = readdirSync(WEBROOT);
    for (const dir of dirs) {
      const htaccess = path.join(WEBROOT, dir, '.htaccess');
      let listing = false;
      if (existsSync(htaccess)) {
        const content = require('fs').readFileSync(htaccess, 'utf8');
        listing = /Options\s+.*Indexes/i.test(content) && !/Options\s+-Indexes/i.test(content);
      }
      domains.push({ domain: dir, listing });
    }
    res.json(domains);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/index-manager/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  const { listing } = req.body;
  const safe = domain.replace(/[^a-zA-Z0-9._-]/g, '');
  const htaccess = path.join(WEBROOT, safe, '.htaccess');
  try {
    let content = existsSync(htaccess) ? require('fs').readFileSync(htaccess, 'utf8') : '';
    // Remove existing Options Indexes lines
    content = content.replace(/^Options\s+.*Indexes.*$/gmi, '').trim();
    if (listing) content += '\nOptions +Indexes\n';
    else content += '\nOptions -Indexes\n';
    require('fs').writeFileSync(htaccess, content.trim() + '\n');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Leech Protection ─────────────────────────────────────── */
// Prevent credential sharing by limiting logins per password

router.get('/leech', (_req: Request, res: Response) => {
  const conf = path.join(VHOST_DIR, 'leech_protection.conf');
  if (!existsSync(conf)) return res.json({ enabled: false, domains: [] });
  const content = require('fs').readFileSync(conf, 'utf8');
  const domains = [...content.matchAll(/# LEECH:(\S+)/g)].map(m => m[1]);
  res.json({ enabled: true, domains });
});

router.post('/leech', async (req: Request, res: Response) => {
  const { domain, max_logins = 2, redirect_url = '' } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  const safe = domain.replace(/[^a-zA-Z0-9._-]/g, '');
  const dir = path.join(WEBROOT, safe);
  const htaccess = path.join(dir, '.htaccess');
  try {
    let content = existsSync(htaccess) ? require('fs').readFileSync(htaccess, 'utf8') : '';
    if (!content.includes('AuthType Basic')) {
      content += `\n# LEECH:${safe}\nAuthType Basic\nAuthName "Protected"\nAuthUserFile ${dir}/.htpasswd\nRequire valid-user\n`;
      require('fs').writeFileSync(htaccess, content);
    }
    res.json({ success: true, message: `Leech protection enabled for ${domain}` });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/leech/:domain', async (req: Request, res: Response) => {
  const safe = req.params.domain.replace(/[^a-zA-Z0-9._-]/g, '');
  const htaccess = path.join(WEBROOT, safe, '.htaccess');
  try {
    if (!existsSync(htaccess)) return res.json({ success: true });
    let content = require('fs').readFileSync(htaccess, 'utf8');
    content = content.replace(/# LEECH:[^\n]+\n[\s\S]*?Require valid-user\n?/g, '').trim();
    require('fs').writeFileSync(htaccess, content + '\n');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
