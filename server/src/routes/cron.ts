import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

interface CronJob {
  id: number;
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
  command: string;
}

async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await execAsync('crontab -l 2>/dev/null || true');
    return stdout;
  } catch {
    return '';
  }
}

async function writeCrontab(content: string): Promise<void> {
  const tmp = join(tmpdir(), `crontab_${randomBytes(8).toString('hex')}`);
  try {
    writeFileSync(tmp, content);
    await execAsync(`crontab ${tmp}`);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function parseCrontab(raw: string): CronJob[] {
  const lines = raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  return lines.map((line, id) => {
    const m = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/);
    if (!m) return { id, minute: '*', hour: '*', day: '*', month: '*', weekday: '*', command: line };
    return { id, minute: m[1], hour: m[2], day: m[3], month: m[4], weekday: m[5], command: m[6] };
  });
}

const FIELD_RE = /^(\*|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*)$/;

router.get('/list', async (_req: AuthRequest, res: Response) => {
  try {
    const raw = await readCrontab();
    res.json(parseCrontab(raw));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/add', async (req: AuthRequest, res: Response) => {
  const { minute = '*', hour = '*', day = '*', month = '*', weekday = '*', command } = req.body;
  if (!command?.trim()) return res.status(400).json({ error: 'Command is required' });
  for (const [name, val] of [['minute', minute], ['hour', hour], ['day', day], ['month', month], ['weekday', weekday]]) {
    if (!FIELD_RE.test(val)) return res.status(400).json({ error: `Invalid ${name} field: ${val}` });
  }
  try {
    const existing = await readCrontab();
    const newLine = `${minute} ${hour} ${day} ${month} ${weekday} ${command}\n`;
    await writeCrontab(existing.trimEnd() + '\n' + newLine);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id);
  try {
    const raw = await readCrontab();
    const allLines = raw.split('\n');
    const jobLines = allLines.filter(l => l.trim() && !l.trim().startsWith('#'));
    if (id < 0 || id >= jobLines.length) return res.status(404).json({ error: 'Job not found' });
    jobLines.splice(id, 1);
    const comments = allLines.filter(l => l.trim().startsWith('#'));
    await writeCrontab([...comments, ...jobLines].join('\n') + '\n');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
