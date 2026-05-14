import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db';

const router = Router();

/* ── List resellers ──────────────────────────────────────── */

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT r.*, u.username, u.email, u.role,
           COUNT(DISTINCT a.id) as account_count,
           COUNT(DISTINCT c.id) as client_count
    FROM resellers r
    LEFT JOIN admin_users u ON r.admin_user_id = u.id
    LEFT JOIN accounts a    ON a.id IN (
      SELECT account_id FROM invoices WHERE client_id IN (SELECT id FROM clients WHERE id IN (SELECT DISTINCT client_id FROM accounts))
    )
    LEFT JOIN clients c ON c.id > 0
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(rows);
});

/* ── Create reseller account ─────────────────────────────── */

router.post('/', async (req: Request, res: Response) => {
  const { username, email, password, company, alloc_disk, alloc_bandwidth, alloc_accounts, alloc_emails, alloc_dbs } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'username, email, password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const r = db.prepare("INSERT INTO admin_users (username, email, password_hash, role) VALUES (?, ?, ?, 'reseller')").run(username, email, hash);
    const adminId = r.lastInsertRowid;
    const r2 = db.prepare(`
      INSERT INTO resellers (admin_user_id, company, alloc_disk, alloc_bandwidth, alloc_accounts, alloc_emails, alloc_dbs)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(adminId, company || '', alloc_disk ?? 102400, alloc_bandwidth ?? 1024000, alloc_accounts ?? 10, alloc_emails ?? 50, alloc_dbs ?? 20);
    res.json(db.prepare('SELECT r.*, u.username, u.email FROM resellers r LEFT JOIN admin_users u ON r.admin_user_id = u.id WHERE r.id = ?').get(r2.lastInsertRowid));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: err.message });
  }
});

/* ── Update reseller allocations ─────────────────────────── */

router.put('/:id', (req: Request, res: Response) => {
  const { company, alloc_disk, alloc_bandwidth, alloc_accounts, alloc_emails, alloc_dbs } = req.body;
  db.prepare('UPDATE resellers SET company=?, alloc_disk=?, alloc_bandwidth=?, alloc_accounts=?, alloc_emails=?, alloc_dbs=? WHERE id=?')
    .run(company, alloc_disk, alloc_bandwidth, alloc_accounts, alloc_emails, alloc_dbs, req.params.id);
  res.json(db.prepare('SELECT * FROM resellers WHERE id = ?').get(req.params.id));
});

/* ── Delete reseller ─────────────────────────────────────── */

router.delete('/:id', (req: Request, res: Response) => {
  const reseller = db.prepare('SELECT * FROM resellers WHERE id = ?').get(req.params.id) as any;
  if (!reseller) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(reseller.admin_user_id);
  db.prepare('DELETE FROM resellers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── Reseller WHM summary ────────────────────────────────── */

router.get('/:id/summary', (req: Request, res: Response) => {
  const reseller = db.prepare('SELECT r.*, u.username FROM resellers r LEFT JOIN admin_users u ON r.admin_user_id = u.id WHERE r.id = ?').get(req.params.id) as any;
  if (!reseller) return res.status(404).json({ error: 'Not found' });
  res.json({ reseller, usage: { accounts: 0, clients: 0, disk: 0, bandwidth: 0 } });
});

export default router;
