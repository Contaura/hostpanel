import { Router, Response } from 'express';
import { runFile } from '../utils/process-runner';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();

const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';
const WEBROOT = process.env.WEBROOT || '/var/www';
const NAMED_DIR = process.env.NAMED_DIR || '/etc/named';
const NAMED_CONF = process.env.NAMED_CONF || '/etc/named.conf';

function sanitizeDomain(domain: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}[a-zA-Z0-9]$/.test(domain);
}

router.get('/domains', async (_req: AuthRequest, res: Response) => {
  try {
    const files = await fs.readdir(VHOST_DIR).catch(() => [] as string[]);
    const domains = files
      .filter(f => f.endsWith('.conf') && !f.startsWith('ssl_'))
      .map(f => f.replace('.conf', ''));
    res.json(domains);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/domains', async (req: AuthRequest, res: Response) => {
  const { domain, phpVersion = '8.2' } = req.body;
  if (!domain || !sanitizeDomain(domain)) {
    res.status(400).json({ error: 'Invalid domain name' });
    return;
  }

  const docRoot = path.join(WEBROOT, domain, 'public_html');
  const vhostConf = `<VirtualHost *:80>
    ServerName ${domain}
    ServerAlias www.${domain}
    DocumentRoot ${docRoot}
    ErrorLog /var/log/httpd/${domain}-error.log
    CustomLog /var/log/httpd/${domain}-access.log combined

    <Directory ${docRoot}>
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
`;

  try {
    await fs.mkdir(docRoot, { recursive: true });
    await fs.writeFile(path.join(VHOST_DIR, `${domain}.conf`), vhostConf);
    await fs.writeFile(
      path.join(docRoot, 'index.html'),
      `<html><body><h1>Welcome to ${domain}</h1><p>Hosted by HostPanel</p></body></html>`
    );
    await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ message: `Domain ${domain} added` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/domains/:domain', async (req: AuthRequest, res: Response) => {
  const { domain } = req.params;
  if (!sanitizeDomain(domain)) {
    res.status(400).json({ error: 'Invalid domain name' });
    return;
  }

  try {
    await fs.unlink(path.join(VHOST_DIR, `${domain}.conf`)).catch(() => {});
    await fs.unlink(path.join(VHOST_DIR, `ssl_${domain}.conf`)).catch(() => {});
    await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ message: `Domain ${domain} removed` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ssl/:domain', async (req: AuthRequest, res: Response) => {
  const { domain } = req.params;
  const { email } = req.body;
  if (!sanitizeDomain(domain)) {
    res.status(400).json({ error: 'Invalid domain name' });
    return;
  }

  try {
    if (email && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    const args = ['--apache', '-d', domain, '-d', `www.${domain}`, '--agree-tos', '--non-interactive'];
    if (email) args.push('--email', email);
    else args.push('--register-unsafely-without-email');
    const { stdout } = await runFile('certbot', args);
    res.json({ message: 'SSL certificate issued', output: stdout });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/dns/:domain', async (req: AuthRequest, res: Response) => {
  const { domain } = req.params;
  if (!sanitizeDomain(domain)) {
    res.status(400).json({ error: 'Invalid domain name' });
    return;
  }

  try {
    const zoneFile = path.join(NAMED_DIR, `${domain}.zone`);
    const content = await fs.readFile(zoneFile, 'utf-8').catch(() => null);
    if (!content) {
      res.json({ records: [] });
      return;
    }

    // Parse basic zone file records
    const records: { type: string; name: string; value: string; ttl: string }[] = [];
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith(';'));
    for (const line of lines) {
      const match = line.match(/^(\S+)\s+(\d+)?\s*IN\s+(\w+)\s+(.+)$/);
      if (match) {
        records.push({ name: match[1], ttl: match[2] || '3600', type: match[3], value: match[4].trim() });
      }
    }
    res.json({ records });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/dns/:domain', async (req: AuthRequest, res: Response) => {
  const { domain } = req.params;
  const { name, type, value, ttl = '3600' } = req.body;

  const allowedTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'];
  if (!allowedTypes.includes(type)) {
    res.status(400).json({ error: `Record type must be one of: ${allowedTypes.join(', ')}` });
    return;
  }
  // Reject missing/blank name + value up front. The previous form happily
  // wrote "undefined" into the zone file when the caller omitted a field,
  // which then came back through GET /dns/:domain as a record with
  // name="undefined". Whitespace is also disallowed since it would break
  // the tab-separated zone line we emit below.
  if (typeof name !== 'string' || !name || /\s/.test(name)) {
    return res.status(400).json({ error: 'name is required and must not contain whitespace' });
  }
  if (typeof value !== 'string' || !value.trim()) {
    return res.status(400).json({ error: 'value is required' });
  }
  if (!/^\d+$/.test(String(ttl))) {
    return res.status(400).json({ error: 'ttl must be a positive integer' });
  }

  try {
    const zoneFile = path.join(NAMED_DIR, `${domain}.zone`);
    const record = `${name}\t${ttl}\tIN\t${type}\t${value}\n`;
    await fs.appendFile(zoneFile, record);
    await runFile('rndc', ['reload']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ message: 'DNS record added' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── DNS record delete (by index) ────────────────────────── */

router.delete('/dns/:domain/:index', async (req: AuthRequest, res: Response) => {
  const { domain } = req.params;
  const idx = parseInt(req.params.index);
  if (!sanitizeDomain(domain) || isNaN(idx)) return res.status(400).json({ error: 'Invalid params' });
  try {
    const zoneFile = path.join(NAMED_DIR, `${domain}.zone`);
    const content = await fs.readFile(zoneFile, 'utf-8').catch(() => '');
    const lines = content.split('\n');
    const recordLines: number[] = [];
    lines.forEach((l, i) => { if (/^\S+\s+\d*\s*IN\s+\w+\s+.+/.test(l.trim())) recordLines.push(i); });
    if (idx < 0 || idx >= recordLines.length) return res.status(404).json({ error: 'Record index out of range' });
    lines.splice(recordLines[idx], 1);
    await fs.writeFile(zoneFile, lines.join('\n'));
    await runFile('rndc', ['reload']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── DNS record update (by index) ────────────────────────── */

router.put('/dns/:domain/:index', async (req: AuthRequest, res: Response) => {
  const { domain } = req.params;
  const idx = parseInt(req.params.index);
  const { name, type, value, ttl = '3600' } = req.body;
  if (!sanitizeDomain(domain) || isNaN(idx)) return res.status(400).json({ error: 'Invalid params' });
  const allowedTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'];
  if (!allowedTypes.includes(type)) return res.status(400).json({ error: 'Invalid record type' });
  try {
    const zoneFile = path.join(NAMED_DIR, `${domain}.zone`);
    const content = await fs.readFile(zoneFile, 'utf-8').catch(() => '');
    const lines = content.split('\n');
    const recordLines: number[] = [];
    lines.forEach((l, i) => { if (/^\S+\s+\d*\s*IN\s+\w+\s+.+/.test(l.trim())) recordLines.push(i); });
    if (idx < 0 || idx >= recordLines.length) return res.status(404).json({ error: 'Record index out of range' });
    lines[recordLines[idx]] = `${name}\t${ttl}\tIN\t${type}\t${value}`;
    await fs.writeFile(zoneFile, lines.join('\n'));
    await runFile('rndc', ['reload']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── DNSSEC ─────────────────────────────────────────────── */

router.get('/dnssec/:domain/status', (req: AuthRequest, res: Response) => {
  const { domain } = req.params;
  if (!sanitizeDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const { existsSync } = require('fs');
  const signed = existsSync(path.join(NAMED_DIR, `${domain}.zone.signed`));
  const hasKeys = existsSync(path.join(NAMED_DIR, `K${domain}.+`)) ||
    require('fs').readdirSync(NAMED_DIR).some((f: string) => f.startsWith(`K${domain}.`));
  res.json({ signed, has_keys: hasKeys });
});

router.post('/dnssec/:domain/sign', async (req: AuthRequest, res: Response) => {
  const { domain } = req.params;
  if (!sanitizeDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    // Generate ZSK and KSK if not present
    const keys = require('fs').readdirSync(NAMED_DIR).filter((f: string) => f.startsWith(`K${domain}.`) && f.endsWith('.key'));
    if (keys.length < 2) {
      await runFile('dnssec-keygen', ['-a', 'NSEC3RSASHA1', '-b', '2048', '-n', 'ZONE', domain], { cwd: NAMED_DIR, timeout: 60000 });
      await runFile('dnssec-keygen', ['-a', 'NSEC3RSASHA1', '-b', '1024', '-n', 'ZONE', '-f', 'KSK', domain], { cwd: NAMED_DIR, timeout: 60000 });
    }
    const salt = require('crypto').randomBytes(8).toString('hex');
    const { stdout } = await runFile('dnssec-signzone', ['-A', '-3', salt, '-N', 'increment', '-o', domain, '-t', `${NAMED_DIR}/${domain}.zone`], { cwd: NAMED_DIR, timeout: 120000 });
    await runFile('rndc', ['reload']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true, output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/dnssec/:domain/unsign', async (req: AuthRequest, res: Response) => {
  const { domain } = req.params;
  if (!sanitizeDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const fsSync = require('fs');
    for (const f of fsSync.readdirSync(NAMED_DIR).filter((name: string) => name === `${domain}.zone.signed` || (name.startsWith(`K${domain}.`) && (name.endsWith('.key') || name.endsWith('.private'))))) {
      fsSync.rmSync(path.join(NAMED_DIR, f), { force: true });
    }
    await runFile('rndc', ['reload']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
