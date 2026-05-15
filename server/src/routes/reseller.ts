import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db';
import { requireRole } from '../middleware/auth';

const router = Router();

// Only superadmin/admin can manage reseller accounts. Without this, a
// reseller-role token could create siblings, raise its own allocations via
// PUT /:id, or delete other resellers' admin_users rows.
const adminOnly = requireRole('superadmin', 'admin');

/* ── List resellers ──────────────────────────────────────── */

router.get('/', adminOnly, (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT r.*, u.username, u.email, u.role,
           COUNT(DISTINCT a.id) as account_count,
           COUNT(DISTINCT c.id) as client_count
    FROM resellers r
    LEFT JOIN admin_users u ON r.admin_user_id = u.id
    LEFT JOIN accounts a    ON a.id IN (
      SELECT account_id FROM invoices WHERE client_id IN (SELECT id FROM clients WHERE id IN (SELECT DISTINCT client_id FROM accounts))
    )
    LEFT JOIN clients c ON c.id > 0
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(rows);
});

/* ── Create reseller account ─────────────────────────────── */

router.post('/', adminOnly, async (req: Request, res: Response) => {
  const { username, email, password, company, alloc_disk, alloc_bandwidth, alloc_accounts, alloc_emails, alloc_dbs } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'username, email, password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const r = db.prepare("INSERT INTO admin_users (username, email, password_hash, role) VALUES (?, ?, ?, 'reseller')").run(username, email, hash);
    const adminId = r.lastInsertRowid;
    const r2 = db.prepare(`
      INSERT INTO resellers (admin_user_id, company, alloc_disk, alloc_bandwidth, alloc_accounts, alloc_emails, alloc_dbs)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(adminId, company || '', alloc_disk ?? 102400, alloc_bandwidth ?? 1024000, alloc_accounts ?? 10, alloc_emails ?? 50, alloc_dbs ?? 20);
    res.json(db.prepare('SELECT r.*, u.username, u.email FROM resellers r LEFT JOIN admin_users u ON r.admin_user_id = u.id WHERE r.id = ?').get(r2.lastInsertRowid));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: err.message });
  }
});

/* ── Update reseller allocations ─────────────────────────── */

router.put('/:id', adminOnly, (req: Request, res: Response) => {
  const { company, alloc_disk, alloc_bandwidth, alloc_accounts, alloc_emails, alloc_dbs } = req.body;
  db.prepare('UPDATE resellers SET company=?, alloc_disk=?, alloc_bandwidth=?, alloc_accounts=?, alloc_emails=?, alloc_dbs=? WHERE id=?')
    .run(company, alloc_disk, alloc_bandwidth, alloc_accounts, alloc_emails, alloc_dbs, req.params.id);
  res.json(db.prepare('SELECT * FROM resellers WHERE id = ?').get(req.params.id));
});

/* ── Delete reseller ─────────────────────────────────────── */

router.delete('/:id', adminOnly, (req: Request, res: Response) => {
  const reseller = db.prepare('SELECT * FROM resellers WHERE id = ?').get(req.params.id) as any;
  if (!reseller) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(reseller.admin_user_id);
  db.prepare('DELETE FROM resellers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── Reseller WHM summary with real usage ────────────────── */

router.get('/:id/summary', adminOnly, async (req: Request, res: Response) => {
  const reseller = db.prepare('SELECT r.*, u.username FROM resellers r LEFT JOIN admin_users u ON r.admin_user_id = u.id WHERE r.id = ?').get(req.params.id) as any;
  if (!reseller) return res.status(404).json({ error: 'Not found' });

  // Accounts owned by this reseller (matched by reseller_id column if exists, else by admin user)
  const accounts = db.prepare(`SELECT * FROM accounts WHERE reseller_id = ? OR (reseller_id IS NULL AND 0=1)`)
    .all(reseller.id) as any[];

  const accountCount = accounts.length;
  const clientIds = [...new Set(accounts.map((a: any) => a.client_id).filter(Boolean))];
  const clientCount = clientIds.length;

  // Disk usage
  let diskBytes = 0;
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const ea = promisify(exec);
  for (const acc of accounts) {
    try {
      const { stdout } = await ea(`du -sb "/var/www/${acc.domain}" 2>/dev/null || echo 0`);
      diskBytes += parseInt(stdout.trim().split(/\s+/)[0]) || 0;
    } catch {}
  }

  res.json({
    reseller,
    usage: {
      accounts: accountCount,
      clients: clientCount,
      disk_bytes: diskBytes,
      disk_mb: Math.round(diskBytes / 1024 / 1024),
    },
    alloc: {
      disk_mb: reseller.alloc_disk,
      accounts: reseller.alloc_accounts,
      emails: reseller.alloc_emails,
      databases: reseller.alloc_dbs,
    },
  });
});

export default router;
