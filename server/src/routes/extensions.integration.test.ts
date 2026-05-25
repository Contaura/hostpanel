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
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing listen address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

describe('extensions and update parity foundation', () => {
  let tmp: string; let closeServer: (() => Promise<void>) | undefined;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-extensions-')); process.env.PLUGIN_DIR = path.join(tmp, 'plugins'); process.env.PLUGIN_ROLLBACK_DIR = path.join(tmp, 'rollbacks'); await fs.mkdir(path.join(process.env.PLUGIN_DIR, 'sample'), { recursive: true }); await fs.writeFile(path.join(process.env.PLUGIN_DIR, 'sample', 'plugin.json'), JSON.stringify({ id: 'sample', name: 'Sample', version: '1.0.0', enabled: true })); runFileMock.mockReset(); vi.resetModules(); });
  afterEach(async () => { if (closeServer) await closeServer(); closeServer = undefined; await fs.rm(tmp, { recursive: true, force: true }); delete process.env.PLUGIN_DIR; delete process.env.PLUGIN_ROLLBACK_DIR; vi.resetModules(); });
  async function appForRoutes() { const route = (await import('./extensions')).default; const app = express(); app.use(express.json()); app.use('/api/extensions', route); return listen(app); }

  it('reports update status and installed plugin manifests', async () => {
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'rev-parse') return { stdout: 'abc123\n', stderr: '' };
      if (cmd === 'git' && args[0] === 'ls-remote') return { stdout: 'def456\trefs/heads/master\n', stderr: '' };
      return { stdout: '{}\n', stderr: '' };
    });
    const server = await appForRoutes(); closeServer = server.close;
    const updates: any = await (await fetch(`${server.url}/api/extensions/updates`)).json();
    expect(updates.currentRevision).toBe('abc123');
    expect(updates.remoteRevision).toBe('def456');
    const plugins: any = await (await fetch(`${server.url}/api/extensions/plugins`)).json();
    expect(plugins.plugins[0]).toMatchObject({ name: 'Sample', version: '1.0.0' });
  });

  it('installs signed plugin packages, toggles state with rollback, and restores rollback', async () => {
    const pkgRoot = path.join(tmp, 'pkg', 'sample');
    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.writeFile(path.join(pkgRoot, 'plugin.json'), JSON.stringify({ id: 'sample', name: 'Sample', version: '2.0.0', enabled: true }));
    await fs.writeFile(path.join(pkgRoot, 'index.js'), 'module.exports = {};');
    const packagePath = path.join(tmp, 'sample.tgz');
    await import('node:child_process').then(({ execFileSync }) => execFileSync('tar', ['-czf', packagePath, '-C', path.join(tmp, 'pkg'), 'sample']));
    const crypto = await import('node:crypto');
    const pkgBuf = await fs.readFile(packagePath);
    const sha = crypto.createHash('sha256').update(pkgBuf).digest('hex');
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'tar' && args[0] === '-xzf') {
        await import('node:child_process').then(({ execFileSync }) => execFileSync('tar', args));
      }
      return { stdout: '', stderr: '' };
    });
    const server = await appForRoutes(); closeServer = server.close;
    const bad = await fetch(`${server.url}/api/extensions/plugins/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packagePath, sha256: 'bad' }) });
    expect(bad.status).toBe(400);
    const installed = await fetch(`${server.url}/api/extensions/plugins/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packagePath, sha256: sha }) });
    expect(installed.status).toBe(200);
    expect((await installed.json()).plugin).toMatchObject({ id: 'sample', version: '2.0.0', enabled: true, signed: true });
    const disabled = await fetch(`${server.url}/api/extensions/plugins/sample/disable`, { method: 'POST' });
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).plugin.enabled).toBe(false);
    const rollback = await fetch(`${server.url}/api/extensions/plugins/sample/rollback`, { method: 'POST' });
    expect(rollback.status).toBe(200);
    expect((await rollback.json()).plugin.version).toBe('2.0.0');
    const listed = await fetch(`${server.url}/api/extensions/plugins`);
    const body: any = await listed.json();
    expect(body.rollbacks.length).toBeGreaterThan(0);
  });
});
