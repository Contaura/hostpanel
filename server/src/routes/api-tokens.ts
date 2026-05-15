import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import db from '../db';
import { requireRole } from '../middleware/auth';
import { assertHttpTargetAllowed } from '../utils/safe-target';

const router = Router();

// Minting API tokens and creating webhooks both grant powers that bypass the
// JWT auth model (a token can carry 'admin' permissions; a webhook URL becomes
// an internal-fetch primitive). Keep both administrator-only.
const adminOnly = requireRole('superadmin', 'admin');

function scrubWebhook(row: any) {
  if (!row) return row;
  const { secret: _omitted, events, ...rest } = row;
  return { ...rest, events: typeof events === 'string' ? JSON.parse(events || '[]') : events, has_secret: !!_omitted };
}

/* ── List tokens (never shows full token) ────────────────── */

router.get('/', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT id, name, token_prefix, permissions, last_used, expires_at, created_at FROM api_tokens ORDER BY created_at DESC').all());
});

/* ── Create token ────────────────────────────────────────── */

router.post('/', adminOnly, (req: Request, res: Response) => {
  const { name, permissions, expires_at } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!['read', 'write', 'admin'].includes(permissions)) return res.status(400).json({ error: 'permissions must be read, write, or admin' });

  const rawToken = 'hp_' + crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const prefix = rawToken.slice(0, 10);

  try {
    const r = db.prepare(`
      INSERT INTO api_tokens (name, token_hash, token_prefix, permissions, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, tokenHash, prefix, permissions || 'read', expires_at || null);

    // Return the full token only once
    res.json({
      id: r.lastInsertRowid,
      name,
      token: rawToken,
      token_prefix: prefix,
      permissions,
      expires_at: expires_at || null,
      message: 'Store this token securely — it will not be shown again.',
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Revoke token ────────────────────────────────────────── */

router.delete('/:id', adminOnly, (req: Request, res: Response) => {
  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── Webhooks ────────────────────────────────────────────── */

db.exec(`CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER DEFAULT 1,
  last_delivery TEXT,
  last_status INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  payload TEXT,
  status INTEGER,
  response TEXT,
  delivered_at TEXT DEFAULT (datetime('now'))
)`);

router.get('/webhooks', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT id, name, url, events, enabled, last_delivery, last_status, created_at FROM webhooks ORDER BY created_at DESC').all()
    .map((w: any) => ({ ...w, events: JSON.parse(w.events || '[]') })));
});

router.post('/webhooks', adminOnly, async (req: Request, res: Response) => {
  const { name, url, secret, events } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  try { await assertHttpTargetAllowed(url); }
  catch (e: any) { return res.status(400).json({ error: e.message }); }
  const evList = Array.isArray(events) ? events : [];
  const r = db.prepare('INSERT INTO webhooks (name, url, secret, events) VALUES (?, ?, ?, ?)').run(name, url, secret || '', JSON.stringify(evList));
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(r.lastInsertRowid) as any;
  res.json(scrubWebhook(row));
});

router.put('/webhooks/:id', adminOnly, async (req: Request, res: Response) => {
  // Partial PUT — name + url are NOT NULL.
  const current: any = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Webhook not found' });
  const pick = <T,>(k: string, fb: T) => (req.body[k] !== undefined ? req.body[k] : fb);
  const newUrl = pick('url', current.url);
  if (req.body.url) {
    try { await assertHttpTargetAllowed(newUrl); }
    catch (e: any) { return res.status(400).json({ error: e.message }); }
  }
  const newEvents = req.body.events !== undefined
    ? JSON.stringify(Array.isArray(req.body.events) ? req.body.events : [])
    : current.events;
  db.prepare('UPDATE webhooks SET name=?, url=?, secret=?, events=?, enabled=? WHERE id=?')
    .run(
      pick('name',    current.name),
      newUrl,
      pick('secret',  current.secret ?? ''),
      newEvents,
      pick('enabled', current.enabled) ? 1 : 0,
      req.params.id,
    );
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id) as any;
  res.json(scrubWebhook(row));
});

router.delete('/webhooks/:id', adminOnly, (req: Request, res: Response) => {
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').run(req.params.id);
  res.json({ success: true });
});

router.get('/webhooks/:id/deliveries', adminOnly, (req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY delivered_at DESC LIMIT 50').all(req.params.id));
});

router.post('/webhooks/:id/test', adminOnly, async (req: Request, res: Response) => {
  const webhook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id) as any;
  if (!webhook) return res.status(404).json({ error: 'Webhook not found' });
  const payload = JSON.stringify({ event: 'test', timestamp: new Date().toISOString(), data: { message: 'HostPanel webhook test' } });
  try {
    const result = await deliverWebhook(webhook, 'test', payload);
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

async function deliverWebhook(webhook: any, event: string, payload: string): Promise<{ status: number; response: string }> {
  // Re-validate on delivery so an old row created before SSRF checks landed
  // (or a hostname whose DNS now resolves to an internal address) can't be
  // used to probe internal services.
  const parsedUrl = await assertHttpTargetAllowed(webhook.url);
  return new Promise((resolve, reject) => {
    const signature = webhook.secret
      ? 'sha256=' + crypto.createHmac('sha256', webhook.secret).update(payload).digest('hex')
      : '';
    const opts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-HostPanel-Event': event,
        ...(signature ? { 'X-HostPanel-Signature': signature } : {}),
      },
      timeout: 10000,
    };
    const mod = parsedUrl.protocol === 'https:' ? https : http;
    const reqObj = mod.request(opts, (res2) => {
      let body = '';
      res2.on('data', d => { body += d; });
      res2.on('end', () => {
        const status = res2.statusCode || 0;
        // A thrown SqliteError from here used to crash the entire Node
        // process — this callback runs in its own event-loop tick, not
        // inside the Express request chain, so Express's error middleware
        // never sees it and Node's default uncaughtException handler
        // exits. Swallow DB write failures: the webhook delivery itself
        // succeeded, so still resolve the outer Promise.
        try {
          db.prepare("UPDATE webhooks SET last_delivery=datetime('now'), last_status=? WHERE id=?").run(status, webhook.id);
          db.prepare('INSERT INTO webhook_deliveries (webhook_id, event, payload, status, response) VALUES (?, ?, ?, ?, ?)').run(webhook.id, event, payload, status, body.slice(0, 2000));
        } catch (e) {
          console.error('[webhook] failed to record delivery for', webhook.id, e);
        }
        resolve({ status, response: body.slice(0, 500) });
      });
    });
    reqObj.on('error', reject);
    reqObj.on('timeout', () => { reqObj.destroy(); reject(new Error('Timeout')); });
    reqObj.write(payload);
    reqObj.end();
  });
}

export { deliverWebhook };
export default router;
