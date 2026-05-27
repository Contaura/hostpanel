/**
 * Monitoring / alerting integration tests
 *
 * Verifies that when metric thresholds are breached the alerts route:
 *  1. Returns a populated alerts array with the correct severity/metric fields.
 *  2. Dispatches a webhook event via dispatchNotification so registered
 *     webhooks receive the signal (not just the in-process SMTP path).
 *  3. Does NOT dispatch when all metrics are below their thresholds.
 */
import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('systeminformation', () => ({
  default: {
    currentLoad: vi.fn(),
    mem: vi.fn(),
    fsSize: vi.fn(),
  },
}));

// Spy on dispatchNotification from notifications route so we can assert calls.
vi.mock('./notifications', () => ({
  dispatchNotification: vi.fn(),
  default: (() => {
    const r = require('express').Router();
    return r;
  })(),
}));

// nodemailer transport is a network call — stub it out
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing listen address');
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res()))),
      });
    });
  });
}

describe('alerts route — webhook dispatch on threshold breach', () => {
  let tmp = '';
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    vi.resetModules();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-alerts-'));
    process.env.DATA_DIR = tmp;
  });

  afterEach(async () => {
    if (closeServer) { await closeServer(); closeServer = undefined; }
    vi.clearAllMocks();
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    vi.resetModules();
  });

  async function buildApp() {
    const alertsRoute = (await import('./alerts')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/alerts', alertsRoute);
    return listen(app);
  }

  it('dispatches system.cpu_alert when CPU rule threshold is exceeded', async () => {
    const si = (await import('systeminformation')).default as any;
    si.currentLoad.mockResolvedValue({ currentLoad: 95 });
    si.mem.mockResolvedValue({ used: 1e9, total: 8e9 });
    si.fsSize.mockResolvedValue([{ mount: '/', use: 40, size: 100e9, used: 40e9 }]);

    const { dispatchNotification } = await import('./notifications');

    // seed a CPU rule at 80%
    const db = (await import('../db')).default;
    db.prepare('INSERT INTO alert_rules (metric, threshold, notify_email, enabled) VALUES (?, ?, ?, 1)').run('cpu', 80, '');

    const server = await buildApp(); closeServer = server.close;
    const res = await fetch(`${server.url}/api/alerts/current`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.alerts.length).toBeGreaterThanOrEqual(1);
    const cpuAlert = body.alerts.find((a: any) => a.metric === 'CPU');
    expect(cpuAlert).toBeDefined();
    expect(cpuAlert.value).toBe(95);

    expect(dispatchNotification).toHaveBeenCalledWith(
      'system.cpu_alert',
      expect.objectContaining({ value: 95, threshold: 80 }),
    );
  });

  it('dispatches system.memory_alert when memory rule threshold is exceeded', async () => {
    const si = (await import('systeminformation')).default as any;
    si.currentLoad.mockResolvedValue({ currentLoad: 10 });
    // memory at ~90% used
    si.mem.mockResolvedValue({ used: 7.2e9, total: 8e9 });
    si.fsSize.mockResolvedValue([{ mount: '/', use: 40, size: 100e9, used: 40e9 }]);

    const { dispatchNotification } = await import('./notifications');

    const db = (await import('../db')).default;
    db.prepare('INSERT INTO alert_rules (metric, threshold, notify_email, enabled) VALUES (?, ?, ?, 1)').run('memory', 85, '');

    const server = await buildApp(); closeServer = server.close;
    const res = await fetch(`${server.url}/api/alerts/current`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const memAlert = body.alerts.find((a: any) => a.metric === 'Memory');
    expect(memAlert).toBeDefined();

    expect(dispatchNotification).toHaveBeenCalledWith(
      'system.memory_alert',
      expect.objectContaining({ threshold: 85 }),
    );
  });

  it('dispatches system.disk_alert when disk rule threshold is exceeded', async () => {
    const si = (await import('systeminformation')).default as any;
    si.currentLoad.mockResolvedValue({ currentLoad: 10 });
    si.mem.mockResolvedValue({ used: 1e9, total: 8e9 });
    si.fsSize.mockResolvedValue([{ mount: '/', use: 92, size: 100e9, used: 92e9 }]);

    const { dispatchNotification } = await import('./notifications');

    const db = (await import('../db')).default;
    db.prepare('INSERT INTO alert_rules (metric, threshold, notify_email, enabled) VALUES (?, ?, ?, 1)').run('disk', 90, '');

    const server = await buildApp(); closeServer = server.close;
    const res = await fetch(`${server.url}/api/alerts/current`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const diskAlert = body.alerts.find((a: any) => a.metric === 'Disk');
    expect(diskAlert).toBeDefined();

    expect(dispatchNotification).toHaveBeenCalledWith(
      'system.disk_alert',
      expect.objectContaining({ mount: '/', threshold: 90 }),
    );
  });

  it('does NOT dispatch notifications when all metrics are below thresholds', async () => {
    const si = (await import('systeminformation')).default as any;
    si.currentLoad.mockResolvedValue({ currentLoad: 20 });
    si.mem.mockResolvedValue({ used: 1e9, total: 8e9 });
    si.fsSize.mockResolvedValue([{ mount: '/', use: 30, size: 100e9, used: 30e9 }]);

    const { dispatchNotification } = await import('./notifications');

    const db = (await import('../db')).default;
    db.prepare('INSERT INTO alert_rules (metric, threshold, notify_email, enabled) VALUES (?, ?, ?, 1)').run('cpu', 80, '');
    db.prepare('INSERT INTO alert_rules (metric, threshold, notify_email, enabled) VALUES (?, ?, ?, 1)').run('memory', 85, '');
    db.prepare('INSERT INTO alert_rules (metric, threshold, notify_email, enabled) VALUES (?, ?, ?, 1)').run('disk', 90, '');

    const server = await buildApp(); closeServer = server.close;
    const res = await fetch(`${server.url}/api/alerts/current`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.alerts).toHaveLength(0);
    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it('includes severity field (warning vs critical) in dispatched payload', async () => {
    const si = (await import('systeminformation')).default as any;
    si.currentLoad.mockResolvedValue({ currentLoad: 97 }); // critical >= 95
    si.mem.mockResolvedValue({ used: 1e9, total: 8e9 });
    si.fsSize.mockResolvedValue([{ mount: '/', use: 30, size: 100e9, used: 30e9 }]);

    const { dispatchNotification } = await import('./notifications');

    const db = (await import('../db')).default;
    db.prepare('INSERT INTO alert_rules (metric, threshold, notify_email, enabled) VALUES (?, ?, ?, 1)').run('cpu', 80, '');

    const server = await buildApp(); closeServer = server.close;
    await fetch(`${server.url}/api/alerts/current`);

    expect(dispatchNotification).toHaveBeenCalledWith(
      'system.cpu_alert',
      expect.objectContaining({ severity: 'critical' }),
    );
  });
});
