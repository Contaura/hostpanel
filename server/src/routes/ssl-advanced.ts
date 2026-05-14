import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const router = Router();
const execAsync = promisify(exec);
const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';
const SSL_CONF  = path.join(VHOST_DIR, 'ssl_ciphers.conf');

/* ── SSL/TLS cipher configuration ───────────────────────── */

const CIPHER_PRESETS: Record<string, any> = {
  modern: {
    protocols: 'TLSv1.3',
    ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
    hsts: true,
  },
  intermediate: {
    protocols: 'TLSv1.2 TLSv1.3',
    ciphers: 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384',
    hsts: true,
  },
  old: {
    protocols: 'TLSv1 TLSv1.1 TLSv1.2 TLSv1.3',
    ciphers: 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:AES128-GCM-SHA256:AES256-SHA',
    hsts: false,
  },
};

router.get('/ciphers', (_req: Request, res: Response) => {
  let current = CIPHER_PRESETS.intermediate;
  if (existsSync(SSL_CONF)) {
    const conf = readFileSync(SSL_CONF, 'utf8');
    const proto = conf.match(/SSLProtocol\s+(.+)/)?.[1]?.trim() || '';
    const cipher = conf.match(/SSLCipherSuite\s+(.+)/)?.[1]?.trim() || '';
    const hsts = conf.includes('Strict-Transport-Security');
    current = { protocols: proto, ciphers: cipher, hsts };
  }
  res.json({ current, presets: Object.keys(CIPHER_PRESETS) });
});

router.put('/ciphers', async (req: Request, res: Response) => {
  const { preset, protocols, ciphers, hsts } = req.body;
  const cfg = preset && CIPHER_PRESETS[preset] ? CIPHER_PRESETS[preset] : { protocols, ciphers, hsts };
  try {
    const conf = `
# SSL/TLS configuration — managed by HostPanel
SSLProtocol ${cfg.protocols}
SSLCipherSuite ${cfg.ciphers}
SSLHonorCipherOrder on
SSLCompression off
SSLSessionTickets off
${cfg.hsts ? 'Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"' : ''}
`.trim() + '\n';
    writeFileSync(SSL_CONF, conf);
    await execAsync('apachectl graceful').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Wildcard SSL (Let's Encrypt DNS challenge) ───────────── */

router.post('/wildcard', async (req: Request, res: Response) => {
  const { domain, dns_plugin, credentials_file } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  const plugin = dns_plugin || 'cloudflare';
  const credFlag = credentials_file ? `--${plugin}-credentials ${credentials_file}` : '';
  try {
    const { stdout, stderr } = await execAsync(
      `certbot certonly --dns-${plugin} ${credFlag} -d "${domain}" -d "*.${domain}" --non-interactive --agree-tos --email $(grep company_email /etc/hostpanel.env 2>/dev/null | cut -d= -f2) 2>&1`,
      { timeout: 180000 }
    ).catch(e => ({ stdout: '', stderr: e.message }));
    res.json({ output: stdout + stderr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Per-domain SSL test ─────────────────────────────────── */

router.get('/test/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  try {
    const { stdout } = await execAsync(`echo | openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -subject -dates -issuer 2>/dev/null`);
    const notAfter  = stdout.match(/notAfter=(.+)/)?.[1]?.trim() || '';
    const notBefore = stdout.match(/notBefore=(.+)/)?.[1]?.trim() || '';
    const issuer    = stdout.match(/issuer=(.+)/)?.[1]?.trim() || '';
    const subject   = stdout.match(/subject=(.+)/)?.[1]?.trim() || '';
    const expires   = notAfter ? new Date(notAfter) : null;
    const daysLeft  = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : null;
    res.json({ domain, subject, issuer, notBefore, notAfter, daysLeft, valid: !!notAfter });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Certificate auto-renew status ───────────────────────── */

router.get('/renew-status', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('certbot certificates 2>&1', { timeout: 30000 });
    const certs: any[] = [];
    const certBlocks = stdout.split(/\n\s*-+\s*\n/);
    for (const block of certBlocks) {
      const name    = block.match(/Certificate Name:\s*(.+)/)?.[1]?.trim();
      const domains = block.match(/Domains:\s*(.+)/)?.[1]?.trim();
      const expiry  = block.match(/Expiry Date:\s*(.+)/)?.[1]?.trim();
      const valid   = block.match(/\(VALID:/)?.[0] ? true : false;
      const days    = block.match(/VALID: (\d+)/)?.[1];
      if (name) certs.push({ name, domains, expiry, valid, days_left: days ? parseInt(days) : null });
    }
    res.json(certs);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/renew/:name', async (req: Request, res: Response) => {
  const { name } = req.params;
  if (!name || /[^a-zA-Z0-9._-]/.test(name)) return res.status(400).json({ error: 'Invalid cert name' });
  try {
    const { stdout, stderr } = await execAsync(`certbot renew --cert-name "${name}" --force-renewal 2>&1`, { timeout: 120000 });
    res.json({ output: stdout + stderr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/renew-all', async (_req: Request, res: Response) => {
  try {
    const { stdout, stderr } = await execAsync('certbot renew 2>&1', { timeout: 300000 });
    res.json({ output: stdout + stderr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

