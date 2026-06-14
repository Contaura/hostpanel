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

function latestDrillReport(): { dir: string; latest: null | { file: string; mtime: string; ageDays: number; valid: boolean; validationErrors: string[] }; maxAgeDays: number } {
  const dir = process.env.DRILL_REPORT_DIR || path.join(process.env.BACKUP_DIR || '/var/backups/hostpanel', 'drills');
  if (!existsSync(dir)) return { dir, latest: null, maxAgeDays: drillReportMaxAgeDays() };
  const reports = readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      const file = path.join(dir, name);
      const st = statSync(file);
      const validation = validateDrillReport(file);
      return { file, mtimeMs: st.mtimeMs, mtime: st.mtime.toISOString(), ageDays: Math.floor((Date.now() - st.mtimeMs) / (24 * 60 * 60 * 1000)), ...validation };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = reports[0];
  return { dir, latest: latest ? { file: latest.file, mtime: latest.mtime, ageDays: latest.ageDays, valid: latest.valid, validationErrors: latest.validationErrors } : null, maxAgeDays: drillReportMaxAgeDays() };
}

function validateDrillReport(file: string) {
  const errors: string[] = [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed.success !== true) errors.push('success is not true');
    if (parsed.drill !== true) errors.push('drill is not true');
    if (!parsed.backup || typeof parsed.backup !== 'string') errors.push('backup is missing');
    if (!parsed.verifiedAt || Number.isNaN(Date.parse(parsed.verifiedAt))) errors.push('verifiedAt is missing or invalid');
    if (!parsed.restorePlan || parsed.restorePlan.dryRun !== true) errors.push('restorePlan dry-run evidence is missing');
  } catch (err: any) {
    errors.push(`report is not valid JSON: ${err.message}`);
  }
  return { valid: errors.length === 0, validationErrors: errors };
}

function drillReportMaxAgeDays() {
  const raw = Number(process.env.DRILL_REPORT_MAX_AGE_DAYS || 7);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 7;
}

function latestBackupArchive() {
  const dir = process.env.BACKUP_DIR || '/var/backups/hostpanel';
  if (!existsSync(dir)) return { dir, latest: null as null | { file: string; mtime: string; ageDays: number }, maxAgeDays: backupArchiveMaxAgeDays() };
  const archives = readdirSync(dir)
    .filter(name => name.endsWith('.tar.gz') || name.endsWith('.sql.gz'))
    .map(name => {
      const file = path.join(dir, name);
      const st = statSync(file);
      if (!st.isFile()) return null;
      return { file, mtimeMs: st.mtimeMs, mtime: st.mtime.toISOString(), ageDays: Math.floor((Date.now() - st.mtimeMs) / (24 * 60 * 60 * 1000)) };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.mtimeMs - a.mtimeMs) as Array<{ file: string; mtimeMs: number; mtime: string; ageDays: number }>;
  const latest = archives[0];
  return { dir, latest: latest ? { file: latest.file, mtime: latest.mtime, ageDays: latest.ageDays } : null, maxAgeDays: backupArchiveMaxAgeDays() };
}

function backupArchiveMaxAgeDays() {
  const raw = Number(process.env.BACKUP_ARCHIVE_MAX_AGE_DAYS || 1);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
}

function countEnabledNightlyDatabaseBackups() {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_schedules'").get() as any;
  if (!table) return 0;
  const row = db.prepare("SELECT COUNT(*) AS c FROM backup_schedules WHERE type='database' AND enabled=1").get() as { c: number };
  return Number(row?.c || 0);
}

function tlsCertificateWarnDays() {
  const raw = Number(process.env.TLS_CERT_WARN_DAYS || 14);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 14;
}

function tlsCertificateDir() {
  return process.env.TLS_CERT_CHECK_DIR || '/etc/letsencrypt/live';
}

function monitoredCertificates() {
  const dir = tlsCertificateDir();
  const warnDays = tlsCertificateWarnDays();
  if (!existsSync(dir)) return { ok: true, dir, warnDays, certificates: [], expiring: [] };
  const certificates = readdirSync(dir)
    .map(domain => ({ domain, file: path.join(dir, domain, 'fullchain.pem') }))
    .filter(cert => existsSync(cert.file))
    .map(cert => {
      const result = spawnSync('openssl', ['x509', '-in', cert.file, '-noout', '-enddate'], { encoding: 'utf8', timeout: 5000 });
      const raw = String(result.stdout || '').trim();
      const notAfter = raw.replace(/^notAfter=/, '');
      const expiresAt = Date.parse(notAfter);
      const daysLeft = Number.isFinite(expiresAt) ? Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)) : null;
      return { ...cert, notAfter, daysLeft, ok: result.status === 0 && daysLeft !== null && daysLeft > warnDays };
    });
  const expiring = certificates
    .filter(cert => cert.daysLeft === null || cert.daysLeft <= warnDays)
    .map(({ domain, file, notAfter, daysLeft }) => ({ domain, file, notAfter, daysLeft }));
  return { ok: expiring.length === 0, dir, warnDays, certificates, expiring };
}

async function currentCriticalAlerts() {
  const [cpu, mem, disks] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
  ]);
  const rules = db.prepare('SELECT * FROM alert_rules WHERE enabled=1').all() as any[];
  const alerts: any[] = [];
  const cpuPct = Math.round(Number(cpu.currentLoad));
  const memPct = mem.total ? Math.round((mem.used / mem.total) * 100) : 0;

  for (const rule of rules) {
    const threshold = Number(rule.threshold || 80);
    if (rule.metric === 'cpu' && cpuPct >= threshold && cpuPct >= 95) {
      alerts.push({ metric: 'CPU', value: cpuPct, threshold, message: `CPU usage is ${cpuPct}%` });
    }
    if (rule.metric === 'memory' && memPct >= threshold && memPct >= 95) {
      alerts.push({ metric: 'Memory', value: memPct, threshold, message: `Memory usage is ${memPct}%` });
    }
    if (rule.metric === 'disk') {
      for (const disk of disks) {
        const pct = Math.round(Number(disk.use));
        if (pct >= threshold && pct >= 95) {
          alerts.push({ metric: 'Disk', value: pct, threshold, mount: disk.mount, message: `Disk ${disk.mount} usage is ${pct}%` });
        }
      }
    }
  }
  return alerts;
}

type ManualLaunchBlockerCode =
  | 'admin_2fa_missing'
  | 'notification_webhook_missing'
  | 'payment_webhook_secrets_unverified'
  | 'critical_alerts_active'
  | 'dr_drill_evidence_missing'
  | 'dr_drill_evidence_stale'
  | 'dr_drill_evidence_invalid'
  | 'backup_evidence_missing'
  | 'backup_evidence_stale'
  | 'nightly_database_backup_schedule_missing'
  | 'tls_cert_expiring';

const MANUAL_LAUNCH_BLOCKER_EVIDENCE: Record<ManualLaunchBlockerCode, { owner: string; requiredEvidence: string }> = {
  admin_2fa_missing: { owner: 'Marcos', requiredEvidence: 'Enable TOTP for the production admin account in /admin-users; readiness security warning clears.' },
  notification_webhook_missing: { owner: 'Marcos', requiredEvidence: 'Configure an enabled notification webhook and send a successful test notification; readiness monitoring warning clears.' },
  payment_webhook_secrets_unverified: { owner: 'Marcos', requiredEvidence: 'Configure the Stripe webhook signing secret in Settings and verify a signed Stripe webhook test event before launch.' },
  critical_alerts_active: { owner: 'Ron', requiredEvidence: 'Resolve active critical CPU, memory, or disk alerts and rerun /api/health/readiness.' },
  dr_drill_evidence_missing: { owner: 'Ron', requiredEvidence: 'Run POST /api/backup/drill/:name and verify the persisted report before launch.' },
  dr_drill_evidence_stale: { owner: 'Ron', requiredEvidence: 'Rerun POST /api/backup/drill/:name against a current backup and verify the persisted report age.' },
  dr_drill_evidence_invalid: { owner: 'Ron', requiredEvidence: 'Rerun POST /api/backup/drill/:name and confirm the latest report has success=true, drill=true, a valid verifiedAt timestamp, backup name, and dry-run restore plan.' },
  backup_evidence_missing: { owner: 'Ron + Marcos', requiredEvidence: 'Create and verify on-server backup archive evidence, then confirm off-server replication.' },
  backup_evidence_stale: { owner: 'Ron + Marcos', requiredEvidence: 'Create a fresh backup archive and verify off-server replication before launch.' },
  nightly_database_backup_schedule_missing: { owner: 'Ron + Marcos', requiredEvidence: 'Configure an enabled database backup schedule and verify the first archive before launch.' },
  tls_cert_expiring: { owner: 'Ron', requiredEvidence: 'Renew expiring TLS certificates and verify HTTPS handshakes before launch.' },
};

function manualLaunchBlocker(code: ManualLaunchBlockerCode, message: string) {
  return { code, severity: 'manual' as const, ...MANUAL_LAUNCH_BLOCKER_EVIDENCE[code], message };
}

async function buildReadiness() {
  const checks: any = {};
  const launchBlockers: Array<ReturnType<typeof manualLaunchBlocker>> = [];
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
        launchBlockers.push(manualLaunchBlocker('admin_2fa_missing', message));
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
      const criticalAlerts = await currentCriticalAlerts();
      const warnings: string[] = [];
      if (activeWebhookCount === 0) {
        const message = 'No enabled notification webhook is configured. Configure Slack, Discord, or email webhook delivery so production alerts leave the panel.';
        warnings.push(message);
        launchBlockers.push(manualLaunchBlocker('notification_webhook_missing', message));
      }
      if (enabledAlertRuleCount === 0) {
        warnings.push('No enabled system alert rule is configured. Enable CPU, memory, disk, or load alert rules before launch so threshold breaches are surfaced.');
      }
      if (criticalAlerts.length > 0) {
        const message = `${criticalAlerts.length} critical production alert${criticalAlerts.length === 1 ? '' : 's'} currently active. Resolve critical CPU, memory, or disk alerts before launch.`;
        warnings.push(message);
        launchBlockers.push(manualLaunchBlocker('critical_alerts_active', message));
      }
      checks.monitoring = { ok: criticalAlerts.length === 0, activeWebhookCount, enabledAlertRuleCount, criticalAlerts, warnings, selfHealthWatchdog: getSelfHealthWatchdogState() };
    } catch (err: any) {
      checks.monitoring = { ok: true, activeWebhookCount: null, criticalAlerts: [], warnings: [`Unable to inspect notification webhook configuration: ${err.message}`] };
    }
  }

  if (process.env.NODE_ENV === 'production') {
    try {
      const settings = db.prepare("SELECT key, value FROM settings WHERE key IN ('stripe_secret_key', 'stripe_publishable_key', 'stripe_price_id', 'stripe_webhook_secret')").all() as Array<{ key: string; value: string }>;
      const byKey = Object.fromEntries(settings.map(row => [row.key, String(row.value || '').trim()]));
      const stripeConfigured = Boolean(byKey.stripe_secret_key || byKey.stripe_publishable_key || byKey.stripe_price_id);
      const stripeWebhookSecretConfigured = Boolean(byKey.stripe_webhook_secret);
      if (stripeConfigured && !stripeWebhookSecretConfigured) {
        launchBlockers.push(manualLaunchBlocker('payment_webhook_secrets_unverified', 'Stripe is configured without a webhook signing secret. Configure and verify the signed Stripe webhook before accepting live payments.'));
      }
      checks.payments = { ok: true, stripeConfigured, stripeWebhookSecretConfigured };
    } catch (err: any) {
      checks.payments = { ok: true, stripeConfigured: null, stripeWebhookSecretConfigured: null, warnings: [`Unable to inspect payment webhook configuration: ${err.message}`] };
    }
  }

  if (process.env.NODE_ENV === 'production') {
    try {
      const report = latestDrillReport();
      if (!report.latest) {
        launchBlockers.push(manualLaunchBlocker('dr_drill_evidence_missing', 'No disaster-recovery restore drill evidence was found. Run POST /api/backup/drill/:name and verify the persisted report before launch.'));
      } else if (report.latest.ageDays > report.maxAgeDays) {
        launchBlockers.push(manualLaunchBlocker('dr_drill_evidence_stale', `Latest disaster-recovery restore drill evidence is older than ${report.maxAgeDays} days. Re-run POST /api/backup/drill/:name against a current backup before launch.`));
      } else if (!report.latest.valid) {
        launchBlockers.push(manualLaunchBlocker('dr_drill_evidence_invalid', `Latest invalid disaster-recovery restore drill evidence must be rerun before launch: ${report.latest.validationErrors.join('; ')}`));
      }
      checks.disasterRecovery = { ok: true, latestDrillReport: report.latest, reportDir: report.dir, maxAgeDays: report.maxAgeDays };
    } catch (err: any) {
      checks.disasterRecovery = { ok: true, latestDrillReport: null, warnings: [`Unable to inspect disaster-recovery drill evidence: ${err.message}`] };
    }
  }

  if (process.env.NODE_ENV === 'production') {
    try {
      const archive = latestBackupArchive();
      if (!archive.latest) {
        launchBlockers.push(manualLaunchBlocker('backup_evidence_missing', 'No HostPanel backup archive evidence was found. Create and verify an on-server backup archive before launch, then confirm off-server replication.'));
      } else if (archive.latest.ageDays > archive.maxAgeDays) {
        launchBlockers.push(manualLaunchBlocker('backup_evidence_stale', `Latest backup archive evidence is older than ${archive.maxAgeDays} day${archive.maxAgeDays === 1 ? '' : 's'}. Create a fresh backup and verify off-server replication before launch.`));
      }
      checks.backups = { ok: true, latestArchive: archive.latest, backupDir: archive.dir, maxAgeDays: archive.maxAgeDays };
    } catch (err: any) {
      checks.backups = { ok: true, latestArchive: null, warnings: [`Unable to inspect backup archive evidence: ${err.message}`] };
    }
  }

  if (process.env.NODE_ENV === 'production') {
    try {
      const enabledNightlyDatabaseBackupCount = countEnabledNightlyDatabaseBackups();
      if (enabledNightlyDatabaseBackupCount === 0) {
        launchBlockers.push(manualLaunchBlocker('nightly_database_backup_schedule_missing', 'No enabled nightly database backup schedule was found. Configure an enabled database backup schedule and verify the first archive before launch.'));
      }
      checks.backupSchedules = { ok: true, enabledNightlyDatabaseBackupCount };
    } catch (err: any) {
      checks.backupSchedules = { ok: true, enabledNightlyDatabaseBackupCount: null, warnings: [`Unable to inspect backup schedules: ${err.message}`] };
    }
  }

  if (process.env.NODE_ENV === 'production') {
    try {
      const certificates = monitoredCertificates();
      if (certificates.expiring.length > 0) {
        const first = certificates.expiring[0];
        const days = first.daysLeft === null ? 'an unknown number of' : String(first.daysLeft);
        launchBlockers.push(manualLaunchBlocker('tls_cert_expiring', `TLS certificate for ${first.domain} expires in ${days} days. Renew certificates before launch and verify HTTPS handshakes.`));
      }
      checks.certificates = certificates;
    } catch (err: any) {
      checks.certificates = { ok: false, warnings: [`Unable to inspect TLS certificates: ${err.message}`], expiring: [] };
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
