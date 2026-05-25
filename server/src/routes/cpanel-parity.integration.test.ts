import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runFile } from '../utils/process-runner';

vi.mock('../utils/process-runner', () => ({ runFile: vi.fn(async () => ({ stdout: '', stderr: '' })) }));
const runFileMock = vi.mocked(runFile);

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('Missing address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

describe('cPanel parity control-plane routes', () => {
  let tmp = ''; let closeServer: (() => Promise<void>) | undefined;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-parity-')); process.env.DATA_DIR = tmp; process.env.WEBDAV_CONF_FILE = path.join(tmp, 'httpd', 'hostpanel-webdav.conf'); process.env.WEBDAV_PASSWD_FILE = path.join(tmp, 'httpd', '.hostpanel-webdav-passwd'); process.env.WEBDAV_ALLOWED_ROOT = path.join(tmp, 'www') + path.sep; process.env.WEBROOT = path.join(tmp, 'www'); process.env.TRANSFER_ROLLBACK_DIR = path.join(tmp, 'rollbacks'); runFileMock.mockReset(); vi.resetModules(); });
  afterEach(async () => { if (closeServer) await closeServer(); closeServer = undefined; await fs.rm(tmp, { recursive: true, force: true }); delete process.env.DATA_DIR; delete process.env.WEBDAV_CONF_FILE; delete process.env.WEBDAV_PASSWD_FILE; delete process.env.WEBDAV_ALLOWED_ROOT; delete process.env.WEBROOT; delete process.env.TRANSFER_ROLLBACK_DIR; vi.resetModules(); });
  async function appForRoutes() {
    const team = (await import('./team-users')).default;
    const webdav = (await import('./webdav')).default;
    const dns = (await import('./dns-cluster')).default;
    const transfers = (await import('./transfer-import')).default;
    const app = express(); app.use(express.json()); app.use('/team', team); app.use('/webdav', webdav); app.use('/dns', dns); app.use('/transfer', transfers); return listen(app);
  }

  it('creates team users, WebDAV accounts, DNS nodes, and transfer dry-run reports', async () => {
    runFileMock.mockResolvedValue({ stdout: 'archive/userdata/example.com\narchive/mysql/app.sql\n', stderr: '' });
    const archive = path.join(tmp, 'cpmove-user.tar.gz'); await fs.writeFile(archive, 'fake');
    const server = await appForRoutes(); closeServer = server.close;
    const team = await fetch(`${server.url}/team`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'helper1', email: 'helper@example.com', password: 'password123', permissions: ['files','webdav','invalid'] }) });
    expect(team.status).toBe(200); expect((await team.json()).permissions).toEqual(['files','webdav']);
    const webdavHome = path.join(tmp, 'www', 'example.com', 'public_html');
    const wd = await fetch(`${server.url}/webdav`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'diskuser', password: 'password123', home: webdavHome, permissions: 'ro' }) });
    expect(wd.status).toBe(200); expect((await wd.json()).home).toContain('/www/');
    const conf = await fs.readFile(process.env.WEBDAV_CONF_FILE!, 'utf8');
    expect(conf).toContain('DAV On');
    expect(conf).toContain('Require user diskuser');
    expect(conf).toContain('<LimitExcept GET OPTIONS PROPFIND>');
    const passwd = await fs.readFile(process.env.WEBDAV_PASSWD_FILE!, 'utf8');
    expect(passwd).toMatch(/^diskuser:/);
    const node = await fetch(`${server.url}/dns/nodes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ns2', host: '192.0.2.2', tsig_name: 'cluster-key', tsig_secret: 'ZmFrZS1jbHVzdGVyLXNlY3JldA==' }) });
    expect(node.status).toBe(200);
    const nodeBody = await node.json();
    expect(nodeBody.host).toBe('192.0.2.2');
    expect(nodeBody.authenticated).toBe(true);
    expect(nodeBody.tsig_secret).toBeUndefined();
    const preview = await fetch(`${server.url}/dns/sync-preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domain: 'example.com' }) });
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.actions[0].command).toContain('<managed-key-file>');
    expect(previewBody.actions[0].command).not.toContain('ZmFrZS1jbHVzdGVy');
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'rndc') {
        const keyFile = args[args.indexOf('-k') + 1];
        expect(await fs.readFile(keyFile, 'utf8')).toContain('cluster-key');
        expect(await fs.readFile(keyFile, 'utf8')).toContain('ZmFrZS1jbHVzdGVyLXNlY3JldA==');
      }
      return { stdout: 'queued', stderr: '' };
    });
    const sync = await fetch(`${server.url}/dns/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domain: 'example.com' }) });
    expect(sync.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('rndc', expect.arrayContaining(['-s', '192.0.2.2', '-k', expect.any(String), 'retransfer', 'example.com']), expect.objectContaining({ timeout: 120000 }));
    expect(JSON.stringify(await sync.json())).not.toContain('ZmFrZS1jbHVzdGVy');
    const inspect = await fetch(`${server.url}/transfer/inspect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archivePath: archive }) });
    expect(inspect.status).toBe(400); // tmp archives are intentionally outside approved import roots
  });

  it('executes cPanel transfer import with file rollback and progress report', async () => {
    const archive = `/var/backups/hostpanel-test-${Date.now()}.tar.gz`;
    await fs.mkdir('/var/backups', { recursive: true });
    await fs.writeFile(archive, 'fake');
    const entries = [
      'cpmove-demo/userdata/example.com',
      'cpmove-demo/homedir/public_html/index.html',
      'cpmove-demo/mysql/demo_app.sql',
    ];
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'tar' && args[0] === '-tf') return { stdout: entries.join('\n') + '\n', stderr: '' };
      if (cmd === 'tar' && args[0] === '-xf') {
        const staging = args[args.indexOf('-C') + 1];
        await fs.mkdir(path.join(staging, 'cpmove-demo', 'homedir', 'public_html'), { recursive: true });
        await fs.mkdir(path.join(staging, 'cpmove-demo', 'mysql'), { recursive: true });
        await fs.writeFile(path.join(staging, 'cpmove-demo', 'homedir', 'public_html', 'index.html'), 'imported');
        await fs.writeFile(path.join(staging, 'cpmove-demo', 'mysql', 'demo_app.sql'), '-- sql');
        return { stdout: '', stderr: '' };
      }
      if (cmd === 'mysql') return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const server = await appForRoutes(); closeServer = server.close;
    const inspect = await fetch(`${server.url}/transfer/inspect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archivePath: archive }) });
    expect(inspect.status).toBe(200);
    const inspected = await inspect.json();
    expect(inspected.report.executable).toBe(true);
    const existing = path.join(process.env.WEBROOT!, 'example.com', 'public_html');
    await fs.mkdir(existing, { recursive: true });
    await fs.writeFile(path.join(existing, 'old.html'), 'old');
    const exec = await fetch(`${server.url}/transfer/${inspected.id}/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, sections: { databases: false } }) });
    expect(exec.status).toBe(200);
    const body = await exec.json();
    expect(body.status).toBe('completed');
    await expect(fs.readFile(path.join(existing, 'index.html'), 'utf8')).resolves.toBe('imported');
    const db = (await import('../db')).default;
    const account = db.prepare('SELECT username,domain FROM accounts WHERE domain=?').get('example.com') as any;
    expect(account.username).toBe('demo');
    const progress = await fetch(`${server.url}/transfer/${inspected.id}`);
    expect((await progress.json()).report.steps.some((s: any) => s.step === 'files-restored')).toBe(true);
    await fs.rm(archive, { force: true });
  });
});
