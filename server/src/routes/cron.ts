import { Router, Response } from 'express';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import nodemailer from 'nodemailer';
import db from '../db';
import { AuthRequest, requireRole } from '../middleware/auth';
import { runFile } from '../utils/process-runner';

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
  const { stdout } = await runFile('crontab', ['-l']).catch(() => ({ stdout: '', stderr: '' }));
  return stdout;
}

async function writeCrontab(content: string): Promise<void> {
  const tmp = join(tmpdir(), `crontab_${randomBytes(8).toString('hex')}`);
  try {
    writeFileSync(tmp, content);
    await runFile('crontab', [tmp]);
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

// Run a cron job on-demand and log output.
// SECURITY: This endpoint INTENTIONALLY executes an arbitrary command line
// through `sh -c` because admins use it to test cron jobs that legitimately
// contain shell syntax (pipes, redirection, &&). It is gated behind adminOnly
// (superadmin/admin) — the same trust level that can edit /etc/crontab. Do
// NOT generalize this pattern to other routes, and do NOT re-introduce
// shell-string execution anywhere else in this file.
function runShellCommand(command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { shell: false, timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', d => { stdout += d.toString(); });
    child.stderr?.on('data', d => { stderr += d.toString(); });
    child.on('close', code => resolve({ stdout, stderr, code: code ?? 1 }));
    child.on('error', err => resolve({ stdout, stderr: stderr + String(err), code: 1 }));
  });
}

router.post('/run', adminOnly, async (req: AuthRequest, res: Response) => {
  const { command } = req.body;
  if (!command?.trim()) return res.status(400).json({ error: 'command required' });
  const { stdout, stderr, code } = await runShellCommand(command, 60000);
  const output = (stdout + stderr).trim();
  db.prepare('INSERT INTO cron_logs (command, exit_code, output) VALUES (?, ?, ?)').run(command, code, output);
  if (code !== 0) sendCronFailureEmail(command, code, output);
  res.json({ output, exit_code: code });
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
  const { stdout } = await runFile('crontab', ['-u', user, '-l']).catch(() => ({ stdout: '', stderr: '' }));
  return stdout.split('\n').filter(l => l.trim() && !l.startsWith('#'));
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
  // crontab -u <user> requires <user> to be a real OS account. HostPanel's
  // "accounts" are DB rows backed by Apache vhosts, not necessarily Linux
  // users, so check `id <user>` first and surface a clear 404 instead of the
  // raw 500 "user 'foo' unknown" that crontab spits out.
  try {
    await runFile('id', [user]);
  } catch {
    return res.status(404).json({ error: `No OS user named '${user}'. Create the user (useradd ${user}) before adding a per-account cron job.` });
  }
  try {
    const lines = await getUserCrontab(user);
    const newLine = `${schedule.trim()} ${command.trim()}`;
    lines.push(newLine);
    const tmp = join(tmpdir(), `crontab_${user}_${randomBytes(4).toString('hex')}`);
    writeFileSync(tmp, lines.join('\n') + '\n');
    try {
      await runFile('crontab', ['-u', user, tmp]);
    } finally {
      try { unlinkSync(tmp); } catch {}
    }
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
    try {
      await runFile('crontab', ['-u', user, tmp]);
    } finally {
      try { unlinkSync(tmp); } catch {}
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
