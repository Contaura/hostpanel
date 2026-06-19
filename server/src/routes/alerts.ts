import { Router, Request, Response } from 'express';
import { runFile } from '../utils/process-runner';
import nodemailer from 'nodemailer';
import si from 'systeminformation';
import db from '../db';
import { dispatchNotification } from './notifications';
import path from 'path';
import { existsSync, readdirSync, statSync } from 'fs';

const router = Router();

function getSmtpConfig() {
  const get = (k: string) => (db.prepare('SELECT value FROM settings WHERE key=?').get(k) as any)?.value || '';
  return { host: get('smtp_host'), port: parseInt(get('smtp_port') || '587'), user: get('smtp_user'), pass: get('smtp_pass'), from: get('smtp_from') || get('smtp_user'), secure: get('smtp_secure') === '1' };
}

async function sendAlertEmail(to: string, subject: string, text: string) {
  const cfg = getSmtpConfig();
  if (!cfg.host || !to) return;
  try {
    const transporter = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
    await transporter.sendMail({ from: cfg.from, to, subject, text });
  } catch (_) {}
}

// Track last-notified time per rule to avoid spam (in-memory, resets on restart)
const NOTIFICATION_COOLDOWN_MS = 3600000;
const lastNotified: Record<number, number> = {};
const lastWebhookNotified: Record<string, number> = {};

function latestBackupArchive() {
  const dir = process.env.BACKUP_DIR || '/var/backups/hostpanel';
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter(name => name.endsWith('.tar.gz') || name.endsWith('.sql.gz'))
    .map(name => {
      const file = path.join(dir, name);
      const stat = statSync(file);
      return { file, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!files.length) return null;
  const latest = files[0];
  return { file: latest.file, ageDays: Math.floor((Date.now() - latest.mtimeMs) / 86400000) };
}

function dispatchAlertNotification(event: string, payload: Record<string, any>, dedupeKey: string, now = Date.now()) {
  const lastTime = lastWebhookNotified[dedupeKey] || 0;
  if (now - lastTime <= NOTIFICATION_COOLDOWN_MS) return;
  lastWebhookNotified[dedupeKey] = now;
  void Promise.resolve(dispatchNotification(event, payload)).catch(() => {});
}

/* ── Alert rules CRUD ────────────────────────────────────── */

router.get('/rules', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM alert_rules ORDER BY metric').all());
});

router.post('/rules', (req: Request, res: Response) => {
  const { metric, threshold, notify_email } = req.body;
  const valid = ['cpu', 'memory', 'disk', 'load', 'backup_age'];
  if (!metric || !valid.includes(metric)) return res.status(400).json({ error: `metric must be one of: ${valid.join(', ')}` });
  try {
    const r = db.prepare('INSERT INTO alert_rules (metric, threshold, notify_email) VALUES (?, ?, ?)').run(metric, threshold ?? 80, notify_email || '');
    res.json(db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/rules/:id', (req: Request, res: Response) => {
  // Partial PUT: bound undefined to NOT NULL threshold/notify_email used to
  // 500 with "NOT NULL constraint failed".
  const current: any = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Alert rule not found' });
  const pick = <T,>(k: string, fb: T) => (req.body[k] !== undefined ? req.body[k] : fb);
  db.prepare('UPDATE alert_rules SET threshold=?, notify_email=?, enabled=? WHERE id=?')
    .run(pick('threshold', current.threshold), pick('notify_email', current.notify_email), pick('enabled', current.enabled) ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id));
});

router.delete('/rules/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM alert_rules WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── Live alerts (check against rules) ──────────────────── */

router.get('/current', async (_req: Request, res: Response) => {
  try {
    const [cpu, mem, disks, load] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.currentLoad(),
    ]);

    const rules = db.prepare("SELECT * FROM alert_rules WHERE enabled=1").all() as any[];
    const alerts: any[] = [];

    const cpuPct = Math.round(cpu.currentLoad);
    const memPct = Math.round((mem.used / mem.total) * 100);
    const loadPct = Math.round((load.currentLoad));

    for (const rule of rules) {
      if (rule.metric === 'cpu' && cpuPct >= rule.threshold) {
        const severity = cpuPct >= 95 ? 'critical' : 'warning';
        const alertObj = { id: rule.id, severity, metric: 'CPU', value: cpuPct, threshold: rule.threshold, message: `CPU usage is ${cpuPct}%` };
        alerts.push(alertObj);
        dispatchAlertNotification('system.cpu_alert', { value: cpuPct, threshold: rule.threshold, severity, message: alertObj.message }, `cpu:${rule.id}`);
      }
      if (rule.metric === 'memory' && memPct >= rule.threshold) {
        const severity = memPct >= 95 ? 'critical' : 'warning';
        const alertObj = { id: rule.id, severity, metric: 'Memory', value: memPct, threshold: rule.threshold, message: `Memory usage is ${memPct}%` };
        alerts.push(alertObj);
        dispatchAlertNotification('system.memory_alert', { value: memPct, threshold: rule.threshold, severity, message: alertObj.message }, `memory:${rule.id}`);
      }
      if (rule.metric === 'disk') {
        for (const disk of disks) {
          const pct = Math.round(disk.use);
          if (pct >= rule.threshold) {
            const severity = pct >= 95 ? 'critical' : 'warning';
            const alertObj = { id: rule.id, severity, metric: 'Disk', value: pct, threshold: rule.threshold, mount: disk.mount, message: `Disk ${disk.mount} usage is ${pct}%` };
            alerts.push(alertObj);
            dispatchAlertNotification('system.disk_alert', { mount: disk.mount, value: pct, threshold: rule.threshold, severity, message: alertObj.message }, `disk:${rule.id}:${disk.mount}`);
          }
        }
      }
      if (rule.metric === 'backup_age') {
        const latest = latestBackupArchive();
        if (latest && latest.ageDays >= rule.threshold) {
          const severity = latest.ageDays >= Math.max(rule.threshold * 2, rule.threshold + 1) ? 'critical' : 'warning';
          const alertObj = { id: rule.id, severity, metric: 'BackupAge', value: latest.ageDays, threshold: rule.threshold, file: latest.file, message: `Newest backup archive is ${latest.ageDays} day${latest.ageDays === 1 ? '' : 's'} old` };
          alerts.push(alertObj);
          dispatchAlertNotification('system.backup_stale', { file: latest.file, value: latest.ageDays, threshold: rule.threshold, severity, message: alertObj.message }, `backup_age:${rule.id}:${latest.file}`);
        }
      }
    }

    // Send email notifications (rate-limited to once per hour per rule)
    const now = Date.now();
    for (const alert of alerts) {
      const rule = rules.find(r => r.id === alert.id);
      if (!rule?.notify_email) continue;
      const lastTime = lastNotified[rule.id] || 0;
      if (now - lastTime > NOTIFICATION_COOLDOWN_MS) {
        lastNotified[rule.id] = now;
        sendAlertEmail(rule.notify_email, `[HostPanel Alert] ${alert.metric} threshold exceeded`, `${alert.message}\n\nThreshold: ${alert.threshold}%\nCurrent value: ${alert.value}%\nSeverity: ${alert.severity}\n\nThis alert was generated by HostPanel.`);
      }
    }

    // Always add disk info even without rules
    const diskInfo = disks.map(d => ({ mount: d.mount, size: d.size, used: d.used, use: Math.round(d.use) }));
    res.json({ alerts, stats: { cpu: cpuPct, memory: memPct, load: loadPct, disks: diskInfo } });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Package Updates (dnf) ───────────────────────────────── */

router.get('/packages', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await runFile('dnf', ['check-update', '--quiet'], { timeout: 60000 }).catch((e: any) => ({ stdout: e.stdout || '', stderr: e.stderr || '' }));
    const lines = stdout.trim().split('\n').filter((l: string) => l.trim() && !l.startsWith('Last') && l.includes(' '));
    const updates = lines.map((l: string) => {
      const parts = l.trim().split(/\s+/);
      return parts.length >= 2 ? { package: parts[0], version: parts[1], repo: parts[2] || '' } : null;
    }).filter(Boolean);
    res.json({ count: updates.length, updates });
  } catch (err: any) { res.json({ count: 0, updates: [], error: err.message }); }
});

router.post('/packages/update', async (req: Request, res: Response) => {
  const { packages } = req.body; // array of package names, or empty for all
  const pkgList: string[] = Array.isArray(packages) ? packages.map((p: string) => p.replace(/[^a-zA-Z0-9._-]/g, '')).filter(Boolean) : [];
  try {
    const args = ['update', '-y', ...pkgList];
    const { stdout, stderr } = await runFile('dnf', args, { timeout: 300000 });
    res.json({ success: true, output: stdout + stderr });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
