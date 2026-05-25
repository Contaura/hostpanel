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
  it('runs stats service checks with argv', async () => {
    const server = await appFor('/api/stats', './stats');
    closeServer = server.close;
    runFileMock.mockResolvedValue({ stdout: 'active\n', stderr: '' });
    const res = await fetch(`${server.url}/api/stats/services`);
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['is-active', 'httpd']);
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['is-active', 'mariadb']);
  });

  it('runs redirect reloads with argv after writing redirect config', async () => {
    process.env.REDIRECT_CONF = path.join(tmp, 'redirects.conf');
    const server = await appFor('/api/redirects', './redirects');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/redirects/add`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'example.com', from: '/old', to: 'https://example.com/new', type: '302' }),
    });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['reload', 'httpd']);
  });

  it('runs error page reloads with argv only after vhost update', async () => {
    process.env.VHOST_DIR = path.join(tmp, 'vhosts');
    process.env.WEBROOT = path.join(tmp, 'www');
    await fs.mkdir(process.env.VHOST_DIR, { recursive: true });
    await fs.writeFile(path.join(process.env.VHOST_DIR, 'example.com.conf'), '<VirtualHost *:80>\n</VirtualHost>\n');
    const server = await appFor('/api/errpages', './errpages');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/errpages/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'example.com', code: 404, content: '<h1>missing</h1>' }),
    });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['reload', 'httpd']);
  });

  it('runs process list and kill with argv instead of shell fallback', async () => {
    const server = await appFor('/api/processes', './processes');
    closeServer = server.close;
    runFileMock.mockResolvedValueOnce({ stdout: 'root 123 1.0 0.5 1 2 ? S 00:00 0:00 node app.js\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });
    const list = await fetch(`${server.url}/api/processes/list`);
    expect(list.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('ps', ['aux', '--no-headers', '--sort=-%cpu']);
    const del = await fetch(`${server.url}/api/processes/123`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('kill', ['-15', '123']);
  });

  it('runs security scanner clamscan with argv and rejects invalid paths before launch', async () => {
    process.env.WEBROOT = path.join(tmp, 'www');
    await fs.mkdir(process.env.WEBROOT, { recursive: true });
    const server = await appFor('/api/security-scanner', './security-scanner');
    closeServer = server.close;
    runFileMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'which') return { stdout: '/usr/bin/clamscan\n', stderr: '' };
      if (cmd === 'clamscan') return { stdout: `${process.env.WEBROOT}/index.php: Eicar FOUND\n`, stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const bad = await fetch(`${server.url}/api/security-scanner/scan`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: `${process.env.WEBROOT}/$(touch pwned)` }),
    });
    expect(bad.status).toBe(400);
    expect(runFileMock).not.toHaveBeenCalled();

    const ok = await fetch(`${server.url}/api/security-scanner/scan`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: process.env.WEBROOT }),
    });
    expect(ok.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('which', ['clamscan']);
    expect(runFileMock).toHaveBeenCalledWith('clamscan', ['-r', '--infected', '--no-summary', process.env.WEBROOT], { timeout: 300000 });
  });

  it('runs ftp deletion with argv and rewrites the user list without sed', async () => {
    process.env.FTP_USER_DIR = path.join(tmp, 'ftp-users');
    process.env.VSFTPD_USER_LIST = path.join(tmp, 'user_list');
    await fs.mkdir(process.env.FTP_USER_DIR, { recursive: true });
    await fs.writeFile(process.env.VSFTPD_USER_LIST, 'alice\nbob\n');
    const server = await appFor('/api/ftp', './ftp');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/ftp/users/alice`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('userdel', ['-r', 'alice']);
    await expect(fs.readFile(process.env.VSFTPD_USER_LIST!, 'utf8')).resolves.toBe('bob\n');
  });

  it('reloads apache via apachectl argv when adding a MIME type', async () => {
    process.env.VHOST_DIR = path.join(tmp, 'vhosts');
    await fs.mkdir(process.env.VHOST_DIR, { recursive: true });
    const server = await appFor('/api/web-extras', './web-extras');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/web-extras/mime`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mime: 'application/x-foo', extensions: '.foo' }),
    });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('apachectl', ['graceful']);
  });

  it('reloads apache via apachectl argv when creating a parked domain', async () => {
    process.env.VHOST_DIR = path.join(tmp, 'vhosts');
    await fs.mkdir(process.env.VHOST_DIR, { recursive: true });
    const server = await appFor('/api/parked', './parked-domains');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/parked/`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'parked.example.uniq', primary_domain: 'example.com' }),
    });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('apachectl', ['graceful']);
    const db = (await import('../db')).default;
    db.prepare('DELETE FROM parked_domains').run();
  });

  it('removes addon-domain vhost via fs.rm not shell rm, then reloads apache argv', async () => {
    process.env.VHOST_DIR = path.join(tmp, 'vhosts');
    await fs.mkdir(process.env.VHOST_DIR, { recursive: true });
    const server = await appFor('/api/addon', './addon-domains');
    closeServer = server.close;
    const db = (await import('../db')).default;
    db.exec(`CREATE TABLE IF NOT EXISTS addon_domains (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, domain TEXT, subdomain TEXT, document_root TEXT, created_at TEXT DEFAULT (datetime('now')))`);
    db.pragma('foreign_keys = OFF');
    const vhostPath = path.join(process.env.VHOST_DIR!, 'remove.example.conf');
    await fs.writeFile(vhostPath, '# vhost');
    const r: any = db.prepare('INSERT INTO addon_domains (account_id, domain, subdomain, document_root) VALUES (1, ?, ?, ?)').run('remove.example', 'rm', '/tmp/x');
    const res = await fetch(`${server.url}/api/addon/${r.lastInsertRowid}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    await expect(fs.access(vhostPath)).rejects.toThrow();
    expect(runFileMock).toHaveBeenCalledWith('apachectl', ['graceful']);
    expect(runFileMock).not.toHaveBeenCalledWith('rm', expect.anything());
    db.prepare('DELETE FROM addon_domains').run();
    db.pragma('foreign_keys = ON');
  });

  it('runs rspamd status with argv systemctl is-active', async () => {
    const server = await appFor('/api/rspamd', './rspamd');
    closeServer = server.close;
    runFileMock.mockResolvedValue({ stdout: 'inactive', stderr: '' });
    const res = await fetch(`${server.url}/api/rspamd/status`);
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['is-active', 'rspamd']);
  });

  it('runs alerts package check with argv dnf, not shell', async () => {
    const server = await appFor('/api/alerts', './alerts');
    closeServer = server.close;
    runFileMock.mockResolvedValue({ stdout: 'pkg1 1.0 base\npkg2 2.0 updates\n', stderr: '' });
    const res = await fetch(`${server.url}/api/alerts/packages`);
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('dnf', ['check-update', '--quiet'], { timeout: 60000 });
  });

  it('runs dkim DNS verification with argv dig', async () => {
    process.env.NAMED_DIR = path.join(tmp, 'named');
    process.env.DKIM_DIR  = path.join(tmp, 'dkim');
    await fs.mkdir(process.env.NAMED_DIR, { recursive: true });
    await fs.mkdir(process.env.DKIM_DIR, { recursive: true });
    const server = await appFor('/api/dkim', './dkim');
    closeServer = server.close;
    runFileMock.mockResolvedValue({ stdout: '"v=spf1 mx ~all"', stderr: '' });
    const res = await fetch(`${server.url}/api/dkim/example.com/verify`);
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('dig', ['+short', 'TXT', 'example.com']);
    expect(runFileMock).toHaveBeenCalledWith('dig', ['+short', 'TXT', '_dmarc.example.com']);
    expect(runFileMock).toHaveBeenCalledWith('dig', ['+short', 'TXT', 'default._domainkey.example.com']);
  });

  it('rejects invalid fail2ban jail names before invoking the binary', async () => {
    const server = await appFor('/api/waf', './waf');
    closeServer = server.close;
    const bad = await fetch(`${server.url}/api/waf/fail2ban/unban`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jail: 'sshd; rm -rf /', ip: '1.2.3.4' }),
    });
    expect(bad.status).toBe(400);
    expect(runFileMock).not.toHaveBeenCalled();
  });

  it('runs php-domains apachectl graceful with argv after vhost write', async () => {
    process.env.VHOST_DIR = path.join(tmp, 'vhosts');
    await fs.mkdir(process.env.VHOST_DIR, { recursive: true });
    const server = await appFor('/api/php-domains', './php-domains');
    closeServer = server.close;
    const db = (await import('../db')).default;
    db.exec("CREATE TABLE IF NOT EXISTS php_domain_versions (domain TEXT PRIMARY KEY, php_version TEXT, updated_at TEXT DEFAULT (datetime('now')))");
    const res = await fetch(`${server.url}/api/php-domains/`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'phpd.example.com', php_version: '8.2' }),
    });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('apachectl', ['graceful']);
    db.prepare('DELETE FROM php_domain_versions').run();
  });

});
