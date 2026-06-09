/**
 * TDD integration test: WordPress async install via background job
 */
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFile } from '../utils/process-runner';

// Mock wp-cli and child_process so no real binaries are needed
vi.mock('../utils/process-runner', () => ({
  runFile: vi.fn(async (cmd: string, args: string[]) => {
    // wp core download, config create, core install, core version
    if (cmd === 'wp' && args.includes('version')) return { stdout: '6.5.3', stderr: '' };
    if (cmd === 'wp' && args.includes('download')) return { stdout: 'Success: WordPress downloaded.', stderr: '' };
    if (cmd === 'create') return { stdout: 'Success: Generated', stderr: '' };
    if (cmd === 'wp' && args.includes('install')) return { stdout: 'Success: WordPress installed.', stderr: '' };
    if (cmd === 'find') return { stdout: '', stderr: '' };
    return { stdout: 'ok', stderr: '' };
  }),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], opts: any, cb?: Function) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (callback) callback(null, 'ok', '');
      return {} as any;
    }),
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

function waitForJob(url: string, jobId: number, maxMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = async () => {
      const r = await fetch(`${url}/api/jobs/${jobId}`);
      const d = await r.json();
      if (d.status === 'completed' || d.status === 'failed') return resolve(d);
      if (Date.now() - start > maxMs) return reject(new Error(`Job ${jobId} timed out in state ${d.status}`));
      setTimeout(poll, 100);
    };
    poll();
  });
}

describe('WordPress install background job', () => {
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(() => { vi.resetModules(); });
  afterEach(async () => { if (closeServer) { await closeServer(); closeServer = undefined; } });

  async function appForRoutes() {
    const { default: wpRoutes } = await import('./wordpress');
    const { default: jobsRoutes } = await import('./jobs');
    const app = express();
    app.use(express.json());
    app.use('/api/wordpress', wpRoutes);
    app.use('/api/jobs', jobsRoutes);
    return listen(app);
  }

  it('returns 400 when required fields are missing', async () => {
    const server = await appForRoutes(); closeServer = server.close;
    const r = await fetch(`${server.url}/api/wordpress/example.com/install`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://example.com' }), // missing adminEmail, adminPass, db*
    });
    expect(r.status).toBe(400);
    const d = await r.json();
    expect(d.error).toMatch(/required/i);
  });

  it('enqueues a wordpress.install job with async:true and completes', async () => {
    const server = await appForRoutes(); closeServer = server.close;
    const payload = {
      url: 'http://example.com',
      adminEmail: 'admin@example.com',
      adminPass: 'Str0ngP@ss!',
      dbName: 'wp_example',
      dbUser: 'wp_user',
      dbPass: 'dbpassword',
      async: true,
    };
    const r = await fetch(`${server.url}/api/wordpress/example.com/install`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(r.status).toBe(202);
    const { jobId, statusUrl } = await r.json();
    expect(typeof jobId).toBe('number');
    expect(statusUrl).toBe(`/api/jobs/${jobId}`);

    // Poll until complete
    const job = await waitForJob(server.url, jobId);
    expect(job.status).toBe('completed');
    expect(job.result?.domain).toBe('example.com');
    expect(job.result?.url).toBe('http://example.com');
    expect(job.logs.some((l: any) => l.message.includes('completed'))).toBe(true);
  });

  it('runs synchronously without async:true and returns install result', async () => {
    const server = await appForRoutes(); closeServer = server.close;
    const payload = {
      url: 'http://sync.example.com',
      adminEmail: 'admin@sync.example.com',
      adminPass: 'Str0ngP@ss!',
      dbName: 'wp_sync',
      dbUser: 'wp_sync_user',
      dbPass: 'dbpassword',
    };
    const r = await fetch(`${server.url}/api/wordpress/sync.example.com/install`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.domain).toBe('sync.example.com');
    expect(d.url).toBe('http://sync.example.com');
  });

  it('enqueues update-all as a wordpress.update_all background job and preserves exact wp-cli operations', async () => {
    const runFileMock = vi.mocked(runFile);
    runFileMock.mockClear();
    const server = await appForRoutes(); closeServer = server.close;

    const r = await fetch(`${server.url}/api/wordpress/maint.example.com/update-all`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ async: true }),
    });
    expect(r.status).toBe(202);
    const { jobId, statusUrl } = await r.json();
    expect(typeof jobId).toBe('number');
    expect(statusUrl).toBe(`/api/jobs/${jobId}`);

    const job = await waitForJob(server.url, jobId);
    expect(job.status).toBe('completed');
    expect(job.type).toBe('wordpress.update_all');
    expect(job.resource).toBe('maint.example.com');
    expect(job.result).toEqual(expect.objectContaining({ domain: 'maint.example.com' }));
    expect(runFileMock).toHaveBeenCalledWith('wp', expect.arrayContaining(['--path=/var/www/maint.example.com/public_html', '--allow-root', 'core', 'update']), expect.any(Object));
    expect(runFileMock).toHaveBeenCalledWith('wp', expect.arrayContaining(['--path=/var/www/maint.example.com/public_html', '--allow-root', 'plugin', 'update', '--all']), expect.any(Object));
    expect(runFileMock).toHaveBeenCalledWith('wp', expect.arrayContaining(['--path=/var/www/maint.example.com/public_html', '--allow-root', 'theme', 'update', '--all']), expect.any(Object));
  });

  it('enqueues a single plugin update as a wordpress.plugin_update background job when async:true', async () => {
    const runFileMock = vi.mocked(runFile);
    runFileMock.mockClear();
    const server = await appForRoutes(); closeServer = server.close;

    const r = await fetch(`${server.url}/api/wordpress/maint.example.com/plugins/akismet/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ async: true }),
    });
    expect(r.status).toBe(202);
    const { jobId, statusUrl } = await r.json();
    expect(typeof jobId).toBe('number');
    expect(statusUrl).toBe(`/api/jobs/${jobId}`);

    const job = await waitForJob(server.url, jobId);
    expect(job.status).toBe('completed');
    expect(job.type).toBe('wordpress.plugin_update');
    expect(job.resource).toBe('maint.example.com:akismet');
    expect(job.result).toEqual(expect.objectContaining({ domain: 'maint.example.com', plugin: 'akismet' }));
    expect(runFileMock).toHaveBeenCalledWith('wp', expect.arrayContaining(['--path=/var/www/maint.example.com/public_html', '--allow-root', 'plugin', 'update', 'akismet']), expect.any(Object));
  });

  it('enqueues a single theme update as a wordpress.theme_update background job when async:true', async () => {
    const runFileMock = vi.mocked(runFile);
    runFileMock.mockClear();
    const server = await appForRoutes(); closeServer = server.close;

    const r = await fetch(`${server.url}/api/wordpress/maint.example.com/themes/twentytwentyfive/update`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ async: true }),
    });
    expect(r.status).toBe(202);
    const { jobId, statusUrl } = await r.json();
    expect(typeof jobId).toBe('number');
    expect(statusUrl).toBe(`/api/jobs/${jobId}`);

    const job = await waitForJob(server.url, jobId);
    expect(job.status).toBe('completed');
    expect(job.type).toBe('wordpress.theme_update');
    expect(job.resource).toBe('maint.example.com:twentytwentyfive');
    expect(job.result).toEqual(expect.objectContaining({ domain: 'maint.example.com', theme: 'twentytwentyfive' }));
    expect(runFileMock).toHaveBeenCalledWith('wp', expect.arrayContaining(['--path=/var/www/maint.example.com/public_html', '--allow-root', 'theme', 'update', 'twentytwentyfive']), expect.any(Object));
  });
});
