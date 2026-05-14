import { Router, Request, Response } from 'express';
import db from '../db';

const router = Router();

function cfFetch(path: string, token: string, method = 'GET', body?: any) {
  return fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json()) as Promise<any>;
}

/* ── Zones ───────────────────────────────────────────────── */

router.get('/', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT id, zone_id, zone_name, enabled, created_at FROM cloudflare_zones').all());
});

router.post('/', async (req: Request, res: Response) => {
  const { api_token } = req.body;
  if (!api_token) return res.status(400).json({ error: 'api_token required' });
  try {
    const data = await cfFetch('/zones?per_page=50', api_token);
    if (!data.success) return res.status(400).json({ error: 'Invalid token or no zones found', details: data.errors });
    const insert = db.prepare('INSERT OR REPLACE INTO cloudflare_zones (zone_id, zone_name, api_token, enabled) VALUES (?, ?, ?, 1)');
    const tx = db.transaction(() => { for (const z of data.result) insert.run(z.id, z.name, api_token); });
    tx();
    res.json({ success: true, zones: data.result.map((z: any) => ({ id: z.id, name: z.name })) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM cloudflare_zones WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── Zone details + analytics ────────────────────────────── */

router.get('/:id/analytics', async (req: Request, res: Response) => {
  const zone = db.prepare('SELECT * FROM cloudflare_zones WHERE id = ?').get(req.params.id) as any;
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  try {
    const data = await cfFetch(`/zones/${zone.zone_id}/analytics/dashboard?since=-10080&until=0`, zone.api_token);
    res.json(data.result || {});
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── DNS records ─────────────────────────────────────────── */

router.get('/:id/dns', async (req: Request, res: Response) => {
  const zone = db.prepare('SELECT * FROM cloudflare_zones WHERE id = ?').get(req.params.id) as any;
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  try {
    const data = await cfFetch(`/zones/${zone.zone_id}/dns_records?per_page=100`, zone.api_token);
    res.json(data.result || []);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Toggle proxy (orange cloud) ─────────────────────────── */

router.patch('/:id/dns/:recordId/proxy', async (req: Request, res: Response) => {
  const zone = db.prepare('SELECT * FROM cloudflare_zones WHERE id = ?').get(req.params.id) as any;
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  const { proxied } = req.body;
  try {
    const record = await cfFetch(`/zones/${zone.zone_id}/dns_records/${req.params.recordId}`, zone.api_token);
    const updated = await cfFetch(`/zones/${zone.zone_id}/dns_records/${req.params.recordId}`, zone.api_token, 'PUT', { ...record.result, proxied });
    res.json(updated.result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Purge cache ─────────────────────────────────────────── */

router.post('/:id/purge', async (req: Request, res: Response) => {
  const zone = db.prepare('SELECT * FROM cloudflare_zones WHERE id = ?').get(req.params.id) as any;
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  try {
    const data = await cfFetch(`/zones/${zone.zone_id}/purge_cache`, zone.api_token, 'POST', { purge_everything: true });
    res.json({ success: data.success });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Toggle zone (pause/unpause) ─────────────────────────── */

router.patch('/:id/pause', async (req: Request, res: Response) => {
  const zone = db.prepare('SELECT * FROM cloudflare_zones WHERE id = ?').get(req.params.id) as any;
  if (!zone) return res.status(404).json({ error: 'Zone not found' });
  const { paused } = req.body;
  try {
    await cfFetch(`/zones/${zone.zone_id}`, zone.api_token, 'PATCH', { paused });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
