import { Router, Request, Response } from 'express';
import { runFile } from '../utils/process-runner';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import db from '../db';

const router = Router();
const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';
const WEBROOT   = process.env.WEBROOT   || '/var/www';

router.get('/', (_req: Request, res: Response) => {
  res.json(db.prepare(`
    SELECT ad.*, a.username, a.domain as account_domain
    FROM addon_domains ad
    LEFT JOIN accounts a ON ad.account_id = a.id
    ORDER BY ad.created_at DESC
  `).all());
});

router.post('/', async (req: Request, res: Response) => {
  const { account_id, domain, subdomain, document_root } = req.body;
  if (!account_id || !domain || !subdomain) return res.status(400).json({ error: 'account_id, domain, subdomain required' });
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(subdomain)) return res.status(400).json({ error: 'Invalid subdomain' });

  const resolvedWebroot = path.resolve(WEBROOT);
  const rawDocRoot = document_root || path.join(WEBROOT, subdomain, 'public_html');
  const docRoot = path.resolve(rawDocRoot);
  if (!docRoot.startsWith(resolvedWebroot)) return res.status(400).json({ error: 'Invalid document root' });
  try {
    mkdirSync(docRoot, { recursive: true });

    // Create Apache vhost
    const conf = `<VirtualHost *:80>
  ServerName ${domain}
  ServerAlias www.${domain}
  DocumentRoot ${docRoot}
  <Directory "${docRoot}">
    AllowOverride All
    Require all granted
  </Directory>
</VirtualHost>\n`;
    writeFileSync(path.join(VHOST_DIR, `${domain}.conf`), conf);
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));

    const r = db.prepare('INSERT INTO addon_domains (account_id, domain, subdomain, document_root) VALUES (?, ?, ?, ?)').run(account_id, domain, subdomain, docRoot);
    res.json(db.prepare('SELECT * FROM addon_domains WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Domain already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  const addon = db.prepare('SELECT * FROM addon_domains WHERE id = ?').get(req.params.id) as any;
  if (!addon) return res.status(404).json({ error: 'Not found' });
  try {
    await fs.rm(path.join(VHOST_DIR, `${addon.domain}.conf`), { force: true }).catch(() => {});
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));
    db.prepare('DELETE FROM addon_domains WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
