import { Router, Request, Response } from 'express';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { runFile } from '../utils/process-runner';

const router = Router();

/* ── List queue ──────────────────────────────────────────── */

router.get('/', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await runFile('mailq', []).catch(() => runFile('postqueue', ['-p']).catch(() => ({ stdout: '', stderr: '' })));
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
    const { stdout: queue } = await runFile('postqueue', ['-p']).catch(() => ({ stdout: '', stderr: '' }));
    const active = queue.split('\n').filter(l => /^[A-F0-9]/.test(l)).length;
    const countFiles = (dir: string): number => { try { return readdirSync(dir, { recursive: true }).length; } catch { return 0; } };
    res.json({ active, deferred: countFiles('/var/spool/postfix/deferred'), held: countFiles('/var/spool/postfix/hold') });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Flush / retry all ───────────────────────────────────── */

router.post('/flush', async (_req: Request, res: Response) => {
  try {
    await runFile('postqueue', ['-f']);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Delete message ──────────────────────────────────────── */

router.delete('/:id', async (req: Request, res: Response) => {
  if (!/^[A-F0-9]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid message ID' });
  try {
    await runFile('postsuper', ['-d', req.params.id]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Delete all deferred ─────────────────────────────────── */

router.delete('/', async (_req: Request, res: Response) => {
  try {
    await runFile('postsuper', ['-d', 'ALL', 'deferred']);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Retry (requeue) single message ─────────────────────── */

router.post('/retry/:id', async (req: Request, res: Response) => {
  if (!/^[A-F0-9]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid message ID' });
  try {
    await runFile('postsuper', ['-r', req.params.id]);
    await runFile('postqueue', ['-f']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Hold / unhold message ───────────────────────────────── */

router.post('/hold/:id', async (req: Request, res: Response) => {
  if (!/^[A-F0-9]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid message ID' });
  try {
    await runFile('postsuper', ['-h', req.params.id]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/unhold/:id', async (req: Request, res: Response) => {
  if (!/^[A-F0-9]+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid message ID' });
  try {
    await runFile('postsuper', ['-H', req.params.id]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Bounce/NDR log ──────────────────────────────────────── */

router.get('/bounce-log', async (req: Request, res: Response) => {
  const limit = parseInt((req.query.limit as string) || '200');
  const LOG_PATHS = ['/var/log/maillog', '/var/log/mail.log'];
  const logPath = LOG_PATHS.find(p => existsSync(p));
  if (!logPath) return res.json([]);
  try {
    const stdout = readFileSync(logPath, 'utf8').split('\n').filter(l => /bounce|status=bounced|undeliverable|status=defer|status=5\./i.test(l)).slice(-Math.min(limit, 1000)).join('\n');
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
  let logPath = LOG_PATHS.find(p => existsSync(p));
  if (!logPath) return res.json({ lines: [], source: 'none' });

  try {
    const stdout = readFileSync(logPath, 'utf8').split('\n').slice(-Math.min(limit, 5000)).join('\n');
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
