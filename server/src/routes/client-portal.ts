import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import db from '../db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const speakeasy = require('speakeasy');
import QRCode from 'qrcode';

const execAsync = promisify(exec);
const PORTAL_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}[a-zA-Z0-9]$/;
const PORTAL_EMAIL_RE  = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PORTAL_NAMED_DIR  = process.env.NAMED_DIR  || '/etc/named';
const PORTAL_VMAIL_DIR  = process.env.VMAIL_DIR  || '/etc/postfix/vmail';
const PORTAL_PASSWD_FILE = process.env.MAIL_PASSWD || '/etc/dovecot/users';
const PORTAL_WEBROOT     = process.env.WEBROOT    || '/var/www';

// Ownership boundary for every per-domain portal route. A client may only act
// on a domain that's attached (via accounts.client_id) to one of their hosting
// accounts. Terminated accounts don't grant access.
function clientOwnsDomain(clientId: number, domain: string): boolean {
  return !!db.prepare("SELECT 1 FROM accounts WHERE client_id = ? AND domain = ? AND status != 'terminated'").get(clientId, domain);
}

// Username prefixes the client is allowed to use for FTP / DB / DB-user
// names. Same cPanel convention: every resource a tenant creates is
// namespaced under their hosting account's username (e.g. `marcos_blog`).
// Returns ['username1', 'username2', ...] for all of the client's non-
// terminated accounts.
function clientAccountUsernames(clientId: number): string[] {
  const rows = db.prepare("SELECT DISTINCT username FROM accounts WHERE client_id = ? AND status != 'terminated'").all(clientId) as { username: string }[];
  return rows.map(r => r.username).filter(u => /^[a-zA-Z][a-zA-Z0-9_]{1,31}$/.test(u));
}

// Returns the account-username if `name` is prefixed with one of the
// client's hosting account usernames followed by an underscore, otherwise
// null. Used to scope DB / FTP namespace.
function clientPrefixOwner(clientId: number, name: string): string | null {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) return null;
  for (const u of clientAccountUsernames(clientId)) {
    if (name === u || name.startsWith(u + '_')) return u;
  }
  return null;
}

db.prepare(`CREATE TABLE IF NOT EXISTS client_totp (
  client_id INTEGER PRIMARY KEY,
  secret TEXT NOT NULL,
  enabled INTEGER DEFAULT 0
)`).run();

const router = Router();

function jwtSecret() {
  return process.env.JWT_SECRET || 'hostpanel-secret-change-in-production';
}

function clientAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(auth.slice(7), jwtSecret(), { algorithms: ['HS256'] }) as any;
    if (payload.role !== 'client') return res.status(403).json({ error: 'Forbidden' });
    (req as any).clientId = payload.clientId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/* ── Login ───────────────────────────────────────────────── */

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  // Use a single generic message for every failure path below so that an
  // attacker can't tell "no such email" from "portal disabled" from "wrong
  // password" from "password not set". The dummy bcrypt.compare against a
  // valid-shaped hash keeps the timing roughly constant when the email is
  // unknown or the password row is empty.
  const GENERIC_ERR = { error: 'Invalid credentials' };
  const DUMMY_HASH = '$2a$12$0000000000000000000000000000000000000000000000000000';

  const client: any = db.prepare('SELECT * FROM clients WHERE email = ? AND portal_enabled = 1').get(email);
  const hashToTest = client?.password_hash || DUMMY_HASH;
  const valid = await bcrypt.compare(password, hashToTest);
  if (!client || !client.password_hash || !valid) {
    return res.status(401).json(GENERIC_ERR);
  }

  const totp = db.prepare('SELECT * FROM client_totp WHERE client_id = ?').get(client.id) as any;
  if (totp?.enabled) {
    const tempToken = jwt.sign({ clientId: client.id, role: 'client_pending_2fa' }, jwtSecret(), { expiresIn: '5m' });
    return res.json({ requires_2fa: true, temp_token: tempToken });
  }

  const token = jwt.sign({ clientId: client.id, email: client.email, role: 'client' }, jwtSecret(), { expiresIn: '8h' });
  res.json({ token, name: client.name, email: client.email });
});

/* ── Client 2FA verify (after password login) ────────────── */

router.post('/login/totp', async (req: Request, res: Response) => {
  const { temp_token, code } = req.body;
  if (!temp_token || !code) return res.status(400).json({ error: 'temp_token and code required' });
  let payload: any;
  try { payload = jwt.verify(temp_token, jwtSecret(), { algorithms: ['HS256'] }); } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
  if (payload.role !== 'client_pending_2fa') return res.status(401).json({ error: 'Invalid token' });
  const totp = db.prepare('SELECT * FROM client_totp WHERE client_id = ?').get(payload.clientId) as any;
  if (!totp?.enabled) return res.status(400).json({ error: '2FA not enabled' });
  const valid = speakeasy.totp.verify({ secret: totp.secret, encoding: 'base32', token: code, window: 1 });
  if (!valid) return res.status(401).json({ error: 'Invalid code' });
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(payload.clientId) as any;
  const token = jwt.sign({ clientId: client.id, email: client.email, role: 'client' }, jwtSecret(), { expiresIn: '8h' });
  res.json({ token, name: client.name, email: client.email });
});

/* ── Client profile ──────────────────────────────────────── */

router.get('/me', clientAuth, (req: Request, res: Response) => {
  const client = db.prepare('SELECT id, name, email, phone, company, city, country, created_at FROM clients WHERE id = ?').get((req as any).clientId);
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json(client);
});

/* ── Client invoices ─────────────────────────────────────── */

router.get('/invoices', clientAuth, (req: Request, res: Response) => {
  const invoices = db.prepare(`
    SELECT i.*, a.domain as account_domain
    FROM invoices i
    LEFT JOIN accounts a ON i.account_id = a.id
    WHERE i.client_id = ?
    ORDER BY i.created_at DESC
  `).all((req as any).clientId);
  res.json(invoices);
});

router.get('/invoices/:id', clientAuth, (req: Request, res: Response) => {
  const invoice: any = db.prepare(`
    SELECT i.*, a.domain as account_domain
    FROM invoices i LEFT JOIN accounts a ON i.account_id = a.id
    WHERE i.id = ? AND i.client_id = ?
  `).get(req.params.id, (req as any).clientId);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(invoice.id);
  res.json({ invoice, payments });
});

// Portal-scoped PDF download. The WHERE i.client_id = ? clause is the
// authorization boundary — a client can only download invoices that belong
// to them, never another client's. Shares the renderer with /api/billing.
router.get('/invoices/:id/pdf', clientAuth, async (req: Request, res: Response) => {
  const { renderInvoicePdf } = await import('./billing');
  const row: any = db.prepare(`
    SELECT i.*, c.name as client_name, c.email as client_email, c.company, c.address, c.city, c.country,
           a.domain as account_domain
    FROM invoices i
    LEFT JOIN clients  c ON i.client_id  = c.id
    LEFT JOIN accounts a ON i.account_id = a.id
    WHERE i.id = ? AND i.client_id = ?
  `).get(req.params.id, (req as any).clientId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  renderInvoicePdf(row, res);
});

// Admin set-password is in billing.ts (POST /billing/clients/:id/portal-password) — protected by authenticateToken there

/* ── Client 2FA management (authenticated) ───────────────── */

router.get('/totp', clientAuth, (req: Request, res: Response) => {
  const row = db.prepare('SELECT enabled FROM client_totp WHERE client_id = ?').get((req as any).clientId) as any;
  res.json({ enabled: !!row?.enabled });
});

router.post('/totp/setup', clientAuth, async (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const client = db.prepare('SELECT email FROM clients WHERE id = ?').get(clientId) as any;
  const secretObj = speakeasy.generateSecret({ length: 20, name: client?.email || 'client' });
  const secret = secretObj.base32;
  const otpauth = speakeasy.otpauthURL({ secret, label: client?.email || 'client', issuer: 'HostPanel Client Portal', encoding: 'base32' });
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  db.prepare('INSERT INTO client_totp (client_id, secret, enabled) VALUES (?, ?, 0) ON CONFLICT(client_id) DO UPDATE SET secret=excluded.secret, enabled=0').run(clientId, secret);
  res.json({ secret, qrDataUrl });
});

router.post('/totp/verify', clientAuth, (req: Request, res: Response) => {
  const clientId = (req as any).clientId;
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code required' });
  const row = db.prepare('SELECT secret FROM client_totp WHERE client_id = ?').get(clientId) as any;
  if (!row) return res.status(400).json({ error: '2FA setup not initiated' });
  const valid = speakeasy.totp.verify({ secret: row.secret, encoding: 'base32', token: code, window: 1 });
  if (!valid) return res.status(401).json({ error: 'Invalid code' });
  db.prepare('UPDATE client_totp SET enabled=1 WHERE client_id=?').run(clientId);
  res.json({ success: true });
});

router.delete('/totp', clientAuth, async (req: Request, res: Response) => {
  // Require re-authentication with the current password to disable 2FA — a
  // stolen session token shouldn't be enough to strip the second factor off
  // the account.
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Current password is required to disable 2FA' });
  const clientId = (req as any).clientId;
  const client: any = db.prepare('SELECT password_hash FROM clients WHERE id = ?').get(clientId);
  if (!client?.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, client.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  db.prepare('DELETE FROM client_totp WHERE client_id=?').run(clientId);
  res.json({ success: true });
});

/* ── My Hosting (read-only) ─────────────────────────────────────── */

router.get('/accounts', clientAuth, (req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT a.id, a.username, a.domain, a.status, a.notes, a.expires_at, a.created_at,
           p.name as plan_name, p.price as plan_price, p.disk_quota, p.bandwidth,
           p.email_accts, p.databases, p.ftp_accts
    FROM accounts a
    LEFT JOIN plans p ON a.plan_id = p.id
    WHERE a.client_id = ?
    ORDER BY a.created_at DESC
  `).all((req as any).clientId);
  res.json(rows);
});

router.get('/accounts/:id', clientAuth, (req: Request, res: Response) => {
  const acc: any = db.prepare(`
    SELECT a.*, p.name as plan_name, p.price as plan_price, p.disk_quota, p.bandwidth,
           p.email_accts, p.databases, p.ftp_accts
    FROM accounts a
    LEFT JOIN plans p ON a.plan_id = p.id
    WHERE a.id = ? AND a.client_id = ?
  `).get(req.params.id, (req as any).clientId);
  if (!acc) return res.status(404).json({ error: 'Not found' });
  res.json(acc);
});

router.get('/accounts/:id/usage', clientAuth, async (req: Request, res: Response) => {
  const acc: any = db.prepare('SELECT domain FROM accounts WHERE id = ? AND client_id = ?').get(req.params.id, (req as any).clientId);
  if (!acc) return res.status(404).json({ error: 'Not found' });
  const accountDir = path.join(PORTAL_WEBROOT, acc.domain);
  let diskBytes = 0;
  try {
    const { stdout } = await execAsync(`du -sb "${accountDir}" 2>/dev/null`);
    diskBytes = parseInt(stdout.split('\t')[0]) || 0;
  } catch { /* directory missing — leave 0 */ }
  res.json({ disk_bytes: diskBytes, directory: accountDir });
});

/* ── Self-service password change ───────────────────────────────── */

router.post('/change-password', clientAuth, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  const clientId = (req as any).clientId;
  const client: any = db.prepare('SELECT password_hash FROM clients WHERE id = ?').get(clientId);
  if (!client?.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(currentPassword, client.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE clients SET password_hash = ? WHERE id = ?').run(hash, clientId);
  res.json({ success: true });
});

/* ── DNS records for an owned domain ────────────────────────────── */

router.get('/domains/:domain/dns', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const zoneFile = path.join(PORTAL_NAMED_DIR, `${domain}.zone`);
  const content = await fs.readFile(zoneFile, 'utf-8').catch(() => null);
  if (!content) return res.json({ records: [] });
  const records: { type: string; name: string; value: string; ttl: string }[] = [];
  for (const line of content.split('\n').filter(l => l.trim() && !l.startsWith(';'))) {
    const m = line.match(/^(\S+)\s+(\d+)?\s*IN\s+(\w+)\s+(.+)$/);
    if (m) records.push({ name: m[1], ttl: m[2] || '3600', type: m[3], value: m[4].trim() });
  }
  res.json({ records });
});

router.post('/domains/:domain/dns', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const { name, type, value, ttl = '3600' } = req.body;
  // Clients are restricted to the safe record types — no NS / SRV — to keep
  // a tenant from delegating their subdomain away or putting up service
  // records that conflict with the operator's mail / SIP infrastructure.
  const allowed = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'];
  if (!allowed.includes(type)) return res.status(400).json({ error: `Type must be one of: ${allowed.join(', ')}` });
  if (typeof name !== 'string' || !name || /\s/.test(name)) return res.status(400).json({ error: 'name is required and must not contain whitespace' });
  if (typeof value !== 'string' || !value.trim()) return res.status(400).json({ error: 'value is required' });
  if (!/^\d+$/.test(String(ttl))) return res.status(400).json({ error: 'ttl must be a positive integer' });
  const zoneFile = path.join(PORTAL_NAMED_DIR, `${domain}.zone`);
  await fs.appendFile(zoneFile, `${name}\t${ttl}\tIN\t${type}\t${value}\n`);
  await execAsync('rndc reload 2>/dev/null || true');
  res.json({ message: 'DNS record added' });
});

router.delete('/domains/:domain/dns/:index', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  const idx = parseInt(req.params.index);
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  if (!Number.isFinite(idx) || idx < 0) return res.status(400).json({ error: 'Invalid index' });
  const zoneFile = path.join(PORTAL_NAMED_DIR, `${domain}.zone`);
  const content = await fs.readFile(zoneFile, 'utf-8').catch(() => null);
  if (!content) return res.status(404).json({ error: 'No zone file' });
  const all = content.split('\n');
  const recordLines = all.filter(l => l.trim() && !l.startsWith(';'));
  if (idx >= recordLines.length) return res.status(404).json({ error: 'Record not found' });
  recordLines.splice(idx, 1);
  const headerLines = all.filter(l => !l.trim() || l.startsWith(';'));
  await fs.writeFile(zoneFile, [...headerLines, ...recordLines].join('\n') + '\n');
  await execAsync('rndc reload 2>/dev/null || true');
  res.json({ success: true });
});

/* ── Email accounts on an owned domain ──────────────────────────── */

router.get('/email/accounts', clientAuth, async (req: Request, res: Response) => {
  const domain = req.query.domain as string;
  if (!domain || !PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'domain query param required' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const content = await fs.readFile(PORTAL_PASSWD_FILE, 'utf-8').catch(() => '');
  const suffix = '@' + domain.toLowerCase();
  const accounts = content
    .split('\n')
    .filter(Boolean)
    .filter(l => l.split(':')[0].toLowerCase().endsWith(suffix))
    .map(l => ({ email: l.split(':')[0] }));
  res.json(accounts);
});

router.post('/email/accounts', clientAuth, async (req: Request, res: Response) => {
  const { email, password, quota } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!PORTAL_EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const [user, domain] = email.split('@');
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  // doveadm pw hashes the password without it touching the shell command
  // line — pipe via stdin so the value never lands in `ps` or err.message.
  const { spawn } = await import('child_process');
  const hash: string = await new Promise<string>((resolve, reject) => {
    const p = spawn('doveadm', ['pw', '-s', 'SHA512-CRYPT']);
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err || `doveadm exit ${code}`)));
    p.on('error', reject);
    p.stdin.write(password + '\n'); p.stdin.end();
  }).catch((e: any) => { throw new Error('Failed to hash password: ' + e.message); });
  const quotaRule = quota ? `userdb_quota_rule=*:bytes=${quota}` : '';
  const entry = `${email}:${hash}:5000:5000::${PORTAL_VMAIL_DIR}/${domain}/${user}::${quotaRule}`;
  await fs.appendFile(PORTAL_PASSWD_FILE, entry + '\n');
  await fs.appendFile(path.join(PORTAL_VMAIL_DIR, 'mailbox'), `${email}    ${domain}/${user}/\n`);
  await execAsync(`postmap ${PORTAL_VMAIL_DIR}/mailbox 2>/dev/null || true`);
  await fs.mkdir(path.join(PORTAL_VMAIL_DIR, domain, user), { recursive: true });
  res.json({ message: `Mailbox ${email} created` });
});

router.delete('/email/accounts/:email', clientAuth, async (req: Request, res: Response) => {
  const { email } = req.params;
  if (!PORTAL_EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
  const domain = email.split('@')[1];
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  // EMAIL_RE only allows [A-Za-z0-9._%+-] left of @ and [A-Za-z0-9.-] right
  // of @, none of which are shell or sed metacharacters, so the sed pattern
  // below is safe to interpolate. Mirror the admin email.ts delete flow.
  const escaped = email.replace(/[.@]/g, '\\$&');
  await execAsync(`sed -i '/^${escaped}:/d' ${PORTAL_PASSWD_FILE} 2>/dev/null || true`);
  await execAsync(`sed -i '/^${escaped}/d' ${PORTAL_VMAIL_DIR}/mailbox 2>/dev/null || true`);
  await execAsync(`postmap ${PORTAL_VMAIL_DIR}/mailbox 2>/dev/null || true`);
  res.json({ success: true });
});

/* ── Email forwarders on owned domain ───────────────────────── */

router.get('/email/forwarders', clientAuth, async (req: Request, res: Response) => {
  const domain = req.query.domain as string;
  if (!domain || !PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'domain query param required' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const content = await fs.readFile(path.join(PORTAL_VMAIL_DIR, 'aliases'), 'utf-8').catch(() => '');
  const suffix = '@' + domain.toLowerCase();
  const forwarders = content
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => { const [from, to] = l.split(/\s+/); return { from, to }; })
    .filter(f => f.from?.toLowerCase().endsWith(suffix));
  res.json(forwarders);
});

router.post('/email/forwarders', clientAuth, async (req: Request, res: Response) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  if (!PORTAL_EMAIL_RE.test(from) || !PORTAL_EMAIL_RE.test(to)) return res.status(400).json({ error: 'Invalid email' });
  const domain = from.split('@')[1];
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  await fs.appendFile(path.join(PORTAL_VMAIL_DIR, 'aliases'), `${from}    ${to}\n`);
  await execAsync(`postmap ${PORTAL_VMAIL_DIR}/aliases 2>/dev/null || true`);
  res.json({ message: 'Forwarder created' });
});

router.delete('/email/forwarders/:from', clientAuth, async (req: Request, res: Response) => {
  const { from } = req.params;
  if (!PORTAL_EMAIL_RE.test(from)) return res.status(400).json({ error: 'Invalid email' });
  const domain = from.split('@')[1];
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const escaped = from.replace(/[.@]/g, '\\$&');
  await execAsync(`sed -i '/^${escaped}\\s/d' ${PORTAL_VMAIL_DIR}/aliases 2>/dev/null || true`);
  await execAsync(`postmap ${PORTAL_VMAIL_DIR}/aliases 2>/dev/null || true`);
  res.json({ success: true });
});

/* ── FTP users (cPanel-style prefix, chrooted to owned domain) ── */

const PORTAL_FTP_USER_DIR = process.env.FTP_USER_DIR || '/etc/vsftpd/users';
const PORTAL_FTP_USER_LIST = '/etc/vsftpd/user_list';

router.get('/ftp/users', clientAuth, async (req: Request, res: Response) => {
  const usernames = clientAccountUsernames((req as any).clientId);
  if (!usernames.length) return res.json([]);
  const content = await fs.readFile(PORTAL_FTP_USER_LIST, 'utf-8').catch(() => '');
  const all = content.split('\n').map(s => s.trim()).filter(Boolean);
  // Return only users whose name matches one of the client's account
  // prefixes (e.g. marcos_*). Excludes the bare account-username itself
  // unless the operator explicitly created an FTP user with that name.
  const users = all
    .filter(u => usernames.some(prefix => u === prefix || u.startsWith(prefix + '_')))
    .map(username => {
      const homeFromCfg = (() => {
        try { return require('fs').readFileSync(path.join(PORTAL_FTP_USER_DIR, username), 'utf-8').match(/local_root=(.+)/)?.[1] || null; }
        catch { return null; }
      })();
      return { username, directory: homeFromCfg };
    });
  res.json(users);
});

router.post('/ftp/users', clientAuth, async (req: Request, res: Response) => {
  const { username, password, domain } = req.body;
  if (!username || !password || !domain) return res.status(400).json({ error: 'username, password, domain required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  // Force the cPanel-style prefix. A client picks the *suffix*; we
  // prepend their account-username so two tenants can't collide on a
  // common name like "blog" or "test", and so the OS user always traces
  // back to the right hosting account.
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(username)) return res.status(400).json({ error: 'username must be lowercase letters/digits/underscore (max 31 chars), start with a letter' });
  const owner = clientAccountUsernames((req as any).clientId).find(u => db.prepare('SELECT 1 FROM accounts WHERE client_id = ? AND username = ? AND domain = ?').get((req as any).clientId, u, domain));
  if (!owner) return res.status(403).json({ error: 'Not your domain' });
  const fullUser = `${owner}_${username}`;
  if (fullUser.length > 32) return res.status(400).json({ error: 'username too long when combined with account prefix' });
  const homeDir = path.join(PORTAL_WEBROOT, domain, 'public_html');
  try {
    await execAsync(`id "${fullUser}" 2>/dev/null`);
    return res.status(409).json({ error: 'FTP user already exists' });
  } catch { /* expected — user doesn't exist yet */ }
  // Create the OS user with /sbin/nologin shell so the only thing they
  // can do is FTP. Use spawn+stdin for chpasswd so the password never
  // touches the process command line.
  await execAsync(`useradd -d "${homeDir}" -s /sbin/nologin -M "${fullUser}"`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn('chpasswd');
    p.stdin.write(`${fullUser}:${password}\n`); p.stdin.end();
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`chpasswd exit ${code}`)));
    p.on('error', reject);
  });
  await fs.appendFile(PORTAL_FTP_USER_LIST, `${fullUser}\n`);
  await fs.mkdir(PORTAL_FTP_USER_DIR, { recursive: true });
  await fs.writeFile(path.join(PORTAL_FTP_USER_DIR, fullUser), `local_root=${homeDir}\nwrite_enable=YES\nanon_world_readable_only=NO\n`);
  res.json({ message: `FTP user ${fullUser} created`, username: fullUser, directory: homeDir });
});

router.delete('/ftp/users/:username', clientAuth, async (req: Request, res: Response) => {
  const { username } = req.params;
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!clientPrefixOwner((req as any).clientId, username)) return res.status(403).json({ error: 'Not your FTP user' });
  await execAsync(`userdel "${username}" 2>/dev/null || true`);
  await execAsync(`sed -i '/^${username}$/d' ${PORTAL_FTP_USER_LIST} 2>/dev/null || true`);
  await fs.unlink(path.join(PORTAL_FTP_USER_DIR, username)).catch(() => {});
  res.json({ success: true });
});

/* ── Databases (cPanel-style prefix) ────────────────────────── */

const PORTAL_DB_HOST = process.env.DB_HOST || '127.0.0.1';
const PORTAL_DB_PORT = parseInt(process.env.DB_PORT || '3306', 10);
const PORTAL_DB_USER = process.env.DB_ROOT_USER || 'root';
const PORTAL_DB_PASS = process.env.DB_ROOT_PASS || '';

async function getPortalDbConn() {
  return mysql.createConnection({ host: PORTAL_DB_HOST, port: PORTAL_DB_PORT, user: PORTAL_DB_USER, password: PORTAL_DB_PASS });
}

router.get('/databases', clientAuth, async (req: Request, res: Response) => {
  const usernames = clientAccountUsernames((req as any).clientId);
  if (!usernames.length) return res.json([]);
  let conn;
  try {
    conn = await getPortalDbConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT schema_name AS name FROM information_schema.SCHEMATA');
    const owned = (rows as any[]).filter(r => usernames.some(u => r.name === u || r.name.startsWith(u + '_')));
    res.json(owned);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
  finally { await conn?.end(); }
});

router.post('/databases', clientAuth, async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!clientPrefixOwner((req as any).clientId, name)) return res.status(403).json({ error: 'Database name must start with your account username (e.g. <youruser>_<name>)' });
  let conn;
  try {
    conn = await getPortalDbConn();
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    res.json({ message: `Database ${name} created` });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
  finally { await conn?.end(); }
});

router.delete('/databases/:name', clientAuth, async (req: Request, res: Response) => {
  const { name } = req.params;
  if (!clientPrefixOwner((req as any).clientId, name)) return res.status(403).json({ error: 'Not your database' });
  let conn;
  try {
    conn = await getPortalDbConn();
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
    res.json({ message: `Database ${name} dropped` });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
  finally { await conn?.end(); }
});

router.get('/databases/users', clientAuth, async (req: Request, res: Response) => {
  const usernames = clientAccountUsernames((req as any).clientId);
  if (!usernames.length) return res.json([]);
  let conn;
  try {
    conn = await getPortalDbConn();
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT user, host FROM mysql.user WHERE user NOT IN ('root','mysql','mariadb.sys') ORDER BY user",
    );
    // MariaDB returns the columns with their original casing (User, Host)
    // regardless of how the SELECT was written, so we have to read both
    // shapes here to stay tolerant. The admin /databases/users route does
    // the same thing.
    const owned = (rows as any[]).filter(r => {
      const u = r.User ?? r.user;
      return u && usernames.some(p => u === p || u.startsWith(p + '_'));
    });
    res.json(owned);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
  finally { await conn?.end(); }
});

router.post('/databases/users', clientAuth, async (req: Request, res: Response) => {
  const { username, password, database } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!clientPrefixOwner((req as any).clientId, username)) return res.status(403).json({ error: 'Username must start with your account username (e.g. <youruser>_<name>)' });
  if (database && !clientPrefixOwner((req as any).clientId, database)) return res.status(403).json({ error: 'Not your database' });
  let conn;
  try {
    conn = await getPortalDbConn();
    await conn.query('CREATE USER ?@? IDENTIFIED BY ?', [username, 'localhost', password]);
    if (database) await conn.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@?`, [username, 'localhost']);
    await conn.query('FLUSH PRIVILEGES');
    res.json({ message: `DB user ${username} created` });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
  finally { await conn?.end(); }
});

router.delete('/databases/users/:username', clientAuth, async (req: Request, res: Response) => {
  const { username } = req.params;
  const host = (req.query.host as string) || 'localhost';
  if (!clientPrefixOwner((req as any).clientId, username)) return res.status(403).json({ error: 'Not your DB user' });
  let conn;
  try {
    conn = await getPortalDbConn();
    await conn.query('DROP USER IF EXISTS ?@?', [username, host]);
    await conn.query('FLUSH PRIVILEGES');
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
  finally { await conn?.end(); }
});

/* ── WHOIS (any domain) ─────────────────────────────────────── */

router.get('/whois/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    // /usr/bin/whois isn't always installed. Surface a clean 503 rather
    // than ENOENT if it's missing.
    if (!existsSync('/usr/bin/whois') && !existsSync('/usr/local/bin/whois')) {
      return res.status(503).json({ error: 'whois binary not installed on this server' });
    }
    const { stdout } = await execAsync(`whois "${domain}" 2>/dev/null`, { timeout: 15000, maxBuffer: 1024 * 1024 });
    res.json({ domain, raw: stdout });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── Self-service Let's Encrypt for owned domain ────────────── */

router.get('/ssl/:domain/status', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const certPath = `/etc/letsencrypt/live/${domain}/fullchain.pem`;
  if (!existsSync(certPath)) return res.json({ issued: false });
  try {
    const { stdout } = await execAsync(`openssl x509 -in "${certPath}" -noout -enddate 2>/dev/null`);
    const m = stdout.match(/notAfter=(.+)/);
    res.json({ issued: true, expires: m?.[1]?.trim() || null });
  } catch { res.json({ issued: true, expires: null }); }
});

router.post('/ssl/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  // The contact email goes to the LE registrar; use the client's account
  // email rather than letting the tenant pass an arbitrary one (which
  // would let them squat someone else's email on LE notifications).
  const client: any = db.prepare('SELECT email FROM clients WHERE id = ?').get((req as any).clientId);
  const email = client?.email;
  if (!email) return res.status(400).json({ error: 'No contact email on file; ask your hosting provider to set one' });
  try {
    const { stdout, stderr } = await execAsync(
      `certbot --apache -d "${domain}" --non-interactive --agree-tos -m "${email}" 2>&1`,
      { timeout: 180000 },
    );
    res.json({ success: true, output: stdout + stderr });
  } catch (e: any) {
    res.status(500).json({ error: e.message, output: (e.stdout || '') + (e.stderr || '') });
  }
});

/* ── Subdomains (under owned parent domain) ─────────────────── */

const PORTAL_VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';
const PORTAL_SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]*$/;

router.get('/subdomains', clientAuth, async (_req: Request, res: Response) => {
  const usernames = clientAccountUsernames((_req as any).clientId);
  const ownedDomains = db.prepare("SELECT domain FROM accounts WHERE client_id = ? AND status != 'terminated'").all((_req as any).clientId) as { domain: string }[];
  // Subdomains are stored as Apache vhosts named <fqdn>.conf. Filter to
  // those whose ServerName is a subdomain of one of the client's domains.
  const files = await fs.readdir(PORTAL_VHOST_DIR).catch(() => [] as string[]);
  const subs: { fqdn: string; parent: string; docroot: string }[] = [];
  for (const f of files) {
    if (!f.endsWith('.conf')) continue;
    const fqdn = f.replace('.conf', '');
    const parent = ownedDomains.find(d => fqdn !== d.domain && fqdn.endsWith('.' + d.domain));
    if (!parent) continue;
    try {
      const conf = await fs.readFile(path.join(PORTAL_VHOST_DIR, f), 'utf-8');
      const m = conf.match(/DocumentRoot\s+(\S+)/);
      subs.push({ fqdn, parent: parent.domain, docroot: m?.[1] || '' });
    } catch { /* skip */ }
  }
  void usernames;
  res.json(subs);
});

router.post('/subdomains', clientAuth, async (req: Request, res: Response) => {
  const { subdomain, domain } = req.body;
  if (!subdomain || !domain) return res.status(400).json({ error: 'subdomain and domain required' });
  if (!PORTAL_SUBDOMAIN_RE.test(subdomain)) return res.status(400).json({ error: 'Subdomain must be lowercase letters/digits/hyphen' });
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid parent domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const fqdn = `${subdomain}.${domain}`;
  const docRoot = path.join(PORTAL_WEBROOT, domain, fqdn);
  const confFile = path.join(PORTAL_VHOST_DIR, `${fqdn}.conf`);
  if (existsSync(confFile)) return res.status(409).json({ error: 'Subdomain already exists' });
  await fs.mkdir(docRoot, { recursive: true });
  await fs.writeFile(path.join(docRoot, 'index.html'), `<html><body><h1>${fqdn}</h1></body></html>`);
  await fs.writeFile(confFile, `<VirtualHost *:80>\n  ServerName ${fqdn}\n  DocumentRoot ${docRoot}\n  <Directory ${docRoot}>\n    AllowOverride All\n    Require all granted\n  </Directory>\n</VirtualHost>\n`);
  await execAsync('systemctl reload httpd 2>/dev/null || true');
  res.json({ message: 'Subdomain created', fqdn, docroot: docRoot });
});

router.delete('/subdomains/:fqdn', clientAuth, async (req: Request, res: Response) => {
  const { fqdn } = req.params;
  if (!PORTAL_DOMAIN_RE.test(fqdn)) return res.status(400).json({ error: 'Invalid subdomain' });
  // Verify the fqdn belongs to one of the client's parent domains.
  const owned = db.prepare("SELECT domain FROM accounts WHERE client_id = ? AND status != 'terminated'").all((req as any).clientId) as { domain: string }[];
  if (!owned.some(d => fqdn === d.domain || fqdn.endsWith('.' + d.domain))) return res.status(403).json({ error: 'Not your subdomain' });
  if (owned.some(d => d.domain === fqdn)) return res.status(400).json({ error: 'Refusing to delete the parent account domain — use the admin panel' });
  await fs.unlink(path.join(PORTAL_VHOST_DIR, `${fqdn}.conf`)).catch(() => {});
  await execAsync('systemctl reload httpd 2>/dev/null || true');
  res.json({ success: true });
});

/* ── Redirects (per owned domain) ───────────────────────────── */

db.exec(`CREATE TABLE IF NOT EXISTS portal_redirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  type   TEXT NOT NULL DEFAULT '301',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(domain, source)
)`);

router.get('/redirects', clientAuth, (req: Request, res: Response) => {
  const owned = (db.prepare("SELECT domain FROM accounts WHERE client_id = ? AND status != 'terminated'").all((req as any).clientId) as { domain: string }[]).map(d => d.domain);
  if (!owned.length) return res.json([]);
  const placeholders = owned.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM portal_redirects WHERE domain IN (${placeholders}) ORDER BY created_at DESC`).all(...owned);
  res.json(rows);
});

router.post('/redirects', clientAuth, async (req: Request, res: Response) => {
  const { domain, source, target, type } = req.body;
  if (!domain || !source || !target) return res.status(400).json({ error: 'domain, source, target required' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  if (!/^\/[^\s]*$/.test(source)) return res.status(400).json({ error: 'source must be an absolute path' });
  if (!/^https?:\/\//.test(target)) return res.status(400).json({ error: 'target must be an http(s) URL' });
  if (type && !['301', '302'].includes(String(type))) return res.status(400).json({ error: 'type must be 301 or 302' });
  // Persist in our portal-side table AND write a .htaccess entry under
  // the domain's public_html so Apache actually serves the redirect.
  const docRoot = path.join(PORTAL_WEBROOT, domain, 'public_html');
  if (!existsSync(docRoot)) return res.status(400).json({ error: 'public_html does not exist for this domain' });
  let inserted: any;
  try {
    const r = db.prepare('INSERT INTO portal_redirects (domain, source, target, type) VALUES (?, ?, ?, ?)').run(domain, source, target, type || '301');
    inserted = db.prepare('SELECT * FROM portal_redirects WHERE id = ?').get(r.lastInsertRowid);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'A redirect for that source already exists' });
    throw e;
  }
  const htaccess = path.join(docRoot, '.htaccess');
  const block = `# portal-redirect:${source}\nRedirect ${type || '301'} ${source} ${target}\n`;
  await fs.appendFile(htaccess, block).catch(() => {});
  res.json(inserted);
});

router.delete('/redirects/:id', clientAuth, async (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM portal_redirects WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!clientOwnsDomain((req as any).clientId, row.domain)) return res.status(403).json({ error: 'Not your domain' });
  db.prepare('DELETE FROM portal_redirects WHERE id = ?').run(req.params.id);
  // Remove the matching block from .htaccess so Apache stops redirecting.
  const htaccess = path.join(PORTAL_WEBROOT, row.domain, 'public_html', '.htaccess');
  try {
    const content = await fs.readFile(htaccess, 'utf-8');
    const cleaned = content
      .split('\n')
      .reduce<string[]>((acc, line, i, lines) => {
        if (line === `# portal-redirect:${row.source}`) {
          // skip this marker AND the next line (the Redirect directive)
          lines[i + 1] = '__SKIP__';
          return acc;
        }
        if (line === '__SKIP__') return acc;
        acc.push(line); return acc;
      }, [])
      .join('\n');
    await fs.writeFile(htaccess, cleaned);
  } catch { /* htaccess missing — fine */ }
  res.json({ success: true });
});

/* ── Cron (per-OS-user, only if the user is prefixed) ───────── */

const PORTAL_CRON_RE = /^(@(reboot|hourly|daily|weekly|monthly)|(\*(?:\/\d+)?|[0-9,\-\/\*]+)\s+(\*(?:\/\d+)?|[0-9,\-\/\*]+)\s+(\*(?:\/\d+)?|[0-9,\-\/\*]+)\s+(\*(?:\/\d+)?|[0-9,\-\/\*]+)\s+(\*(?:\/\d+)?|[0-9,\-\/\*]+))$/;

async function osUserExists(name: string): Promise<boolean> {
  try { await execAsync(`id "${name}" 2>/dev/null`); return true; } catch { return false; }
}

router.get('/cron', clientAuth, async (req: Request, res: Response) => {
  // List crontabs for every OS user that's prefixed with one of the
  // client's account usernames (e.g. `marcos_web`'s crontab).
  const usernames = clientAccountUsernames((req as any).clientId);
  const out: { user: string; jobs: { id: number; line: string }[] }[] = [];
  for (const base of usernames) {
    // Match exact account-username and prefix-only OS users we created via
    // /api/portal/ftp/users (which prepends <base>_).
    const { stdout } = await execAsync(`getent passwd | awk -F: '{print $1}'`).catch(() => ({ stdout: '' }));
    const candidates = stdout.split('\n').filter(u => u === base || u.startsWith(base + '_'));
    for (const u of candidates) {
      const { stdout: tab } = await execAsync(`crontab -u "${u}" -l 2>/dev/null || true`);
      const lines = tab.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      if (lines.length) out.push({ user: u, jobs: lines.map((line, id) => ({ id, line })) });
    }
  }
  res.json(out);
});

router.post('/cron', clientAuth, async (req: Request, res: Response) => {
  const { user, schedule, command } = req.body;
  if (!user || !schedule || !command) return res.status(400).json({ error: 'user, schedule, command required' });
  if (!PORTAL_CRON_RE.test(String(schedule).trim())) return res.status(400).json({ error: 'Invalid cron schedule' });
  if (!clientPrefixOwner((req as any).clientId, user)) return res.status(403).json({ error: 'Not your OS user' });
  if (!await osUserExists(user)) return res.status(404).json({ error: `No OS user named '${user}'` });
  // Append to the user's crontab via a temp file in mkdtemp so we don't
  // race against the cron-account write paths in cron.ts.
  const { tmpdir } = await import('os');
  const { mkdtempSync, writeFileSync, unlinkSync } = await import('fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'portal-cron-'));
  try {
    const { stdout: existing } = await execAsync(`crontab -u "${user}" -l 2>/dev/null || true`);
    const next = (existing.replace(/\n+$/, '') + '\n' + `${schedule.trim()} ${command.trim()}\n`).replace(/^\n+/, '');
    const tmp = path.join(dir, 'crontab');
    writeFileSync(tmp, next);
    await execAsync(`crontab -u "${user}" "${tmp}"`);
    unlinkSync(tmp);
  } finally {
    try { await fs.rmdir(dir); } catch { /* best-effort */ }
  }
  res.json({ message: 'Cron job added' });
});

router.delete('/cron/:user/:index', clientAuth, async (req: Request, res: Response) => {
  const { user } = req.params;
  const idx = parseInt(req.params.index);
  if (!clientPrefixOwner((req as any).clientId, user)) return res.status(403).json({ error: 'Not your OS user' });
  if (!Number.isFinite(idx) || idx < 0) return res.status(400).json({ error: 'Invalid index' });
  const { stdout: existing } = await execAsync(`crontab -u "${user}" -l 2>/dev/null || true`);
  const lines = existing.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  if (idx >= lines.length) return res.status(404).json({ error: 'Job not found' });
  lines.splice(idx, 1);
  const { tmpdir } = await import('os');
  const { mkdtempSync, writeFileSync, unlinkSync } = await import('fs');
  const dir = mkdtempSync(path.join(tmpdir(), 'portal-cron-rm-'));
  try {
    const tmp = path.join(dir, 'crontab');
    writeFileSync(tmp, lines.join('\n') + (lines.length ? '\n' : ''));
    await execAsync(`crontab -u "${user}" "${tmp}"`);
    unlinkSync(tmp);
  } finally {
    try { await fs.rmdir(dir); } catch { /* best-effort */ }
  }
  res.json({ success: true });
});

/* ── Email autoresponders (per address on owned domain) ─────── */

router.get('/email/autoresponders', clientAuth, (req: Request, res: Response) => {
  const owned = (db.prepare("SELECT domain FROM accounts WHERE client_id = ? AND status != 'terminated'").all((req as any).clientId) as { domain: string }[]).map(d => '@' + d.domain);
  if (!owned.length) return res.json([]);
  const rows = db.prepare('SELECT * FROM autoresponders ORDER BY created_at DESC').all() as any[];
  res.json(rows.filter(r => owned.some(suffix => r.email?.toLowerCase().endsWith(suffix))));
});

router.post('/email/autoresponders', clientAuth, (req: Request, res: Response) => {
  const { email, subject, body, start_date, end_date } = req.body;
  if (!email || !subject || !body) return res.status(400).json({ error: 'email, subject, body required' });
  if (!PORTAL_EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
  const domain = email.split('@')[1];
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  try {
    const r = db.prepare('INSERT INTO autoresponders (email, subject, body, start_date, end_date, enabled) VALUES (?, ?, ?, ?, ?, 1)')
      .run(email, subject, body, start_date || null, end_date || null);
    res.json(db.prepare('SELECT * FROM autoresponders WHERE id = ?').get(r.lastInsertRowid));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/email/autoresponders/:id', clientAuth, (req: Request, res: Response) => {
  const row: any = db.prepare('SELECT email FROM autoresponders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const domain = row.email.split('@')[1];
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your autoresponder' });
  db.prepare('DELETE FROM autoresponders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── Catch-all email (per owned domain) ─────────────────────── */

router.get('/email/catch-all', clientAuth, async (req: Request, res: Response) => {
  const domain = req.query.domain as string;
  if (!domain || !PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'domain required' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const content = await fs.readFile(path.join(PORTAL_VMAIL_DIR, 'aliases'), 'utf-8').catch(() => '');
  const m = content.split('\n').find(l => l.startsWith(`@${domain}`));
  if (!m) return res.json({ destination: null });
  const dest = m.split(/\s+/)[1] || null;
  res.json({ destination: dest });
});

router.post('/email/catch-all', clientAuth, async (req: Request, res: Response) => {
  const { domain, destination } = req.body;
  if (!domain || !destination) return res.status(400).json({ error: 'domain and destination required' });
  if (!PORTAL_EMAIL_RE.test(destination)) return res.status(400).json({ error: 'Invalid destination email' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const aliasesPath = path.join(PORTAL_VMAIL_DIR, 'aliases');
  const content = await fs.readFile(aliasesPath, 'utf-8').catch(() => '');
  const filtered = content.split('\n').filter(l => l && !l.startsWith(`@${domain}`)).join('\n');
  const next = filtered.replace(/\n+$/, '') + `\n@${domain}    ${destination}\n`;
  await fs.writeFile(aliasesPath, next);
  await execAsync(`postmap ${aliasesPath} 2>/dev/null || true`);
  res.json({ success: true });
});

router.delete('/email/catch-all/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const aliasesPath = path.join(PORTAL_VMAIL_DIR, 'aliases');
  const content = await fs.readFile(aliasesPath, 'utf-8').catch(() => '');
  await fs.writeFile(aliasesPath, content.split('\n').filter(l => !l.startsWith(`@${domain}`)).join('\n'));
  await execAsync(`postmap ${aliasesPath} 2>/dev/null || true`);
  res.json({ success: true });
});

/* ── Webmail (Roundcube) availability + per-mailbox deep link ── */

router.get('/webmail', clientAuth, async (_req: Request, res: Response) => {
  const setting = (db.prepare('SELECT value FROM settings WHERE key = ?').get('webmail_url') as any)?.value;
  const configured = (setting || process.env.WEBMAIL_URL || '').trim();
  const installed =
    existsSync('/usr/share/roundcubemail') ||
    await execAsync('rpm -q roundcubemail >/dev/null 2>&1 && echo y || true').then(r => r.stdout.trim() === 'y').catch(() => false);
  // Same-origin default — the install.sh Apache alias mounts /roundcube
  const url = configured || (installed ? '/roundcube' : '');
  res.json({ installed, url });
});

/* ── DKIM / SPF / DMARC for owned domain ────────────────────── */

router.get('/mail-auth/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const dkimPub = await fs.readFile(`/etc/opendkim/keys/${domain}/default.txt`, 'utf-8').catch(() => '');
  const dkimMatch = dkimPub.match(/"v=DKIM1[^"]*"/);
  const zoneContent = await fs.readFile(path.join(PORTAL_NAMED_DIR, `${domain}.zone`), 'utf-8').catch(() => '');
  const spf   = zoneContent.match(/v=spf1[^"]*/)?.[0]   || '';
  const dmarc = zoneContent.match(/v=DMARC1[^"]*/)?.[0] || '';
  res.json({ domain, dkim: dkimMatch?.[0] || null, spf, dmarc });
});

router.post('/mail-auth/:domain/dkim', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  if (!existsSync('/usr/sbin/opendkim-genkey') && !existsSync('/usr/bin/opendkim-genkey')) {
    return res.status(503).json({ error: 'opendkim-tools not installed on this server' });
  }
  await fs.mkdir(`/etc/opendkim/keys/${domain}`, { recursive: true });
  await execAsync(`opendkim-genkey -b 2048 -d "${domain}" -s default -D "/etc/opendkim/keys/${domain}"`);
  const txt = await fs.readFile(`/etc/opendkim/keys/${domain}/default.txt`, 'utf-8');
  res.json({ success: true, dnsRecord: txt });
});

router.post('/mail-auth/:domain/spf', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const include: string[] = Array.isArray(req.body.include) ? req.body.include : [];
  const includePart = include.filter(i => /^[a-zA-Z0-9._:-]+$/.test(i)).map(i => `include:${i}`).join(' ');
  const spf = `v=spf1 ${includePart ? includePart + ' ' : ''}~all`;
  // Write into the bind zone so DNS lookups answer correctly. The record
  // landing in the zone is just a TXT — actual delivery still happens
  // through whichever MX is in DNS.
  const zonePath = path.join(PORTAL_NAMED_DIR, `${domain}.zone`);
  const content = await fs.readFile(zonePath, 'utf-8').catch(() => '');
  const stripped = content.split('\n').filter(l => !l.includes('v=spf1')).join('\n');
  await fs.writeFile(zonePath, stripped.replace(/\n+$/, '') + `\n@\t3600\tIN\tTXT\t"${spf}"\n`);
  await execAsync('rndc reload 2>/dev/null || true');
  res.json({ success: true, spf });
});

router.post('/mail-auth/:domain/dmarc', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const { policy, rua } = req.body;
  if (!['none', 'quarantine', 'reject'].includes(String(policy || 'none'))) return res.status(400).json({ error: 'policy must be none|quarantine|reject' });
  const parts = [`v=DMARC1`, `p=${policy || 'none'}`];
  if (rua) {
    if (!PORTAL_EMAIL_RE.test(rua)) return res.status(400).json({ error: 'Invalid rua email' });
    parts.push(`rua=mailto:${rua}`);
  }
  const dmarc = parts.join('; ');
  const zonePath = path.join(PORTAL_NAMED_DIR, `${domain}.zone`);
  const content = await fs.readFile(zonePath, 'utf-8').catch(() => '');
  const stripped = content.split('\n').filter(l => !(l.startsWith('_dmarc') && l.includes('v=DMARC1'))).join('\n');
  await fs.writeFile(zonePath, stripped.replace(/\n+$/, '') + `\n_dmarc\t3600\tIN\tTXT\t"${dmarc}"\n`);
  await execAsync('rndc reload 2>/dev/null || true');
  res.json({ success: true, dmarc });
});

/* ── SSH keys (per-account-username OS user) ────────────────── */

const PORTAL_ACCT_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
async function readPortalAccountKeys(username: string): Promise<{ id: number; raw: string; comment: string }[]> {
  const content = await fs.readFile(path.join('/home', username, '.ssh', 'authorized_keys'), 'utf-8').catch(() => '');
  return content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map((raw, id) => {
    const parts = raw.trim().split(/\s+/);
    return { id, raw: raw.trim(), comment: parts[2] || '' };
  });
}

router.get('/sshkeys', clientAuth, async (req: Request, res: Response) => {
  const usernames = clientAccountUsernames((req as any).clientId);
  const out: { user: string; keys: any[] }[] = [];
  for (const u of usernames) {
    if (await osUserExists(u)) out.push({ user: u, keys: await readPortalAccountKeys(u) });
  }
  res.json(out);
});

router.post('/sshkeys', clientAuth, async (req: Request, res: Response) => {
  const { user, key } = req.body;
  if (!user || !key) return res.status(400).json({ error: 'user and key required' });
  if (!PORTAL_ACCT_RE.test(user)) return res.status(400).json({ error: 'Invalid user' });
  if (!clientPrefixOwner((req as any).clientId, user)) return res.status(403).json({ error: 'Not your OS user' });
  if (!await osUserExists(user)) return res.status(404).json({ error: `No OS user '${user}'` });
  const trimmed = String(key).trim();
  const valid = ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'];
  if (!valid.includes(trimmed.split(/\s+/)[0])) return res.status(400).json({ error: 'Invalid SSH key type' });
  const sshDir = path.join('/home', user, '.ssh');
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
  const file = path.join(sshDir, 'authorized_keys');
  const existing = await fs.readFile(file, 'utf-8').catch(() => '');
  await fs.writeFile(file, existing.replace(/\n+$/, '') + (existing ? '\n' : '') + trimmed + '\n', { mode: 0o600 });
  await execAsync(`chown -R "${user}:${user}" "${sshDir}" 2>/dev/null || true`);
  res.json({ success: true });
});

router.delete('/sshkeys/:user/:id', clientAuth, async (req: Request, res: Response) => {
  const { user } = req.params;
  const id = parseInt(req.params.id);
  if (!clientPrefixOwner((req as any).clientId, user)) return res.status(403).json({ error: 'Not your OS user' });
  const keys = await readPortalAccountKeys(user);
  if (id < 0 || id >= keys.length) return res.status(404).json({ error: 'Key not found' });
  keys.splice(id, 1);
  const sshDir = path.join('/home', user, '.ssh');
  await fs.writeFile(path.join(sshDir, 'authorized_keys'), keys.map(k => k.raw).join('\n') + (keys.length ? '\n' : ''), { mode: 0o600 });
  await execAsync(`chown -R "${user}:${user}" "${sshDir}" 2>/dev/null || true`);
  res.json({ success: true });
});

/* ── Backups (scoped to owned domain dirs) ──────────────────── */

const PORTAL_BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/hostpanel';

router.get('/backups', clientAuth, async (req: Request, res: Response) => {
  const owned = (db.prepare("SELECT domain FROM accounts WHERE client_id = ? AND status != 'terminated'").all((req as any).clientId) as { domain: string }[]).map(d => d.domain);
  const files = await fs.readdir(PORTAL_BACKUP_DIR).catch(() => [] as string[]);
  // Convention: per-domain files-backups are named files_<domain-with-dots-as-underscores>_<ts>.tar.gz
  // (see admin /api/backup/create). Filter by domain prefix.
  const filtered: any[] = [];
  for (const f of files) {
    const m = f.match(/^files_(.+?)_\d{4}-/);
    if (!m) continue;
    const tag = m[1];
    if (owned.some(d => tag === d.replace(/\./g, '_'))) {
      const st = await fs.stat(path.join(PORTAL_BACKUP_DIR, f));
      filtered.push({ name: f, size: st.size, created: st.mtime.toISOString() });
    }
  }
  filtered.sort((a, b) => b.created.localeCompare(a.created));
  res.json(filtered);
});

router.post('/backups/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  if (!existsSync(PORTAL_BACKUP_DIR)) await fs.mkdir(PORTAL_BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `files_${domain.replace(/\./g, '_')}_${ts}.tar.gz`;
  const out = path.join(PORTAL_BACKUP_DIR, filename);
  const src = path.join(PORTAL_WEBROOT, domain);
  if (!existsSync(src)) return res.status(404).json({ error: `${src} does not exist` });
  await execAsync(`tar -czf "${out}" -C "${path.dirname(src)}" "${path.basename(src)}" 2>/dev/null || true`, { timeout: 300000 });
  const st = await fs.stat(out);
  res.json({ name: filename, size: st.size, created: new Date().toISOString() });
});

router.delete('/backups/:name', clientAuth, async (req: Request, res: Response) => {
  const name = path.basename(req.params.name);
  if (!/^files_[a-zA-Z0-9_.-]+\.tar\.gz$/.test(name)) return res.status(400).json({ error: 'Invalid backup name' });
  // Reconstruct the domain from the filename and verify ownership.
  const tag = name.match(/^files_(.+?)_\d{4}-/)?.[1];
  if (!tag) return res.status(400).json({ error: 'Unrecognized backup name' });
  const owned = (db.prepare("SELECT domain FROM accounts WHERE client_id = ? AND status != 'terminated'").all((req as any).clientId) as { domain: string }[]).map(d => d.domain);
  if (!owned.some(d => tag === d.replace(/\./g, '_'))) return res.status(403).json({ error: 'Not your backup' });
  await fs.unlink(path.join(PORTAL_BACKUP_DIR, name)).catch(() => {});
  res.json({ success: true });
});

router.get('/backups/:name/download', clientAuth, async (req: Request, res: Response) => {
  const name = path.basename(req.params.name);
  if (!/^files_[a-zA-Z0-9_.-]+\.tar\.gz$/.test(name)) return res.status(400).json({ error: 'Invalid backup name' });
  const tag = name.match(/^files_(.+?)_\d{4}-/)?.[1];
  if (!tag) return res.status(400).json({ error: 'Unrecognized backup name' });
  const owned = (db.prepare("SELECT domain FROM accounts WHERE client_id = ? AND status != 'terminated'").all((req as any).clientId) as { domain: string }[]).map(d => d.domain);
  if (!owned.some(d => tag === d.replace(/\./g, '_'))) return res.status(403).json({ error: 'Not your backup' });
  const file = path.join(PORTAL_BACKUP_DIR, name);
  if (!existsSync(file)) return res.status(404).json({ error: 'Backup not found' });
  res.download(file);
});

/* ── Scripts installer (WordPress for now) ──────────────────── */

router.post('/scripts/install', clientAuth, async (req: Request, res: Response) => {
  const { script, domain, dbName, dbUser, dbPass, siteTitle, adminUser, adminPass, adminEmail } = req.body;
  if (script !== 'wordpress') return res.status(400).json({ error: 'Only wordpress is supported for client self-install right now' });
  if (!domain || !PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  if (!dbName || !dbUser || !dbPass) return res.status(400).json({ error: 'dbName, dbUser, dbPass required' });
  if (!clientPrefixOwner((req as any).clientId, dbName)) return res.status(403).json({ error: 'dbName must start with your account username' });
  if (!clientPrefixOwner((req as any).clientId, dbUser)) return res.status(403).json({ error: 'dbUser must start with your account username' });
  // Delegate to the admin /scripts/install logic via an internal http call.
  // We don't have a clean way to call the admin handler programmatically;
  // mint a short-lived admin-equivalent JWT scoped to this single request
  // and replay it. Safer alternative would be to extract the install
  // function into a shared module — but for now, do the install inline.
  const installPath = path.join(PORTAL_WEBROOT, domain, 'public_html');
  await fs.mkdir(installPath, { recursive: true });
  // Download WordPress
  await execAsync(`curl -L -o /tmp/wp-portal.tar.gz https://wordpress.org/latest.tar.gz`, { timeout: 180000 });
  await fs.mkdir('/tmp/wp-portal-extract', { recursive: true });
  await execAsync(`tar -xzf /tmp/wp-portal.tar.gz -C /tmp/wp-portal-extract --strip-components=1`);
  await execAsync(`cp -r /tmp/wp-portal-extract/. "${installPath}/"`);
  await execAsync(`rm -rf /tmp/wp-portal-extract /tmp/wp-portal.tar.gz`);
  // wp-config + wp core install via wp-cli
  await execAsync(`/usr/local/bin/wp config create --path="${installPath}" --dbname="${dbName}" --dbuser="${dbUser}" --dbpass="${dbPass}" --dbhost=localhost --skip-check --allow-root --force`);
  if (siteTitle && adminUser && adminPass && adminEmail) {
    await execAsync(`/usr/local/bin/wp core install --allow-root --path="${installPath}" --url="http://${domain}" --title="${siteTitle.replace(/"/g, '')}" --admin_user="${String(adminUser).replace(/[^a-zA-Z0-9_]/g, '')}" --admin_password="${String(adminPass).replace(/"/g, '')}" --admin_email="${adminEmail}" --skip-email`);
  }
  await execAsync(`chown -R apache:apache "${installPath}" 2>/dev/null || true`);
  res.json({ message: 'WordPress installed', url: `http://${domain}` });
});

/* ── Error pages (per owned domain) ─────────────────────────── */

const PORTAL_ERR_DIR = '.errpages';

router.get('/errpages/:domain/:code', clientAuth, async (req: Request, res: Response) => {
  const { domain, code } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  if (!/^(400|401|403|404|500|502|503)$/.test(code)) return res.status(400).json({ error: 'Unsupported code' });
  const file = path.join(PORTAL_WEBROOT, domain, 'public_html', PORTAL_ERR_DIR, `${code}.html`);
  const content = await fs.readFile(file, 'utf-8').catch(() => '');
  res.json({ content });
});

router.post('/errpages/:domain/:code', clientAuth, async (req: Request, res: Response) => {
  const { domain, code } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  if (!/^(400|401|403|404|500|502|503)$/.test(code)) return res.status(400).json({ error: 'Unsupported code' });
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  const dir = path.join(PORTAL_WEBROOT, domain, 'public_html', PORTAL_ERR_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${code}.html`), content);
  // Wire ErrorDocument in .htaccess
  const htaccess = path.join(PORTAL_WEBROOT, domain, 'public_html', '.htaccess');
  const directive = `ErrorDocument ${code} /${PORTAL_ERR_DIR}/${code}.html`;
  const existing = await fs.readFile(htaccess, 'utf-8').catch(() => '');
  if (!existing.includes(directive)) {
    await fs.writeFile(htaccess, existing.replace(/\n+$/, '') + (existing ? '\n' : '') + directive + '\n');
  }
  res.json({ success: true });
});

/* ── File manager (scoped strictly to /var/www/<owned-domain>) ── */

import multer from 'multer';
const portalFileUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const clientId = (req as any).clientId;
      const targetDomain = (req as any).portalTargetDomain;
      const targetSub = (req.query.subpath as string) || '';
      try {
        const base = path.resolve(path.join(PORTAL_WEBROOT, targetDomain));
        const dest = path.resolve(base, targetSub.replace(/^\/+/, ''));
        if (dest !== base && !dest.startsWith(base + path.sep)) throw new Error('Path traversal');
        cb(null, dest);
      } catch (e: any) { cb(e, ''); }
      void clientId;
    },
    filename: (_req, file, cb) => cb(null, path.basename(file.originalname || 'upload').replace(/^\.+/, '_').slice(0, 255) || 'upload'),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function portalResolveOwnedPath(clientId: number, domain: string, sub: string): string {
  if (!clientOwnsDomain(clientId, domain)) throw new Error('Not your domain');
  const base = path.resolve(path.join(PORTAL_WEBROOT, domain));
  const resolved = path.resolve(base, (sub || '').replace(/^\/+/, ''));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Path traversal not allowed');
  if (/[$`"\\!]/.test(resolved)) throw new Error('Path contains invalid characters');
  return resolved;
}

router.get('/files/:domain/list', clientAuth, async (req: Request, res: Response) => {
  try {
    const dir = portalResolveOwnedPath((req as any).clientId, req.params.domain, (req.query.path as string) || '');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = await Promise.all(entries.map(async e => {
      try {
        const st = await fs.stat(path.join(dir, e.name));
        return { name: e.name, type: e.isDirectory() ? 'directory' : 'file', size: st.size, modified: st.mtime, permissions: (st.mode & 0o777).toString(8) };
      } catch { return { name: e.name, type: 'file', size: 0, modified: new Date(), permissions: '000' }; }
    }));
    items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'directory' ? -1 : 1));
    res.json({ path: dir.replace(path.resolve(path.join(PORTAL_WEBROOT, req.params.domain)), '') || '/', items });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

router.get('/files/:domain/read', clientAuth, async (req: Request, res: Response) => {
  try {
    const file = portalResolveOwnedPath((req as any).clientId, req.params.domain, (req.query.path as string) || '');
    const st = await fs.stat(file);
    if (st.size > 2 * 1024 * 1024) return res.status(413).json({ error: 'File too large to edit (> 2 MB)' });
    res.json({ content: await fs.readFile(file, 'utf-8') });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

router.post('/files/:domain/write', clientAuth, async (req: Request, res: Response) => {
  try {
    const file = portalResolveOwnedPath((req as any).clientId, req.params.domain, req.body.path || '');
    await fs.writeFile(file, String(req.body.content ?? ''), 'utf-8');
    res.json({ message: 'File saved' });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

router.post('/files/:domain/mkdir', clientAuth, async (req: Request, res: Response) => {
  try {
    const dir = portalResolveOwnedPath((req as any).clientId, req.params.domain, req.body.path || '');
    await fs.mkdir(dir, { recursive: true });
    res.json({ message: 'Directory created' });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

router.delete('/files/:domain/delete', clientAuth, async (req: Request, res: Response) => {
  try {
    const target = portalResolveOwnedPath((req as any).clientId, req.params.domain, req.body.path || '');
    await fs.rm(target, { recursive: true, force: true });
    res.json({ message: 'Deleted' });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

router.post('/files/:domain/rename', clientAuth, async (req: Request, res: Response) => {
  try {
    const from = portalResolveOwnedPath((req as any).clientId, req.params.domain, req.body.from || '');
    const to   = portalResolveOwnedPath((req as any).clientId, req.params.domain, req.body.to   || '');
    await fs.rename(from, to);
    res.json({ message: 'Renamed' });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// Upload stamps req.portalTargetDomain before multer destination resolver
// kicks in so the upload can't escape the client's owned-domain root.
router.post('/files/:domain/upload', clientAuth,
  (req: Request, res: Response, next: NextFunction) => {
    if (!PORTAL_DOMAIN_RE.test(req.params.domain)) return res.status(400).json({ error: 'Invalid domain' });
    if (!clientOwnsDomain((req as any).clientId, req.params.domain)) return res.status(403).json({ error: 'Not your domain' });
    (req as any).portalTargetDomain = req.params.domain;
    next();
  },
  portalFileUpload.array('files'),
  (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    res.json({ message: `Uploaded ${files.length} file(s)` });
  },
);

router.get('/files/:domain/download', clientAuth, async (req: Request, res: Response) => {
  try {
    const file = portalResolveOwnedPath((req as any).clientId, req.params.domain, (req.query.path as string) || '');
    res.download(file);
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

/* ── htpasswd directory protection (scoped to public_html) ──── */

const PORTAL_HTPW_DIR = process.env.HTPW_DIR || '/etc/httpd/htpasswd';

router.get('/htpasswd/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  // Each protected directory lives under public_html/<sub> with its own
  // .htaccess pointing at the matching htpasswd file in HTPW_DIR (the
  // filename is a hex-encoded copy of the absolute directory path, same
  // convention as admin htpasswd.ts).
  const base = path.join(PORTAL_WEBROOT, domain, 'public_html');
  const walk = async (dir: string): Promise<{ directory: string; users: string[] }[]> => {
    const out: { directory: string; users: string[] }[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const sub = path.join(dir, e.name);
      const file = path.join(PORTAL_HTPW_DIR, Buffer.from(sub).toString('hex') + '.htpasswd');
      if (existsSync(file)) {
        const content = await fs.readFile(file, 'utf-8').catch(() => '');
        const users = content.split('\n').filter(Boolean).map(l => l.split(':')[0]);
        out.push({ directory: sub, users });
      }
      out.push(...await walk(sub));
    }
    return out;
  };
  const list = existsSync(base) ? await walk(base) : [];
  res.json(list);
});

function htpasswdStdinAdd(file: string, username: string, password: string, createFile: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = createFile ? ['-ic', file, username] : ['-i', file, username];
    const p = spawn('htpasswd', args);
    let err = '';
    p.stderr.on('data', d => err += d);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(err || `htpasswd exit ${code}`)));
    p.on('error', reject);
    p.stdin.write(password + '\n'); p.stdin.end();
  });
}

router.post('/htpasswd/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const { subpath, username, password, realm } = req.body;
  if (!subpath || !username || !password) return res.status(400).json({ error: 'subpath, username, password required' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  // Reuse the file-manager's safePath to keep the protected directory
  // strictly under the client's own /var/www/<domain> tree.
  const absDir = portalResolveOwnedPath((req as any).clientId, domain, `public_html/${subpath}`);
  if (!existsSync(absDir)) return res.status(404).json({ error: 'Directory does not exist' });
  const htpasswdFile = path.join(PORTAL_HTPW_DIR, Buffer.from(absDir).toString('hex') + '.htpasswd');
  await fs.mkdir(PORTAL_HTPW_DIR, { recursive: true });
  const fresh = !existsSync(htpasswdFile);
  await htpasswdStdinAdd(htpasswdFile, username, password, fresh);
  // Write/update .htaccess in the directory pointing at the file. Each
  // directory has its own .htaccess so users for one protected area
  // can't authenticate for another.
  const htaccessBlock = `AuthType Basic\nAuthName "${(realm || 'Protected Area').replace(/[\r\n"]/g, '')}"\nAuthUserFile ${htpasswdFile}\nRequire valid-user\n`;
  await fs.writeFile(path.join(absDir, '.htaccess'), htaccessBlock);
  res.json({ success: true });
});

router.delete('/htpasswd/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const { subpath } = req.body;
  if (!subpath) return res.status(400).json({ error: 'subpath required' });
  const absDir = portalResolveOwnedPath((req as any).clientId, domain, `public_html/${subpath}`);
  const file = path.join(PORTAL_HTPW_DIR, Buffer.from(absDir).toString('hex') + '.htpasswd');
  await fs.unlink(file).catch(() => {});
  await fs.unlink(path.join(absDir, '.htaccess')).catch(() => {});
  res.json({ success: true });
});

/* ── Hotlink protection (per owned domain) ──────────────────── */

router.get('/hotlink/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const htaccess = path.join(PORTAL_WEBROOT, domain, 'public_html', '.htaccess');
  const content = await fs.readFile(htaccess, 'utf-8').catch(() => '');
  const enabled = content.includes('# portal-hotlink-begin');
  const blockMatch = content.match(/# portal-hotlink-begin([\s\S]*?)# portal-hotlink-end/);
  const block = blockMatch?.[1] || '';
  const exts = (block.match(/\\\.\([^)]+\)/)?.[1] || '').split('|').filter(Boolean);
  const allowed = [...block.matchAll(/RewriteCond %\{HTTP_REFERER\} !\^\?https?:\/\/(?:www\.)?([^/\s$]+)/g)].map(m => m[1]).filter(d => d !== domain);
  res.json({ enabled, allowed_domains: allowed, blocked_extensions: exts.join(',') });
});

router.put('/hotlink/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const { enabled, allowed_domains, blocked_extensions } = req.body;
  const htaccess = path.join(PORTAL_WEBROOT, domain, 'public_html', '.htaccess');
  const content = await fs.readFile(htaccess, 'utf-8').catch(() => '');
  // Strip any prior portal-hotlink block before writing the new one.
  const stripped = content.replace(/# portal-hotlink-begin[\s\S]*?# portal-hotlink-end\n?/g, '');
  let next = stripped;
  if (enabled) {
    const exts = String(blocked_extensions || 'jpg,jpeg,png,gif,webp,mp4,mp3,pdf').replace(/[^a-zA-Z0-9,]/g, '').split(',').filter(Boolean).join('|');
    const allowList = ([domain] as string[]).concat(Array.isArray(allowed_domains) ? allowed_domains.filter((d: string) => /^[a-zA-Z0-9.-]+$/.test(d)) : []);
    const conds = allowList.map(d => `RewriteCond %{HTTP_REFERER} !^https?://(?:www\\.)?${d.replace(/\./g, '\\.')} [NC]`).join('\n');
    next = stripped.replace(/\n+$/, '') + `\n# portal-hotlink-begin\nRewriteEngine On\n${conds}\nRewriteRule \\.(${exts})$ - [F,NC]\n# portal-hotlink-end\n`;
  }
  await fs.writeFile(htaccess, next);
  res.json({ success: true });
});

/* ── Per-domain spam rules (whitelist / blacklist) ──────────── */

router.get('/spam-rules/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const rows = db.prepare("SELECT * FROM domain_spam_rules WHERE domain = ? ORDER BY type, address").all(domain);
  res.json(rows);
});

router.post('/spam-rules/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const { type, address } = req.body;
  if (!['whitelist', 'blacklist'].includes(type)) return res.status(400).json({ error: 'type must be whitelist or blacklist' });
  if (!address || !/^[A-Za-z0-9._%+@*-]+$/.test(String(address))) return res.status(400).json({ error: 'Invalid address pattern' });
  try {
    db.prepare('INSERT INTO domain_spam_rules (domain, type, address) VALUES (?, ?, ?)').run(domain, type, address);
    res.json({ success: true });
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Rule already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/spam-rules/:domain/:id', clientAuth, (req: Request, res: Response) => {
  const { domain, id } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  // The row is keyed by id; also verify the row's domain matches the URL
  // domain so a client can't delete a rule on a domain they don't own
  // even with a guessed id.
  const row: any = db.prepare('SELECT domain FROM domain_spam_rules WHERE id = ?').get(id);
  if (!row || row.domain !== domain) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM domain_spam_rules WHERE id = ?').run(id);
  res.json({ success: true });
});

/* ── Bandwidth / hit stats from the per-domain Apache log ───── */

router.get('/stats/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const log = `/var/log/httpd/${domain}-access.log`;
  if (!existsSync(log)) return res.json({ hits: 0, bytes: 0, top: [], log_path: log });
  try {
    // Awk over the access log: $7 is the URL path, $10 is response size
    // in CLF combined log format. Aggregate hits + bytes total + top 10
    // paths. tail -50000 caps memory for very chatty logs.
    const { stdout: total } = await execAsync(`tail -50000 "${log}" 2>/dev/null | awk '{ hits++; bytes += ($10 ~ /^[0-9]+$/ ? $10 : 0) } END { print hits"\\t"bytes }'`, { timeout: 15000 });
    const [hitsStr, bytesStr] = total.trim().split('\t');
    const { stdout: top } = await execAsync(`tail -50000 "${log}" 2>/dev/null | awk '{ print $7 }' | sort | uniq -c | sort -rn | head -10`, { timeout: 15000 });
    const topPaths = top.split('\n').filter(Boolean).map(l => { const m = l.trim().match(/^(\d+)\s+(.+)$/); return m ? { hits: parseInt(m[1]), path: m[2] } : null; }).filter(Boolean);
    res.json({ hits: parseInt(hitsStr) || 0, bytes: parseInt(bytesStr) || 0, top: topPaths, log_path: log });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── Security scan (ClamAV) scoped to owned webroot ─────────── */

router.post('/security-scan/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  if (!existsSync('/usr/bin/clamscan')) return res.status(503).json({ error: 'ClamAV is not installed on this server' });
  const target = path.join(PORTAL_WEBROOT, domain);
  // path.resolve + base-prefix check is unnecessary here because the
  // domain regex already restricts the input to safe characters, but
  // wrap clamscan's output in a try/catch so a non-zero exit (clamscan
  // returns 1 when it finds infections, 2 on error) is still reported
  // as a usable JSON response.
  try {
    const { stdout, stderr } = await execAsync(`clamscan -r --infected --no-summary "${target}" 2>&1`, { timeout: 300000 })
      .catch((e: any) => ({ stdout: (e.stdout || '') as string, stderr: (e.stderr || '') as string }));
    const lines: string[] = (stdout + stderr).split('\n').filter(Boolean);
    const infected = lines.filter((l: string) => l.includes(': ') && !l.startsWith('LibClamAV')).map((l: string) => l.trim());
    res.json({ scanned: target, infected_count: infected.length, infected });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/* ── Raw .htaccess editor (for owned domain public_html) ───── */

router.get('/htaccess/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const file = path.join(PORTAL_WEBROOT, domain, 'public_html', '.htaccess');
  const content = await fs.readFile(file, 'utf-8').catch(() => '');
  res.json({ content });
});

router.post('/htaccess/:domain', clientAuth, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!PORTAL_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!clientOwnsDomain((req as any).clientId, domain)) return res.status(403).json({ error: 'Not your domain' });
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  if (content.length > 64 * 1024) return res.status(413).json({ error: '.htaccess too large (> 64 KB)' });
  // Apache will refuse to start a vhost with a broken .htaccess, but
  // since AllowOverride is per-Directory, a bad file only breaks the
  // tenant's own site. Still, refuse obviously-malicious directives.
  if (/\b(SetHandler\s+server-status|SetHandler\s+server-info)\b/i.test(content)) {
    return res.status(400).json({ error: 'Server-status / server-info handlers are not allowed' });
  }
  const file = path.join(PORTAL_WEBROOT, domain, 'public_html', '.htaccess');
  await fs.writeFile(file, content);
  res.json({ success: true });
});

export default router;
