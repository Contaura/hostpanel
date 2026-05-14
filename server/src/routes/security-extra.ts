import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const speakeasy = require('speakeasy');
import QRCode from 'qrcode';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

/* ── 2FA TOTP ────────────────────────────────────────────── */

router.get('/2fa', (req: AuthRequest, res: Response) => {
  const username = (req as any).user?.username || process.env.ADMIN_USER || 'admin';
  const user = db.prepare('SELECT totp_enabled, totp_secret FROM admin_users WHERE username = ?').get(username) as any;
  if (!user) return res.json({ enabled: false, configured: false });
  res.json({ enabled: !!user.totp_enabled, configured: !!user.totp_secret });
});

router.post('/2fa/setup', async (req: AuthRequest, res: Response) => {
  const username = (req as any).user?.username || process.env.ADMIN_USER || 'admin';
  const secretObj = speakeasy.generateSecret({ length: 20, name: username });
  const secret = secretObj.base32;
  const companyName = (db.prepare("SELECT value FROM settings WHERE key='company_name'").get() as any)?.value || 'HostPanel';
  const otpauth = speakeasy.otpauthURL({ secret, label: username, issuer: companyName, encoding: 'base32' });

  try {
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    // Store unconfirmed secret; only activate on verify
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_secret, totp_enabled) VALUES (?, ?, ?, 'superadmin', ?, 0) ON CONFLICT(username) DO UPDATE SET totp_secret=excluded.totp_secret, totp_enabled=0")
      .run(username, username + '@local', '', secret);
    res.json({ secret, qrDataUrl, otpauth });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/2fa/verify', (req: AuthRequest, res: Response) => {
  const username = (req as any).user?.username || process.env.ADMIN_USER || 'admin';
  const { token } = req.body;
  const user = db.prepare('SELECT totp_secret FROM admin_users WHERE username = ?').get(username) as any;
  if (!user?.totp_secret) return res.status(400).json({ error: '2FA not set up — call /setup first' });

  const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: String(token) });
  if (!valid) return res.status(401).json({ error: 'Invalid code' });

  db.prepare('UPDATE admin_users SET totp_enabled = 1 WHERE username = ?').run(username);
  res.json({ success: true });
});

router.delete('/2fa', (req: AuthRequest, res: Response) => {
  const username = (req as any).user?.username || process.env.ADMIN_USER || 'admin';
  db.prepare('UPDATE admin_users SET totp_secret = NULL, totp_enabled = 0 WHERE username = ?').run(username);
  res.json({ success: true });
});

/* ── 2FA Backup Codes ────────────────────────────────────── */

router.post('/2fa/backup-codes', (req: AuthRequest, res: Response) => {
  const username = (req as any).user?.username || process.env.ADMIN_USER || 'admin';
  const user = db.prepare('SELECT totp_enabled FROM admin_users WHERE username = ?').get(username) as any;
  if (!user?.totp_enabled) return res.status(400).json({ error: '2FA must be enabled first' });
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex').toUpperCase());
  const codesJson = JSON.stringify(codes);
  db.prepare('UPDATE admin_users SET totp_backup_codes = ? WHERE username = ?').run(codesJson, username);
  res.json({ codes });
});

router.get('/2fa/backup-codes', (req: AuthRequest, res: Response) => {
  const username = (req as any).user?.username || process.env.ADMIN_USER || 'admin';
  const user = db.prepare('SELECT totp_backup_codes FROM admin_users WHERE username = ?').get(username) as any;
  const codes: string[] = user?.totp_backup_codes ? JSON.parse(user.totp_backup_codes) : [];
  res.json({ count: codes.length, has_codes: codes.length > 0 });
});

/* ── Change Password ─────────────────────────────────────── */

router.post('/change-password', async (req: AuthRequest, res: Response) => {
  const username = (req as any).user?.username || process.env.ADMIN_USER || 'admin';
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const dbUser = db.prepare('SELECT password_hash FROM admin_users WHERE username = ?').get(username) as any;

  // Verify against DB hash first, then env fallback
  let valid = false;
  if (dbUser?.password_hash) {
    valid = await bcrypt.compare(currentPassword, dbUser.password_hash);
  } else {
    const envHash = process.env.ADMIN_PASS_HASH || bcrypt.hashSync('changeme', 10);
    valid = await bcrypt.compare(currentPassword, envHash);
  }

  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(newPassword, 12);
  db.prepare("INSERT INTO admin_users (username, email, password_hash, role) VALUES (?, ?, ?, 'superadmin') ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash")
    .run(username, username + '@local', newHash);

  res.json({ success: true, message: 'Password updated. New hash: ' + newHash });
});

/* ── IP Whitelist ────────────────────────────────────────── */

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

router.get('/ip-whitelist', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM ip_whitelist ORDER BY created_at DESC').all());
});

router.post('/ip-whitelist', (req: Request, res: Response) => {
  const { ip, label } = req.body;
  if (!ip || !IP_RE.test(ip)) return res.status(400).json({ error: 'Valid IP or CIDR required' });
  try {
    const r = db.prepare('INSERT INTO ip_whitelist (ip, label) VALUES (?, ?)').run(ip, label || '');
    res.json(db.prepare('SELECT * FROM ip_whitelist WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'IP already in whitelist' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/ip-whitelist/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM ip_whitelist WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
