import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const router = Router();
const execAsync = promisify(exec);

/* ── OPcache ─────────────────────────────────────────────── */

router.get('/opcache', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync(`php -r "if(function_exists('opcache_get_status')){$s=opcache_get_status(false);echo json_encode(['enabled'=>true,'used'=>$s['memory_usage']['used_memory'],'free'=>$s['memory_usage']['free_memory'],'wasted'=>$s['memory_usage']['wasted_memory'],'hit_rate'=>$s['opcache_statistics']['opcache_hit_rate'],'cached_files'=>$s['opcache_statistics']['num_cached_files']]);}else{echo json_encode(['enabled'=>false]);}" 2>/dev/null`);
    res.json(JSON.parse(stdout || '{"enabled":false}'));
  } catch { res.json({ enabled: false }); }
});

router.post('/opcache/flush', async (_req: Request, res: Response) => {
  try {
    // php returns non-zero if the OPcache extension isn't loaded, which
    // surfaced as a 500 "Command failed: php -r 'opcache_reset()'" before.
    // Check the extension first so we can return a clearer 503.
    const { stdout: check } = await execAsync(`php -r "echo function_exists('opcache_reset') ? 'yes' : 'no';" 2>/dev/null`).catch(() => ({ stdout: 'no' }));
    if (check.trim() !== 'yes') {
      return res.status(503).json({ error: 'OPcache is not enabled on this server. Install php-opcache and restart php-fpm to use this feature.' });
    }
    await execAsync(`php -r "opcache_reset();"`);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Redis ───────────────────────────────────────────────── */

router.get('/redis', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('redis-cli info 2>/dev/null');
    if (!stdout.trim()) return res.json({ enabled: false });
    const parse = (key: string) => { const m = stdout.match(new RegExp(key + ':(.+)')); return m ? m[1].trim() : ''; };
    res.json({
      enabled: true,
      version:    parse('redis_version'),
      uptime:     parse('uptime_in_seconds'),
      connected:  parse('connected_clients'),
      memory:     parse('used_memory_human'),
      keys:       parse('db0')?.match(/keys=(\d+)/)?.[1] || '0',
      hits:       parse('keyspace_hits'),
      misses:     parse('keyspace_misses'),
    });
  } catch { res.json({ enabled: false }); }
});

router.post('/redis/flush', async (_req: Request, res: Response) => {
  try {
    await execAsync('redis-cli FLUSHALL 2>/dev/null');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/redis/toggle', async (req: Request, res: Response) => {
  const { enabled } = req.body;
  try {
    await execAsync(enabled ? 'systemctl start redis' : 'systemctl stop redis');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Memcached ───────────────────────────────────────────── */

router.get('/memcached', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('echo "stats" | nc -q 1 127.0.0.1 11211 2>/dev/null');
    if (!stdout.trim()) return res.json({ enabled: false });
    const parse = (key: string) => { const m = stdout.match(new RegExp(`STAT ${key} (.+)`)); return m ? m[1].trim() : ''; };
    res.json({
      enabled:     true,
      uptime:      parse('uptime'),
      bytes:       parse('bytes'),
      limit_maxbytes: parse('limit_maxbytes'),
      curr_items:  parse('curr_items'),
      total_items: parse('total_items'),
      get_hits:    parse('get_hits'),
      get_misses:  parse('get_misses'),
    });
  } catch { res.json({ enabled: false }); }
});

router.post('/memcached/flush', async (_req: Request, res: Response) => {
  try {
    await execAsync('echo "flush_all" | nc -q 1 127.0.0.1 11211 2>/dev/null');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
