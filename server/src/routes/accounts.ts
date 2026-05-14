import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import bcrypt from 'bcryptjs';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

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
    await execAsync('systemctl reload httpd 2>/dev/null || true');

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
    await execAsync('systemctl reload httpd 2>/dev/null || true');
    db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accounts/:id/usage — disk usage for account's webroot dir
router.get('/:id/usage', async (req: AuthRequest, res: Response) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const accountDir = path.join(WEBROOT, account.username || account.domain);
  try {
    // Disk usage
    let diskBytes = 0;
    let breakdown: { dir: string; bytes: number }[] = [];
    try {
      const { stdout } = await execAsync(`du -sb "${accountDir}" 2>/dev/null`);
      diskBytes = parseInt(stdout.split('\t')[0]) || 0;
      // Breakdown by top-level subdir
      const { stdout: sub } = await execAsync(`du -sb "${accountDir}"/* 2>/dev/null | sort -rn | head -10`);
      breakdown = sub.trim().split('\n').filter(Boolean).map(line => {
        const [bytes, dir] = line.split('\t');
        return { dir: dir?.replace(accountDir + '/', '') || dir, bytes: parseInt(bytes) || 0 };
      });
    } catch {}

    // File count
    let fileCount = 0;
    try {
      const { stdout } = await execAsync(`find "${accountDir}" -type f 2>/dev/null | wc -l`);
      fileCount = parseInt(stdout.trim()) || 0;
    } catch {}

    res.json({ disk_bytes: diskBytes, file_count: fileCount, breakdown, directory: accountDir });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Full account export / migration ────────────────────── */

router.post('/:id/export', async (req: AuthRequest, res: Response) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/hostpanel';
  const { execSync } = await import('child_process');
  try {
    const { mkdirSync: mkdir, existsSync: exists } = await import('fs');
    if (!exists(BACKUP_DIR)) mkdir(BACKUP_DIR, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archiveName = `account_${account.username}_${ts}.tar.gz`;
    const archivePath = path.join(BACKUP_DIR, archiveName);
    const tmpDir = `/tmp/hp_export_${account.username}_${Date.now()}`;

    // Collect files
    const webDir = path.join(WEBROOT, account.username);
    await execAsync(`mkdir -p "${tmpDir}/files" "${tmpDir}/databases"`);
    if (exists(webDir)) {
      await execAsync(`tar -czf "${tmpDir}/files/files.tar.gz" -C "${path.dirname(webDir)}" "${account.username}" 2>/dev/null || true`, { timeout: 300000 });
    }

    // Dump all databases owned by this account user
    const user = process.env.DB_ROOT_USER || 'root';
    const pass = process.env.DB_ROOT_PASS || '';
    const passArg = pass ? `-p${pass}` : '';
    try {
      const { stdout: dbs } = await execAsync(`mysql -u${user} ${passArg} -e "SHOW DATABASES LIKE '${account.username}%'" -N 2>/dev/null`);
      for (const dbName of dbs.split('\n').filter(Boolean)) {
        if (/^[a-zA-Z0-9_]+$/.test(dbName)) {
          await execAsync(`mysqldump -u${user} ${passArg} ${dbName} | gzip > "${tmpDir}/databases/${dbName}.sql.gz"`, { timeout: 300000 });
        }
      }
    } catch {}

    // Create manifest
    const manifest = { username: account.username, domain: account.domain, exported_at: new Date().toISOString() };
    await execAsync(`echo '${JSON.stringify(manifest)}' > "${tmpDir}/manifest.json"`);

    // Bundle everything
    await execAsync(`tar -czf "${archivePath}" -C "${tmpDir}" . && rm -rf "${tmpDir}"`, { timeout: 300000 });

    res.download(archivePath, archiveName);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Account expiry / auto-suspension ───────────────────── */

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
      await execAsync(`mv "${path.join(VHOST_DIR, `${acc.domain}.conf`)}" "${path.join(VHOST_DIR, `${acc.domain}.conf.disabled`)}" 2>/dev/null || true`);
    } catch {}
    suspended.push(acc.username);
  }

  if (suspended.length > 0) {
    await execAsync('systemctl reload httpd 2>/dev/null || true').catch(() => {});
  }

  res.json({ checked: expired.length, suspended });
});

router.post('/:id/suspend', async (req: AuthRequest, res: Response) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  try {
    db.prepare("UPDATE accounts SET status='suspended' WHERE id=?").run(account.id);
    await execAsync(`mv "${path.join(VHOST_DIR, `${account.domain}.conf`)}" "${path.join(VHOST_DIR, `${account.domain}.conf.disabled`)}" 2>/dev/null || true`);
    await execAsync('systemctl reload httpd 2>/dev/null || true').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/unsuspend', async (req: AuthRequest, res: Response) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as any;
  if (!account) return res.status(404).json({ error: 'Account not found' });
  try {
    db.prepare("UPDATE accounts SET status='active' WHERE id=?").run(account.id);
    await execAsync(`mv "${path.join(VHOST_DIR, `${account.domain}.conf.disabled`)}" "${path.join(VHOST_DIR, `${account.domain}.conf`)}" 2>/dev/null || true`);
    await execAsync('systemctl reload httpd 2>/dev/null || true').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
