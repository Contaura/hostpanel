import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, promises as fsp } from 'fs';
import path from 'path';
import tls from 'tls';
import { runFile } from '../utils/process-runner';

const router = Router();
const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';
const SSL_CONF  = path.join(VHOST_DIR, 'ssl_ciphers.conf');
const HOSTPANEL_ENV_FILE = process.env.HOSTPANEL_ENV_FILE || '/etc/hostpanel.env';

const DOMAIN_RE   = /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
const WILDCARD_RE = /^[a-zA-Z0-9._*-]+$/;
const EMAIL_RE    = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function readCompanyEmail(): string | null {
  try {
    const content = readFileSync(HOSTPANEL_ENV_FILE, 'utf8');
    const m = content.match(/^\s*company_email\s*=\s*(.+)\s*$/m);
    if (!m) return null;
    const v = m[1].trim().replace(/^['"]|['"]$/g, '');
    return EMAIL_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

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
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Wildcard SSL (Let's Encrypt DNS challenge) ───────────── */

router.post('/wildcard', async (req: Request, res: Response) => {
  const { domain, dns_plugin, credentials_file } = req.body;
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const plugin = (dns_plugin || 'cloudflare').toString();
  if (!/^[a-z0-9]+$/.test(plugin)) {
    return res.status(400).json({ error: 'Invalid dns_plugin' });
  }
  let credPath: string | null = null;
  if (credentials_file) {
    const credStr = String(credentials_file);
    const resolved = path.resolve(credStr);
    if (resolved !== credStr || !/^[\w./@\-+]+$/.test(credStr)) {
      return res.status(400).json({ error: 'Invalid credentials_file path' });
    }
    if (!existsSync(resolved)) {
      return res.status(400).json({ error: 'credentials_file does not exist' });
    }
    credPath = resolved;
  }
  const email = readCompanyEmail();
  if (!email) {
    return res.status(400).json({ error: 'No valid company_email configured in hostpanel.env' });
  }
  try {
    const args = [
      'certonly',
      `--dns-${plugin}`,
      ...(credPath ? [`--${plugin}-credentials`, credPath] : []),
      '-d', domain,
      '-d', `*.${domain}`,
      '--non-interactive',
      '--agree-tos',
      '--email', email,
    ];
    const { stdout, stderr } = await runFile('certbot', args, { timeout: 180000 })
      .catch((e: any) => ({ stdout: '', stderr: e.message }));
    res.json({ output: stdout + stderr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Per-domain SSL test ─────────────────────────────────── */

function fetchPeerCertPem(host: string, port = 443): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 10000 }, () => {
      const peer = socket.getPeerCertificate(true);
      socket.end();
      if (!peer || !peer.raw) return reject(new Error('No peer certificate'));
      const b64 = peer.raw.toString('base64');
      const lines = b64.match(/.{1,64}/g) || [];
      resolve('-----BEGIN CERTIFICATE-----\n' + lines.join('\n') + '\n-----END CERTIFICATE-----\n');
    });
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(new Error('TLS connect timeout')); });
  });
}

function opensslX509Info(pem: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('openssl', ['x509', '-noout', '-subject', '-dates', '-issuer'], { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`openssl x509 exited ${code}: ${stderr}`));
      resolve(stdout);
    });
    child.stdin.write(pem);
    child.stdin.end();
  });
}

router.get('/test/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const pem = await fetchPeerCertPem(domain);
    const stdout = await opensslX509Info(pem);
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
    await fsp.mkdir(challengeDir, { recursive: true });
    await fsp.writeFile(testFile, 'ok\n');

    // Wait briefly then probe via HTTP
    await new Promise(r => setTimeout(r, 500));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    let body = '';
    let fetchErr = '';
    try {
      const resp = await fetch(`http://${domain}/.well-known/acme-challenge/${testToken}`, { redirect: 'follow', signal: ctrl.signal });
      body = await resp.text();
    } catch (e: any) {
      fetchErr = e.message || String(e);
    } finally {
      clearTimeout(timer);
    }
    const reachable = body.trim() === 'ok';

    await fsp.rm(testFile, { force: true }).catch(() => {});

    res.json({
      domain,
      reachable,
      response: body.trim() || fetchErr,
      note: reachable
        ? 'HTTP-01 challenge path is accessible — certificate issuance should work.'
        : 'Challenge path not reachable. Check DNS, firewall, and webroot.',
    });
  } catch (err: any) {
    await fsp.rm(testFile, { force: true }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

/* ── Certificate auto-renew status ───────────────────────── */

router.get('/renew-status', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await runFile('certbot', ['certificates'], { timeout: 30000 });
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
    const { stdout, stderr } = await runFile('certbot', ['renew', '--cert-name', name, '--force-renewal'], { timeout: 120000 });
    res.json({ output: stdout + stderr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/renew-all', async (_req: Request, res: Response) => {
  try {
    const { stdout, stderr } = await runFile('certbot', ['renew'], { timeout: 300000 });
    res.json({ output: stdout + stderr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── CSR generator ───────────────────────────────────────── */

function sanitizeSubjectComponent(s: string, max = 64): string {
  // Strip characters that are special inside an OpenSSL subject DN
  // (separators / =), shell metacharacters that could escape an exec, and
  // any control bytes. Result is always safe to embed in a -subj string.
  return String(s).replace(/[\/=+,\\"`$()<>;|&!\r\n\t\0]/g, '').slice(0, max);
}

router.post('/csr', async (req: Request, res: Response) => {
  const { domain, country = 'US', state = 'CA', city = 'San Francisco', org = 'My Company', email = '' } = req.body;
  if (!domain || !WILDCARD_RE.test(domain) || /[^a-zA-Z0-9._*-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const safeCountry = sanitizeSubjectComponent(country, 2);
  const safeState   = sanitizeSubjectComponent(state);
  const safeCity    = sanitizeSubjectComponent(city);
  const safeOrg     = sanitizeSubjectComponent(org);
  const safeEmail   = String(email).replace(/[^a-zA-Z0-9.@_+-]/g, '').slice(0, 64);
  if (safeEmail && !EMAIL_RE.test(safeEmail)) return res.status(400).json({ error: 'Invalid email' });
  const safe = domain.replace(/\*/g, 'wildcard').replace(/[^a-zA-Z0-9._-]/g, '_');
  const keyFile = `/tmp/hp_${safe}.key`;
  const csrFile = `/tmp/hp_${safe}.csr`;
  const subject = `/C=${safeCountry}/ST=${safeState}/L=${safeCity}/O=${safeOrg}/CN=${domain}${safeEmail ? `/emailAddress=${safeEmail}` : ''}`;
  try {
    await runFile('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', csrFile, '-subj', subject]);
    const csr = await fsp.readFile(csrFile, 'utf8');
    const key = await fsp.readFile(keyFile, 'utf8');
    await fsp.rm(keyFile, { force: true }).catch(() => {});
    await fsp.rm(csrFile, { force: true }).catch(() => {});
    res.json({ csr, private_key: key, domain, subject });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Self-signed certificate generator ──────────────────── */

router.post('/self-signed', async (req: Request, res: Response) => {
  const { domain, days = 365, country = 'US', org = 'My Company' } = req.body;
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const safeCountry = sanitizeSubjectComponent(country, 2);
  const safeOrg     = sanitizeSubjectComponent(org);
  const numDays     = parseInt(String(days)) || 365;
  if (numDays < 1 || numDays > 36500) return res.status(400).json({ error: 'Invalid days' });
  const safe = domain.replace(/[^a-zA-Z0-9._-]/g, '_');
  const keyFile = `/tmp/hp_ss_${safe}.key`;
  const crtFile = `/tmp/hp_ss_${safe}.crt`;
  const subject = `/C=${safeCountry}/O=${safeOrg}/CN=${domain}`;
  try {
    await runFile('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', crtFile, '-days', String(numDays), '-subj', subject]);
    const cert = await fsp.readFile(crtFile, 'utf8');
    const key  = await fsp.readFile(keyFile, 'utf8');
    await fsp.rm(keyFile, { force: true }).catch(() => {});
    await fsp.rm(crtFile, { force: true }).catch(() => {});
    res.json({ certificate: cert, private_key: key, domain, days: numDays });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Certificate import ──────────────────────────────────── */

router.post('/import', async (req: Request, res: Response) => {
  const { domain, certificate, private_key, ca_bundle } = req.body;
  if (!domain || !certificate || !private_key) return res.status(400).json({ error: 'domain, certificate, private_key required' });
  if (/[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const LE_DIR = `/etc/letsencrypt/live/${domain}`;
  try {
    await fsp.mkdir(LE_DIR, { recursive: true });
    await fsp.writeFile(`${LE_DIR}/fullchain.pem`, (certificate + '\n' + (ca_bundle || '')).trim() + '\n');
    await fsp.writeFile(`${LE_DIR}/privkey.pem`, private_key.trim() + '\n');
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true, domain, path: LE_DIR });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
