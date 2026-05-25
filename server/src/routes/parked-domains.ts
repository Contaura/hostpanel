import { Router, Response } from 'express';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { runFile } from '../utils/process-runner';
import path from 'path';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';

db.prepare(`CREATE TABLE IF NOT EXISTS parked_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  primary_domain TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`).run();

router.get('/', (_req: AuthRequest, res: Response) => {
  res.json(db.prepare('SELECT * FROM parked_domains ORDER BY created_at DESC').all());
});

const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{1,253}[a-zA-Z0-9]$/;

router.post('/', async (req: AuthRequest, res: Response) => {
  const { domain, primary_domain } = req.body;
  if (!domain || !primary_domain) return res.status(400).json({ error: 'domain and primary_domain required' });
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!DOMAIN_RE.test(primary_domain)) return res.status(400).json({ error: 'Invalid primary_domain' });

  const conf = path.join(VHOST_DIR, `parked-${domain}.conf`);
  writeFileSync(conf, `<VirtualHost *:80>
    ServerName ${domain}
    ServerAlias www.${domain}
    Redirect permanent / http://${primary_domain}/
</VirtualHost>
`);
  await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));

  const r = db.prepare('INSERT INTO parked_domains (domain, primary_domain) VALUES (?, ?)').run(domain, primary_domain);
  res.json(db.prepare('SELECT * FROM parked_domains WHERE id = ?').get(r.lastInsertRowid));
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const row = db.prepare('SELECT * FROM parked_domains WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Not found' });

  const conf = path.join(VHOST_DIR, `parked-${row.domain}.conf`);
  if (existsSync(conf)) unlinkSync(conf);
  await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));

  db.prepare('DELETE FROM parked_domains WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

export default router;
