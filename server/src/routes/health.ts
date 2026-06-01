import { Router, Request, Response } from 'express';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import os from 'os';
import si from 'systeminformation';
import db from '../db';
import '../background-jobs';

const router = Router();

const STARTED_AT = new Date().toISOString();
const SERVICE = 'hostpanel';

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

async function buildReadiness() {
  const checks: any = {};
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

  // Security advisory (non-blocking): warn if no admin has 2FA enabled in production
  if (process.env.NODE_ENV === 'production') {
    try {
      const warnings: string[] = [];
      const anyTotp = db.prepare('SELECT COUNT(*) AS c FROM admin_users WHERE totp_enabled = 1').get() as { c: number };
      if (!anyTotp || anyTotp.c === 0) {
        warnings.push('No admin user has 2FA (TOTP) enabled. Enable 2FA for all admin accounts to harden access.');
      }
      if (sshPasswordAuthenticationEnabled()) {
        warnings.push('SSH password authentication is enabled. Disable PasswordAuthentication and use key-only SSH for production access.');
      }
      checks.security = { warnings };
    } catch (err: any) {
      checks.security = { warnings: [], error: err.message };
    }
  }

  const ok = Object.values(checks).every((c: any) => c.ok !== false);
  return { ok, service: SERVICE, version: version(), hostname: os.hostname(), uptime: Math.round(process.uptime()), startedAt: STARTED_AT, checkedAt: new Date().toISOString(), checks };
}

router.get('/readiness', async (_req: Request, res: Response) => {
  const body = await buildReadiness();
  res.status(body.ok ? 200 : 503).json(body);
});

router.get('/live', publicHealth);

export default router;
