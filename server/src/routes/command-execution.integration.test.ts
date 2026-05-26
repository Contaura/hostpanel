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
    delete process.env.PHPMYADMIN_PATHS;
    delete process.env.PHPMYADMIN_CONF_FILE;
    delete process.env.PHPMYADMIN_ALIAS;
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

  it('runs backup create with tar argv, not shell', async () => {
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    await fs.mkdir(process.env.BACKUP_DIR, { recursive: true });
    process.env.WEBROOT = path.join(tmp, 'www');
    await fs.mkdir(process.env.WEBROOT, { recursive: true });
    const server = await appFor('/api/backup', './backup');
    closeServer = server.close;
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'tar' && args[0] === '-czf') {
        await fs.writeFile(args[1], 'fake');
      }
      return { stdout: '', stderr: '' };
    });
    const res = await fetch(`${server.url}/api/backup/create`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'files' }),
    });
    expect(res.status).toBe(200);
    const tarCall = runFileMock.mock.calls.find(c => c[0] === 'tar' && (c[1] as string[])[0] === '-czf');
    expect(tarCall).toBeTruthy();
    const args = tarCall![1] as string[];
    expect(args[0]).toBe('-czf');
    expect(args[2]).toBe('-C');
    expect(args[3]).toBe(path.resolve(process.env.WEBROOT!));
    expect(args[4]).toBe('.');
  });

  it('runs backup restore with tar argv when restoring a tar.gz', async () => {
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.WEBROOT = path.join(tmp, 'www');
    await fs.mkdir(process.env.BACKUP_DIR, { recursive: true });
    await fs.mkdir(process.env.WEBROOT, { recursive: true });
    const backupFile = path.join(process.env.BACKUP_DIR, 'files_all_2024-01-01T00-00-00.tar.gz');
    await fs.writeFile(backupFile, 'fake');
    const server = await appFor('/api/backup', './backup');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/backup/restore/files_all_2024-01-01T00-00-00.tar.gz`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('tar', ['-xzf', backupFile, '-C', process.env.WEBROOT], { timeout: 300000 });
  });

  it('dry-runs selective backup restores before extracting files', async () => {
    process.env.BACKUP_DIR = path.join(tmp, 'backups');
    process.env.WEBROOT = path.join(tmp, 'www');
    await fs.mkdir(process.env.BACKUP_DIR, { recursive: true });
    await fs.mkdir(process.env.WEBROOT, { recursive: true });
    const backupFile = path.join(process.env.BACKUP_DIR, 'files_all_2024-01-01T00-00-00.tar.gz');
    await fs.writeFile(backupFile, 'fake');
    const server = await appFor('/api/backup', './backup');
    closeServer = server.close;
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'tar' && args[0] === '-tzf') return { stdout: 'public_html/index.html\nmail/config.json\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const plan = await fetch(`${server.url}/api/backup/restore/files_all_2024-01-01T00-00-00.tar.gz/plan`);
    expect(plan.status).toBe(200);
    expect((await plan.json()).entries).toContain('public_html/index.html');
    const res = await fetch(`${server.url}/api/backup/restore/files_all_2024-01-01T00-00-00.tar.gz`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: true, entries: ['public_html'] }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.selected).toEqual(['public_html/index.html']);
    expect(runFileMock).not.toHaveBeenCalledWith('tar', expect.arrayContaining(['-xzf']), expect.anything());
  });

  it('installs composer-based scripts via runFile argv', async () => {
    process.env.WEBROOT = path.join(tmp, 'www');
    await fs.mkdir(process.env.WEBROOT, { recursive: true });
    const server = await appFor('/api/scripts', './scripts');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/scripts/install`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: 'laravel', domain: 'example.com' }),
    });
    expect(res.status).toBe(200);
    const installPath = path.join(process.env.WEBROOT, 'example.com', 'public_html');
    expect(runFileMock).toHaveBeenCalledWith(
      'composer',
      ['create-project', 'laravel/laravel', installPath, '--no-interaction'],
      { timeout: 300000 },
    );
  });

  it('scripts install rejects WordPress without DB credentials before any command runs', async () => {
    process.env.WEBROOT = path.join(tmp, 'www');
    await fs.mkdir(process.env.WEBROOT, { recursive: true });
    const server = await appFor('/api/scripts', './scripts');
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/scripts/install`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ script: 'wordpress', domain: 'example.com' }),
    });
    expect(res.status).toBe(400);
    expect(runFileMock).not.toHaveBeenCalled();
  });

  it('rejects ssl-advanced wildcard issuance when the configured company email is malformed', async () => {
    const envFile = path.join(tmp, 'hostpanel.env');
    process.env.HOSTPANEL_ENV_FILE = envFile;
    await fs.writeFile(envFile, 'company_email=bad;rm -rf /\n');
    const server = await appFor('/api/ssl-advanced', './ssl-advanced');
    closeServer = server.close;
    const bad = await fetch(`${server.url}/api/ssl-advanced/wildcard`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'example.com', dns_plugin: 'cloudflare' }),
    });
    expect(bad.status).toBe(400);
    expect(runFileMock).not.toHaveBeenCalled();

    await fs.writeFile(envFile, 'company_email=ops@example.com\n');
    const ok = await fetch(`${server.url}/api/ssl-advanced/wildcard`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'example.com', dns_plugin: 'cloudflare' }),
    });
    expect(ok.status).toBe(200);
    const callArgs = runFileMock.mock.calls.find(c => c[0] === 'certbot');
    expect(callArgs).toBeDefined();
    expect(callArgs![1]).toEqual(expect.arrayContaining([
      'certonly', '--dns-cloudflare', '-d', 'example.com', '-d', '*.example.com',
      '--non-interactive', '--agree-tos', '--email', 'ops@example.com',
    ]));
    for (const a of callArgs![1] as string[]) {
      expect(a).not.toMatch(/[;&|`$()]/);
    }
  });

  it('routes WP-CLI through runFile with --path argv (no shell string)', async () => {
    process.env.WEBROOT = path.join(tmp, 'www');
    await fs.mkdir(process.env.WEBROOT, { recursive: true });
    const server = await appFor('/api/wordpress', './wordpress');
    closeServer = server.close;
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });
    const res = await fetch(`${server.url}/api/wordpress/example.com/info`);
    expect(res.status).toBe(200);
    const expectedPath = path.join(process.env.WEBROOT!, 'example.com', 'public_html');
    expect(runFileMock).toHaveBeenCalledWith(
      'wp',
      [`--path=${expectedPath}`, '--allow-root', 'core', 'version'],
      expect.objectContaining({ timeout: 60000 }),
    );
    for (const call of runFileMock.mock.calls) {
      if (call[0] === 'wp') {
        for (const a of call[1] as string[]) {
          expect(a).not.toMatch(/\s2>&1$/);
          expect(a).not.toMatch(/[;&|`$()]/);
        }
      }
    }
  });

  it('runs pm2 jlist with argv runFile when listing apps', async () => {
    const server = await appFor('/api/apps', './apps');
    closeServer = server.close;
    runFileMock.mockResolvedValue({ stdout: '[]', stderr: '' });
    const res = await fetch(`${server.url}/api/apps/`);
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('pm2', ['jlist']);
  });

  it('installs phpMyAdmin through dnf, writes Apache alias config, and reloads httpd', async () => {
    const pmaDir = path.join(tmp, 'phpMyAdmin');
    process.env.PHPMYADMIN_PATHS = pmaDir;
    process.env.PHPMYADMIN_CONF_FILE = path.join(tmp, 'httpd', 'hostpanel-phpmyadmin.conf');
    process.env.PHPMYADMIN_CONFIG_FILE = path.join(tmp, 'phpMyAdmin', 'config.inc.php');
    process.env.PHPMYADMIN_ALIAS = '/phpMyAdmin';
    const server = await appFor('/api/databases', './databases');
    closeServer = server.close;
    runFileMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'dnf' && args.includes('phpMyAdmin')) await fs.mkdir(pmaDir, { recursive: true });
      return { stdout: '', stderr: '' };
    });
    const res = await fetch(`${server.url}/api/databases/phpmyadmin/install`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('dnf', ['install', '-y', 'phpMyAdmin'], expect.objectContaining({ timeout: 300000 }));
    expect(runFileMock).toHaveBeenCalledWith('apachectl', ['graceful'], expect.objectContaining({ timeout: 120000 }));
    await expect(fs.readFile(process.env.PHPMYADMIN_CONF_FILE, 'utf8')).resolves.toContain(`Alias /phpMyAdmin ${pmaDir}`);
    await expect(fs.readFile(path.join(pmaDir, 'hostpanel-signon.php'), 'utf8')).resolves.toContain('PMA_single_signon_user');
    const pmaConfig = await fs.readFile(process.env.PHPMYADMIN_CONFIG_FILE, 'utf8');
    expect(pmaConfig).toContain("$cfg['Servers'][$i]['auth_type'] = 'signon'");
    expect(pmaConfig).toContain("$cfg['Servers'][$i]['SignonSession'] = 'HOSTPANEL_PMA'");
    expect(pmaConfig).toContain("$cfg['Servers'][$i]['SignonURL'] = '/phpMyAdmin/hostpanel-signon.php'");
  });

  it('validates phpMyAdmin Signon field configuration without exposing token secrets', async () => {
    const pmaDir = path.join(tmp, 'phpMyAdmin');
    process.env.PHPMYADMIN_PATHS = pmaDir;
    process.env.PHPMYADMIN_CONF_FILE = path.join(tmp, 'httpd', 'hostpanel-phpmyadmin.conf');
    process.env.PHPMYADMIN_CONFIG_FILE = path.join(tmp, 'phpMyAdmin', 'config.inc.php');
    process.env.PHPMYADMIN_SSO_TOKEN_DIR = path.join(tmp, 'tokens');
    process.env.PHPMYADMIN_ALIAS = '/phpMyAdmin';
    await fs.mkdir(pmaDir, { recursive: true });
    const server = await appFor('/api/databases', './databases');
    closeServer = server.close;
    runFileMock.mockResolvedValue({ stdout: 'Syntax OK\nactive\n', stderr: '' });

    await fetch(`${server.url}/api/databases/phpmyadmin/install`, { method: 'POST' });
    await fs.writeFile(path.join(process.env.PHPMYADMIN_SSO_TOKEN_DIR, 'abcdef.json'), '{"password":"do-not-leak"}');
    const res = await fetch(`${server.url}/api/databases/phpmyadmin/validation`);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.checks).toEqual(expect.objectContaining({
      installed: true,
      apacheAlias: true,
      signonBridge: true,
      signonConfig: true,
      phpSyntax: true,
      apacheConfig: true,
      httpdActive: true,
      tokenDirectory: true,
    }));
    expect(JSON.stringify(body)).not.toContain('do-not-leak');
    expect(runFileMock).toHaveBeenCalledWith('php', ['-l', path.join(pmaDir, 'hostpanel-signon.php')], expect.objectContaining({ timeout: 60000 }));
    expect(runFileMock).toHaveBeenCalledWith('apachectl', ['configtest'], expect.objectContaining({ timeout: 60000 }));
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['is-active', 'httpd'], expect.objectContaining({ timeout: 60000 }));
  });

  it('treats real runFile string stdout as phpMyAdmin validation command output', async () => {
    const pmaDir = path.join(tmp, 'phpMyAdmin');
    process.env.PHPMYADMIN_PATHS = pmaDir;
    process.env.PHPMYADMIN_CONF_FILE = path.join(tmp, 'httpd', 'hostpanel-phpmyadmin.conf');
    process.env.PHPMYADMIN_CONFIG_FILE = path.join(tmp, 'phpMyAdmin', 'config.inc.php');
    process.env.PHPMYADMIN_SSO_TOKEN_DIR = path.join(tmp, 'tokens');
    process.env.PHPMYADMIN_ALIAS = '/phpMyAdmin';
    await fs.mkdir(pmaDir, { recursive: true });
    const server = await appFor('/api/databases', './databases');
    closeServer = server.close;
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });
    await fetch(`${server.url}/api/databases/phpmyadmin/install`, { method: 'POST' });
    runFileMock
      .mockResolvedValueOnce('No syntax errors detected' as any)
      .mockResolvedValueOnce('Syntax OK' as any)
      .mockResolvedValueOnce('active\n' as any);

    const res = await fetch(`${server.url}/api/databases/phpmyadmin/validation`);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.checks.phpSyntax).toBe(true);
    expect(body.checks.apacheConfig).toBe(true);
    expect(body.checks.httpdActive).toBe(true);
    expect(body.ready).toBe(true);
  });

  it('removes promisify(exec) from hardened route sources', async () => {
    for (const file of ['reseller.ts', 'logs.ts', 'cache.ts', 'resource-limits.ts', 'node-apps.ts']) {
      const src = await fs.readFile(path.resolve(__dirname, file), 'utf8');
      expect(src, file).not.toMatch(/promisify\s*\(\s*exec\s*\)/);
      expect(src, file).not.toMatch(/\bexecAsync\b/);
      expect(src, file).not.toMatch(/exec\s*\(/);
    }
  });

  it('reloads httpd via argv when suspending an account', async () => {
    process.env.VHOST_DIR = path.join(tmp, 'vhosts');
    await fs.mkdir(process.env.VHOST_DIR, { recursive: true });
    const server = await appFor('/api/accounts', './accounts');
    closeServer = server.close;
    const db = (await import('../db')).default;
    db.pragma('foreign_keys = OFF');
    const uniq = `susp-${Date.now()}-${Math.random().toString(36).slice(2,8)}.example.com`;
    const r: any = db.prepare("INSERT INTO accounts (username, domain) VALUES (?, ?)").run(`u_${Date.now()}`, uniq);
    await fs.writeFile(path.join(process.env.VHOST_DIR!, `${uniq}.conf`), '# vhost');
    const res = await fetch(`${server.url}/api/accounts/${r.lastInsertRowid}/suspend`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['reload', 'httpd']);
    await expect(fs.access(path.join(process.env.VHOST_DIR!, `${uniq}.conf.disabled`))).resolves.toBeUndefined();
    db.prepare('DELETE FROM accounts WHERE id = ?').run(r.lastInsertRowid);
    db.pragma('foreign_keys = ON');
  });

  it('reports account usage via du argv (no shell sort|head pipeline)', async () => {
    process.env.WEBROOT = path.join(tmp, 'www');
    const uniq = `usage-${Date.now()}-${Math.random().toString(36).slice(2,8)}.example.com`;
    const accountDir = path.join(process.env.WEBROOT, uniq);
    await fs.mkdir(path.join(accountDir, 'sub1'), { recursive: true });
    await fs.writeFile(path.join(accountDir, 'sub1', 'a.txt'), 'hello');
    const server = await appFor('/api/accounts', './accounts');
    closeServer = server.close;
    runFileMock.mockResolvedValue({ stdout: '1234\t' + accountDir + '\n', stderr: '' });
    const db = (await import('../db')).default;
    db.pragma('foreign_keys = OFF');
    const r: any = db.prepare("INSERT INTO accounts (username, domain) VALUES (?, ?)").run(`u_${Date.now()}`, uniq);
    const res = await fetch(`${server.url}/api/accounts/${r.lastInsertRowid}/usage`);
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('du', ['-sb', '--', accountDir]);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(r.lastInsertRowid);
    db.pragma('foreign_keys = ON');
  });

  it('reloads bind via runFile rndc when a client appends a DNS record', async () => {
    process.env.NAMED_DIR = path.join(tmp, 'named');
    await fs.mkdir(process.env.NAMED_DIR, { recursive: true });
    await fs.writeFile(path.join(process.env.NAMED_DIR, 'cpdns.example.com.zone'), '; zone\n');

    vi.resetModules();
    runFileMock.mockReset();
    runFileMock.mockResolvedValue({ stdout: '', stderr: '' });
    const route = (await import('./client-portal')).default;
    const db = (await import('../db')).default;
    db.pragma('foreign_keys = OFF');
    const uniq = `cpdns-${Date.now()}-${Math.random().toString(36).slice(2,8)}.example.com`;
    db.prepare("INSERT INTO clients (id, name, email, password_hash) VALUES (9001, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run('CP Tester', 'cp@example.com', 'x');
    db.prepare("INSERT INTO accounts (username, domain, client_id) VALUES (?, ?, 9001)").run(`cpu_${Date.now()}`, uniq);
    await fs.writeFile(path.join(process.env.NAMED_DIR, `${uniq}.zone`), '; zone\n');

    const app = express();
    app.use(express.json());
    // shim: inject clientId so clientAuth middleware would have passed
    app.use((req: any, _res, next) => { req.clientId = 9001; req.headers.authorization = 'Bearer test'; next(); });
    // The portal's clientAuth middleware verifies a JWT; for this test we mount the route directly
    // and the route handler reads (req as any).clientId. The clientAuth chain must still be bypassed.
    // Easiest: monkey-patch the route by walking its layer stack to replace clientAuth with our shim.
    for (const layer of (route as any).stack) {
      if (layer.route?.stack) {
        layer.route.stack = layer.route.stack.filter((l: any) => l.name !== 'clientAuth');
      }
    }
    app.use('/api/portal', route);
    const server = await listen(app);
    closeServer = server.close;
    const res = await fetch(`${server.url}/api/portal/domains/${uniq}/dns`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'www', type: 'A', value: '1.2.3.4', ttl: '300' }),
    });
    expect(res.status).toBe(200);
    expect(runFileMock).toHaveBeenCalledWith('rndc', ['reload']);
    db.prepare('DELETE FROM accounts WHERE client_id = 9001').run();
    db.prepare('DELETE FROM clients WHERE id = 9001').run();
    db.pragma('foreign_keys = ON');
  });

});
