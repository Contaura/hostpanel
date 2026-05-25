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

describe('mail trace parity foundation', () => {
  let tmp: string;
  let closeServer: (() => Promise<void>) | undefined;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-mail-trace-')); vi.resetModules(); });
  afterEach(async () => { if (closeServer) await closeServer(); closeServer = undefined; await fs.rm(tmp, { recursive: true, force: true }); delete process.env.MAIL_LOG_FILE; vi.resetModules(); });
  async function appForRoutes() { const route = (await import('./mail-trace')).default; const app = express(); app.use('/api/mail-trace', route); return listen(app); }

  it('finds delivery events by sender recipient and queue id', async () => {
    const log = path.join(tmp, 'maillog');
    process.env.MAIL_LOG_FILE = log;
    await fs.writeFile(log, [
      'May 25 10:01:02 host postfix/qmgr[123]: ABC123: from=<sender@example.com>, size=1234, nrcpt=1 (queue active)',
      'May 25 10:01:03 host postfix/smtp[124]: ABC123: to=<user@example.net>, relay=mx.example.net[1.2.3.4]:25, delay=1.2, status=sent (250 2.0.0 ok)',
      'May 25 10:02:00 host postfix/smtp[125]: DEF456: to=<other@example.net>, relay=none, delay=0.1, status=bounced (bad)',
    ].join('\n'));
    const server = await appForRoutes(); closeServer = server.close;
    const res = await fetch(`${server.url}/api/mail-trace/search?sender=sender@example.com&recipient=user@example.net`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ queueId: 'ABC123', sender: 'sender@example.com', recipient: 'user@example.net', status: 'sent' });
  });
});
