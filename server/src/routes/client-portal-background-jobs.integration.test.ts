/**
 * TDD integration test: client portal long operations can run via central background jobs.
 */
import express from 'express';
import jwt from 'jsonwebtoken';
import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/process-runner', () => ({
  runFile: vi.fn(async (cmd: string, args: string[]) => {
    if (cmd === 'clamscan') {
      return { stdout: `${args[args.length - 1]}/index.php: Eicar-Test-Signature FOUND\n`, stderr: '' };
    }
    return { stdout: 'ok', stderr: '' };
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (p: Parameters<typeof actual.existsSync>[0]) => p === '/usr/bin/clamscan' ? true : actual.existsSync(p),
  };
});

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('no address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

async function waitForJob(url: string, jobId: number, maxMs = 5000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const r = await fetch(`${url}/api/jobs/${jobId}`);
    const d = await r.json();
    if (d.status === 'completed' || d.status === 'failed') return d;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Job ${jobId} timed out`);
}

describe('client portal background jobs', () => {
  let tmp = '';
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(() => {
    vi.resetModules();
    tmp = mkdtempSync(path.join(os.tmpdir(), 'hostpanel-portal-bg-'));
    process.env.DATA_DIR = path.join(tmp, 'data');
    process.env.WEBROOT = path.join(tmp, 'www');
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(async () => {
    if (closeServer) { await closeServer(); closeServer = undefined; }
    rmSync(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.WEBROOT;
    delete process.env.JWT_SECRET;
  });

  async function appForRoutes() {
    const { default: db } = await import('../db');
    db.prepare(`INSERT INTO clients (id, name, email, portal_enabled) VALUES (1, 'Client', 'client@example.com', 1)`).run();
    db.prepare(`INSERT INTO accounts (id, username, domain, client_id, status) VALUES (1, 'client', 'example.com', 1, 'active')`).run();

    const { default: portalRoutes } = await import('./client-portal');
    const { default: jobsRoutes } = await import('./jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/portal', portalRoutes);
    app.use('/api/jobs', jobsRoutes);
    return listen(app);
  }

  it('enqueues client portal security scans with async:true and exposes scan results through jobs', async () => {
    const server = await appForRoutes(); closeServer = server.close;
    const token = jwt.sign({ clientId: 1, email: 'client@example.com', role: 'client' }, process.env.JWT_SECRET!);

    const r = await fetch(`${server.url}/api/portal/security-scan/example.com`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ async: true }),
    });

    expect(r.status).toBe(202);
    const body = await r.json();
    expect(body.statusUrl).toBe(`/api/jobs/${body.jobId}`);

    const job = await waitForJob(server.url, body.jobId);
    expect(job.status).toBe('completed');
    expect(job.type).toBe('portal.security_scan');
    expect(job.result.infected_count).toBe(1);
    expect(job.result.infected[0]).toContain('Eicar-Test-Signature FOUND');
  });
});
