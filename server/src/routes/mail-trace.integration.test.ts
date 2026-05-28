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

// Sample mail log with entries on two different days
const LOG_LINES = [
  'May 25 10:01:02 host postfix/qmgr[123]: ABC123: from=<alice@example.com>, size=1234, nrcpt=1 (queue active)',
  'May 25 10:01:03 host postfix/smtp[124]: ABC123: to=<bob@example.net>, relay=mx.example.net[1.2.3.4]:25, delay=1.2, status=sent (250 2.0.0 ok)',
  'May 25 10:02:00 host postfix/smtp[125]: DEF456: to=<other@example.net>, relay=none, delay=0.1, status=bounced (bad destination)',
  'May 26 08:00:00 host postfix/qmgr[200]: GHI789: from=<carol@example.com>, size=500, nrcpt=1 (queue active)',
  'May 26 08:00:01 host postfix/smtp[201]: GHI789: to=<dave@example.net>, relay=mx2.example.net[5.6.7.8]:25, delay=0.5, status=sent (250 ok)',
];

describe('mail trace parity foundation', () => {
  let tmp: string;
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-mail-trace-'));
    vi.resetModules();
  });
  afterEach(async () => {
    if (closeServer) await closeServer(); closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.MAIL_LOG_FILE;
    vi.resetModules();
  });
  async function appForRoutes() {
    const route = (await import('./mail-trace')).default;
    const app = express(); app.use('/api/mail-trace', route);
    return listen(app);
  }

  it('finds delivery events by sender recipient and queue id', async () => {
    const log = path.join(tmp, 'maillog');
    process.env.MAIL_LOG_FILE = log;
    await fs.writeFile(log, LOG_LINES.join('\n'));
    const server = await appForRoutes(); closeServer = server.close;

    const res = await fetch(`${server.url}/api/mail-trace/search?sender=alice@example.com&recipient=bob@example.net`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ queueId: 'ABC123', sender: 'alice@example.com', recipient: 'bob@example.net', status: 'sent' });
  });

  it('filters search results by status', async () => {
    const log = path.join(tmp, 'maillog');
    process.env.MAIL_LOG_FILE = log;
    await fs.writeFile(log, LOG_LINES.join('\n'));
    const server = await appForRoutes(); closeServer = server.close;

    const res = await fetch(`${server.url}/api/mail-trace/search?status=bounced`);
    const body: any = await res.json();
    expect(body.events.every((e: any) => e.status === 'bounced')).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].queueId).toBe('DEF456');
  });

  it('filters search results by date range', async () => {
    const log = path.join(tmp, 'maillog');
    process.env.MAIL_LOG_FILE = log;
    await fs.writeFile(log, LOG_LINES.join('\n'));
    const server = await appForRoutes(); closeServer = server.close;

    const year = new Date().getFullYear();
    // Filter to only May 25 events using ISO date prefix
    const from = `${year}-05-25`;
    const to = `${year}-05-25`;
    const res = await fetch(`${server.url}/api/mail-trace/search?from=${from}&to=${to}`);
    const body: any = await res.json();
    // May 25 has ABC123 (sent) and DEF456 (bounced) = 2 delivery events
    expect(body.events.length).toBe(2);
  });

  it('returns delivery stats: byStatus, topSenders, topDomains', async () => {
    const log = path.join(tmp, 'maillog');
    process.env.MAIL_LOG_FILE = log;
    await fs.writeFile(log, LOG_LINES.join('\n'));
    const server = await appForRoutes(); closeServer = server.close;

    const res = await fetch(`${server.url}/api/mail-trace/stats`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.byStatus).toBeDefined();
    expect(body.byStatus.sent).toBe(2);
    expect(body.byStatus.bounced).toBe(1);
    expect(body.total).toBe(3);
    expect(body.topSenders).toBeInstanceOf(Array);
    expect(body.topDomains).toBeInstanceOf(Array);
    // example.net has 3 recipient events
    const netDomain = body.topDomains.find((d: any) => d.key === 'example.net');
    expect(netDomain).toBeDefined();
    expect(netDomain.count).toBe(3);
  });

  it('exports filtered mail trace events as CSV', async () => {
    const log = path.join(tmp, 'maillog');
    process.env.MAIL_LOG_FILE = log;
    await fs.writeFile(log, LOG_LINES.join('\n'));
    const server = await appForRoutes(); closeServer = server.close;

    const res = await fetch(`${server.url}/api/mail-trace/export?status=sent`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('timestamp,queueId,sender,recipient,status');
    // 2 sent events
    const dataRows = text.trim().split('\n').slice(1);
    expect(dataRows).toHaveLength(2);
    expect(dataRows.every(r => r.includes('sent'))).toBe(true);
  });
});
