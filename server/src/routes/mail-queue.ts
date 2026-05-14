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

    for (const line of lines) {
      const header = line.match(/^([A-F0-9]+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+)\s+(.+)/);
      if (header) {
        if (current) messages.push(current);
        current = { id: header[1], size: header[2], date: header[3], sender: header[4], recipients: [], reason: '' };
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

/* ── Email delivery log (Postfix mail.log) ───────────────────*/

router.get('/delivery-log', async (req: Request, res: Response) => {
  const limit = parseInt((req.query.limit as string) || '500');
  const search = (req.query.search as string) || '';
  const LOG_PATHS = ['/var/log/maillog', '/var/log/mail.log', '/var/log/mail/mail.log'];
  let logPath = LOG_PATHS.find(p => require('fs').existsSync(p));
  if (!logPath) return res.json({ lines: [], source: 'none' });

  try {
    const grepFlag = search ? `| grep -i "${search.replace(/"/g, '')}"` : '';
    const { stdout } = await execAsync(`tail -${limit} "${logPath}" ${grepFlag} 2>/dev/null || true`);
    const lines = stdout.trim().split('\n').filter(Boolean).reverse().map((line, i) => {
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
