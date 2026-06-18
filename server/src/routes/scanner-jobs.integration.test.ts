/**
 * TDD integration tests for security-scanner and apps routes
 * migrated to background jobs for long-running operations.
 *
 * Priority item #5: scans and app staging/promote become async jobs.
 */
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, unlinkSync, writeFileSync } from 'fs';
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
const fakePm2Path = '/usr/local/bin/pm2';
let createdFakePm2 = false;

function ensurePm2PresentForMockedExecFile() {
  if (existsSync(fakePm2Path)) return;
  writeFileSync(fakePm2Path, '#!/bin/sh\nexit 0\n');
  chmodSync(fakePm2Path, 0o755);
  createdFakePm2 = true;
}

function cleanupFakePm2() {
  if (!createdFakePm2) return;
  try { unlinkSync(fakePm2Path); } catch (_) {}
  createdFakePm2 = false;
}

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
    cleanupFakePm2();
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

  it('enqueues a ClamAV definition update as a background job and exposes output', async () => {
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: 'daily.cvd updated\n', stderr: 'freshclam warning\n' });

    const scanner = (await import('./security-scanner')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/scanner', scanner);
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    const res = await fetch(`${server.url}/api/scanner/update-definitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true }),
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
    expect(done.type).toBe('scanner.update_definitions');
    expect(done.result.output).toContain('daily.cvd updated');
    expect(runFileMock).toHaveBeenCalledWith('freshclam', [], { timeout: 120000 });
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
    cleanupFakePm2();
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

  it('keeps app staging synchronous when form payload sends async as false string', async () => {
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });

    const apps = (await import('./apps')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/apps', withAdminAuth(apps));
    const server = await listen(app);
    closeServer = server.close;

    const db = (await import('../db')).default;
    db.prepare(`INSERT OR IGNORE INTO managed_apps (name, type, domain, port, start_script, working_dir, status, env_vars)
      VALUES ('syncstage','nodejs','syncstage.example.com',5567,'/apps/syncstage/app.js','/apps/syncstage','stopped','{}')`).run();

    const res = await fetch(`${server.url}/api/apps/syncstage/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ port: 5568, branch: 'staging', async: 'false' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staging_name).toBe('syncstage-staging');
    expect(body).not.toHaveProperty('jobId');

    db.prepare('DELETE FROM managed_apps WHERE name=?').run('syncstage');
    db.prepare('DELETE FROM app_staging WHERE app_name=?').run('syncstage');
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

  it('records the authenticated admin on app create background jobs', async () => {
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });

    const tmp = await import('fs/promises').then(fs => fs.mkdtemp('/tmp/hostpanel-app-create-job-'));
    process.env.VHOST_DIR = tmp;
    vi.resetModules();

    const apps = (await import('./apps')).default;
    const jobs = (await import('./jobs')).default;
    const db = (await import('../db')).default;
    db.prepare('DELETE FROM managed_apps WHERE name=?').run('auditcreate');
    const app = express();
    app.use(express.json());
    app.use('/api/apps', withAdminAuth(apps));
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    const res = await fetch(`${server.url}/api/apps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'auditcreate',
        type: 'nodejs',
        domain: 'auditcreate.example.com',
        port: 5012,
        start_script: '/apps/auditcreate/app.js',
        working_dir: '/apps/auditcreate',
        async: true,
      }),
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
    expect(done.type).toBe('app.create');
    expect(done.created_by).toBe('testadmin');
    expect(done.metadata).toMatchObject({ appName: 'auditcreate', domain: 'auditcreate.example.com' });
    expect(done.result).toMatchObject({ name: 'auditcreate', domain: 'auditcreate.example.com' });

    db.prepare('DELETE FROM managed_apps WHERE name=?').run('auditcreate');
    await import('fs/promises').then(fs => fs.rm(tmp, { recursive: true, force: true }));
    delete process.env.VHOST_DIR;
  });

  it('enqueues app stop as a background job and reports completion', async () => {
    ensurePm2PresentForMockedExecFile();
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
      VALUES ('stopapp','nodejs','stopapp.example.com',5003,'/apps/stopapp/app.js','/apps/stopapp','running','{}')`).run();

    const res = await fetch(`${server.url}/api/apps/stopapp/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true }),
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
    expect(done.type).toBe('app.stop');
    expect(done.result).toMatchObject({ success: true, appName: 'stopapp' });
    expect(db.prepare('SELECT status FROM managed_apps WHERE name=?').get('stopapp')).toMatchObject({ status: 'stopped' });

    db.prepare('DELETE FROM managed_apps WHERE name=?').run('stopapp');
  });

  it('enqueues app restart as a background job and reports completion', async () => {
    ensurePm2PresentForMockedExecFile();
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
      VALUES ('restartapp','nodejs','restartapp.example.com',5004,'/apps/restartapp/app.js','/apps/restartapp','running','{}')`).run();

    const res = await fetch(`${server.url}/api/apps/restartapp/restart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true }),
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
    expect(done.type).toBe('app.restart');
    expect(done.result).toMatchObject({ success: true, appName: 'restartapp' });

    db.prepare('DELETE FROM managed_apps WHERE name=?').run('restartapp');
  });

  it('enqueues app deletion (pm2 delete + vhost cleanup) as a background job', async () => {
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
      VALUES ('deleteapp','nodejs','deleteapp.example.com',5002,'/apps/deleteapp/app.js','/apps/deleteapp','running','{}')`).run();

    const res = await fetch(`${server.url}/api/apps/deleteapp`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true }),
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
    expect(done.type).toBe('app.delete');
    expect(done.result).toMatchObject({ success: true, appName: 'deleteapp' });
    expect(db.prepare('SELECT * FROM managed_apps WHERE name=?').get('deleteapp')).toBeUndefined();
  });

  it('enqueues staging environment deletion as a background job', async () => {
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
      VALUES ('stagecleanup','nodejs','stagecleanup.example.com',5010,'/apps/stagecleanup/app.js','/apps/stagecleanup','running','{}')`).run();
    db.prepare(`INSERT OR IGNORE INTO app_staging (app_name, staging_name, staging_port, staging_dir, branch, status)
      VALUES ('stagecleanup','stagecleanup-staging',5011,'/apps/stagecleanup-staging','staging','running')`).run();

    const res = await fetch(`${server.url}/api/apps/stagecleanup/staging`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true }),
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
    expect(done.type).toBe('app.staging_delete');
    expect(done.result).toMatchObject({ success: true, appName: 'stagecleanup', stagingName: 'stagecleanup-staging' });
    expect(db.prepare('SELECT * FROM app_staging WHERE app_name=?').get('stagecleanup')).toBeUndefined();

    db.prepare('DELETE FROM managed_apps WHERE name=?').run('stagecleanup');
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
