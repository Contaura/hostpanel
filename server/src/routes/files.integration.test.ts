import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateToken, readonlyGuard } from '../middleware/auth';

const JWT_SECRET = 'test-secret';
process.env.JWT_SECRET = JWT_SECRET;

function token(role: string) {
  return jwt.sign({ username: `${role}-user`, role }, JWT_SECRET, { algorithm: 'HS256' });
}

async function makeFileApp(baseDir: string) {
  process.env.FILES_BASE_DIR = baseDir;
  vi.resetModules();
  const fileRoutes = (await import('./files')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/files', readonlyGuard, authenticateToken, fileRoutes);
  return app;
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

describe('/api/files authenticated integration', () => {
  let baseDir: string;
  let closeServer: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-files-'));
    const app = await makeFileApp(baseDir);
    const server = await listen(app);
    url = server.url;
    closeServer = server.close;
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('rejects unauthenticated file requests', async () => {
    const res = await fetch(`${url}/api/files/list?path=/`);
    expect(res.status).toBe(401);
  });

  it('lets an authenticated admin write, read, list, and delete inside FILES_BASE_DIR', async () => {
    const auth = { Authorization: `Bearer ${token('admin')}` };
    const write = await fetch(`${url}/api/files/write`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/hello.txt', content: 'hello' }),
    });
    const writeBody = await write.clone().json().catch(() => ({}));
    expect(write.status, JSON.stringify(writeBody)).toBe(200);

    const read = await fetch(`${url}/api/files/read?path=/hello.txt`, { headers: auth });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ content: 'hello' });

    const list = await fetch(`${url}/api/files/list?path=/`, { headers: auth });
    expect(list.status).toBe(200);
    expect((await list.json()).items.map((i: any) => i.name)).toContain('hello.txt');

    const del = await fetch(`${url}/api/files/delete`, {
      method: 'DELETE',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/hello.txt' }),
    });
    expect(del.status).toBe(200);
  });

  it('blocks readonly tokens from mutating file routes', async () => {
    const res = await fetch(`${url}/api/files/write`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token('readonly')}`, 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/blocked.txt', content: 'nope' }),
    });
    expect(res.status).toBe(403);
    expect(await fs.readdir(baseDir)).toEqual([]);
  });
});
