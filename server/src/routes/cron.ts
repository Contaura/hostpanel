import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import nodemailer from 'nodemailer';
import db from '../db';
import { AuthRequest, requireRole } from '../middleware/auth';

// Cron routes are direct shell-exec primitives — POST /add and POST /run let
// the caller run arbitrary commands as the panel uid (typically root). Keep
// them off reseller/readonly tokens.
const adminOnly = requireRole('superadmin', 'admin');

function sendCronFailureEmail(command: string, exitCode: number, output: string) {
  const email = (db.prepare("SELECT value FROM settings WHERE key='cron_failure_email'").get() as any)?.value;
  if (!email || !email.includes('@')) return;
  const host = (db.prepare("SELECT value FROM settings WHERE key='smtp_host'").get() as any)?.value;
  if (!host) return;
  const port = Number((db.prepare("SELECT value FROM settings WHERE key='smtp_port'").get() as any)?.value) || 587;
  const user = (db.prepare("SELECT value FROM settings WHERE key='smtp_user'").get() as any)?.value || '';
  const pass = (db.prepare("SELECT value FROM settings WHERE key='smtp_pass'").get() as any)?.value || '';
  const from = (db.prepare("SELECT value FROM settings WHERE key='smtp_from'").get() as any)?.value || user;
  const transporter = nodemailer.createTransport({ host, port, auth: user ? { user, pass } : undefined });
  transporter.sendMail({
    from: `"HostPanel" <${from}>`,
    to: email,
    subject: `Cron job failed (exit ${exitCode})`,
    text: `Command: ${command}\nExit code: ${exitCode}\n\nOutput:\n${output}`,
  }).catch(() => {});
}

db.prepare(`CREATE TABLE IF NOT EXISTS cron_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  exit_code INTEGER,
  output TEXT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now'))
)`).run();

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

// Accept * / N (step value of wildcard, e.g. */30), single number, range
// N-M, range with step N-M/S, comma-separated lists of any of the above.
// The previous regex didn't allow `*/N`, so the panel rejected `*/30` for
// "every 30 minutes" — a perfectly valid cron expression.
const FIELD_RE = /^(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*)$/;

router.get('/list', async (_req: AuthRequest, res: Response) => {
  try {
    const raw = await readCrontab();
    res.json(parseCrontab(raw));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/add', adminOnly, async (req: AuthRequest, res: Response) => {
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

router.delete('/:id', adminOnly, async (req: AuthRequest, res: Response) => {
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

// Run a cron job on-demand and log output
router.post('/run', adminOnly, async (req: AuthRequest, res: Response) => {
  const { command } = req.body;
  if (!command?.trim()) return res.status(400).json({ error: 'command required' });
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 60000 });
    const output = (stdout + stderr).trim();
    db.prepare('INSERT INTO cron_logs (command, exit_code, output) VALUES (?, ?, ?)').run(command, 0, output);
    res.json({ output, exit_code: 0 });
  } catch (err: any) {
    const output = (err.stdout + err.stderr || err.message).trim();
    const exitCode = err.code || 1;
    db.prepare('INSERT INTO cron_logs (command, exit_code, output) VALUES (?, ?, ?)').run(command, exitCode, output);
    sendCronFailureEmail(command, exitCode, output);
    res.json({ output, exit_code: exitCode });
  }
});

router.get('/logs', (_req: AuthRequest, res: Response) => {
  res.json(db.prepare('SELECT * FROM cron_logs ORDER BY ran_at DESC LIMIT 200').all());
});

router.delete('/logs', adminOnly, (_req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM cron_logs').run();
  res.json({ success: true });
});

/* ── Cron failure email setting ──────────────────────────── */

router.get('/failure-email', (_req: AuthRequest, res: Response) => {
  const val = (db.prepare("SELECT value FROM settings WHERE key='cron_failure_email'").get() as any)?.value || '';
  res.json({ email: val });
});

router.post('/failure-email', adminOnly, (req: AuthRequest, res: Response) => {
  const { email } = req.body;
  db.prepare("INSERT INTO settings (key, value) VALUES ('cron_failure_email', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(email || '');
  res.json({ success: true });
});

/* ── Per-account cron management ─────────────────────────── */

const USER_RE = /^[a-z][a-z0-9_]{0,30}$/;
const CRON_RE = /^(@(reboot|hourly|daily|weekly|monthly)|(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+))$/;

async function getUserCrontab(user: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`crontab -u "${user}" -l 2>/dev/null`);
    return stdout.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  } catch { return []; }
}

router.get('/account/:user', async (req: AuthRequest, res: Response) => {
  const { user } = req.params;
  if (!USER_RE.test(user)) return res.status(400).json({ error: 'Invalid username' });
  const lines = await getUserCrontab(user);
  const jobs = lines.map((line, i) => {
    const parts = line.split(/\s+/);
    const isAt = line.startsWith('@');
    const schedule = isAt ? parts[0] : parts.slice(0, 5).join(' ');
    const command = isAt ? parts.slice(1).join(' ') : parts.slice(5).join(' ');
    return { id: i, schedule, command, raw: line };
  });
  res.json(jobs);
});

router.post('/account/:user', adminOnly, async (req: AuthRequest, res: Response) => {
  const { user } = req.params;
  if (!USER_RE.test(user)) return res.status(400).json({ error: 'Invalid username' });
  const { schedule, command } = req.body;
  if (!schedule || !command) return res.status(400).json({ error: 'schedule and command required' });
  if (!CRON_RE.test(schedule.trim())) return res.status(400).json({ error: 'Invalid cron schedule' });
  try {
    const lines = await getUserCrontab(user);
    const newLine = `${schedule.trim()} ${command.trim()}`;
    lines.push(newLine);
    const tmp = join(tmpdir(), `crontab_${user}_${randomBytes(4).toString('hex')}`);
    writeFileSync(tmp, lines.join('\n') + '\n');
    await execAsync(`crontab -u "${user}" ${tmp}`);
    unlinkSync(tmp);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/account/:user/:index', adminOnly, async (req: AuthRequest, res: Response) => {
  const { user } = req.params;
  const idx = parseInt(req.params.index);
  if (!USER_RE.test(user)) return res.status(400).json({ error: 'Invalid username' });
  try {
    const lines = await getUserCrontab(user);
    if (idx < 0 || idx >= lines.length) return res.status(404).json({ error: 'Job not found' });
    lines.splice(idx, 1);
    const tmp = join(tmpdir(), `crontab_${user}_${randomBytes(4).toString('hex')}`);
    writeFileSync(tmp, lines.join('\n') + '\n');
    await execAsync(`crontab -u "${user}" ${tmp}`);
    unlinkSync(tmp);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

