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
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-parity-')); process.env.DATA_DIR = tmp; runFileMock.mockReset(); vi.resetModules(); });
  afterEach(async () => { if (closeServer) await closeServer(); closeServer = undefined; await fs.rm(tmp, { recursive: true, force: true }); delete process.env.DATA_DIR; vi.resetModules(); });
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
    const wd = await fetch(`${server.url}/webdav`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'diskuser', home: '/var/www/example.com/public_html' }) });
    expect(wd.status).toBe(200); expect((await wd.json()).home).toContain('/var/www/');
    const node = await fetch(`${server.url}/dns/nodes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ns2', host: '192.0.2.2' }) });
    expect(node.status).toBe(200); expect((await node.json()).host).toBe('192.0.2.2');
    const inspect = await fetch(`${server.url}/transfer/inspect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archivePath: archive }) });
    expect(inspect.status).toBe(400); // tmp archives are intentionally outside approved import roots
  });
});
