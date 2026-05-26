import { Router, Request, Response } from 'express';
import net from 'net';
import { runFile } from '../utils/process-runner';

const router = Router();

async function runPhp(code: string) {
  return runFile('php', ['-r', code], { timeout: 15000, maxBuffer: 1024 * 1024 });
}

function memcachedCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 11211 });
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy(new Error('memcached command timed out'));
    }, 5000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${command}\r\n`));
    socket.on('data', chunk => {
      data += chunk;
      if (data.includes('\r\nEND\r\n') || data.includes('\r\nOK\r\n') || data.includes('\r\nERROR\r\n')) socket.end();
    });
    socket.on('error', err => { clearTimeout(timer); reject(err); });
    socket.on('end', () => { clearTimeout(timer); resolve(data); });
    socket.on('close', hadError => {
      clearTimeout(timer);
      if (!hadError) resolve(data);
    });
  });
}

/* ── OPcache ─────────────────────────────────────────────── */

router.get('/opcache', async (_req: Request, res: Response) => {
  try {
    const code = `if(function_exists('opcache_get_status')){$s=opcache_get_status(false);echo json_encode(['enabled'=>true,'used'=>$s['memory_usage']['used_memory'],'free'=>$s['memory_usage']['free_memory'],'wasted'=>$s['memory_usage']['wasted_memory'],'hit_rate'=>$s['opcache_statistics']['opcache_hit_rate'],'cached_files'=>$s['opcache_statistics']['num_cached_files']]);}else{echo json_encode(['enabled'=>false]);}`;
    const { stdout } = await runPhp(code);
    res.json(JSON.parse(stdout || '{"enabled":false}'));
  } catch { res.json({ enabled: false }); }
});

router.post('/opcache/flush', async (_req: Request, res: Response) => {
  try {
    const { stdout: check } = await runPhp("echo function_exists('opcache_reset') ? 'yes' : 'no';").catch(() => ({ stdout: 'no', stderr: '' }));
    if (check.trim() !== 'yes') {
      return res.status(503).json({ error: 'OPcache is not enabled on this server. Install php-opcache and restart php-fpm to use this feature.' });
    }
    await runPhp('opcache_reset();');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Redis ───────────────────────────────────────────────── */

router.get('/redis', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await runFile('redis-cli', ['info'], { timeout: 10000, maxBuffer: 1024 * 1024 });
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
    await runFile('redis-cli', ['FLUSHALL'], { timeout: 30000 });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/redis/toggle', async (req: Request, res: Response) => {
  const { enabled } = req.body;
  try {
    await runFile('systemctl', [enabled ? 'start' : 'stop', 'redis'], { timeout: 30000 });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Memcached ───────────────────────────────────────────── */

router.get('/memcached', async (_req: Request, res: Response) => {
  try {
    const stdout = await memcachedCommand('stats');
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
    await memcachedCommand('flush_all');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
