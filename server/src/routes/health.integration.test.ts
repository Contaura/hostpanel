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

describe('production health and readiness checks', () => {
  let tmp = '';

  beforeEach(async () => {
    vi.resetModules();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-health-'));
    process.env.DATA_DIR = tmp;
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
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
});
