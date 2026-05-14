import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';

const router = Router();
const execAsync = promisify(exec);
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
    await execAsync('apachectl graceful').catch(() => {});
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
    await execAsync('apachectl graceful').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/mime', async (req: Request, res: Response) => {
  const { mime } = req.body;
  if (!existsSync(MIME_CONF)) return res.json({ success: true });
  try {
    const lines = readFileSync(MIME_CONF, 'utf8').split('\n').filter(l => !l.includes(`AddType ${mime} `));
    writeFileSync(MIME_CONF, lines.join('\n'));
    await execAsync('apachectl graceful').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Disk Usage ──────────────────────────────────────────── */

router.get('/diskusage', async (req: Request, res: Response) => {
  const target = (req.query.path as string) || WEBROOT;
  if (!target.startsWith(WEBROOT) && target !== '/') return res.status(400).json({ error: 'Path not allowed' });
  try {
    const { stdout } = await execAsync(`du -sh ${target}/* 2>/dev/null | sort -hr | head -50`);
    const items = stdout.trim().split('\n').filter(Boolean).map(l => {
      const [size, ...rest] = l.split('\t');
      return { path: rest.join('\t'), size };
    });
    const { stdout: total } = await execAsync(`df -h ${target} | tail -1`);
    const parts = total.trim().split(/\s+/);
    res.json({ items, disk: { total: parts[1], used: parts[2], available: parts[3], percent: parts[4] } });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Bandwidth / Traffic Stats ───────────────────────────── */

router.get('/bandwidth', async (req: Request, res: Response) => {
  try {
    // Try vnstat first
    const { stdout: vnstat } = await execAsync('vnstat --json 2>/dev/null').catch(() => ({ stdout: '' }));
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
    const { stdout } = await execAsync(`awk '{print $7, $10}' ${LOG} | awk 'NF==2 && $2~/^[0-9]+$/' | awk '{sum[$1]+=$2} END{for(k in sum) print k, sum[k]}' | sort | head -100`);
    res.json({ source: 'apache', raw: stdout.trim().split('\n').slice(0, 20) });
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
        const { stdout } = await execAsync(`openssl x509 -in ${certPath} -noout -subject -dates -issuer 2>/dev/null`);
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
    const { stdout } = await execAsync(`grep -r SSLCertificateFile ${VHOST_DIR} 2>/dev/null`);
    for (const line of stdout.split('\n').filter(Boolean)) {
      const m = line.match(/SSLCertificateFile\s+(\S+)/);
      if (!m) continue;
      const certPath = m[1];
      if (!existsSync(certPath) || certs.find(c => c.certPath === certPath)) continue;
      const { stdout: info } = await execAsync(`openssl x509 -in ${certPath} -noout -subject -dates -issuer 2>/dev/null`).catch(() => ({ stdout: '' }));
      const notAfter  = info.match(/notAfter=(.+)/)?.[1]?.trim() ?? '';
      const issuer    = info.match(/issuer=(.+)/)?.[1]?.trim() ?? '';
      const expires   = notAfter ? new Date(notAfter) : null;
      const daysLeft  = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : null;
      certs.push({ domain: path.basename(certPath, '.pem'), certPath, notAfter, issuer, daysLeft, type: 'custom' });
    }
  } catch (_) {}

  res.json(certs);
});

export default router;
