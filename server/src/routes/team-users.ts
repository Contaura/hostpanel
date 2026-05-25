import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import db from '../db';

const router = Router();
const PERMISSIONS = ['files','backup-wizard','webdav','email-accounts','mail-trace','analytics','databases','phpmyadmin','dns','ftp','billing','support'];

db.exec(`CREATE TABLE IF NOT EXISTS team_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  permissions TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  invite_token TEXT,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

function cleanPerms(input: unknown): string[] {
  const allowed = new Set(PERMISSIONS);
  return Array.isArray(input) ? [...new Set(input.map(String).filter(p => allowed.has(p)))] : [];
}
function publicRow(row: any) { if (!row) return row; const { password_hash, ...rest } = row; return { ...rest, permissions: JSON.parse(row.permissions || '[]') }; }

router.get('/permissions', (_req: Request, res: Response) => res.json({ permissions: PERMISSIONS }));
router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare(`SELECT tu.*, c.name AS client_name, a.domain AS account_domain FROM team_users tu LEFT JOIN clients c ON c.id=tu.client_id LEFT JOIN accounts a ON a.id=tu.account_id ORDER BY tu.created_at DESC`).all().map(publicRow);
  res.json(rows);
});
router.post('/', async (req: Request, res: Response) => {
  const { username, email, password, client_id = null, account_id = null, permissions = [], notes = '' } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: 'username, email and password required' });
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const invite = crypto.randomBytes(24).toString('hex');
    const r = db.prepare(`INSERT INTO team_users (client_id, account_id, username, email, password_hash, permissions, notes, invite_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(client_id, account_id, username, email, hash, JSON.stringify(cleanPerms(permissions)), notes, invite);
    res.json(publicRow(db.prepare('SELECT * FROM team_users WHERE id=?').get(r.lastInsertRowid)));
  } catch (err: any) { res.status(err.message?.includes('UNIQUE') ? 409 : 500).json({ error: err.message?.includes('UNIQUE') ? 'Username or email already exists' : err.message }); }
});
router.put('/:id', async (req: Request, res: Response) => {
  const current: any = db.prepare('SELECT * FROM team_users WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Team user not found' });
  const password_hash = req.body.password ? await bcrypt.hash(req.body.password, 12) : current.password_hash;
  db.prepare(`UPDATE team_users SET client_id=?, account_id=?, email=?, password_hash=?, status=?, permissions=?, notes=?, updated_at=datetime('now') WHERE id=?`).run(
    req.body.client_id ?? current.client_id, req.body.account_id ?? current.account_id, req.body.email ?? current.email, password_hash,
    req.body.status ?? current.status, JSON.stringify(cleanPerms(req.body.permissions ?? JSON.parse(current.permissions || '[]'))), req.body.notes ?? current.notes, req.params.id);
  res.json(publicRow(db.prepare('SELECT * FROM team_users WHERE id=?').get(req.params.id)));
});
router.delete('/:id', (req: Request, res: Response) => { db.prepare('DELETE FROM team_users WHERE id=?').run(req.params.id); res.json({ success: true }); });
export default router;
