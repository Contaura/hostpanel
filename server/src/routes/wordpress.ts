import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import db from '../db';

const router = Router();
const execAsync = promisify(exec);
const WEBROOT = process.env.WEBROOT || '/var/www';

function wpPath(domain: string) {
  return path.join(WEBROOT, domain, 'public_html');
}

function wp(domain: string, cmd: string) {
  return execAsync(`wp --path="${wpPath(domain)}" --allow-root ${cmd} 2>&1`, { timeout: 60000 });
}

/* ── Detect WP installs ──────────────────────────────────────── */

router.get('/sites', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync(`find ${WEBROOT} -name "wp-config.php" -maxdepth 4 2>/dev/null`);
    const paths = stdout.trim().split('\n').filter(Boolean);
    const sites = paths.map(p => {
      const parts = p.split('/');
      const domain = parts[parts.length - 3] || parts[parts.length - 2];
      return { domain, path: path.dirname(p) };
    });
    res.json(sites);
  } catch { res.json([]); }
});

/* ── Core info ───────────────────────────────────────────────── */

router.get('/:domain/info', async (req: Request, res: Response) => {
  const { domain } = req.params;
  try {
    const [core, url] = await Promise.all([
      wp(domain, 'core version').catch(() => ({ stdout: 'unknown' })),
      wp(domain, 'option get siteurl').catch(() => ({ stdout: '' })),
    ]);
    const updateCheck = await wp(domain, 'core check-update --format=json').catch(() => ({ stdout: '[]' }));
    let updates: any[] = [];
    try { updates = JSON.parse(updateCheck.stdout.trim()); } catch {}
    res.json({ version: core.stdout.trim(), url: url.stdout.trim(), core_updates: updates });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/core-update', async (req: Request, res: Response) => {
  const { domain } = req.params;
  try {
    const { stdout } = await wp(domain, 'core update');
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Plugins ─────────────────────────────────────────────────── */

router.get('/:domain/plugins', async (req: Request, res: Response) => {
  const { domain } = req.params;
  try {
    const { stdout } = await wp(domain, 'plugin list --format=json');
    res.json(JSON.parse(stdout.trim()));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/plugins/:slug/toggle', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  const { active } = req.body;
  try {
    const action = active ? 'deactivate' : 'activate';
    const { stdout } = await wp(domain, `plugin ${action} ${slug}`);
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/plugins/:slug/update', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  try {
    const { stdout } = await wp(domain, `plugin update ${slug}`);
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/plugins/:slug/delete', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  try {
    await wp(domain, `plugin deactivate ${slug}`);
    const { stdout } = await wp(domain, `plugin delete ${slug}`);
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Themes ──────────────────────────────────────────────────── */

router.get('/:domain/themes', async (req: Request, res: Response) => {
  const { domain } = req.params;
  try {
    const { stdout } = await wp(domain, 'theme list --format=json');
    res.json(JSON.parse(stdout.trim()));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/themes/:slug/activate', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  try {
    const { stdout } = await wp(domain, `theme activate ${slug}`);
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/themes/:slug/update', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  try {
    const { stdout } = await wp(domain, `theme update ${slug}`);
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Update all ──────────────────────────────────────────────── */

router.post('/:domain/update-all', async (req: Request, res: Response) => {
  const { domain } = req.params;
  try {
    const [core, plugins, themes] = await Promise.all([
      wp(domain, 'core update').catch(e => ({ stdout: e.message })),
      wp(domain, 'plugin update --all').catch(e => ({ stdout: e.message })),
      wp(domain, 'theme update --all').catch(e => ({ stdout: e.message })),
    ]);
    res.json({ core: core.stdout, plugins: plugins.stdout, themes: themes.stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Search-replace (URL migration) ─────────────────────────── */

router.post('/:domain/search-replace', async (req: Request, res: Response) => {
  const { domain } = req.params;
  const { search, replace } = req.body;
  if (!search || !replace) return res.status(400).json({ error: 'search and replace required' });
  try {
    const { stdout } = await wp(domain, `search-replace "${search}" "${replace}" --all-tables`);
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Auto-update scheduler ───────────────────────────────────── */

// Ensure table exists
db.exec(`CREATE TABLE IF NOT EXISTS wp_auto_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  update_core INTEGER DEFAULT 1,
  update_plugins INTEGER DEFAULT 1,
  update_themes INTEGER DEFAULT 1,
  schedule TEXT DEFAULT 'weekly',
  created_at TEXT DEFAULT (datetime('now'))
)`);

router.get('/auto-updates', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM wp_auto_updates').all());
});

router.put('/auto-updates/:domain', (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const { update_core = 1, update_plugins = 1, update_themes = 1, schedule = 'weekly' } = req.body;
  db.prepare(`
    INSERT INTO wp_auto_updates (domain, update_core, update_plugins, update_themes, schedule)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET update_core=excluded.update_core, update_plugins=excluded.update_plugins, update_themes=excluded.update_themes, schedule=excluded.schedule
  `).run(domain, update_core ? 1 : 0, update_plugins ? 1 : 0, update_themes ? 1 : 0, schedule);
  res.json({ success: true });
});

router.delete('/auto-updates/:domain', (req: Request, res: Response) => {
  db.prepare('DELETE FROM wp_auto_updates WHERE domain = ?').run(req.params.domain);
  res.json({ success: true });
});

export default router;

