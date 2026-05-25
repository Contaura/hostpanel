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
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-extensions-')); process.env.PLUGIN_DIR = path.join(tmp, 'plugins'); await fs.mkdir(path.join(process.env.PLUGIN_DIR, 'sample'), { recursive: true }); await fs.writeFile(path.join(process.env.PLUGIN_DIR, 'sample', 'plugin.json'), JSON.stringify({ name: 'Sample', version: '1.0.0', enabled: true })); runFileMock.mockReset(); vi.resetModules(); });
  afterEach(async () => { if (closeServer) await closeServer(); closeServer = undefined; await fs.rm(tmp, { recursive: true, force: true }); delete process.env.PLUGIN_DIR; vi.resetModules(); });
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
});
