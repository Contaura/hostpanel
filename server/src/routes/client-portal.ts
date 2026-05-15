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

export default router;
