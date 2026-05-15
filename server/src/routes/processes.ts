import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(String(req.query.page  || '1'), 10));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const { stdout } = await execAsync('ps aux --no-headers --sort=-%cpu');
    const all = stdout
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const p = line.trim().split(/\s+/);
        return {
          user:    p[0],
          pid:     p[1],
          cpu:     p[2],
          mem:     p[3],
          vsz:     p[4],
          rss:     p[5],
          stat:    p[7],
          start:   p[8],
          time:    p[9],
          command: p.slice(10).join(' '),
        };
      });
    const total = all.length;
    const data  = all.slice((page - 1) * limit, page * limit);
    res.json({ data, total, page, limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:pid', async (req: AuthRequest, res: Response) => {
  const pid = parseInt(req.params.pid, 10);
  // Reject low PIDs — init (1), kthreadd (2), and most kernel threads /
  // critical system daemons live well below 100. Killing them from the panel
  // is almost always a mistake; let an operator drop to the terminal for
  // those rare cases.
  if (!Number.isFinite(pid) || pid < 100) return res.status(400).json({ error: 'Invalid PID (must be ≥ 100)' });
  if (pid === process.pid) return res.status(400).json({ error: 'Refusing to kill the HostPanel server process' });
  try {
    await execAsync(`kill -15 ${pid} 2>/dev/null || kill -9 ${pid}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
