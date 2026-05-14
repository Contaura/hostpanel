import { Router, Request, Response, NextFunction } from 'express';
import db from '../db';

const router = Router();

/* ── Middleware to log actions — attach to index.ts ─────── */

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const SKIP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  if (SKIP_METHODS.has(req.method)) return next();

  const origJson = res.json.bind(res);
  res.json = function (body: any) {
    if (res.statusCode < 400) {
      try {
        const user = (req as any).user;
        const username = user?.username || 'anonymous';
        const action   = `${req.method} ${req.path}`;
        const resource = req.params?.id || req.params?.name || req.params?.domain || '';
        const ip       = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
        db.prepare("INSERT INTO audit_logs (username, action, resource, ip) VALUES (?, ?, ?, ?)").run(username, action, resource, ip);
      } catch (_) {}
    }
    return origJson(body);
  };
  next();
}

/* ── List audit logs ─────────────────────────────────────── */

router.get('/', (req: Request, res: Response) => {
  const limit  = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const user   = req.query.user as string || '';
  const search = req.query.search as string || '';

  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params: any[] = [];
  if (user) { sql += ' AND username = ?'; params.push(user); }
  if (search) { sql += ' AND (action LIKE ? OR resource LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const total = (db.prepare(`SELECT COUNT(*) as n FROM audit_logs${user ? ' WHERE username=?' : ''}`).get(...(user ? [user] : [])) as any).n;
  res.json({ total, rows: db.prepare(sql).all(...params) });
});

router.delete('/clear', (_req: Request, res: Response) => {
  db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', '-90 days')").run();
  res.json({ success: true });
});

export default router;
