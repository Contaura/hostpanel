import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing listen address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

describe('feature list parity foundation', () => {
  let tmp: string;
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-feature-lists-'));
    process.env.DATA_DIR = tmp;
    vi.resetModules();
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    vi.resetModules();
  });

  async function appForRoutes() {
    const route = (await import('./feature-lists')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/feature-lists', route);
    return listen(app);
  }

  it('returns a grouped cPanel/WHM parity feature catalog', async () => {
    const server = await appForRoutes(); closeServer = server.close;
    const res = await fetch(`${server.url}/api/feature-lists/catalog`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.features.some((f: any) => f.key === 'webdav')).toBe(true);
    expect(body.features.some((f: any) => f.key === 'dns-clustering')).toBe(true);
    expect(body.groups.email).toContain('mail-trace');
  });

  it('creates and returns feature lists with enabled feature keys', async () => {
    const server = await appForRoutes(); closeServer = server.close;
    const create = await fetch(`${server.url}/api/feature-lists`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Starter', description: 'Starter package', features: ['email-accounts', 'mail-trace'] }),
    });
    expect(create.status).toBe(200);
    await expect(create.json()).resolves.toMatchObject({ name: 'Starter', features: ['email-accounts', 'mail-trace'] });
    const list = await fetch(`${server.url}/api/feature-lists`);
    const body: any = await list.json();
    expect(body[0].features).toContain('mail-trace');
  });
});
