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

const LOG_LINES = [
  '1.1.1.1 - - [25/May/2026:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 1000 "-" "Mozilla"',
  '2.2.2.2 - - [25/May/2026:10:01:00 +0000] "GET /missing HTTP/1.1" 404 20 "https://ref.example" "Bot"',
  '1.1.1.1 - - [26/May/2026:08:00:00 +0000] "GET /index.html HTTP/1.1" 200 500 "-" "Mozilla"',
  '3.3.3.3 - - [26/May/2026:09:00:00 +0000] "POST /api/thing HTTP/1.1" 500 100 "-" "curl"',
];

describe('analytics parity foundation', () => {
  let tmp: string; let closeServer: (() => Promise<void>) | undefined;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-analytics-')); vi.resetModules(); });
  afterEach(async () => {
    if (closeServer) await closeServer(); closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.ACCESS_LOG_FILE; delete process.env.ERROR_LOG_FILE;
    vi.resetModules();
  });
  async function appForRoutes() {
    const route = (await import('./analytics')).default;
    const app = express(); app.use('/api/analytics', route);
    return listen(app);
  }

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

  it('filters visitors and bandwidth by date range', async () => {
    const access = path.join(tmp, 'access_log');
    process.env.ACCESS_LOG_FILE = access;
    await fs.writeFile(access, LOG_LINES.join('\n'));
    const server = await appForRoutes(); closeServer = server.close;

    // Only May 25
    const v25: any = await (await fetch(`${server.url}/api/analytics/visitors?from=2026-05-25&to=2026-05-25`)).json();
    expect(v25.hits).toBe(2);

    // Only May 26
    const v26: any = await (await fetch(`${server.url}/api/analytics/visitors?from=2026-05-26&to=2026-05-26`)).json();
    expect(v26.hits).toBe(2);

    // May 25 bandwidth = 1000+20 = 1020
    const bw: any = await (await fetch(`${server.url}/api/analytics/bandwidth?from=2026-05-25&to=2026-05-25`)).json();
    expect(bw.totalBytes).toBe(1020);
  });

  it('returns time-series points by day and by hour', async () => {
    const access = path.join(tmp, 'access_log');
    process.env.ACCESS_LOG_FILE = access;
    await fs.writeFile(access, LOG_LINES.join('\n'));
    const server = await appForRoutes(); closeServer = server.close;

    const ts: any = await (await fetch(`${server.url}/api/analytics/timeseries?interval=day`)).json();
    expect(ts.interval).toBe('day');
    expect(ts.points).toHaveLength(2); // 2026-05-25 and 2026-05-26
    const may25 = ts.points.find((p: any) => p.time === '2026-05-25');
    expect(may25).toBeDefined();
    expect(may25.hits).toBe(2);
    expect(may25.errors).toBe(1); // the 404

    const tsHour: any = await (await fetch(`${server.url}/api/analytics/timeseries?interval=hour`)).json();
    expect(tsHour.interval).toBe('hour');
    expect(tsHour.points.length).toBeGreaterThanOrEqual(3);
  });

  it('returns top-paths filtered by domain prefix', async () => {
    const access = path.join(tmp, 'access_log');
    process.env.ACCESS_LOG_FILE = access;
    await fs.writeFile(access, [
      '1.1.1.1 - - [25/May/2026:10:00:00 +0000] "GET /site1/page.html HTTP/1.1" 200 100 "-" "Moz"',
      '2.2.2.2 - - [25/May/2026:10:01:00 +0000] "GET /site2/other.html HTTP/1.1" 200 200 "-" "Moz"',
      '3.3.3.3 - - [25/May/2026:10:02:00 +0000] "GET /site1/about.html HTTP/1.1" 200 300 "-" "Moz"',
    ].join('\n'));
    const server = await appForRoutes(); closeServer = server.close;

    const tp: any = await (await fetch(`${server.url}/api/analytics/top-paths?domain=site1`)).json();
    expect(tp.paths.every((p: any) => p.path.startsWith('/site1/'))).toBe(true);
    expect(tp.total).toBe(2);
  });

  it('exports filtered access log as CSV', async () => {
    const access = path.join(tmp, 'access_log');
    process.env.ACCESS_LOG_FILE = access;
    await fs.writeFile(access, LOG_LINES.join('\n'));
    const server = await appForRoutes(); closeServer = server.close;

    const res = await fetch(`${server.url}/api/analytics/export?from=2026-05-25&to=2026-05-25`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    // Header row
    expect(text).toContain('ip,date,method,url,status,bytes');
    // Only 2 data rows (May 25)
    const dataRows = text.trim().split('\n').slice(1);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0]).toContain('1.1.1.1');
  });
});
