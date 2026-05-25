import { Router, Request, Response, NextFunction } from 'express';
import db from '../db';

const router = Router();

function resourceFromPath(fullPath: string): string {
  const clean = fullPath.split('?')[0];
  const portalDomain = clean.match(/^\/api\/portal\/domains\/([^/]+)/) || clean.match(/^\/api\/portal\/(?:files|htpasswd|hotlink|spam-rules|stats|security-scan|htaccess)\/([^/]+)/);
  if (portalDomain) return decodeURIComponent(portalDomain[1]);
  const last = clean.split('/').filter(Boolean).pop();
  return last || '';
}

/* ── Middleware to log actions — attach to index.ts ─────── */

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const SKIP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  if (SKIP_METHODS.has(req.method)) return next();

  // Capture the request line up front — req.path is consumed by sub-routers
  // mounted further down the stack, so by the time res.json fires it can be "/".
  const method = req.method;
  const fullPath = (req.originalUrl || req.url).split('?')[0];
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';

  const origJson = res.json.bind(res);
  res.json = function (body: any) {
    if (res.statusCode < 400) {
      try {
        const user = (req as any).user;
        const actor = (req as any).auditActor || {};
        const username = actor.username || user?.username || 'anonymous';
        const action   = `${method} ${fullPath}`;
        const resource = (req as any).auditResource || req.params?.id || req.params?.name || req.params?.domain || resourceFromPath(fullPath);
        const details = JSON.stringify(actor.details || {});
        db.prepare("INSERT INTO audit_logs (username, action, resource, details, ip) VALUES (?, ?, ?, ?, ?)").run(username, action, resource, details, ip);
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
