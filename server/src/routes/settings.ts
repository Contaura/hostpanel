import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import db from '../db';

const router = Router();

/* ── Get all settings ────────────────────────────────────── */

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const obj: Record<string, string> = {};
  for (const r of rows) obj[r.key] = r.value;
  // Never send secrets over the wire
  delete obj.smtp_pass;
  delete obj.paypal_secret;
  res.json(obj);
});

/* ── Update settings (batch) ─────────────────────────────── */

const ALLOWED_KEYS = new Set([
  'company_name', 'company_email', 'company_address', 'company_logo',
  'currency', 'tax_rate', 'tax_name', 'invoice_prefix',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure',
  'paypal_client_id', 'paypal_secret', 'paypal_mode',
  'panel_2fa_required',
]);

router.put('/', (req: Request, res: Response) => {
  const upsert = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at");
  const updates = db.transaction(() => {
    for (const [key, value] of Object.entries(req.body)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      upsert.run(key, String(value));
    }
  });
  updates();
  res.json({ success: true });
});

/* ── Test SMTP ───────────────────────────────────────────── */

router.post('/test-smtp', async (req: Request, res: Response) => {
  const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure, to } = req.body;
  if (!smtp_host || !to) return res.status(400).json({ error: 'smtp_host and to are required' });
  try {
    const transporter = nodemailer.createTransport({
      host: smtp_host,
      port: Number(smtp_port) || 587,
      secure: smtp_secure === '1' || smtp_secure === true,
      auth: smtp_user ? { user: smtp_user, pass: smtp_pass } : undefined,
    });
    await transporter.sendMail({
      from: smtp_from || smtp_user,
      to,
      subject: 'HostPanel SMTP Test',
      text: 'This is a test email from HostPanel. Your SMTP settings are working correctly.',
    });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
