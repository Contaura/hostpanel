import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import db from '../db';

const router = Router();

/* ── List tokens (never shows full token) ────────────────── */

router.get('/', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT id, name, token_prefix, permissions, last_used, expires_at, created_at FROM api_tokens ORDER BY created_at DESC').all());
});

/* ── Create token ────────────────────────────────────────── */

router.post('/', (req: Request, res: Response) => {
  const { name, permissions, expires_at } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!['read', 'write', 'admin'].includes(permissions)) return res.status(400).json({ error: 'permissions must be read, write, or admin' });

  const rawToken = 'hp_' + crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const prefix = rawToken.slice(0, 10);

  try {
    const r = db.prepare(`
      INSERT INTO api_tokens (name, token_hash, token_prefix, permissions, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, tokenHash, prefix, permissions || 'read', expires_at || null);

    // Return the full token only once
    res.json({
      id: r.lastInsertRowid,
      name,
      token: rawToken,
      token_prefix: prefix,
      permissions,
      expires_at: expires_at || null,
      message: 'Store this token securely — it will not be shown again.',
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Revoke token ────────────────────────────────────────── */

router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
