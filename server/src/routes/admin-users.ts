import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { validatePassword, getPasswordPolicy } from '../utils/password-policy';
import { AuthRequest, requireRole } from '../middleware/auth';

const superadminOnly = requireRole('superadmin');

const router = Router();

/* ── List admins ─────────────────────────────────────────── */

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT id, username, email, role, totp_enabled, last_login, created_at FROM admin_users ORDER BY created_at').all();
  res.json(rows);
});

/* ── Create admin ────────────────────────────────────────── */

router.post('/', superadminOnly, async (req: AuthRequest, res: Response) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'username, email, password required' });
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
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

router.put('/:id', superadminOnly, async (req: AuthRequest, res: Response) => {
  // Partial update: fetch current row and fall back per-field so an
  // {role:'admin'} body doesn't blank email/role to NULL on NOT NULL
  // columns. Same idiom as plans / autoresponders / recurring_schedules.
  const current: any = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Admin user not found' });
  const { email, password, role } = req.body;
  const newEmail = email !== undefined ? email : current.email;
  const newRole  = role  !== undefined ? role  : current.role;
  try {
    if (password) {
      const pwError = validatePassword(password);
      if (pwError) return res.status(400).json({ error: pwError });
      const hash = await bcrypt.hash(password, 12);
      db.prepare('UPDATE admin_users SET email=?, password_hash=?, role=? WHERE id=?').run(newEmail, hash, newRole, req.params.id);
    } else {
      db.prepare('UPDATE admin_users SET email=?, role=? WHERE id=?').run(newEmail, newRole, req.params.id);
    }
    res.json(db.prepare('SELECT id, username, email, role, totp_enabled, created_at FROM admin_users WHERE id = ?').get(req.params.id));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Delete admin ────────────────────────────────────────── */

router.delete('/:id', superadminOnly, (req: AuthRequest, res: Response) => {
  const current: any = db.prepare('SELECT id, role FROM admin_users WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Admin user not found' });
  const count = (db.prepare('SELECT COUNT(*) as n FROM admin_users').get() as any).n;
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last admin user' });
  if (current.role === 'superadmin') {
    const superadminCount = (db.prepare("SELECT COUNT(*) as n FROM admin_users WHERE role = 'superadmin'").get() as any).n;
    if (superadminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last superadmin user' });
  }
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── Password policy ─────────────────────────────────────── */

router.get('/password-policy', (_req: Request, res: Response) => {
  res.json(getPasswordPolicy());
});

router.put('/password-policy', superadminOnly, (req: AuthRequest, res: Response) => {
  const { min_length, require_upper, require_number, require_special } = req.body;
  const upsert = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at");
  if (min_length !== undefined) upsert.run('pw_min_length', String(Math.max(6, parseInt(min_length) || 8)));
  if (require_upper !== undefined) upsert.run('pw_require_upper', require_upper ? '1' : '0');
  if (require_number !== undefined) upsert.run('pw_require_number', require_number ? '1' : '0');
  if (require_special !== undefined) upsert.run('pw_require_special', require_special ? '1' : '0');
  res.json({ success: true });
});

export default router;
