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
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const plugin = (dns_plugin || 'cloudflare').toString();
  // certbot DNS plugins are named like "cloudflare", "route53", "digitalocean".
  // Restrict to a lowercase-alphanumeric token before letting it land in the
  // shell command line or anywhere it could affect argv parsing.
  if (!/^[a-z0-9]+$/.test(plugin)) {
    return res.status(400).json({ error: 'Invalid dns_plugin' });
  }
  // credentials_file must be an absolute, normalised path with no shell
  // metacharacters. We don't enforce a fixed directory because operators
  // legitimately keep these in /root, /etc/letsencrypt, /home/..., etc.
  let credFlag = '';
  if (credentials_file) {
    const credStr = String(credentials_file);
    const resolved = path.resolve(credStr);
    if (resolved !== credStr || !/^[\w./@\-+]+$/.test(credStr)) {
      return res.status(400).json({ error: 'Invalid credentials_file path' });
    }
    if (!existsSync(resolved)) {
      return res.status(400).json({ error: 'credentials_file does not exist' });
    }
    credFlag = `--${plugin}-credentials "${resolved}"`;
  }
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
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const { stdout } = await execAsync(`echo | openssl s_client -connect "${domain}:443" -servername "${domain}" 2>/dev/null | openssl x509 -noout -subject -dates -issuer 2>/dev/null`);
    const notAfter  = stdout.match(/notAfter=(.+)/)?.[1]?.trim() || '';
    const notBefore = stdout.match(/notBefore=(.+)/)?.[1]?.trim() || '';
    const issuer    = stdout.match(/issuer=(.+)/)?.[1]?.trim() || '';
    const subject   = stdout.match(/subject=(.+)/)?.[1]?.trim() || '';
    const expires   = notAfter ? new Date(notAfter) : null;
    const daysLeft  = expires ? Math.ceil((expires.getTime() - Date.now()) / 86400000) : null;
    res.json({ domain, subject, issuer, notBefore, notAfter, daysLeft, valid: !!notAfter });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── ACME HTTP-01 challenge reachability check ──────────── */

router.get('/acme-check/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });

  const testToken = `hostpanel_test_${Date.now()}`;
  const challengeDir = `/var/www/${domain}/public_html/.well-known/acme-challenge`;
  const testFile = `${challengeDir}/${testToken}`;

  try {
    await execAsync(`mkdir -p "${challengeDir}" && echo "ok" > "${testFile}"`);

    // Wait briefly then probe via HTTP
    await new Promise(r => setTimeout(r, 500));
    const { stdout, stderr } = await execAsync(`curl -sL --max-time 10 "http://${domain}/.well-known/acme-challenge/${testToken}" 2>&1`);
    const reachable = stdout.trim() === 'ok';

    await execAsync(`rm -f "${testFile}"`).catch(() => {});

    res.json({ domain, reachable, response: stdout.trim(), note: reachable ? 'HTTP-01 challenge path is accessible — certificate issuance should work.' : 'Challenge path not reachable. Check DNS, firewall, and webroot.' });
  } catch (err: any) {
    await execAsync(`rm -f "${testFile}"`).catch(() => {});
    res.status(500).json({ error: err.message });
  }
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

/* ── CSR generator ───────────────────────────────────────── */

router.post('/csr', async (req: Request, res: Response) => {
  const { domain, country = 'US', state = 'CA', city = 'San Francisco', org = 'My Company', email = '' } = req.body;
  if (!domain || /[^a-zA-Z0-9._*-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const stripSubj = (s: string) => String(s).replace(/["\\\/]/g, '').slice(0, 64);
  const safeCountry = stripSubj(country).slice(0, 2);
  const safeState   = stripSubj(state);
  const safeCity    = stripSubj(city);
  const safeOrg     = stripSubj(org);
  const safeEmail   = String(email).replace(/[^a-zA-Z0-9.@_+-]/g, '').slice(0, 64);
  const safe = domain.replace(/\*/g, 'wildcard').replace(/[^a-zA-Z0-9._-]/g, '_');
  const keyFile = `/tmp/hp_${safe}.key`;
  const csrFile = `/tmp/hp_${safe}.csr`;
  const subject = `/C=${safeCountry}/ST=${safeState}/L=${safeCity}/O=${safeOrg}/CN=${domain}${safeEmail ? `/emailAddress=${safeEmail}` : ''}`;
  try {
    await execAsync(`openssl req -newkey rsa:2048 -nodes -keyout "${keyFile}" -out "${csrFile}" -subj "${subject}" 2>/dev/null`);
    const { stdout: csr } = await execAsync(`cat "${csrFile}"`);
    const { stdout: key } = await execAsync(`cat "${keyFile}"`);
    await execAsync(`rm -f "${keyFile}" "${csrFile}"`).catch(() => {});
    res.json({ csr, private_key: key, domain, subject });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Self-signed certificate generator ──────────────────── */

router.post('/self-signed', async (req: Request, res: Response) => {
  const { domain, days = 365, country = 'US', org = 'My Company' } = req.body;
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const stripSubj = (s: string) => String(s).replace(/["\\\/]/g, '').slice(0, 64);
  const safeCountry = stripSubj(country).slice(0, 2);
  const safeOrg     = stripSubj(org);
  const safe = domain.replace(/[^a-zA-Z0-9._-]/g, '_');
  const keyFile = `/tmp/hp_ss_${safe}.key`;
  const crtFile = `/tmp/hp_ss_${safe}.crt`;
  try {
    await execAsync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyFile}" -out "${crtFile}" -days ${parseInt(String(days)) || 365} -subj "/C=${safeCountry}/O=${safeOrg}/CN=${domain}" 2>/dev/null`);
    const { stdout: cert } = await execAsync(`cat "${crtFile}"`);
    const { stdout: key } = await execAsync(`cat "${keyFile}"`);
    await execAsync(`rm -f "${keyFile}" "${crtFile}"`).catch(() => {});
    res.json({ certificate: cert, private_key: key, domain, days });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Certificate import ──────────────────────────────────── */

router.post('/import', async (req: Request, res: Response) => {
  const { domain, certificate, private_key, ca_bundle } = req.body;
  if (!domain || !certificate || !private_key) return res.status(400).json({ error: 'domain, certificate, private_key required' });
  if (/[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const LE_DIR = `/etc/letsencrypt/live/${domain}`;
  try {
    await execAsync(`mkdir -p "${LE_DIR}"`);
    const { writeFileSync } = await import('fs');
    writeFileSync(`${LE_DIR}/fullchain.pem`, (certificate + '\n' + (ca_bundle || '')).trim() + '\n');
    writeFileSync(`${LE_DIR}/privkey.pem`, private_key.trim() + '\n');
    await execAsync('apachectl graceful').catch(() => {});
    res.json({ success: true, domain, path: LE_DIR });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

