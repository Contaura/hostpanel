import { Router, Request, Response } from 'express';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import si from 'systeminformation';
import db from '../db';
import '../background-jobs';
import { getSelfHealthWatchdogState } from '../utils/self-health-watchdog';

const router = Router();

const STARTED_AT = new Date().toISOString();
const SERVICE = 'hostpanel';
const REQUIRED_SERVICES = (process.env.READINESS_REQUIRED_SERVICES || 'hostpanel,httpd,mariadb').split(',').map(s => s.trim()).filter(Boolean);

function version() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../../package.json').version || 'unknown';
  } catch (_) { return 'unknown'; }
}

export function publicHealth(_req: Request, res: Response) {
  res.json({ ok: true, service: SERVICE, version: version(), uptime: Math.round(process.uptime()), startedAt: STARTED_AT });
}

function recentFailedJobs(hours = 24) {
  return db.prepare(`SELECT id,type,resource,error,completed_at,updated_at
    FROM background_jobs
    WHERE status='failed' AND datetime(COALESCE(completed_at, updated_at, created_at)) >= datetime('now', ?)
    ORDER BY id DESC LIMIT 10`).all(`-${hours} hours`) as any[];
}

function passwordAuthenticationEnabledFrom(text: string) {
  const directives = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  const passwordAuth = directives
    .map(line => line.match(/^passwordauthentication\s+(yes|no)\b/i)?.[1]?.toLowerCase())
    .filter(Boolean)
    .pop();
  return passwordAuth === 'yes';
}

function sshPasswordAuthenticationEnabled() {
  const configuredFile = process.env.SSHD_CONFIG_FILE;
  if (configuredFile) {
    return passwordAuthenticationEnabledFrom(readFileSync(configuredFile, 'utf8'));
  }

  const effective = spawnSync('sshd', ['-T'], { encoding: 'utf8', timeout: 5000 });
  if (effective.status === 0 && effective.stdout) {
    return passwordAuthenticationEnabledFrom(effective.stdout);
  }

  return passwordAuthenticationEnabledFrom(readFileSync('/etc/ssh/sshd_config', 'utf8'));
}

function serviceActive(name: string) {
  const result = spawnSync('systemctl', ['is-active', name], { encoding: 'utf8', timeout: 5000 });
  const status = String(result.stdout || '').trim() || (result.status === 0 ? 'active' : 'unknown');
  return { name, active: result.status === 0 && status === 'active', status };
}

function latestDrillReport() {
  const dir = process.env.DRILL_REPORT_DIR || path.join(process.env.BACKUP_DIR || '/var/backups/hostpanel', 'drills');
  if (!existsSync(dir)) return { dir, latest: null as null | { file: string; mtime: string; ageDays: number }, maxAgeDays: drillReportMaxAgeDays() };
  const reports = readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const file = path.join(dir, name);
      const st = statSync(file);
      return { file, mtimeMs: st.mtimeMs, mtime: st.mtime.toISOString(), ageDays: Math.floor((Date.now() - st.mtimeMs) / (24 * 60 * 60 * 1000)) };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = reports[0];
  return { dir, latest: latest ? { file: latest.file, mtime: latest.mtime, ageDays: latest.ageDays } : null, maxAgeDays: drillReportMaxAgeDays() };
}

function drillReportMaxAgeDays() {
  const raw = Number(process.env.DRILL_REPORT_MAX_AGE_DAYS || 7);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7;
}

async function buildReadiness() {
  const checks: any = {};
  const launchBlockers: Array<{ code: string; severity: 'manual'; message: string }> = [];
  try {
    const row = db.prepare('SELECT 1 AS ok').get() as any;
    checks.database = { ok: row?.ok === 1 };
  } catch (err: any) {
    checks.database = { ok: false, error: err.message };
  }

  try {
    const disks = await si.fsSize();
    const root = disks.find(d => d.mount === '/') || disks[0];
    const high = disks.filter(d => Number(d.use) >= 95).map(d => ({ mount: d.mount, use: Math.round(Number(d.use)) }));
    checks.disk = { ok: high.length === 0, root: root ? { mount: root.mount, use: Math.round(Number(root.use)), size: root.size, used: root.used } : null, high };
  } catch (err: any) {
    checks.disk = { ok: false, error: err.message };
  }

  try {
    const mem = await si.mem();
    const use = mem.total ? Math.round((mem.used / mem.total) * 100) : 0;
    checks.memory = { ok: use < 95, use, total: mem.total, used: mem.used };
  } catch (err: any) {
    checks.memory = { ok: false, error: err.message };
  }

  try {
    const failures = recentFailedJobs();
    checks.recentFailedJobs = { ok: failures.length === 0, failures };
  } catch (err: any) {
    checks.recentFailedJobs = { ok: false, error: err.message, failures: [] };
  }

  if (process.env.NODE_ENV === 'production') {
    try {
      const services = REQUIRED_SERVICES.map(serviceActive);
      checks.services = { ok: services.every(s => s.active), services };
    } catch (err: any) {
      checks.services = { ok: false, error: err.message, services: [] };
    }
  }

  // Security readiness: TOTP is advisory until enabled manually; password SSH is launch-blocking.
  if (process.env.NODE_ENV === 'production') {
    try {
      const warnings: string[] = [];
      const failures: string[] = [];
      const anyTotp = db.prepare('SELECT COUNT(*) AS c FROM admin_users WHERE totp_enabled = 1').get() as { c: number };
      if (!anyTotp || anyTotp.c === 0) {
        const message = 'No admin user has 2FA (TOTP) enabled. Enable 2FA for all admin accounts to harden access.';
        warnings.push(message);
        launchBlockers.push({ code: 'admin_2fa_missing', severity: 'manual', message });
      }
      if (sshPasswordAuthenticationEnabled()) {
        failures.push('SSH password authentication is enabled. Disable PasswordAuthentication and use key-only SSH for production access.');
      }
      checks.security = { ok: failures.length === 0, warnings, failures };
    } catch (err: any) {
      checks.security = { ok: false, warnings: [], failures: [], error: err.message };
    }
  }

  if (process.env.NODE_ENV === 'production') {
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM notification_webhooks WHERE enabled = 1').get() as { c: number };
      const alertRuleRow = db.prepare('SELECT COUNT(*) AS c FROM alert_rules WHERE enabled = 1').get() as { c: number };
      const activeWebhookCount = Number(row?.c || 0);
      const enabledAlertRuleCount = Number(alertRuleRow?.c || 0);
      const warnings: string[] = [];
      if (activeWebhookCount === 0) {
        const message = 'No enabled notification webhook is configured. Configure Slack, Discord, or email webhook delivery so production alerts leave the panel.';
        warnings.push(message);
        launchBlockers.push({ code: 'notification_webhook_missing', severity: 'manual', message });
      }
      if (enabledAlertRuleCount === 0) {
        warnings.push('No enabled system alert rule is configured. Enable CPU, memory, disk, or load alert rules before launch so threshold breaches are surfaced.');
      }
      checks.monitoring = { ok: true, activeWebhookCount, enabledAlertRuleCount, warnings, selfHealthWatchdog: getSelfHealthWatchdogState() };
    } catch (err: any) {
      checks.monitoring = { ok: true, activeWebhookCount: null, warnings: [`Unable to inspect notification webhook configuration: ${err.message}`] };
    }
  }

  if (process.env.NODE_ENV === 'production') {
    try {
      const report = latestDrillReport();
      if (!report.latest) {
        launchBlockers.push({
          code: 'dr_drill_evidence_missing',
          severity: 'manual',
          message: 'No disaster-recovery restore drill evidence was found. Run POST /api/backup/drill/:name and verify the persisted report before launch.',
        });
      } else if (report.latest.ageDays > report.maxAgeDays) {
        launchBlockers.push({
          code: 'dr_drill_evidence_stale',
          severity: 'manual',
          message: `Latest disaster-recovery restore drill evidence is older than ${report.maxAgeDays} days. Re-run POST /api/backup/drill/:name against a current backup before launch.`,
        });
      }
      checks.disasterRecovery = { ok: true, latestDrillReport: report.latest, reportDir: report.dir, maxAgeDays: report.maxAgeDays };
    } catch (err: any) {
      checks.disasterRecovery = { ok: true, latestDrillReport: null, warnings: [`Unable to inspect disaster-recovery drill evidence: ${err.message}`] };
    }
  }

  const ok = Object.values(checks).every((c: any) => c.ok !== false);
  return { ok, service: SERVICE, version: version(), hostname: os.hostname(), uptime: Math.round(process.uptime()), startedAt: STARTED_AT, checkedAt: new Date().toISOString(), launchBlockers, checks };
}

router.get('/readiness', async (_req: Request, res: Response) => {
  const body = await buildReadiness();
  res.status(body.ok ? 200 : 503).json(body);
});

router.get('/live', publicHealth);

export default router;
