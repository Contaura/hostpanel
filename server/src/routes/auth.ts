import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const speakeasy = require('speakeasy');
import db from '../db';

const router = Router();

function jwtSecret() {
  return process.env.JWT_SECRET || 'hostpanel-secret-change-in-production';
}

router.post('/login', async (req: Request, res: Response) => {
  const { username, password, totp_token } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Try DB users first
  const dbUser = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username) as any;

  let valid = false;
  let totpEnabled = false;
  let totpSecret: string | null = null;
  let role = 'admin';

  if (dbUser) {
    valid = await bcrypt.compare(password, dbUser.password_hash);
    totpEnabled = !!dbUser.totp_enabled;
    totpSecret = dbUser.totp_secret;
    role = dbUser.role;
  } else {
    // Fallback to env credentials
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || bcrypt.hashSync('changeme', 10);
    if (username !== ADMIN_USER) return res.status(401).json({ error: 'Invalid credentials' });
    valid = await bcrypt.compare(password, ADMIN_PASS_HASH);
  }

  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  // Enforce global 2FA requirement
  const tfaEnforced = (db.prepare("SELECT value FROM settings WHERE key = 'panel_2fa_required'").get() as any)?.value === '1';
  if (tfaEnforced && !totpEnabled) {
    return res.status(403).json({ error: 'Two-factor authentication is required for all admins. Enable 2FA in Security settings before logging in.' });
  }

  // 2FA check
  if (totpEnabled && totpSecret) {
    if (!totp_token) {
      return res.status(200).json({ requires2FA: true, message: 'TOTP token required' });
    }
    const totpValid = speakeasy.totp.verify({ secret: totpSecret, encoding: 'base32', token: String(totp_token) });
    if (!totpValid) return res.status(401).json({ error: 'Invalid 2FA code' });
  }

  // Update last_login
  if (dbUser) db.prepare('UPDATE admin_users SET last_login = datetime("now") WHERE id = ?').run(dbUser.id);

  const token = jwt.sign({ username, role }, jwtSecret(), { expiresIn: '8h' });
  res.json({ token, username, role });
});

router.post('/change-password', async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || bcrypt.hashSync('changeme', 10);
  const valid = await bcrypt.compare(currentPassword, ADMIN_PASS_HASH);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(newPassword, 12);
  res.json({ message: 'Password updated. Update ADMIN_PASS_HASH in .env to: ' + newHash });
});

export default router;
