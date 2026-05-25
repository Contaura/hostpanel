import { Router, Request, Response } from 'express';
import db from '../db';
import { runFile } from '../utils/process-runner';

const router = Router();
db.exec(`CREATE TABLE IF NOT EXISTS webdav_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  home TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  permissions TEXT NOT NULL DEFAULT 'rw',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
const validUser = (s: string) => /^[a-zA-Z0-9._-]{3,64}$/.test(s);
const validPath = (s: string) => typeof s === 'string' && s.startsWith('/var/www/') && !s.includes('..');
function config(row: any) { return `Alias /webdav/${row.username} ${row.home}\n<Directory ${row.home}>\n  DAV On\n  AuthType Basic\n  AuthName "HostPanel Web Disk"\n  AuthUserFile /etc/httpd/.hostpanel-webdav-passwd\n  Require user ${row.username}\n</Directory>\n`; }
router.get('/', (_req: Request, res: Response) => res.json(db.prepare('SELECT * FROM webdav_accounts ORDER BY username').all()));
router.post('/', (req: Request, res: Response) => {
  const { username, home, domain = '', enabled = 1, permissions = 'rw' } = req.body || {};
  if (!validUser(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!validPath(home)) return res.status(400).json({ error: 'home must be under /var/www' });
  db.prepare(`INSERT INTO webdav_accounts (username, home, domain, enabled, permissions, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(username) DO UPDATE SET home=excluded.home, domain=excluded.domain, enabled=excluded.enabled, permissions=excluded.permissions, updated_at=datetime('now')`).run(username, home, domain, enabled ? 1 : 0, permissions === 'ro' ? 'ro' : 'rw');
  res.json(db.prepare('SELECT * FROM webdav_accounts WHERE username=?').get(username));
});
router.delete('/:id', (req: Request, res: Response) => { db.prepare('DELETE FROM webdav_accounts WHERE id=?').run(req.params.id); res.json({ success: true }); });
router.get('/config-preview', (_req: Request, res: Response) => { const rows = db.prepare('SELECT * FROM webdav_accounts WHERE enabled=1 ORDER BY username').all() as any[]; res.type('text/plain').send(rows.map(config).join('\n')); });
router.post('/reload', async (_req: Request, res: Response) => { const result = await runFile('systemctl', ['reload', 'httpd']).catch((e: any) => ({ stdout: '', stderr: e.message })); res.json({ reloaded: !result.stderr, output: result.stdout || result.stderr }); });
export default router;
