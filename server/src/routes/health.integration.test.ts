import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing listen address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

function markBusinessLaunchEvidenceVerified(db: any) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('external_uptime_monitor_verified', 'https://uptime.example.test/hostpanel');
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('off_server_backup_replication_verified', 's3://example-hostpanel-backups/latest');
}

describe('production health and readiness checks', () => {
  let tmp = '';

  beforeEach(async () => {
    vi.resetModules();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-health-'));
    process.env.DATA_DIR = tmp;
    process.env.TLS_CERT_CHECK_DIR = path.join(tmp, 'certs-empty');
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.TLS_CERT_CHECK_DIR;
    vi.resetModules();
  });

  it('exposes a minimal public liveness response without leaking internals', async () => {
    const { publicHealth } = await import('./health');
    const app = express();
    app.get('/healthz', publicHealth);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/healthz`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, service: 'hostpanel' });
      expect(body).not.toHaveProperty('checks');
      expect(body).not.toHaveProperty('env');
    } finally {
      await server.close();
    }
  });

  it('reports readiness checks and recent background job failures', async () => {
    await import('../background-jobs');
    const db = (await import('../db')).default;
    db.prepare("INSERT INTO background_jobs (type,status,resource,error,created_at,updated_at,completed_at) VALUES (?,?,?,?,datetime('now'),datetime('now'),datetime('now'))").run('backup.restore', 'failed', 'bad-backup.tar.gz', 'restore failed');
    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.checks.database.ok).toBe(true);
      expect(body.checks.recentFailedJobs.ok).toBe(false);
      expect(body.checks.recentFailedJobs.failures[0]).toMatchObject({ type: 'backup.restore', resource: 'bad-backup.tar.gz' });
    } finally {
      await server.close();
    }
  });

  it('includes a security advisory when no admin has 2FA enabled in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    await import('../background-jobs');
    const db = (await import('../db')).default;
    // Ensure admin_users has at least one user without TOTP enabled
    db.prepare('DELETE FROM admin_users').run();
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_enabled) VALUES (?,?,?,?,?)")
      .run('admin', 'admin@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'admin', 0);
    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      // 2FA warning should not flip ok=false — it's an advisory, not a hard failure
      expect(body.checks.security).toBeDefined();
      expect(body.checks.security.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/2FA/i)])
      );
    } finally {
      await server.close();
      process.env.NODE_ENV = prev;
    }
  });

  it('includes a monitoring advisory when no notification webhook is enabled in production', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    vi.doMock('systeminformation', () => ({
      default: {
        fsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 10, size: 1000, used: 100 }]),
        mem: vi.fn().mockResolvedValue({ total: 1000, used: 400 }),
        currentLoad: vi.fn().mockResolvedValue({ currentLoad: 20 }),
      },
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    db.prepare('DELETE FROM notification_webhooks').run();

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.checks.monitoring).toMatchObject({ ok: true, activeWebhookCount: 0 });
      expect(body.checks.monitoring.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/notification webhook/i)])
      );
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
    }
  });

  it('adds a manual launch blocker when the latest disaster-recovery drill evidence is stale', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    const prevDrillReportDir = process.env.DRILL_REPORT_DIR;
    const prevBackupDir = process.env.BACKUP_DIR;
    const prevDrillMaxAgeDays = process.env.DRILL_REPORT_MAX_AGE_DAYS;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    process.env.BACKUP_DIR = path.join(tmp, 'missing-backups');
    process.env.DRILL_REPORT_DIR = path.join(tmp, 'drills');
    process.env.DRILL_REPORT_MAX_AGE_DAYS = '7';
    await fs.mkdir(process.env.DRILL_REPORT_DIR);
    const staleReport = path.join(process.env.DRILL_REPORT_DIR, 'stale-drill.json');
    await fs.writeFile(staleReport, JSON.stringify({ ok: true }));
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await fs.utimes(staleReport, staleDate, staleDate);
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    vi.doMock('systeminformation', () => ({
      default: {
        fsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 10, size: 1000, used: 100 }]),
        mem: vi.fn().mockResolvedValue({ total: 1000, used: 400 }),
        currentLoad: vi.fn().mockResolvedValue({ currentLoad: 20 }),
      },
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    markBusinessLaunchEvidenceVerified(db);
    db.prepare('DELETE FROM admin_users').run();
    db.prepare('DELETE FROM notification_webhooks').run();
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_enabled) VALUES (?,?,?,?,?)")
      .run('admin', 'admin@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'admin', 1);
    db.prepare("INSERT INTO notification_webhooks (name, url, type, events, enabled) VALUES (?, ?, ?, ?, ?)")
      .run('ops', 'https://alerts.example.test/webhook', 'webhook', JSON.stringify(['system.disk_alert']), 1);
    db.prepare("INSERT INTO alert_rules (metric, threshold, enabled) VALUES (?, ?, ?)")
      .run('disk', 90, 1);

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.checks.disasterRecovery).toMatchObject({ ok: true, latestDrillReport: { file: staleReport }, maxAgeDays: 7 });
      expect(body.launchBlockers).toEqual([
        expect.objectContaining({ code: 'dr_drill_evidence_stale', severity: 'manual', owner: 'Ron', requiredEvidence: expect.any(String), message: expect.stringMatching(/older than 7 days/i) }),
        expect.objectContaining({ code: 'backup_evidence_missing', severity: 'manual', owner: 'Ron + Marcos', requiredEvidence: expect.any(String), message: expect.stringMatching(/backup archive evidence/i) }),
        expect.objectContaining({ code: 'nightly_database_backup_schedule_missing', severity: 'manual', owner: 'Ron + Marcos', requiredEvidence: expect.any(String), message: expect.stringMatching(/nightly database backup schedule/i) }),
      ]);
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
      if (prevDrillReportDir === undefined) delete process.env.DRILL_REPORT_DIR;
      else process.env.DRILL_REPORT_DIR = prevDrillReportDir;
      if (prevBackupDir === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = prevBackupDir;
      if (prevDrillMaxAgeDays === undefined) delete process.env.DRILL_REPORT_MAX_AGE_DAYS;
      else process.env.DRILL_REPORT_MAX_AGE_DAYS = prevDrillMaxAgeDays;
    }
  });

  it('adds a manual launch blocker when latest disaster-recovery drill evidence is invalid', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    const prevDrillReportDir = process.env.DRILL_REPORT_DIR;
    const prevBackupDir = process.env.BACKUP_DIR;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.DRILL_REPORT_DIR = path.join(process.env.BACKUP_DIR, 'drills');
    await fs.mkdir(process.env.DRILL_REPORT_DIR, { recursive: true });
    const invalidReport = path.join(process.env.DRILL_REPORT_DIR, 'failed-drill.json');
    await fs.writeFile(invalidReport, JSON.stringify({ success: false, drill: true, backup: 'files_all.tar.gz', restorePlan: { dryRun: true, actions: [] } }));
    const freshBackup = path.join(process.env.BACKUP_DIR, 'files_all_2026-06-01T00-00-00.tar.gz');
    await fs.writeFile(freshBackup, 'backup');
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    vi.doMock('systeminformation', () => ({
      default: {
        fsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 10, size: 1000, used: 100 }]),
        mem: vi.fn().mockResolvedValue({ total: 1000, used: 400 }),
        currentLoad: vi.fn().mockResolvedValue({ currentLoad: 20 }),
      },
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    markBusinessLaunchEvidenceVerified(db);
    db.prepare('DELETE FROM admin_users').run();
    db.prepare('DELETE FROM notification_webhooks').run();
    db.exec(`CREATE TABLE IF NOT EXISTS backup_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target TEXT,
      schedule TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    db.prepare('DELETE FROM backup_schedules').run();
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_enabled) VALUES (?,?,?,?,?)")
      .run('admin', 'admin@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'admin', 1);
    db.prepare("INSERT INTO notification_webhooks (name, url, type, events, enabled) VALUES (?, ?, ?, ?, ?)")
      .run('ops', 'https://alerts.example.test/webhook', 'webhook', JSON.stringify(['system.disk_alert']), 1);
    db.prepare("INSERT INTO alert_rules (metric, threshold, enabled) VALUES (?, ?, ?)")
      .run('disk', 90, 1);
    db.prepare("INSERT INTO backup_schedules (type, target, schedule, enabled) VALUES (?, ?, ?, ?)")
      .run('database', 'hostpanel', '0 2 * * *', 1);

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.checks.disasterRecovery).toMatchObject({ ok: true, latestDrillReport: { file: invalidReport, valid: false } });
      expect(body.launchBlockers).toEqual([
        expect.objectContaining({ code: 'dr_drill_evidence_invalid', severity: 'manual', owner: 'Ron', requiredEvidence: expect.any(String), message: expect.stringMatching(/invalid disaster-recovery restore drill evidence/i) }),
      ]);
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
      if (prevDrillReportDir === undefined) delete process.env.DRILL_REPORT_DIR;
      else process.env.DRILL_REPORT_DIR = prevDrillReportDir;
      if (prevBackupDir === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = prevBackupDir;
    }
  });

  it('adds a manual launch blocker when no enabled nightly database backup schedule exists in production', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    const prevDrillReportDir = process.env.DRILL_REPORT_DIR;
    const prevBackupDir = process.env.BACKUP_DIR;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.DRILL_REPORT_DIR = path.join(process.env.BACKUP_DIR, 'drills');
    await fs.mkdir(process.env.DRILL_REPORT_DIR, { recursive: true });
    const freshReport = path.join(process.env.DRILL_REPORT_DIR, 'fresh-drill.json');
    await fs.writeFile(freshReport, JSON.stringify({ success: true, drill: true, backup: 'files_all_2026-06-01T00-00-00.tar.gz', verifiedAt: new Date().toISOString(), restorePlan: { dryRun: true, type: 'files', actions: ['Would restore ./index.html'] } }));
    const freshBackup = path.join(process.env.BACKUP_DIR, 'files_all_2026-06-01T00-00-00.tar.gz');
    await fs.writeFile(freshBackup, 'backup');
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    vi.doMock('systeminformation', () => ({
      default: {
        fsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 10, size: 1000, used: 100 }]),
        mem: vi.fn().mockResolvedValue({ total: 1000, used: 400 }),
        currentLoad: vi.fn().mockResolvedValue({ currentLoad: 20 }),
      },
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    markBusinessLaunchEvidenceVerified(db);
    db.prepare('DELETE FROM admin_users').run();
    db.prepare('DELETE FROM notification_webhooks').run();
    db.prepare('DELETE FROM alert_rules').run();
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_enabled) VALUES (?,?,?,?,?)")
      .run('admin', 'admin@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'admin', 1);
    db.prepare("INSERT INTO notification_webhooks (name, url, type, events, enabled) VALUES (?, ?, ?, ?, ?)")
      .run('ops', 'https://alerts.example.test/webhook', 'webhook', JSON.stringify(['system.disk_alert']), 1);
    db.prepare("INSERT INTO alert_rules (metric, threshold, enabled) VALUES (?, ?, ?)")
      .run('disk', 90, 1);
    db.exec(`CREATE TABLE IF NOT EXISTS backup_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target TEXT,
      schedule TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    db.prepare('DELETE FROM backup_schedules').run();
    db.prepare('INSERT INTO backup_schedules (type, target, schedule, enabled) VALUES (?, ?, ?, ?)')
      .run('files', 'all', '0 2 * * *', 1);

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.checks.backupSchedules).toMatchObject({ ok: true, enabledNightlyDatabaseBackupCount: 0 });
      expect(body.launchBlockers).toEqual([
        expect.objectContaining({ code: 'nightly_database_backup_schedule_missing', severity: 'manual', owner: 'Ron + Marcos', requiredEvidence: expect.any(String), message: expect.stringMatching(/nightly database backup schedule/i) }),
      ]);
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
      if (prevDrillReportDir === undefined) delete process.env.DRILL_REPORT_DIR;
      else process.env.DRILL_REPORT_DIR = prevDrillReportDir;
      if (prevBackupDir === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = prevBackupDir;
    }
  });

  it('adds a manual launch blocker when the latest backup archive is stale', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    const prevDrillReportDir = process.env.DRILL_REPORT_DIR;
    const prevBackupDir = process.env.BACKUP_DIR;
    const prevBackupMaxAgeDays = process.env.BACKUP_ARCHIVE_MAX_AGE_DAYS;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.DRILL_REPORT_DIR = path.join(process.env.BACKUP_DIR, 'drills');
    process.env.BACKUP_ARCHIVE_MAX_AGE_DAYS = '1';
    await fs.mkdir(process.env.DRILL_REPORT_DIR, { recursive: true });
    const freshReport = path.join(process.env.DRILL_REPORT_DIR, 'fresh-drill.json');
    await fs.writeFile(freshReport, JSON.stringify({ success: true, drill: true, backup: 'files_all_2026-06-01T00-00-00.tar.gz', verifiedAt: new Date().toISOString(), restorePlan: { dryRun: true, type: 'files', actions: ['Would restore ./index.html'] } }));
    const staleBackup = path.join(process.env.BACKUP_DIR, 'files_all_2026-06-01T00-00-00.tar.gz');
    await fs.writeFile(staleBackup, 'backup');
    const staleDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await fs.utimes(staleBackup, staleDate, staleDate);
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    vi.doMock('systeminformation', () => ({
      default: {
        fsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 10, size: 1000, used: 100 }]),
        mem: vi.fn().mockResolvedValue({ total: 1000, used: 400 }),
        currentLoad: vi.fn().mockResolvedValue({ currentLoad: 20 }),
      },
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    markBusinessLaunchEvidenceVerified(db);
    db.prepare('DELETE FROM admin_users').run();
    db.prepare('DELETE FROM notification_webhooks').run();
    db.prepare('DELETE FROM alert_rules').run();
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_enabled) VALUES (?,?,?,?,?)")
      .run('admin', 'admin@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'admin', 1);
    db.prepare("INSERT INTO notification_webhooks (name, url, type, events, enabled) VALUES (?, ?, ?, ?, ?)")
      .run('ops', 'https://alerts.example.test/webhook', 'webhook', JSON.stringify(['system.disk_alert']), 1);
    db.prepare("INSERT INTO alert_rules (metric, threshold, enabled) VALUES (?, ?, ?)")
      .run('disk', 90, 1);

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.checks.backups).toMatchObject({ ok: true, latestArchive: { file: staleBackup }, maxAgeDays: 1 });
      expect(body.launchBlockers).toEqual([
        expect.objectContaining({ code: 'backup_evidence_stale', severity: 'manual', owner: 'Ron + Marcos', requiredEvidence: expect.any(String), message: expect.stringMatching(/backup archive evidence is older than 1 day/i) }),
        expect.objectContaining({ code: 'nightly_database_backup_schedule_missing', severity: 'manual', owner: 'Ron + Marcos', requiredEvidence: expect.any(String), message: expect.stringMatching(/nightly database backup schedule/i) }),
      ]);
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
      if (prevDrillReportDir === undefined) delete process.env.DRILL_REPORT_DIR;
      else process.env.DRILL_REPORT_DIR = prevDrillReportDir;
      if (prevBackupDir === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = prevBackupDir;
      if (prevBackupMaxAgeDays === undefined) delete process.env.BACKUP_ARCHIVE_MAX_AGE_DAYS;
      else process.env.BACKUP_ARCHIVE_MAX_AGE_DAYS = prevBackupMaxAgeDays;
    }
  });

  it('summarizes manual production launch blockers without failing readiness', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    const prevDrillReportDir = process.env.DRILL_REPORT_DIR;
    const prevBackupDir = process.env.BACKUP_DIR;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    process.env.BACKUP_DIR = path.join(tmp, 'missing-backups');
    process.env.DRILL_REPORT_DIR = path.join(tmp, 'empty-drills');
    await fs.mkdir(process.env.DRILL_REPORT_DIR);
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    db.prepare('DELETE FROM admin_users').run();
    db.prepare('DELETE FROM notification_webhooks').run();
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_enabled) VALUES (?,?,?,?,?)")
      .run('admin', 'admin@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'admin', 0);
    db.prepare("INSERT INTO alert_rules (metric, threshold, enabled) VALUES (?, ?, ?)")
      .run('disk', 90, 1);

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.launchBlockers).toEqual([
        expect.objectContaining({ code: 'admin_2fa_missing', severity: 'manual', owner: 'Marcos', requiredEvidence: expect.stringMatching(/Enable TOTP/i), message: expect.stringMatching(/2FA/i) }),
        expect.objectContaining({ code: 'notification_webhook_missing', severity: 'manual', owner: 'Marcos', requiredEvidence: expect.stringMatching(/test notification/i), message: expect.stringMatching(/notification webhook/i) }),
        expect.objectContaining({ code: 'external_uptime_monitor_missing', severity: 'manual', owner: 'Marcos', requiredEvidence: expect.stringMatching(/external uptime monitor/i), message: expect.stringMatching(/external uptime monitor/i) }),
        expect.objectContaining({ code: 'dr_drill_evidence_missing', severity: 'manual', owner: 'Ron', requiredEvidence: expect.stringMatching(/persisted report/i), message: expect.stringMatching(/disaster-recovery restore drill/i) }),
        expect.objectContaining({ code: 'backup_evidence_missing', severity: 'manual', owner: 'Ron + Marcos', requiredEvidence: expect.stringMatching(/off-server replication/i), message: expect.stringMatching(/backup archive evidence/i) }),
        expect.objectContaining({ code: 'off_server_backup_replication_missing', severity: 'manual', owner: 'Marcos', requiredEvidence: expect.stringMatching(/off-server backup replication/i), message: expect.stringMatching(/off-server backup replication/i) }),
        expect.objectContaining({ code: 'nightly_database_backup_schedule_missing', severity: 'manual', owner: 'Ron + Marcos', requiredEvidence: expect.stringMatching(/enabled database backup schedule/i), message: expect.stringMatching(/nightly database backup schedule/i) }),
      ]);
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
      if (prevDrillReportDir === undefined) delete process.env.DRILL_REPORT_DIR;
      else process.env.DRILL_REPORT_DIR = prevDrillReportDir;
      if (prevBackupDir === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = prevBackupDir;
    }
  });

  it('adds a manual launch blocker when Stripe is configured without a webhook signing secret in production', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    const prevDrillReportDir = process.env.DRILL_REPORT_DIR;
    const prevBackupDir = process.env.BACKUP_DIR;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.DRILL_REPORT_DIR = path.join(process.env.BACKUP_DIR, 'drills');
    await fs.mkdir(process.env.DRILL_REPORT_DIR, { recursive: true });
    const freshReport = path.join(process.env.DRILL_REPORT_DIR, 'fresh-drill.json');
    await fs.writeFile(freshReport, JSON.stringify({ success: true, drill: true, backup: 'files_all_2026-06-01T00-00-00.tar.gz', verifiedAt: new Date().toISOString(), restorePlan: { dryRun: true, type: 'files', actions: ['Would restore ./index.html'] } }));
    const freshBackup = path.join(process.env.BACKUP_DIR, 'files_all_2026-06-01T00-00-00.tar.gz');
    await fs.writeFile(freshBackup, 'backup');
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    vi.doMock('systeminformation', () => ({
      default: {
        fsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 10, size: 1000, used: 100 }]),
        mem: vi.fn().mockResolvedValue({ total: 1000, used: 400 }),
        currentLoad: vi.fn().mockResolvedValue({ currentLoad: 20 }),
      },
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    markBusinessLaunchEvidenceVerified(db);
    db.prepare('DELETE FROM admin_users').run();
    db.prepare('DELETE FROM notification_webhooks').run();
    db.prepare('DELETE FROM alert_rules').run();
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_enabled) VALUES (?,?,?,?,?)")
      .run('admin', 'admin@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'admin', 1);
    db.prepare("INSERT INTO notification_webhooks (name, url, type, events, enabled) VALUES (?, ?, ?, ?, ?)")
      .run('ops', 'https://alerts.example.test/webhook', 'webhook', JSON.stringify(['system.disk_alert']), 1);
    db.prepare("INSERT INTO alert_rules (metric, threshold, enabled) VALUES (?, ?, ?)")
      .run('disk', 90, 1);
    db.exec(`CREATE TABLE IF NOT EXISTS backup_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target TEXT,
      schedule TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    db.prepare('DELETE FROM backup_schedules').run();
    db.prepare('INSERT INTO backup_schedules (type, target, schedule, enabled) VALUES (?, ?, ?, ?)')
      .run('database', 'hostpanel', '0 2 * * *', 1);
    db.prepare("UPDATE settings SET value = ? WHERE key = 'stripe_secret_key'").run('sk_live_configured');
    db.prepare("UPDATE settings SET value = '' WHERE key = 'stripe_webhook_secret'").run();

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.checks.payments).toMatchObject({ ok: true, stripeConfigured: true, stripeWebhookSecretConfigured: false });
      expect(body.launchBlockers).toEqual([
        expect.objectContaining({ code: 'payment_webhook_secrets_unverified', severity: 'manual', owner: 'Marcos', requiredEvidence: expect.stringMatching(/Stripe webhook signing secret/i), message: expect.stringMatching(/Stripe is configured without a webhook signing secret/i) }),
      ]);
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
      if (prevDrillReportDir === undefined) delete process.env.DRILL_REPORT_DIR;
      else process.env.DRILL_REPORT_DIR = prevDrillReportDir;
      if (prevBackupDir === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = prevBackupDir;
    }
  });

  it('includes a monitoring advisory when no system alert rule is enabled in production', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    db.prepare('DELETE FROM alert_rules').run();
    db.prepare("INSERT INTO notification_webhooks (name, url, type, events, enabled) VALUES (?, ?, ?, ?, ?)")
      .run('ops', 'https://alerts.example.test/webhook', 'webhook', JSON.stringify(['system.disk_alert']), 1);

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.checks.monitoring).toMatchObject({ ok: true, activeWebhookCount: 1, enabledAlertRuleCount: 0 });
      expect(body.checks.monitoring.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/alert rule/i)])
      );
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
    }
  });

  it('adds a manual launch blocker when a critical live alert is active in production', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    const prevDrillReportDir = process.env.DRILL_REPORT_DIR;
    const prevBackupDir = process.env.BACKUP_DIR;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    process.env.BACKUP_DIR = path.join(tmp, 'missing-backups');
    process.env.DRILL_REPORT_DIR = path.join(tmp, 'drills');
    await fs.mkdir(process.env.DRILL_REPORT_DIR);
    const freshReport = path.join(process.env.DRILL_REPORT_DIR, 'fresh-drill.json');
    await fs.writeFile(freshReport, JSON.stringify({ success: true, drill: true, backup: 'files_all_2026-06-01T00-00-00.tar.gz', verifiedAt: new Date().toISOString(), restorePlan: { dryRun: true, type: 'files', actions: ['Would restore ./index.html'] } }));
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    vi.doMock('systeminformation', () => ({
      default: {
        fsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 96, size: 1000, used: 960 }]),
        mem: vi.fn().mockResolvedValue({ total: 1000, used: 400 }),
        currentLoad: vi.fn().mockResolvedValue({ currentLoad: 20 }),
      },
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    markBusinessLaunchEvidenceVerified(db);
    db.prepare('DELETE FROM admin_users').run();
    db.prepare('DELETE FROM notification_webhooks').run();
    db.prepare('DELETE FROM alert_rules').run();
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_enabled) VALUES (?,?,?,?,?)")
      .run('admin', 'admin@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'admin', 1);
    db.prepare("INSERT INTO notification_webhooks (name, url, type, events, enabled) VALUES (?, ?, ?, ?, ?)")
      .run('ops', 'https://alerts.example.test/webhook', 'webhook', JSON.stringify(['system.disk_alert']), 1);
    db.prepare("INSERT INTO alert_rules (metric, threshold, enabled) VALUES (?, ?, ?)")
      .run('disk', 80, 1);

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.checks.monitoring.criticalAlerts).toEqual([
        { metric: 'Disk', value: 96, threshold: 80, mount: '/', message: 'Disk / usage is 96%' },
      ]);
      expect(body.launchBlockers).toEqual([
        expect.objectContaining({ code: 'critical_alerts_active', severity: 'manual', owner: 'Ron', requiredEvidence: expect.any(String), message: expect.stringMatching(/critical production alert/i) }),
        expect.objectContaining({ code: 'backup_evidence_missing', severity: 'manual', owner: 'Ron + Marcos', requiredEvidence: expect.any(String), message: expect.stringMatching(/backup archive evidence/i) }),
        expect.objectContaining({ code: 'nightly_database_backup_schedule_missing', severity: 'manual', owner: 'Ron + Marcos', requiredEvidence: expect.any(String), message: expect.stringMatching(/nightly database backup schedule/i) }),
      ]);
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
      if (prevDrillReportDir === undefined) delete process.env.DRILL_REPORT_DIR;
      else process.env.DRILL_REPORT_DIR = prevDrillReportDir;
      if (prevBackupDir === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = prevBackupDir;
    }
  });

  it('includes live self-health watchdog state in production monitoring readiness', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    vi.doMock('systeminformation', () => ({
      default: {
        fsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 10, size: 1000, used: 100 }]),
        mem: vi.fn().mockResolvedValue({ total: 1000, used: 400 }),
        currentLoad: vi.fn().mockResolvedValue({ currentLoad: 20 }),
      },
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    db.prepare("INSERT INTO notification_webhooks (name, url, type, events, enabled) VALUES (?, ?, ?, ?, ?)")
      .run('ops', 'https://alerts.example.test/webhook', 'webhook', JSON.stringify(['system.healthz_down']), 1);
    db.prepare("INSERT INTO alert_rules (metric, threshold, enabled) VALUES (?, ?, ?)")
      .run('disk', 100, 1);
    const watchdog = await import('../utils/self-health-watchdog');
    const stop = watchdog.startSelfHealthWatchdog({
      url: 'http://localhost:3001/healthz',
      intervalMs: 60000,
      failureThreshold: 3,
      dispatch: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    });

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.checks.monitoring.selfHealthWatchdog).toMatchObject({
        url: 'http://localhost:3001/healthz',
        running: true,
        consecutiveFailures: 0,
        alertDispatched: false,
      });
    } finally {
      stop();
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
    }
  });

  it('blocks production readiness when a monitored TLS certificate is near expiry', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    const prevRequiredServices = process.env.READINESS_REQUIRED_SERVICES;
    const prevCertDir = process.env.TLS_CERT_CHECK_DIR;
    const prevCertWarnDays = process.env.TLS_CERT_WARN_DAYS;
    process.env.NODE_ENV = 'production';
    process.env.READINESS_REQUIRED_SERVICES = '';
    process.env.TLS_CERT_CHECK_DIR = path.join(tmp, 'letsencrypt-live');
    process.env.TLS_CERT_WARN_DAYS = '14';
    const certPath = path.join(process.env.TLS_CERT_CHECK_DIR, 'example.com', 'fullchain.pem');
    await fs.mkdir(path.dirname(certPath), { recursive: true });
    await fs.writeFile(certPath, 'test certificate');
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication no\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;
    const notAfter = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toUTCString();
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'systemctl' && args[0] === 'is-active') return { status: 0, stdout: 'active\n' };
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        if (cmd === 'openssl' && args.includes(certPath)) return { status: 0, stdout: `notAfter=${notAfter}\n` };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    vi.doMock('systeminformation', () => ({
      default: {
        fsSize: vi.fn().mockResolvedValue([{ mount: '/', use: 10, size: 1000, used: 100 }]),
        mem: vi.fn().mockResolvedValue({ total: 1000, used: 400 }),
        currentLoad: vi.fn().mockResolvedValue({ currentLoad: 20 }),
      },
    }));

    await import('../background-jobs');
    const db = (await import('../db')).default;
    db.prepare('DELETE FROM admin_users').run();
    db.prepare('DELETE FROM notification_webhooks').run();
    db.prepare('DELETE FROM alert_rules').run();
    db.prepare("INSERT INTO admin_users (username, email, password_hash, role, totp_enabled) VALUES (?,?,?,?,?)")
      .run('admin', 'admin@test.local', '$2b$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'admin', 1);
    db.prepare("INSERT INTO notification_webhooks (name, url, type, events, enabled) VALUES (?, ?, ?, ?, ?)")
      .run('ops', 'https://alerts.example.test/webhook', 'webhook', JSON.stringify(['system.cert_expiring']), 1);
    db.prepare("INSERT INTO alert_rules (metric, threshold, enabled) VALUES (?, ?, ?)")
      .run('disk', 90, 1);

    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.checks.certificates).toMatchObject({ ok: false, warnDays: 14 });
      expect(body.checks.certificates.expiring).toEqual([
        { domain: 'example.com', file: certPath, daysLeft: 5, notAfter },
      ]);
      expect(body.launchBlockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'tls_cert_expiring', severity: 'manual', owner: 'Ron', requiredEvidence: expect.stringMatching(/Renew expiring TLS/i), message: expect.stringMatching(/example\.com.*5 days/i) }),
        ])
      );
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
      if (prevRequiredServices === undefined) delete process.env.READINESS_REQUIRED_SERVICES;
      else process.env.READINESS_REQUIRED_SERVICES = prevRequiredServices;
      if (prevCertDir === undefined) delete process.env.TLS_CERT_CHECK_DIR;
      else process.env.TLS_CERT_CHECK_DIR = prevCertDir;
      if (prevCertWarnDays === undefined) delete process.env.TLS_CERT_WARN_DAYS;
      else process.env.TLS_CERT_WARN_DAYS = prevCertWarnDays;
    }
  });

  it('blocks production readiness when SSH password authentication is enabled', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSshdConfig = process.env.SSHD_CONFIG_FILE;
    process.env.NODE_ENV = 'production';
    const sshdConfig = path.join(tmp, 'sshd_config');
    await fs.writeFile(sshdConfig, 'PasswordAuthentication yes\n');
    process.env.SSHD_CONFIG_FILE = sshdConfig;

    await import('../background-jobs');
    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.checks.security.ok).toBe(false);
      expect(body.checks.security.failures).toEqual(
        expect.arrayContaining([expect.stringMatching(/SSH password authentication is enabled/i)])
      );
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
      if (prevSshdConfig === undefined) delete process.env.SSHD_CONFIG_FILE;
      else process.env.SSHD_CONFIG_FILE = prevSshdConfig;
    }
  });

  it('blocks production readiness when a required runtime service is inactive', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    await import('../background-jobs');
    vi.doMock('child_process', () => ({
      spawnSync: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'sshd') return { status: 0, stdout: 'passwordauthentication no\n' };
        if (cmd === 'systemctl' && args[0] === 'is-active' && args[1] === 'hostpanel') return { status: 0, stdout: 'active\n' };
        if (cmd === 'systemctl' && args[0] === 'is-active' && args[1] === 'httpd') return { status: 3, stdout: 'inactive\n' };
        if (cmd === 'systemctl' && args[0] === 'is-active' && args[1] === 'mariadb') return { status: 0, stdout: 'active\n' };
        return { status: 1, stdout: '', stderr: '' };
      })
    }));
    const health = (await import('./health')).default;
    const app = express();
    app.use('/api/health', health);
    const server = await listen(app);
    try {
      const res = await fetch(`${server.url}/api/health/readiness`);
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.checks.services).toMatchObject({ ok: false });
      expect(body.checks.services.services).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'httpd', active: false })])
      );
    } finally {
      await server.close();
      process.env.NODE_ENV = prevNodeEnv;
    }
  });
});
