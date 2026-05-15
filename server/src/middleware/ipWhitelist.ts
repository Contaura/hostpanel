import { Request, Response, NextFunction } from 'express';
import db from '../db';

function normalizeIp(ip: string): string {
  // Strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0;
}

function ipInCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return ip === cidr;
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
}

export function ipWhitelistMiddleware(req: Request, res: Response, next: NextFunction): void {
  const entries = db.prepare('SELECT ip FROM ip_whitelist').all() as { ip: string }[];
  if (entries.length === 0) { next(); return; }

  const raw = req.ip || req.socket.remoteAddress || '';
  const clientIp = normalizeIp(raw);

  // Loopback always passes — the box owner needs an escape hatch when they
  // accidentally whitelist the wrong IP, so curl from a local SSH session
  // (e.g. `ssh box -L 3001:localhost:3001`) can still reach the panel and
  // delete the bad row.
  if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost') {
    next();
    return;
  }

  const allowed = entries.some(e => ipInCidr(clientIp, e.ip));
  if (allowed) { next(); return; }

  res.status(403).json({ error: 'Access denied: your IP is not whitelisted' });
}
