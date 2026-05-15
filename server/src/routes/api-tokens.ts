import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import dns from 'dns/promises';
import { isIP } from 'net';
import db from '../db';
import { requireRole } from '../middleware/auth';

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

// Block private/loopback/link-local/metadata-endpoint targets so webhook tests
// can't be used as an SSRF primitive against AWS/GCP IMDS or the panel's own
// internal API. Allowing webhook delivery to arbitrary public hosts is the
// intended functionality — only the private ranges are off-limits.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isIP(h) === 0) return false; // hostname — resolve and re-check in resolveAndCheck
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true; // multicast/reserved
  } else if (v === 6) {
    if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('ff')) return true;
  }
  return false;
}

async function assertWebhookTargetAllowed(rawUrl: string): Promise<URL> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https URLs are allowed');
  if (isBlockedHost(u.hostname)) throw new Error('Webhook target is in a blocked address range');
  if (isIP(u.hostname) === 0) {
    // Hostname — resolve and re-check each address. Catches DNS-rebind-style
    // payloads where the hostname looks public but resolves to 127.0.0.1.
    const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
    for (const a of addrs) {
      if (isBlockedHost(a.address)) throw new Error('Webhook target resolves to a blocked address');
    }
  }
  return u;
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
  try { await assertWebhookTargetAllowed(url); }
  catch (e: any) { return res.status(400).json({ error: e.message }); }
  const evList = Array.isArray(events) ? events : [];
  const r = db.prepare('INSERT INTO webhooks (name, url, secret, events) VALUES (?, ?, ?, ?)').run(name, url, secret || '', JSON.stringify(evList));
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(r.lastInsertRowid) as any;
  res.json(scrubWebhook(row));
});

router.put('/webhooks/:id', adminOnly, async (req: Request, res: Response) => {
  const { name, url, secret, events, enabled } = req.body;
  if (url) {
    try { await assertWebhookTargetAllowed(url); }
    catch (e: any) { return res.status(400).json({ error: e.message }); }
  }
  db.prepare('UPDATE webhooks SET name=?, url=?, secret=?, events=?, enabled=? WHERE id=?')
    .run(name, url, secret || '', JSON.stringify(Array.isArray(events) ? events : []), enabled ? 1 : 0, req.params.id);
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
  const parsedUrl = await assertWebhookTargetAllowed(webhook.url);
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
        db.prepare('UPDATE webhooks SET last_delivery=datetime("now"), last_status=? WHERE id=?').run(status, webhook.id);
        db.prepare('INSERT INTO webhook_deliveries (webhook_id, event, payload, status, response) VALUES (?, ?, ?, ?, ?)').run(webhook.id, event, payload, status, body.slice(0, 2000));
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
