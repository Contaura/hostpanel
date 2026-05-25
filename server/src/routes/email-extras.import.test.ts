import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

describe('email address importer', () => {
  let tmp: string;
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-email-import-'));
    process.env.VIRTUAL_FILE = path.join(tmp, 'virtual');
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.VIRTUAL_FILE;
  });

  async function appForEmailExtras() {
    const route = (await import('./email-extras')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/email-extras', route);
    return listen(app);
  }

  it('imports forwarders from CSV, skips duplicates, and reports row errors', async () => {
    await fs.writeFile(process.env.VIRTUAL_FILE!, '# Managed by HostPanel\nexisting@example.com\tdest@example.com\n');
    const server = await appForEmailExtras();
    closeServer = server.close;

    const res = await fetch(`${server.url}/api/email-extras/import/forwarders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv: [
        'source,destination',
        'sales@example.com,team@example.net',
        'existing@example.com,dest@example.com',
        'bad-row',
        'support@example.com,help@example.net',
      ].join('\n') }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ imported: 2, skipped: 1, errors: [{ row: 4 }] });
    await expect(fs.readFile(process.env.VIRTUAL_FILE!, 'utf8')).resolves.toContain('sales@example.com\tteam@example.net');
    await expect(fs.readFile(process.env.VIRTUAL_FILE!, 'utf8')).resolves.toContain('support@example.com\thelp@example.net');
  });

  it('rejects importer payloads with no valid rows', async () => {
    const server = await appForEmailExtras();
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/email-extras/import/forwarders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv: 'source,destination\nnot-an-email,also-bad' }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'No valid forwarders to import' });
  });
});
