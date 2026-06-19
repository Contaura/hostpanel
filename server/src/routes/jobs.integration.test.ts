import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFile } from '../utils/process-runner';

vi.mock('../utils/process-runner', () => ({
  runFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
}));

const runFileMock = vi.mocked(runFile);

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing listen address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

async function waitFor(fn: () => Promise<any>, pred: (x: any) => boolean, timeoutMs = 1500) {
  const start = Date.now();
  let last: any;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for condition; last=${JSON.stringify(last)}`);
}

describe('central background jobs API', () => {
  let tmp: string;
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    vi.resetModules();
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-jobs-'));
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.WEBROOT = path.join(tmp, 'www');
    process.env.WEBDAV_CONF_FILE = path.join(tmp, 'httpd', 'webdav.conf');
    process.env.WEBDAV_PASSWD_FILE = path.join(tmp, 'httpd', '.webdav-passwd');
    process.env.WEBDAV_ALLOWED_ROOT = path.join(tmp, 'www') + path.sep;
    process.env.PLUGIN_DIR = path.join(tmp, 'plugins');
    process.env.PLUGIN_ROLLBACK_DIR = path.join(tmp, 'plugin-rollbacks');
    process.env.TRANSFER_ROLLBACK_DIR = path.join(tmp, 'transfer-rollbacks');
    await fs.mkdir(path.join(process.env.WEBROOT, 'example.com'), { recursive: true });
    await fs.writeFile(path.join(process.env.WEBROOT, 'example.com', 'index.html'), 'ok');
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.BACKUP_DIR;
    delete process.env.WEBROOT;
    delete process.env.WEBDAV_CONF_FILE;
    delete process.env.WEBDAV_PASSWD_FILE;
    delete process.env.WEBDAV_ALLOWED_ROOT;
    delete process.env.PLUGIN_DIR;
    delete process.env.PLUGIN_ROLLBACK_DIR;
    delete process.env.TRANSFER_ROLLBACK_DIR;
    delete process.env.VHOST_DIR;
    delete process.env.DATA_DIR;
    vi.resetModules();
  });

  it('runs a file backup through the central jobs table and exposes progress/logs', async () => {
    const backup = (await import('./backup')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/backup', backup);
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    runFileMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const out = args[1];
      if (typeof out === 'string') await fs.writeFile(out, 'archive');
      return { stdout: '', stderr: '' };
    });
    const started = await fetch(`${server.url}/api/backup/create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'files', target: 'example.com', async: true }),
    });
    expect(started.status).toBe(202);
    const body = await started.json();
    expect(body.jobId).toEqual(expect.any(Number));
    expect(body.statusUrl).toBe(`/api/jobs/${body.jobId}`);

    const done = await waitFor(async () => {
      const res = await fetch(`${server.url}/api/jobs/${body.jobId}`);
      return res.json();
    }, j => j.status === 'completed');

    expect(done.type).toBe('backup.create');
    expect(done.progress).toBe(100);
    expect(done.logs.some((l: any) => l.message.includes('Backup completed'))).toBe(true);
    expect(done.result.name).toMatch(/^files_example_com_/);
    expect(runFileMock).toHaveBeenCalledWith('tar', expect.arrayContaining(['-czf']), expect.objectContaining({ timeout: 300000 }));

    const list = await fetch(`${server.url}/api/jobs?type=backup.create`);
    expect(list.status).toBe(200);
    const rows = await list.json();
    expect(rows.some((r: any) => r.id === body.jobId && r.status === 'completed')).toBe(true);
  });

  it('enqueues a disaster-recovery restore drill and persists verification evidence', async () => {
    const backup = (await import('./backup')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/backup', backup);
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    const archive = path.join(process.env.BACKUP_DIR!, 'files_all_2024-01-01T00-00-00.tar.gz');
    await fs.mkdir(path.dirname(archive), { recursive: true });
    await fs.writeFile(archive, 'archive');
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'tar' && args[0] === '-tzf') return { stdout: 'example.com/index.html\n', stderr: '' };
      throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
    });

    const started = await fetch(`${server.url}/api/backup/drill/${path.basename(archive)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ async: true }),
    });

    expect(started.status).toBe(202);
    const body = await started.json();
    const done = await waitFor(async () => (await fetch(`${server.url}/api/jobs/${body.jobId}`)).json(), j => j.status === 'completed');
    expect(done.type).toBe('backup.drill');
    expect(done.result.drill).toBe(true);
    expect(done.result.backup).toBe(path.basename(archive));
    expect(done.result.restorePlan.dryRun).toBe(true);
    expect(done.result.restorePlan.actions).toEqual(['Would restore example.com/index.html']);
    expect(done.result.archive).toEqual({ size: 7, sha256: '0eb3e36bfb24dcd9bb1d1bece1531216b59539a8fde17ee80224af0653c92aa3' });
    expect(done.result.reportPath).toMatch(/drills\/files_all_2024-01-01T00-00-00\.tar\.gz-.*\.json$/);
    const report = JSON.parse(await fs.readFile(done.result.reportPath, 'utf8'));
    expect(report.success).toBe(true);
    expect(report.restorePlan.count).toBe(1);
    expect(report.archive).toEqual({ size: 7, sha256: '0eb3e36bfb24dcd9bb1d1bece1531216b59539a8fde17ee80224af0653c92aa3' });
    expect(runFileMock).toHaveBeenCalledWith('tar', ['-tzf', archive], expect.objectContaining({ timeout: 120000 }));
  });

  it('enqueues a disaster-recovery drill for the newest backup archive automatically', async () => {
    const backup = (await import('./backup')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/backup', backup);
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    const backupDir = process.env.BACKUP_DIR!;
    await fs.mkdir(backupDir, { recursive: true });
    const olderArchive = path.join(backupDir, 'files_all_2024-01-01T00-00-00.tar.gz');
    const newestArchive = path.join(backupDir, 'files_all_2024-01-02T00-00-00.tar.gz');
    await fs.writeFile(olderArchive, 'old');
    await fs.writeFile(newestArchive, 'newest');
    await fs.utimes(olderArchive, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'));
    await fs.utimes(newestArchive, new Date('2024-01-02T00:00:00Z'), new Date('2024-01-02T00:00:00Z'));
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'tar' && args[0] === '-tzf' && args[1] === newestArchive) return { stdout: 'example.com/index.html\n', stderr: '' };
      throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`);
    });

    const started = await fetch(`${server.url}/api/backup/drill-latest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ async: true }),
    });

    expect(started.status).toBe(202);
    const body = await started.json();
    expect(body.backup).toBe(path.basename(newestArchive));
    const done = await waitFor(async () => (await fetch(`${server.url}/api/jobs/${body.jobId}`)).json(), j => j.status === 'completed');
    expect(done.type).toBe('backup.drill');
    expect(done.result.backup).toBe(path.basename(newestArchive));
    expect(done.result.restorePlan.actions).toEqual(['Would restore example.com/index.html']);
    expect(runFileMock).toHaveBeenCalledWith('tar', ['-tzf', newestArchive], expect.objectContaining({ timeout: 120000 }));
  });

  it('lists disaster-recovery drill evidence without exposing restore internals beyond the verification summary', async () => {
    const backup = (await import('./backup')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/backup', backup);
    const server = await listen(app);
    closeServer = server.close;

    const drillDir = path.join(process.env.BACKUP_DIR!, 'drills');
    await fs.mkdir(drillDir, { recursive: true });
    const oldReport = path.join(drillDir, 'files_all_old.tar.gz-2024-01-01T00-00-00-000Z.json');
    const latestReport = path.join(drillDir, 'files_all_new.tar.gz-2024-01-02T00-00-00-000Z.json');
    await fs.writeFile(oldReport, JSON.stringify({
      success: true,
      drill: true,
      backup: 'files_all_old.tar.gz',
      verifiedAt: '2024-01-01T00:00:00.000Z',
      restorePlan: { count: 1, actions: ['Would restore old.html'] },
    }));
    await fs.writeFile(latestReport, JSON.stringify({
      success: true,
      drill: true,
      backup: 'files_all_new.tar.gz',
      verifiedAt: '2024-01-02T00:00:00.000Z',
      archive: { size: 1234, sha256: 'abc123' },
      restorePlan: { count: 2, actions: ['Would restore index.html', 'Would restore app.js'], selected: ['index.html', 'app.js'] },
      accidentalSecret: 'do-not-return',
    }));

    const res = await fetch(`${server.url}/api/backup/drills`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dir).toBe(drillDir);
    expect(body.latest.backup).toBe('files_all_new.tar.gz');
    expect(body.latest.verifiedAt).toBe('2024-01-02T00:00:00.000Z');
    expect(body.latest.restorePlan).toEqual({ type: null, count: 2, dryRun: null, actionCount: 2 });
    expect(body.latest.archive).toEqual({ size: 1234, sha256: 'abc123' });
    expect(body.reports.map((r: any) => r.backup)).toEqual(['files_all_new.tar.gz', 'files_all_old.tar.gz']);
    expect(JSON.stringify(body)).not.toContain('do-not-return');
    expect(JSON.stringify(body)).not.toContain('index.html');
  });

  it('enqueues app creation as a central job and exposes the created app result', async () => {
    process.env.VHOST_DIR = path.join(tmp, 'httpd');
    process.env.DATA_DIR = path.join(tmp, 'data-app-create');
    await fs.mkdir(process.env.VHOST_DIR, { recursive: true });
    const apps = (await import('./apps')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use((_req, _res, next) => { (_req as any).user = { username: 'admin', role: 'admin' }; next(); });
    app.use('/api/apps', apps);
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    const workDir = path.join(tmp, 'apps', 'demo');
    const started = await fetch(`${server.url}/api/apps`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'demo',
        type: 'nodejs',
        domain: 'demo.example.com',
        port: 3100,
        start_script: path.join(workDir, 'server.js'),
        working_dir: workDir,
        env_vars: { NODE_ENV: 'production' },
        async: true,
      }),
    });

    expect(started.status).toBe(202);
    const body = await started.json();
    expect(body.statusUrl).toBe(`/api/jobs/${body.jobId}`);
    const done = await waitFor(async () => (await fetch(`${server.url}/api/jobs/${body.jobId}`)).json(), j => j.status === 'completed');
    expect(done.type).toBe('app.create');
    expect(done.result.name).toBe('demo');
    expect(done.result.domain).toBe('demo.example.com');
    expect(done.result.status).toBe('stopped');
    expect(await fs.readFile(path.join(process.env.VHOST_DIR, 'app_demo.conf'), 'utf8')).toContain('ProxyPass / http://127.0.0.1:3100/');
  });

  it('enqueues restore, transfer, DNS, WebDAV, and plugin operations as central jobs', async () => {
    const backup = (await import('./backup')).default;
    const transfers = (await import('./transfer-import')).default;
    const dns = (await import('./dns-cluster')).default;
    const webdav = (await import('./webdav')).default;
    const extensions = (await import('./extensions')).default;
    const jobs = (await import('./jobs')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/backup', backup);
    app.use('/api/transfer', transfers);
    app.use('/api/dns', dns);
    app.use('/api/webdav', webdav);
    app.use('/api/extensions', extensions);
    app.use('/api/jobs', jobs);
    const server = await listen(app);
    closeServer = server.close;

    const archive = path.join(process.env.BACKUP_DIR!, 'files_all_2024-01-01T00-00-00.tar.gz');
    await fs.mkdir(path.dirname(archive), { recursive: true });
    await fs.writeFile(archive, 'archive');
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'tar' && args[0] === '-tf') return { stdout: 'example.com/index.html\n', stderr: '' };
      if (cmd === 'tar' && args[0] === '-xzf') return { stdout: '', stderr: '' };
      if (cmd === 'rndc') return { stdout: 'queued', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const restore = await fetch(`${server.url}/api/backup/restore/${path.basename(archive)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ async: true }) });
    expect(restore.status).toBe(202);
    const restoreJob = await restore.json();
    const restoreDone = await waitFor(async () => (await fetch(`${server.url}/api/jobs/${restoreJob.jobId}`)).json(), j => j.status === 'completed');
    expect(restoreDone.type).toBe('backup.restore');

    const node = await fetch(`${server.url}/api/dns/nodes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ns2', host: '192.0.2.2' }) });
    expect(node.status).toBe(200);
    const sync = await fetch(`${server.url}/api/dns/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domain: 'example.com', async: true }) });
    expect(sync.status).toBe(202);
    const syncJob = await sync.json();
    const syncDone = await waitFor(async () => (await fetch(`${server.url}/api/jobs/${syncJob.jobId}`)).json(), j => j.status === 'completed');
    expect(syncDone.type).toBe('dns.sync');
    expect(syncDone.result.results[0].ok).toBe(true);

    const provision = await fetch(`${server.url}/api/webdav/provision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ async: true }) });
    expect(provision.status).toBe(202);
    const provisionJob = await provision.json();
    const provisionDone = await waitFor(async () => (await fetch(`${server.url}/api/jobs/${provisionJob.jobId}`)).json(), j => j.status === 'completed');
    expect(provisionDone.type).toBe('webdav.provision');

    const archivePath = `/var/backups/hostpanel-jobs-${Date.now()}.tar.gz`;
    await fs.mkdir('/var/backups', { recursive: true });
    await fs.writeFile(archivePath, 'fake');
    const entries = ['cpmove-demo/userdata/example.com', 'cpmove-demo/homedir/public_html/index.html'];
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'tar' && args[0] === '-tf') return { stdout: entries.join('\n') + '\n', stderr: '' };
      if (cmd === 'tar' && args[0] === '-xf') {
        const staging = args[args.indexOf('-C') + 1];
        await fs.mkdir(path.join(staging, 'cpmove-demo', 'homedir', 'public_html'), { recursive: true });
        await fs.writeFile(path.join(staging, 'cpmove-demo', 'homedir', 'public_html', 'index.html'), 'imported');
      }
      return { stdout: '', stderr: '' };
    });
    const inspect = await fetch(`${server.url}/api/transfer/inspect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archivePath }) });
    expect(inspect.status).toBe(200);
    const inspected = await inspect.json();
    const exec = await fetch(`${server.url}/api/transfer/${inspected.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, async: true, sections: { databases: false } }) });
    expect(exec.status).toBe(202);
    const execJob = await exec.json();
    const execDone = await waitFor(async () => (await fetch(`${server.url}/api/jobs/${execJob.jobId}`)).json(), j => j.status === 'completed');
    expect(execDone.type).toBe('transfer.execute');
    await fs.rm(archivePath, { force: true });

    const pluginRoot = path.join(tmp, 'sample-plugin');
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ id: 'sample-plugin', name: 'Sample Plugin' }));
    const pkg = path.join(tmp, 'sample-plugin.tgz');
    await import('child_process').then(({ execFileSync }) => execFileSync('tar', ['-czf', pkg, '-C', tmp, 'sample-plugin']));
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'tar' && args[0] === '-xzf') {
        await import('child_process').then(({ execFileSync }) => execFileSync('tar', args));
      }
      return { stdout: '', stderr: '' };
    });
    const install = await fetch(`${server.url}/api/extensions/plugins/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packagePath: pkg, async: true }) });
    expect(install.status).toBe(202);
    const installJob = await install.json();
    const installDone = await waitFor(async () => (await fetch(`${server.url}/api/jobs/${installJob.jobId}`)).json(), j => j.status === 'completed');
    expect(installDone.type).toBe('plugin.install');
    expect(installDone.result.installed).toBe(true);
  });

});
