import express from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn((p: unknown) => {
      if (p === '/usr/local/bin/pm2' || p === '/usr/bin/pm2') return true;
      return actual.existsSync(p as any);
    }),
  };
});

const execFileMock = vi.fn((cmd: string, args: string[], cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
  cb(null, '', '');
});

vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('../utils/process-runner', () => ({ runFile: vi.fn(async () => ({ stdout: '', stderr: '' })) }));

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing listen address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

async function waitForJob(db: any, id: number) {
  for (let i = 0; i < 20; i += 1) {
    const row = db.prepare('SELECT * FROM background_jobs WHERE id=?').get(id);
    if (row?.status === 'completed' || row?.status === 'failed') return row;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return db.prepare('SELECT * FROM background_jobs WHERE id=?').get(id);
}

describe('app control background jobs', () => {
  let tmp = '';
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-app-jobs-'));
    process.env.DATA_DIR = tmp;
    vi.resetModules();
    execFileMock.mockClear();
  });

  afterEach(async () => {
    if (closeServer) { await closeServer(); closeServer = undefined; }
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    vi.resetModules();
  });

  it('enqueues app start as a background job when async is requested', async () => {
    const appsRoute = (await import('./apps')).default;
    const db = (await import('../db')).default;
    db.prepare("INSERT INTO managed_apps (name,type,domain,port,start_script,working_dir,status,env_vars) VALUES (?,?,?,?,?,?,?,?)")
      .run('api', 'nodejs', 'api.example.test', 3002, '/srv/api/server.js', '/srv/api', 'stopped', JSON.stringify({ NODE_ENV: 'production' }));

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { username: 'admin', role: 'admin' }; next(); });
    app.use('/api/apps', appsRoute);
    const server = await listen(app); closeServer = server.close;

    const res = await fetch(`${server.url}/api/apps/api/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ async: true }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ statusUrl: expect.stringMatching(/^\/api\/jobs\/\d+$/) });

    const job = await waitForJob(db, body.jobId);
    expect(job.status).toBe('completed');
    expect(job.type).toBe('app.start');
    expect(job.resource).toBe('api');
    expect(db.prepare('SELECT status FROM managed_apps WHERE name=?').get('api')).toMatchObject({ status: 'running' });
    expect(execFileMock).toHaveBeenCalledWith('pm2', ['start', '/srv/api/server.js', '--name', 'api', '--env-var', 'NODE_ENV=production', '--cwd', '/srv/api'], expect.any(Function));
  });
});
