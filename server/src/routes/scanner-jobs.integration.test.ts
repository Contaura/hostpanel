/**
 * TDD integration tests for security-scanner and apps routes
 * migrated to background jobs for long-running operations.
 *
 * Priority item #5: scans and app staging/promote become async jobs.
 */
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFile } from '../utils/process-runner';

vi.mock('../utils/process-runner', () => ({
  runFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

// apps.ts uses execFileAsync (promisify(execFile)) for pm2/cp calls.
// Mock child_process.execFile so pm2 and cp succeed without real binaries.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], opts: any, cb?: Function) => {
      // Handle both 3-arg and 4-arg call signatures (promisify passes callback as last arg)
      const callback = typeof opts === 'function' ? opts : cb;
      if (callback) callback(null, '', '');
      return {} as any;
    }),
  };
});

const runFileMock = vi.mocked(runFile);

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing listen address');
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())),
      });
    });
  });
}

async function waitFor(fn: () => Promise<any>, pred: (x: any) => boolean, timeoutMs = 2000) {
  const start = Date.now();
  let last: any;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for condition; last=${JSON.stringify(last)}`);
}

describe('security scanner background jobs', () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    vi.resetModules();
  });

  it('enqueues a malware scan as a background job and exposes progress via /api/jobs', async () => {
    runFileMock.mockReset();
    // which clamscan → found
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which') return { stdout: '/usr/bin/clamscan\n', stderr: '' };
      if (cmd === 'clamscan') return { stdout: '/var/www/example.com/malware.php: FOUND\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });

    const scanner = (await import('./security-scanner')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/scanner', scanner);
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    // POST /api/scanner/scan with async:true should return 202 + jobId
    const res = await fetch(`${server.url}/api/scanner/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: '/var/www', async: true }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.jobId).toEqual(expect.any(Number));
    expect(body.statusUrl).toBe(`/api/jobs/${body.jobId}`);

    // Poll until completed
    const done = await waitFor(
      async () => (await fetch(`${server.url}/api/jobs/${body.jobId}`)).json(),
      j => j.status === 'completed' || j.status === 'failed',
    );
    expect(done.status).toBe('completed');
    expect(done.type).toBe('scanner.scan');
    expect(done.result.infected).toEqual(expect.arrayContaining([expect.stringContaining('FOUND')]));
    expect(runFileMock).toHaveBeenCalledWith('clamscan', expect.arrayContaining(['-r', '--infected']), expect.any(Object));
  });

  it('enqueues a file integrity baseline rebuild as a background job', async () => {
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });

    const scanner = (await import('./security-scanner')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/scanner', scanner);
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    const res = await fetch(`${server.url}/api/scanner/integrity/baseline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: '/var/www', async: true }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.jobId).toEqual(expect.any(Number));
    expect(body.statusUrl).toBe(`/api/jobs/${body.jobId}`);

    const done = await waitFor(
      async () => (await fetch(`${server.url}/api/jobs/${body.jobId}`)).json(),
      j => j.status === 'completed' || j.status === 'failed',
    );
    expect(done.status).toBe('completed');
    expect(done.type).toBe('scanner.integrity_baseline');
    expect(done.result.files_indexed).toEqual(expect.any(Number));
  });
});

/** Inject a superadmin identity before the apps router to bypass adminOnly. */
function withAdminAuth(router: express.Router): express.Router {
  const wrapped = express.Router();
  wrapped.use((_req: any, _res: express.Response, next: express.NextFunction) => {
    (_req as any).user = { id: 1, role: 'superadmin', username: 'testadmin' };
    next();
  });
  wrapped.use(router);
  return wrapped;
}

describe('app staging/promote background jobs', () => {
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    vi.resetModules();
  });

  it('enqueues app staging (cp + pm2 start) as a background job and reports completion', async () => {
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });

    const apps = (await import('./apps')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/apps', withAdminAuth(apps));
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    // seed a managed_app record directly via the db
    const db = (await import('../db')).default;
    db.prepare(`INSERT OR IGNORE INTO managed_apps (name, type, domain, port, start_script, working_dir, status, env_vars)
      VALUES ('testapp','nodejs','testapp.example.com',4567,'/apps/testapp/app.js','/apps/testapp','stopped','{}')`).run();

    const res = await fetch(`${server.url}/api/apps/testapp/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 4568, branch: 'staging', async: true }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.jobId).toEqual(expect.any(Number));
    expect(body.statusUrl).toBe(`/api/jobs/${body.jobId}`);

    const done = await waitFor(
      async () => (await fetch(`${server.url}/api/jobs/${body.jobId}`)).json(),
      j => j.status === 'completed' || j.status === 'failed',
    );
    expect(done.status).toBe('completed');
    expect(done.type).toBe('app.stage');
    expect(done.result.stagingName).toBe('testapp-staging');

    // cleanup
    db.prepare('DELETE FROM managed_apps WHERE name=?').run('testapp');
    db.prepare('DELETE FROM app_staging WHERE app_name=?').run('testapp');
  });

  it('enqueues script installation as a background job and reports completion', async () => {
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });

    const tmp = await import('fs/promises').then(fs => fs.mkdtemp('/tmp/hostpanel-script-job-'));
    process.env.WEBROOT = tmp;
    vi.resetModules();

    const scripts = (await import('./scripts')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/scripts', scripts);
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    const res = await fetch(`${server.url}/api/scripts/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: 'laravel', domain: 'async-install.example.com', async: true }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.jobId).toEqual(expect.any(Number));
    expect(body.statusUrl).toBe(`/api/jobs/${body.jobId}`);

    const done = await waitFor(
      async () => (await fetch(`${server.url}/api/jobs/${body.jobId}`)).json(),
      j => j.status === 'completed' || j.status === 'failed',
    );
    expect(done.status).toBe('completed');
    expect(done.type).toBe('script.install');
    expect(done.result.url).toBe('http://async-install.example.com');
    expect(done.result.installPath).toContain('async-install.example.com/public_html');
    expect(runFileMock).toHaveBeenCalledWith('composer', expect.arrayContaining(['create-project', 'laravel/laravel']), expect.objectContaining({ timeout: 300000 }));

    await import('fs/promises').then(fs => fs.rm(tmp, { recursive: true, force: true }));
    delete process.env.WEBROOT;
  });

  it('keeps script installation synchronous when form payload sends async as false string', async () => {
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });

    const tmp = await import('fs/promises').then(fs => fs.mkdtemp('/tmp/hostpanel-script-sync-'));
    process.env.WEBROOT = tmp;
    vi.resetModules();

    const scripts = (await import('./scripts')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/scripts', scripts);
    const server = await listen(app);
    closeServer = server.close;

    const res = await fetch(`${server.url}/api/scripts/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: 'laravel', domain: 'sync-install.example.com', async: 'false' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('http://sync-install.example.com');
    expect(body.installPath).toContain('sync-install.example.com/public_html');
    expect(body).not.toHaveProperty('jobId');
    expect(runFileMock).toHaveBeenCalledWith('composer', expect.arrayContaining(['create-project', 'laravel/laravel']), expect.objectContaining({ timeout: 300000 }));

    await import('fs/promises').then(fs => fs.rm(tmp, { recursive: true, force: true }));
    delete process.env.WEBROOT;
  });

  it('enqueues app promote (rsync + pm2 restart) as a background job', async () => {
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });

    const apps = (await import('./apps')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/apps', withAdminAuth(apps));
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    const db = (await import('../db')).default;
    db.prepare(`INSERT OR IGNORE INTO managed_apps (name, type, domain, port, start_script, working_dir, status, env_vars)
      VALUES ('promoteapp','nodejs','promoteapp.example.com',5000,'/apps/promoteapp/app.js','/apps/promoteapp','running','{}')`).run();
    db.prepare(`INSERT OR IGNORE INTO app_staging (app_name, staging_name, staging_port, staging_dir, branch, status)
      VALUES ('promoteapp','promoteapp-staging',5001,'/apps/promoteapp-staging','staging','running')`).run();

    const res = await fetch(`${server.url}/api/apps/promoteapp/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.jobId).toEqual(expect.any(Number));

    const done = await waitFor(
      async () => (await fetch(`${server.url}/api/jobs/${body.jobId}`)).json(),
      j => j.status === 'completed' || j.status === 'failed',
    );
    expect(done.status).toBe('completed');
    expect(done.type).toBe('app.promote');
    expect(done.result.appName).toBe('promoteapp');
    expect(runFileMock).toHaveBeenCalledWith('rsync', expect.arrayContaining(['-a', '--delete']));

    // cleanup
    db.prepare('DELETE FROM managed_apps WHERE name=?').run('promoteapp');
    db.prepare('DELETE FROM app_staging WHERE app_name=?').run('promoteapp');
  });
});
