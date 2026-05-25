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

describe('analytics parity foundation', () => {
  let tmp: string; let closeServer: (() => Promise<void>) | undefined;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-analytics-')); vi.resetModules(); });
  afterEach(async () => { if (closeServer) await closeServer(); closeServer = undefined; await fs.rm(tmp, { recursive: true, force: true }); delete process.env.ACCESS_LOG_FILE; delete process.env.ERROR_LOG_FILE; vi.resetModules(); });
  async function appForRoutes() { const route = (await import('./analytics')).default; const app = express(); app.use('/api/analytics', route); return listen(app); }

  it('summarizes visitors errors bandwidth and raw access logs', async () => {
    const access = path.join(tmp, 'access_log'); const errorLog = path.join(tmp, 'error_log');
    process.env.ACCESS_LOG_FILE = access; process.env.ERROR_LOG_FILE = errorLog;
    await fs.writeFile(access, [
      '1.1.1.1 - - [25/May/2026:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 100 "-" "Mozilla"',
      '2.2.2.2 - - [25/May/2026:10:01:00 +0000] "GET /missing HTTP/1.1" 404 20 "https://ref.example" "Bot"',
    ].join('\n'));
    await fs.writeFile(errorLog, '[Mon May 25 10:02:00.000000 2026] [core:error] [pid 1] File does not exist: /var/www/missing\n');
    const server = await appForRoutes(); closeServer = server.close;
    const visitors: any = await (await fetch(`${server.url}/api/analytics/visitors`)).json();
    expect(visitors.topPages[0]).toMatchObject({ path: '/index.html', hits: 1 });
    const errors: any = await (await fetch(`${server.url}/api/analytics/errors`)).json();
    expect(errors.httpStatuses['404']).toBe(1);
    const bandwidth: any = await (await fetch(`${server.url}/api/analytics/bandwidth`)).json();
    expect(bandwidth.totalBytes).toBe(120);
    const raw: any = await (await fetch(`${server.url}/api/analytics/raw-access`)).json();
    expect(raw.files[0].name).toBe('access_log');
    const awstats: any = await (await fetch(`${server.url}/api/analytics/awstats`)).json();
    expect(awstats.summary.visits).toBe(2);
  });
});
