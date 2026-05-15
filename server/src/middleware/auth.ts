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
    const decoded = jwt.verify(token, jwtSecret()) as { username: string; role: string };
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

// Decodes JWT without requiring req.user to already be set — used as a global pre-route guard
export function readonlyGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET') { next(); return; }
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!tok) { next(); return; }
  try {
    const payload = jwt.verify(tok, jwtSecret()) as { role?: string };
    if (payload.role === 'readonly') {
      res.status(403).json({ error: 'Readonly users cannot perform write operations' });
      return;
    }
  } catch { /* invalid/expired — authenticateToken will reject */ }
  next();
}
