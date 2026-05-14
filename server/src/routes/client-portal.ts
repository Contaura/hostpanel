import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db';

const router = Router();

function jwtSecret() {
  return process.env.JWT_SECRET || 'hostpanel-secret-change-in-production';
}

function clientAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(auth.slice(7), jwtSecret()) as any;
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

  const client: any = db.prepare('SELECT * FROM clients WHERE email = ? AND portal_enabled = 1').get(email);
  if (!client) return res.status(401).json({ error: 'Invalid credentials or portal access not enabled' });
  if (!client.password_hash) return res.status(401).json({ error: 'Password not set. Contact your hosting provider.' });

  const valid = await bcrypt.compare(password, client.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

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

// Admin set-password is in billing.ts (POST /billing/clients/:id/portal-password) — protected by authenticateToken there

export default router;
