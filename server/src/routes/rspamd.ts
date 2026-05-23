import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const router = Router();
const execAsync = promisify(exec);

// Rspamd's controller worker exposes the management HTTP API on 11334 by
// default, bound to loopback only. We proxy a small whitelist through the
// panel so the admin UI can read stats/history without exposing the worker
// to anything outside this box.
const RSPAMD_CONTROLLER = process.env.RSPAMD_CONTROLLER || 'http://127.0.0.1:11334';
const RSPAMD_PASSWORD   = process.env.RSPAMD_PASSWORD   || '';

async function controller(path: string): Promise<any> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (RSPAMD_PASSWORD) headers['Password'] = RSPAMD_PASSWORD;
  const r = await fetch(`${RSPAMD_CONTROLLER}${path}`, { headers });
  if (!r.ok) throw new Error(`rspamd controller ${r.status}: ${await r.text()}`);
  return r.json();
}

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const { stdout: active } = await execAsync('systemctl is-active rspamd 2>/dev/null || echo inactive');
    const running = active.trim() === 'active';
    let stat: any = null;
    if (running) {
      try { stat = await controller('/stat'); } catch { /* controller may be starting up */ }
    }
    res.json({
      installed: true,
      running,
      version:    stat?.version    ?? null,
      uptime:     stat?.uptime     ?? null,
      scanned:    stat?.scanned    ?? null,
      learned:    stat?.learned    ?? null,
      actions:    stat?.actions    ?? null,
      connections:stat?.connections?? null,
    });
  } catch (err: any) {
    res.json({ installed: false, running: false, error: err.message });
  }
});

router.get('/history', async (_req: Request, res: Response) => {
  try {
    const data = await controller('/history');
    // Rspamd returns { version: N, rows: [...] } or just an array depending
    // on version. Normalise.
    const rows = Array.isArray(data) ? data : (data?.rows ?? []);
    res.json({ rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/symbols', async (_req: Request, res: Response) => {
  try { res.json(await controller('/symbols')); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/errors', async (_req: Request, res: Response) => {
  try { res.json(await controller('/errors')); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/actions', async (_req: Request, res: Response) => {
  // Current action thresholds (reject/add_header/greylist/no_action).
  // Pulls them out of /stat which is the canonical source.
  try {
    const stat: any = await controller('/stat');
    res.json({ actions: stat?.actions || {}, thresholds: stat?.metric_thresholds || stat?.thresholds || {} });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
