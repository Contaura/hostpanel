import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import db from '../db';

const router = Router();

const ALL_EVENTS = [
  'invoice.created', 'invoice.paid', 'invoice.overdue',
  'account.created', 'account.suspended', 'account.terminated',
  'system.disk_alert', 'system.cpu_alert', 'system.service_down',
  'deploy.success', 'deploy.failed',
  'login.success', 'login.failed',
];

/* ── CRUD for webhooks ───────────────────────────────────── */

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT id, name, url, type, events, enabled, created_at FROM notification_webhooks ORDER BY created_at DESC').all() as any[];
  res.json(rows.map(r => ({ ...r, events: JSON.parse(r.events || '[]') })));
});

router.post('/', (req: Request, res: Response) => {
  const { name, url, type, events, secret } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  if (!['webhook', 'slack', 'discord', 'email'].includes(type)) return res.status(400).json({ error: 'type must be webhook, slack, discord, or email' });
  try {
    const r = db.prepare('INSERT INTO notification_webhooks (name, url, type, events, secret) VALUES (?, ?, ?, ?, ?)').run(name, url, type || 'webhook', JSON.stringify(events || ALL_EVENTS), secret || '');
    res.json(db.prepare('SELECT * FROM notification_webhooks WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req: Request, res: Response) => {
  const { name, url, type, events, secret, enabled } = req.body;
  db.prepare('UPDATE notification_webhooks SET name=?, url=?, type=?, events=?, secret=?, enabled=? WHERE id=?')
    .run(name, url, type, JSON.stringify(events || []), secret || '', enabled ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM notification_webhooks WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM notification_webhooks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── Test notification ───────────────────────────────────── */

router.post('/:id/test', async (req: Request, res: Response) => {
  const webhook = db.prepare('SELECT * FROM notification_webhooks WHERE id = ?').get(req.params.id) as any;
  if (!webhook) return res.status(404).json({ error: 'Not found' });
  try {
    await sendNotification(webhook, 'test.ping', { message: 'Test notification from HostPanel', timestamp: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Available events list ───────────────────────────────── */

router.get('/events', (_req: Request, res: Response) => {
  res.json(ALL_EVENTS);
});

/* ── Internal dispatcher (called from other routes) ─────── */

export async function dispatchNotification(event: string, data: any) {
  const hooks = db.prepare("SELECT * FROM notification_webhooks WHERE enabled=1").all() as any[];
  for (const hook of hooks) {
    const events: string[] = JSON.parse(hook.events || '[]');
    if (!events.includes(event) && !events.includes('*')) continue;
    try { await sendNotification(hook, event, data); } catch (_) {}
  }
}

async function sendNotification(hook: any, event: string, data: any) {
  const payload = { event, data, timestamp: new Date().toISOString(), source: 'HostPanel' };

  if (hook.type === 'email') {
    const smtpHost = (db.prepare("SELECT value FROM settings WHERE key='smtp_host'").get() as any)?.value;
    if (!smtpHost) return;
    const transporter = nodemailer.createTransport({ host: smtpHost, port: 587, secure: false });
    await transporter.sendMail({ from: 'HostPanel <noreply@hostpanel>', to: hook.url, subject: `[HostPanel] ${event}`, text: JSON.stringify(payload, null, 2) });
    return;
  }

  if (hook.type === 'slack' || hook.type === 'discord') {
    await fetch(hook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `*[${event}]* ${JSON.stringify(data)}`, username: 'HostPanel' }),
    });
    return;
  }

  // Generic webhook
  await fetch(hook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(hook.secret ? { 'X-HostPanel-Secret': hook.secret } : {}) },
    body: JSON.stringify(payload),
  });
}

export default router;
