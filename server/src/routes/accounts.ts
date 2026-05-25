import { Router, Response } from 'express';
import { spawn } from 'child_process';
import zlib from 'zlib';
import { createWriteStream } from 'fs';
import { runFile } from '../utils/process-runner';
import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

function dumpDbToGzip(dbHost: string, user: string, dbName: string, outPath: string, env: NodeJS.ProcessEnv, timeoutMs = 300000): Promise<void> {
  return new Promise((resolve, reject) => {
    const dump = spawn('mysqldump', [`-u${user}`, `-h${dbHost}`, dbName], { env, shell: false });
    const gzip = zlib.createGzip();
    const out = createWriteStream(outPath);
    let timer: NodeJS.Timeout | null = setTimeout(() => { dump.kill('SIGKILL'); reject(new Error('mysqldump timeout')); }, timeoutMs);
    const done = (err?: Error) => { if (timer) { clearTimeout(timer); timer = null; } err ? reject(err) : resolve(); };
    dump.on('error', done);
    dump.stderr.on('data', () => {});
    dump.stdout.pipe(gzip).pipe(out);
    out.on('error', done);
    out.on('finish', () => done());
    dump.on('close', code => { if (code !== 0) done(new Error(`mysqldump exit ${code}`)); });
  });
}


// /:id/export tars the whole account webroot and mysqldumps every account-
// owned database in one shot. /:id/usage walks the same tree with du + find.
// Either one looped under the global 300/min limit pegs disk I/O and fills
// /tmp; pin them to 3/min.
const heavyLimit = rateLimit({
  windowMs: 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit hit on heavy account operation; wait a minute.' },
});

const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';
const WEBROOT   = process.env.WEBROOT   || '/var/www';

// GET /api/accounts — list all accounts with plan + client info
router.get('/', (_req: AuthRequest, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT a.*, p.name as plan_name, p.price as plan_price, p.disk_quota,
             c.name as client_name, c.email as client_email
      FROM accounts a
      LEFT JOIN plans   p ON a.plan_id   = p.id
      LEFT JOIN clients c ON a.client_id = c.id
      ORDER BY a.created_at DESC
    `).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// /check-expiry must be declared BEFORE the /:id route below. Express matches
// routes in declaration order, so with the previous ordering the string
// "check-expiry" was being captured as :id and the handler 404'd looking up
// account id="check-expiry".
router.get('/check-expiry', async (_req: AuthRequest, res: Response) => {
  const now = new Date().toISOString().split('T')[0];
  const expired = db.prepare(`
    SELECT id, username, domain, expires_at, status
    FROM accounts
    WHERE expires_at IS NOT NULL AND expires_at <= ? AND status != 'suspended'
  `).all(now) as any[];

  const suspended: string[] = [];
  for (const acc of expired) {
    db.prepare("UPDATE accounts SET status='suspended' WHERE id=?").run(acc.id);
    try {
      await fs.rename(path.join(VHOST_DIR, `${acc.domain}.conf`), path.join(VHOST_DIR, `${acc.domain}.conf.disabled`)).catch(() => {});
    } catch {}
    suspended.push(acc.username);
  }

  if (suspended.length > 0) {
    await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));
  }

  res.json({ checked: expired.length, suspended });
});

// GET /api/accounts/:id
router.get('/:id', (req: AuthRequest, res: Response) => {
  const row = db.prepare(`
    SELECT a.*, p.name as plan_name, p.price as plan_price, p.disk_quota, p.bandwidth,
           p.email_accts, p.databases, p.subdomains, p.ftp_accts, p.ssl,
           c.name as client_name, c.email as client_email, c.phone as client_phone
    FROM accounts a
    LEFT JOIN plans   p ON a.plan_id   = p.id
    LEFT JOIN clients c ON a.client_id = c.id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Account not found' });
  res.json(row);
});

// POST /api/accounts — create hosting account
router.post('/', async (req: AuthRequest, res: Response) => {
  const { username, domain, password, client_id, plan_id, notes, expires_at } = req.body;

  if (!username || !/^[a-zA-Z][a-zA-Z0-9_]{1,31}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid username (2-32 alphanumeric chars, start with letter)' });
  }
  if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,253}$/.test(domain)) {
    return res.status(400).json({ error: 'Invalid domain name' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const docRoot = path.join(WEBROOT, domain, 'public_html');

  try {
    // Create web directory structure
    await fs.mkdir(docRoot, { recursive: true });
    await fs.writeFile(
      path.join(docRoot, 'index.html'),
      `<html><body><h1>Welcome to ${domain}</h1><p>Hosted by HostPanel</p></body></html>`
    );

    // Create Apache vhost
    const vhostConf = `<VirtualHost *:80>
    ServerName ${domain}
    ServerAlias www.${domain}
    DocumentRoot ${docRoot}
    ErrorLog /var/log/httpd/${domain}-error.log
    CustomLog /var/log/httpd/${domain}-access.log combined
    <Directory ${docRoot}>
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
`;
    await fs.writeFile(path.join(VHOST_DIR, `${domain}.conf`), vhostConf).catch(() => {});
    await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));

    // Insert into DB
    const result = db.prepare(`
      INSERT INTO accounts (username, domain, client_id, plan_id, notes, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, domain, client_id || null, plan_id || null, notes || '', expires_at || null);

    // Auto-generate invoice if plan exists
    if (plan_id && client_id) {
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(plan_id) as any;
      if (plan) {
        const invoiceNum = `INV-${Date.now()}`;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);
        db.prepare(`
          INSERT INTO invoices (invoice_number, client_id, account_id, amount, due_date, notes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(invoiceNum, client_id, result.lastInsertRowid, plan.price, dueDate.toISOString().slice(0, 10), `${plan.name} plan — ${domain}`);
      }
    }

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid);
    res.json(account);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username or domain already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/accounts/:id/status — suspend / activate / terminate
router.patch('/:id/status', (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  if (!['active', 'suspended', 'terminated'].includes(status)) {
    return res.status(400).json({ error: 'status must be active, suspended, or terminated' });
  }
  try {
    db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/accounts/:id — update plan, client, notes, expires_at
router.patch('/:id', (req: AuthRequest, res: Response) => {
  const { plan_id, client_id, notes, expires_at } = req.body;
  try {
    db.prepare(`
      UPDATE accounts SET plan_id = ?, client_id = ?, notes = ?, expires_at = ?
      WHERE id = ?
    `).run(plan_id || null, client_id || null, notes || '', expires_at || null, req.params.id);
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
    res.json(account);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  try {
    // Remove vhost config (don't delete web files — admin should do that manually)
    await fs.unlink(path.join(VHOST_DIR, `${account.domain}.conf`)).catch(() => {});
    await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));
    db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/:id/usage — disk usage for account's webroot dir
router.get('/:id/usage', heavyLimit, async (req: AuthRequest, res: Response) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // Account web roots are keyed on domain (see the POST /accounts handler:
  // docRoot = path.join(WEBROOT, domain, 'public_html')). The previous fallback
  // tried username first, which produced /var/www/<username> and reported zero
  // disk usage for every existing account.
  const accountDir = path.join(WEBROOT, account.domain || account.username);
  try {
    // Disk usage
    let diskBytes = 0;
    let breakdown: { dir: string; bytes: number }[] = [];
    try {
      const { stdout } = await runFile('du', ['-sb', '--', accountDir]);
      diskBytes = parseInt(stdout.split('\t')[0]) || 0;
      // Breakdown by top-level subdir
      const entries = await fs.readdir(accountDir, { withFileTypes: true }).catch(() => [] as any[]);
      const sizes: { dir: string; bytes: number }[] = [];
      for (const entry of entries) {
        const full = path.join(accountDir, entry.name);
        const { stdout: entryRaw } = await runFile('du', ['-sb', '--', full]).catch(() => ({ stdout: '', stderr: '' }));
        const bytes = parseInt(entryRaw.split('\t')[0]) || 0;
        sizes.push({ dir: entry.name, bytes });
      }
      sizes.sort((a, b) => b.bytes - a.bytes);
      breakdown = sizes.slice(0, 10);
    } catch {}

    // File count
    let fileCount = 0;
    try {
      async function countFiles(dir: string): Promise<number> {
        let count = 0;
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as any[]);
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) count += await countFiles(full);
          else if (entry.isFile()) count += 1;
        }
        return count;
      }
      fileCount = await countFiles(accountDir);
    } catch {}

    res.json({ disk_bytes: diskBytes, file_count: fileCount, breakdown, directory: accountDir });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Full account export / migration ────────────────────── */

router.post('/:id/export', heavyLimit, async (req: AuthRequest, res: Response) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });

  // Defensive re-validation — usernames pass /^[a-zA-Z][a-zA-Z0-9_]{1,31}$/ at
  // creation, but a row could have been inserted via another path. Refuse to
  // interpolate anything weird into shell commands or db queries below.
  if (!/^[a-zA-Z][a-zA-Z0-9_]{1,31}$/.test(account.username)) {
    return res.status(400).json({ error: 'Stored account username is invalid; refusing to export' });
  }

  const BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/hostpanel';
  try {
    const { mkdirSync: mkdir, existsSync: exists } = await import('fs');
    if (!exists(BACKUP_DIR)) mkdir(BACKUP_DIR, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveName = `account_${account.username}_${ts}.tar.gz`;
    const archivePath = path.join(BACKUP_DIR, archiveName);
    const tmpDir = await fs.mkdtemp(path.join('/tmp', `hp_export_${account.username}_`));

    // Collect files
    // Same fix as /:id/usage: web roots live at /var/www/<domain>, not
    // /var/www/<username>, so the tarball used to be empty for every export.
    const webDir = path.join(WEBROOT, account.domain);
    await fs.mkdir(path.join(tmpDir, 'files'), { recursive: true });
    await fs.mkdir(path.join(tmpDir, 'databases'), { recursive: true });
    if (exists(webDir)) {
      await runFile('tar', ['-czf', path.join(tmpDir, 'files/files.tar.gz'), '-C', path.dirname(webDir), account.domain], { timeout: 300000 }).catch(() => ({ stdout: '', stderr: '' }));
    }

    // Dump all databases owned by this account user. Pull the list via
    // information_schema with the prefix passed through MYSQL_PWD/env so the
    // username never lands in the shell-quoted -e argument.
    const user = process.env.DB_ROOT_USER || 'root';
    const pass = process.env.DB_ROOT_PASS || '';
    const dbEnv = { ...process.env, ...(pass ? { MYSQL_PWD: pass } : {}) };
    try {
      
      // SHOW DATABASES LIKE accepts SQL wildcards; build the pattern from the
      // validated username — no quote injection possible since the regex above
      // restricts to [A-Za-z0-9_].
      const likePattern = account.username + '%';
      // -h127.0.0.1 forces TCP so the dedicated hostpanel@127.0.0.1 user
      // matches the host part of MariaDB's ACL (a socket connection would
      // be rejected as @localhost).
      const dbHost = process.env.DB_HOST || '127.0.0.1';
      const { stdout: dbs } = await runFile('mysql', [`-u${user}`, `-h${dbHost}`, '-N', '-B', '-e', `SHOW DATABASES LIKE '${likePattern}'`], { env: dbEnv });
      for (const dbName of dbs.split('\n').filter(Boolean)) {
        if (/^[a-zA-Z0-9_]+$/.test(dbName)) {
          await dumpDbToGzip(dbHost, user, dbName, path.join(tmpDir, 'databases', `${dbName}.sql.gz`), dbEnv);
        }
      }
    } catch {}

    // Create manifest
    const manifest = { username: account.username, domain: account.domain, exported_at: new Date().toISOString() };
    await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Bundle everything
    await runFile('tar', ['-czf', archivePath, '-C', tmpDir, '.'], { timeout: 300000 });
    await fs.rm(tmpDir, { recursive: true, force: true });

    res.download(archivePath, archiveName);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Account expiry / auto-suspension (moved above /:id) ─ */

router.post('/:id/suspend', async (req: AuthRequest, res: Response) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  try {
    db.prepare("UPDATE accounts SET status='suspended' WHERE id=?").run(account.id);
    await fs.rename(path.join(VHOST_DIR, `${account.domain}.conf`), path.join(VHOST_DIR, `${account.domain}.conf.disabled`)).catch(() => {});
    await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/unsuspend', async (req: AuthRequest, res: Response) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  try {
    db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(account.id);
    await fs.rename(path.join(VHOST_DIR, `${account.domain}.conf.disabled`), path.join(VHOST_DIR, `${account.domain}.conf`)).catch(() => {});
    await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
