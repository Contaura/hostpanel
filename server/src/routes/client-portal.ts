import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const speakeasy = require('speakeasy');
import QRCode from 'qrcode';

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

export default router;
