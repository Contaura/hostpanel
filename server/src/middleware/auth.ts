import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: { username: string; role: string };
}

function jwtSecret() {
  return process.env.JWT_SECRET || 'hostpanel-secret-change-in-production';
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    // Pin HS256 — without this, an attacker who can supply a forged token gets
    // to choose the algorithm (e.g. alg:none, or RS256 with the secret as the
    // public key) on older jsonwebtoken versions. jsonwebtoken@9 defaults to
    // HS256 when the secret is a string, but being explicit is cheap.
    const decoded = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] }) as { username: string; role: string };
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

// Blocks portal-role JWTs (role: client, client_team) from reaching admin API
// routes. authenticateToken runs first and populates req.user; this guard then
// refuses portal roles before any admin handler can be called. Mounting order
// in index.ts must be: authenticateToken → blockPortalRoles → route handler.
export function blockPortalRoles(req: AuthRequest, res: Response, next: NextFunction): void {
  const role = req.user?.role;
  if (role === 'client' || role === 'client_team' || role === 'client_pending_2fa') {
    res.status(403).json({ error: 'Portal role tokens are not permitted on admin API routes' });
    return;
  }
  next();
}

// Decodes JWT without requiring req.user to already be set — used as a global pre-route guard
export function readonlyGuard(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!tok) { next(); return; }
  try {
    const payload = jwt.verify(tok, jwtSecret(), { algorithms: ['HS256'] }) as { role?: string };
    if (payload.role === 'readonly') {
      res.status(403).json({ error: 'Readonly users cannot perform write operations' });
      return;
    }
  } catch { /* invalid/expired — authenticateToken will reject */ }
  next();
}
