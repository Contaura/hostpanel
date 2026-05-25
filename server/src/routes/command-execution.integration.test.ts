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
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())),
      });
    });
  });
}

async function appFor(prefix: string, modulePath: string) {
  vi.resetModules();
  runFileMock.mockReset();
  runFileMock.mockResolvedValue({ stdout: '', stderr: '' });
  const route = (await import(modulePath)).default;
  const app = express();
  app.use(express.json());
  app.use(prefix, route);
  return listen(app);
}

describe('high-risk route command execution integration', () => {
  let tmp: string;
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-routes-'));
    process.env.VHOST_DIR = path.join(tmp, 'vhosts');
    process.env.WEBROOT = path.join(tmp, 'www');
    process.env.NAMED_DIR = path.join(tmp, 'named');
    process.env.NAMED_CONF = path.join(tmp, 'named.conf');
    process.env.FPM_POOL_DIR = path.join(tmp, 'php-fpm.d');
    process.env.TRANSPORT_FILE = path.join(tmp, 'transport');
    await fs.mkdir(process.env.VHOST_DIR, { recursive: true });
    await fs.mkdir(process.env.WEBROOT, { recursive: true });
    await fs.mkdir(process.env.NAMED_DIR, { recursive: true });
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    vi.resetModules();
  });

  it('runs firewall mutations as executable argv, not shell strings', async () => {
    const server = await appFor('/api/firewall', './firewall');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/firewall/ports`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ port: 443, protocol: 'tcp' }),
    });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('firewall-cmd', ['--add-port=443/tcp', '--permanent']);
    expect(runFileMock).toHaveBeenCalledWith('firewall-cmd', ['--reload']);
  });

  it('runs certbot with explicit arguments and rejects invalid SSL emails', async () => {
    const server = await appFor('/api', './domains');
    closeServer = server.close;
    const bad = await fetch(`${server.url}/api/ssl/example.com`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bad@example.com;touch /tmp/pwned' }),
    });
    expect(bad.status).toBe(400);
    expect(runFileMock).not.toHaveBeenCalled();

    const ok = await fetch(`${server.url}/api/ssl/example.com`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com' }),
    });
    expect(ok.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('certbot', ['--apache', '-d', 'example.com', '-d', 'www.example.com', '--agree-tos', '--non-interactive', '--email', 'admin@example.com']);
  });

  it('reloads httpd from subdomain routes with argv after writing the vhost', async () => {
    const server = await appFor('/api/subdomains', './subdomains');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/subdomains/create`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subdomain: 'app', domain: 'example.com' }),
    });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['reload', 'httpd']);
    await expect(fs.readFile(path.join(process.env.VHOST_DIR!, 'sub_app.example.com.conf'), 'utf8')).resolves.toContain('ServerName app.example.com');
  });

  it('reloads php-fpm from php pool routes with argv', async () => {
    const server = await appFor('/api/php', './php');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/php/fpm-pool/example.com`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pm: 'dynamic', 'pm.max_children': '5' }),
    });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['reload', 'php-fpm']);
  });

  it('runs mail queue message actions with argv', async () => {
    const server = await appFor('/api/mail-queue', './mail-queue');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/mail-queue/ABC123`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('postsuper', ['-d', 'ABC123']);
  });
});
