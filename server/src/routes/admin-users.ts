import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';

function getPasswordPolicy() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('pw_min_length','pw_require_upper','pw_require_number','pw_require_special')").all() as { key: string; value: string }[];
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  return {
    min_length: parseInt(m.pw_min_length) || 8,
    require_upper: m.pw_require_upper === '1',
    require_number: m.pw_require_number === '1',
    require_special: m.pw_require_special === '1',
  };
}

function validatePassword(password: string): string | null {
  const policy = getPasswordPolicy();
  if (password.length < policy.min_length) return `Password must be at least ${policy.min_length} characters`;
  if (policy.require_upper && !/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (policy.require_number && !/[0-9]/.test(password)) return 'Password must contain a number';
  if (policy.require_special && !/[^a-zA-Z0-9]/.test(password)) return 'Password must contain a special character';
  return null;
}

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

router.put('/:id', async (req: Request, res: Response) => {
  const { email, password, role } = req.body;
  try {
    if (password) {
      const pwError = validatePassword(password);
      if (pwError) return res.status(400).json({ error: pwError });
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

/* ── Password policy ─────────────────────────────────────── */

router.get('/password-policy', (_req: Request, res: Response) => {
  res.json(getPasswordPolicy());
});

router.put('/password-policy', (req: Request, res: Response) => {
  const { min_length, require_upper, require_number, require_special } = req.body;
  const upsert = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at");
  if (min_length !== undefined) upsert.run('pw_min_length', String(Math.max(6, parseInt(min_length) || 8)));
  if (require_upper !== undefined) upsert.run('pw_require_upper', require_upper ? '1' : '0');
  if (require_number !== undefined) upsert.run('pw_require_number', require_number ? '1' : '0');
  if (require_special !== undefined) upsert.run('pw_require_special', require_special ? '1' : '0');
  res.json({ success: true });
});

export default router;
