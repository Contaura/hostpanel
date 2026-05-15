import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import multer from 'multer';
import path from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import db from '../db';

const execAsync = promisify(exec);
const MAIN_CF = process.env.POSTFIX_MAIN_CF || '/etc/postfix/main.cf';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../../data');
const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(DATA_DIR, 'uploads');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, _file, cb) => cb(null, 'logo.png'),
});
const logoUpload = multer({ storage: logoStorage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  cb(null, /image\/(png|jpeg|gif|svg\+xml|webp)/.test(file.mimetype));
} });

const router = Router();

/* ── Get all settings ────────────────────────────────────── */

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const obj: Record<string, string> = {};
  for (const r of rows) obj[r.key] = r.value;
  // Never send secrets over the wire
  delete obj.smtp_pass;
  delete obj.paypal_secret;
  delete obj.stripe_secret_key;
  delete obj.stripe_webhook_secret;
  res.json(obj);
});

/* ── Update settings (batch) ─────────────────────────────── */

const ALLOWED_KEYS = new Set([
  'company_name', 'company_email', 'company_address', 'company_logo',
  'currency', 'tax_rate', 'tax_name', 'invoice_prefix',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure',
  'paypal_client_id', 'paypal_secret', 'paypal_mode',
  'stripe_secret_key', 'stripe_publishable_key', 'stripe_webhook_secret', 'stripe_price_id',
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

/* ── Logo upload ─────────────────────────────────────────── */

router.post('/logo', logoUpload.single('logo'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded or unsupported format' });
  const logoUrl = `/api/settings/logo?t=${Date.now()}`;
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('company_logo', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .run(logoUrl);
  res.json({ success: true, url: logoUrl });
});

router.get('/logo', (_req: Request, res: Response) => {
  const logoPath = path.join(DATA_DIR, 'uploads', 'logo.png');
  if (!existsSync(logoPath)) return res.status(404).json({ error: 'No logo uploaded' });
  res.sendFile(logoPath);
});

router.delete('/logo', (req: Request, res: Response) => {
  const logoPath = path.join(DATA_DIR, 'uploads', 'logo.png');
  try {
    if (existsSync(logoPath)) require('fs').unlinkSync(logoPath);
  } catch {}
  db.prepare("DELETE FROM settings WHERE key='company_logo'").run();
  res.json({ success: true });
});

/* ── Postfix SMTP relay (outbound relayhost) ─────────────── */

router.get('/relay', async (_req: Request, res: Response) => {
  try {
    if (!existsSync(MAIN_CF)) return res.json({ relayhost: '', sasl_user: '' });
    const conf = readFileSync(MAIN_CF, 'utf8');
    const relayhost   = conf.match(/^relayhost\s*=\s*(.+)/m)?.[1]?.trim() || '';
    const sasl_user   = conf.match(/^smtp_sasl_password_maps\s*=\s*(.+)/m)?.[1]?.trim() || '';
    const sasl_on     = conf.includes('smtp_sasl_auth_enable = yes');
    res.json({ relayhost, sasl_enabled: sasl_on, sasl_user });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/relay', async (req: Request, res: Response) => {
  const { relayhost, sasl_user, sasl_pass } = req.body;
  if (!relayhost) return res.status(400).json({ error: 'relayhost required' });
  if (/[\r\n]/.test(relayhost)) return res.status(400).json({ error: 'Invalid relayhost' });
  try {
    let conf = existsSync(MAIN_CF) ? readFileSync(MAIN_CF, 'utf8') : '';

    const setParam = (key: string, val: string) => {
      const re = new RegExp(`^#?${key}\\s*=.*`, 'm');
      if (re.test(conf)) conf = conf.replace(re, `${key} = ${val}`);
      else conf += `\n${key} = ${val}`;
    };

    setParam('relayhost', relayhost);

    if (sasl_user && sasl_pass) {
      setParam('smtp_sasl_auth_enable', 'yes');
      setParam('smtp_sasl_password_maps', 'hash:/etc/postfix/sasl_passwd');
      setParam('smtp_sasl_security_options', 'noanonymous');
      setParam('smtp_tls_security_level', 'encrypt');
      writeFileSync('/etc/postfix/sasl_passwd', `${relayhost} ${sasl_user}:${sasl_pass}\n`);
      await execAsync('postmap /etc/postfix/sasl_passwd 2>/dev/null').catch(() => {});
    } else {
      setParam('smtp_sasl_auth_enable', 'no');
    }

    writeFileSync(MAIN_CF, conf);
    await execAsync('systemctl reload postfix 2>/dev/null || true');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

