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

export default router;
