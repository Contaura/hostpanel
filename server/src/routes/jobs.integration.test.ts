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
    await fs.mkdir(path.join(process.env.WEBROOT, 'example.com'), { recursive: true });
    await fs.writeFile(path.join(process.env.WEBROOT, 'example.com', 'index.html'), 'ok');
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.BACKUP_DIR;
    delete process.env.WEBROOT;
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
});
