import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const router = Router();
const execAsync = promisify(exec);

/* ── List queue ──────────────────────────────────────────── */

router.get('/', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('mailq 2>/dev/null || postqueue -p 2>/dev/null || echo ""');
    const lines = stdout.split('\n');
    const messages: any[] = [];
    let current: any = null;

    // mailq decorates the queue ID with a one-char flag: '*' = active,
    // '!' = held, '#' = unsent, otherwise deferred. Capture both pieces.
    for (const line of lines) {
      const header = line.match(/^([A-F0-9]+)([\*!#]?)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+)\s+(.+)/);
      if (header) {
        if (current) messages.push(current);
        const flag = header[2];
        const status = flag === '*' ? 'active' : flag === '!' ? 'held' : 'deferred';
        current = { id: header[1], status, size: header[3], date: header[4], sender: header[5], recipients: [], reason: '' };
      } else if (current && line.trim().startsWith('(')) {
        current.reason = line.trim().replace(/[()]/g, '');
      } else if (current && line.trim() && !line.startsWith('-')) {
        current.recipients.push(line.trim());
      }
    }
    if (current) messages.push(current);

    res.json({ count: messages.length, messages });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Queue stats ─────────────────────────────────────────── */

router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const { stdout: active } = await execAsync('postqueue -p 2>/dev/null | grep -c "^[A-F0-9]" || echo 0').catch(() => ({ stdout: '0' }));
    const { stdout: deferred } = await execAsync('find /var/spool/postfix/deferred -type f 2>/dev/null | wc -l').catch(() => ({ stdout: '0' }));
    const { stdout: held } = await execAsync('find /var/spool/postfix/hold -type f 2>/dev/null | wc -l').catch(() => ({ stdout: '0' }));
    res.json({ active: parseInt(active.trim()), deferred: parseInt(deferred.trim()), held: parseInt(held.trim()) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Flush / retry all ───────────────────────────────────── */

router.post('/flush', async (_req: Request, res: Response) => {
  try {
    await execAsync('postqueue -f');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Delete message ──────────────────────────────────────── */

router.delete('/:id', async (req: Request, res: Response) => {
  if (!/^[A-F0-9]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid message ID' });
  try {
    await execAsync(`postsuper -d ${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Delete all deferred ─────────────────────────────────── */

router.delete('/', async (_req: Request, res: Response) => {
  try {
    await execAsync('postsuper -d ALL deferred');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Retry (requeue) single message ─────────────────────── */

router.post('/retry/:id', async (req: Request, res: Response) => {
  if (!/^[A-F0-9]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid message ID' });
  try {
    await execAsync(`postsuper -r ${req.params.id}`);
    await execAsync('postqueue -f').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Hold / unhold message ───────────────────────────────── */

router.post('/hold/:id', async (req: Request, res: Response) => {
  if (!/^[A-F0-9]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid message ID' });
  try {
    await execAsync(`postsuper -h ${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/unhold/:id', async (req: Request, res: Response) => {
  if (!/^[A-F0-9]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid message ID' });
  try {
    await execAsync(`postsuper -H ${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Bounce/NDR log ──────────────────────────────────────── */

router.get('/bounce-log', async (req: Request, res: Response) => {
  const limit = parseInt((req.query.limit as string) || '200');
  const LOG_PATHS = ['/var/log/maillog', '/var/log/mail.log'];
  const logPath = LOG_PATHS.find(p => require('fs').existsSync(p));
  if (!logPath) return res.json([]);
  try {
    const { stdout } = await execAsync(`grep -iE 'bounce|status=bounced|undeliverable|status=defer|status=5\\.' "${logPath}" 2>/dev/null | tail -${Math.min(limit, 1000)}`);
    const lines = stdout.trim().split('\n').filter(Boolean).reverse().map((line, i) => {
      const m = line.match(/^(\w+ +\d+ \d+:\d+:\d+).*postfix\S*: (\S+): (.+)/);
      return { id: i, raw: line, time: m?.[1] || '', queue_id: m?.[2] || '', message: m?.[3] || line };
    });
    res.json(lines);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Email delivery log (Postfix mail.log) ───────────────────*/

router.get('/delivery-log', async (req: Request, res: Response) => {
  const limit = parseInt((req.query.limit as string) || '500');
  const search = (req.query.search as string) || '';
  const LOG_PATHS = ['/var/log/maillog', '/var/log/mail.log', '/var/log/mail/mail.log'];
  let logPath = LOG_PATHS.find(p => require('fs').existsSync(p));
  if (!logPath) return res.json({ lines: [], source: 'none' });

  try {
    const { stdout } = await execAsync(`tail -${limit} "${logPath}" 2>/dev/null || true`);
    const filtered = search
      ? stdout.split('\n').filter(l => l.toLowerCase().includes(search.toLowerCase())).join('\n')
      : stdout;
    const lines = filtered.trim().split('\n').filter(Boolean).reverse().map((line, i) => {
      const m = line.match(/^(\w+ +\d+ \d+:\d+:\d+).*postfix\S*: (\S+): (.+)/);
      return {
        id: i,
        raw: line,
        time: m?.[1] || '',
        queue_id: m?.[2] || '',
        message: m?.[3] || line,
      };
    });
    res.json({ lines, source: logPath });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
