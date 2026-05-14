import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';

const router = Router();

/* ── List admins ─────────────────────────────────────────── */

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT id, username, email, role, totp_enabled, last_login, created_at FROM admin_users ORDER BY created_at').all();
  res.json(rows);
});

/* ── Create admin ────────────────────────────────────────── */

router.post('/', async (req: Request, res: Response) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'username, email, password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['superadmin', 'admin', 'readonly'].includes(role)) return res.status(400).json({ error: 'role must be superadmin, admin, or readonly' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const r = db.prepare('INSERT INTO admin_users (username, email, password_hash, role) VALUES (?, ?, ?, ?)').run(username, email, hash, role || 'admin');
    res.json(db.prepare('SELECT id, username, email, role, totp_enabled, created_at FROM admin_users WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: err.message });
  }
});

/* ── Update admin ────────────────────────────────────────── */

router.put('/:id', async (req: Request, res: Response) => {
  const { email, password, role } = req.body;
  try {
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      const hash = await bcrypt.hash(password, 12);
      db.prepare('UPDATE admin_users SET email=?, password_hash=?, role=? WHERE id=?').run(email, hash, role, req.params.id);
    } else {
      db.prepare('UPDATE admin_users SET email=?, role=? WHERE id=?').run(email, role, req.params.id);
    }
    res.json(db.prepare('SELECT id, username, email, role, totp_enabled, created_at FROM admin_users WHERE id = ?').get(req.params.id));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Delete admin ────────────────────────────────────────── */

router.delete('/:id', (req: Request, res: Response) => {
  const count = (db.prepare('SELECT COUNT(*) as n FROM admin_users').get() as any).n;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last admin user' });
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
