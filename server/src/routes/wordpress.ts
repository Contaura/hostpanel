import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import multer from 'multer';
import { existsSync, unlinkSync, readFileSync, promises as fsp } from 'fs';
import db from '../db';
import { requireRole } from '../middleware/auth';
import { runFile } from '../utils/process-runner';
import { createBackgroundJob } from '../background-jobs';

const router = Router();
const execFileAsync = promisify(execFile);
const WEBROOT = process.env.WEBROOT || '/var/www';

const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}$/;
const SLUG_RE   = /^[a-zA-Z0-9_-]+$/;

function wpPath(domain: string) {
  return path.join(WEBROOT, domain, 'public_html');
}

function wp(domain: string, args: string[]) {
  return runFile('wp', [`--path=${wpPath(domain)}`, '--allow-root', ...args], { timeout: 60000 });
}

function validateDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

/* ── Detect WP installs ──────────────────────────────────────── */

router.get('/sites', async (_req: Request, res: Response) => {
  try {
    // Detect installs by wp-includes/version.php (always present in any
    // WordPress codebase) rather than wp-config.php — that way half-installed
    // sites (files unpacked, config not yet written) still show up so the
    // user can finish setup instead of seeing an empty list.
    const { stdout } = await runFile('find', [WEBROOT, '-maxdepth', '5', '-path', '*/wp-includes/version.php']);
    const paths = stdout.trim().split('\n').filter(Boolean);
    const { existsSync } = await import('fs');
    const sites = paths.map(p => {
      // p ends in /<install_dir>/wp-includes/version.php; install_dir is two up.
      const installDir = path.dirname(path.dirname(p));
      const domainDir = path.dirname(installDir);
      const domain = path.basename(domainDir);
      const configured = existsSync(path.join(installDir, 'wp-config.php'));
      return { domain, path: installDir, configured };
    });
    res.json(sites);
  } catch { res.json([]); }
});

/* ── Install WordPress on a domain ──────────────────────── */

router.post('/:domain/install', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const {
    url, adminEmail, adminUser = 'admin', adminPass,
    title = 'My Site', dbName, dbUser, dbPass,
    async: runAsync,
  } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  if (!adminEmail || !adminPass) return res.status(400).json({ error: 'adminEmail and adminPass required' });
  if (!dbName || !dbUser || !dbPass) return res.status(400).json({ error: 'dbName, dbUser, dbPass required' });
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) return res.status(400).json({ error: 'Invalid dbName' });
  if (!/^[a-zA-Z0-9_]+$/.test(dbUser))  return res.status(400).json({ error: 'Invalid dbUser' });

  async function doInstall(ctx?: import('../background-jobs').JobContext) {
    ctx?.progress(5, 'Downloading WordPress core…');
    await wp(domain, ['core', 'download', '--skip-content']);
    ctx?.progress(30, 'Creating wp-config.php…');
    await wp(domain, [
      'config', 'create',
      `--dbname=${dbName}`, `--dbuser=${dbUser}`, `--dbpass=${dbPass}`,
      '--dbhost=127.0.0.1', '--skip-check',
    ]);
    ctx?.progress(50, 'Running database install…');
    await wp(domain, [
      'core', 'install',
      `--url=${url}`, `--title=${title}`,
      `--admin_user=${adminUser}`, `--admin_password=${adminPass}`,
      `--admin_email=${adminEmail}`, '--skip-email',
    ]);
    ctx?.progress(90, 'Verifying install…');
    const { stdout: ver } = await wp(domain, ['core', 'version']);
    return { domain, version: ver.trim(), url };
  }

  if (runAsync) {
    const jobId = createBackgroundJob(
      { type: 'wordpress.install', resource: domain, metadata: { domain, url }, createdBy: (req as any).user?.username || 'admin' },
      (ctx) => doInstall(ctx),
    );
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }
  try {
    const result = await doInstall();
    res.json(result);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Core info ───────────────────────────────────────────────── */

router.get('/:domain/info', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const [core, url] = await Promise.all([
      wp(domain, ['core', 'version']).catch(() => ({ stdout: 'unknown' })),
      wp(domain, ['option', 'get', 'siteurl']).catch(() => ({ stdout: '' })),
    ]);
    const updateCheck = await wp(domain, ['core', 'check-update', '--format=json']).catch(() => ({ stdout: '[]' }));
    let updates: any[] = [];
    try { updates = JSON.parse(updateCheck.stdout.trim()); } catch {}
    res.json({ version: core.stdout.trim(), url: url.stdout.trim(), core_updates: updates });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/core-update', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });

  const doCoreUpdate = async (ctx?: import('../background-jobs').JobContext) => {
    ctx?.progress(20, 'Updating WordPress core…');
    const { stdout } = await wp(domain, ['core', 'update']);
    return { domain, output: stdout };
  };

  if (req.body?.async === true) {
    const jobId = createBackgroundJob(
      { type: 'wordpress.core_update', resource: domain, metadata: { domain }, createdBy: (req as any).user?.username || 'admin' },
      (ctx) => doCoreUpdate(ctx),
    );
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    const result = await doCoreUpdate();
    res.json({ output: result.output });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Plugins ─────────────────────────────────────────────────── */

router.get('/:domain/plugins', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const { stdout } = await wp(domain, ['plugin', 'list', '--format=json']);
    res.json(JSON.parse(stdout.trim()));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/plugins/:slug/toggle', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid plugin slug' });
  const { active } = req.body;
  try {
    const action = active ? 'deactivate' : 'activate';
    const { stdout } = await wp(domain, ['plugin', action, slug]);
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/plugins/:slug/update', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid plugin slug' });

  const doPluginUpdate = async (ctx?: import('../background-jobs').JobContext) => {
    ctx?.progress(20, `Updating plugin ${slug}…`);
    const { stdout } = await wp(domain, ['plugin', 'update', slug]);
    return { domain, plugin: slug, output: stdout };
  };

  if (req.body?.async === true) {
    const jobId = createBackgroundJob(
      { type: 'wordpress.plugin_update', resource: `${domain}:${slug}`, metadata: { domain, plugin: slug }, createdBy: (req as any).user?.username || 'admin' },
      (ctx) => doPluginUpdate(ctx),
    );
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    const result = await doPluginUpdate();
    res.json({ output: result.output });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/plugins/:slug/delete', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid plugin slug' });
  try {
    await wp(domain, ['plugin', 'deactivate', slug]);
    const { stdout } = await wp(domain, ['plugin', 'delete', slug]);
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Themes ──────────────────────────────────────────────────── */

router.get('/:domain/themes', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const { stdout } = await wp(domain, ['theme', 'list', '--format=json']);
    res.json(JSON.parse(stdout.trim()));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/themes/:slug/activate', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid theme slug' });
  try {
    const { stdout } = await wp(domain, ['theme', 'activate', slug]);
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/themes/:slug/update', async (req: Request, res: Response) => {
  const { domain, slug } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Invalid theme slug' });

  const doThemeUpdate = async (ctx?: import('../background-jobs').JobContext) => {
    ctx?.progress(20, `Updating theme ${slug}…`);
    const { stdout } = await wp(domain, ['theme', 'update', slug]);
    return { domain, theme: slug, output: stdout };
  };

  if (req.body?.async === true) {
    const jobId = createBackgroundJob(
      { type: 'wordpress.theme_update', resource: `${domain}:${slug}`, metadata: { domain, theme: slug }, createdBy: (req as any).user?.username || 'admin' },
      (ctx) => doThemeUpdate(ctx),
    );
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    const result = await doThemeUpdate();
    res.json({ output: result.output });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Update all ──────────────────────────────────────────────── */

router.post('/:domain/update-all', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });

  const doUpdateAll = async (ctx?: import('../background-jobs').JobContext) => {
    ctx?.progress(10, 'Updating WordPress core…');
    const core = await wp(domain, ['core', 'update']).catch((e: any) => ({ stdout: e.message }));
    ctx?.progress(45, 'Updating WordPress plugins…');
    const plugins = await wp(domain, ['plugin', 'update', '--all']).catch((e: any) => ({ stdout: e.message }));
    ctx?.progress(75, 'Updating WordPress themes…');
    const themes = await wp(domain, ['theme', 'update', '--all']).catch((e: any) => ({ stdout: e.message }));
    return { domain, core: core.stdout, plugins: plugins.stdout, themes: themes.stdout };
  };

  if (req.body?.async === true) {
    const jobId = createBackgroundJob(
      { type: 'wordpress.update_all', resource: domain, metadata: { domain }, createdBy: (req as any).user?.username || 'admin' },
      (ctx) => doUpdateAll(ctx),
    );
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    res.json(await doUpdateAll());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Search-replace (URL migration) ─────────────────────────── */

router.post('/:domain/search-replace', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const { search, replace, async: runAsync } = req.body;
  if (!search || !replace) return res.status(400).json({ error: 'search and replace required' });
  if (typeof search !== 'string' || typeof replace !== 'string') {
    return res.status(400).json({ error: 'search and replace must be strings' });
  }

  const doSearchReplace = async (ctx?: import('../background-jobs').JobContext) => {
    ctx?.progress(20, 'Running WordPress database search-replace…');
    // argv form — the previous shell-string interpolation let a search value
    // like `"; rm -rf / #` break out of the double quotes.
    const { stdout } = await runFile('wp', [
      `--path=${wpPath(domain)}`,
      '--allow-root',
      'search-replace',
      search,
      replace,
      '--all-tables',
    ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
    return { domain, output: stdout };
  };

  if (runAsync === true) {
    const jobId = createBackgroundJob(
      { type: 'wordpress.search_replace', resource: domain, metadata: { domain }, createdBy: (req as any).user?.username || 'admin' },
      (ctx) => doSearchReplace(ctx),
    );
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    const result = await doSearchReplace();
    res.json({ output: result.output });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Plugin / Theme zip upload ───────────────────────────────── */

const zipUpload = multer({ dest: '/tmp/', limits: { fileSize: 100 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { cb(null, file.originalname.endsWith('.zip')); } });

router.post('/:domain/plugins/upload', zipUpload.single('zip'), async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!req.file) return res.status(400).json({ error: 'No zip file uploaded' });

  const zipPath = req.file.path;
  const doPluginUpload = async (ctx?: import('../background-jobs').JobContext) => {
    try {
      ctx?.progress(20, 'Installing uploaded plugin zip…');
      const { stdout } = await wp(domain, ['plugin', 'install', zipPath, '--activate']);
      return { domain, output: stdout };
    } finally {
      if (existsSync(zipPath)) unlinkSync(zipPath);
    }
  };

  if (req.body?.async === true || req.body?.async === 'true') {
    const jobId = createBackgroundJob(
      { type: 'wordpress.plugin_upload', resource: domain, metadata: { domain }, createdBy: (req as any).user?.username || 'admin' },
      (ctx) => doPluginUpload(ctx),
    );
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    const result = await doPluginUpload();
    res.json({ output: result.output });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:domain/themes/upload', zipUpload.single('zip'), async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!req.file) return res.status(400).json({ error: 'No zip file uploaded' });

  const zipPath = req.file.path;
  const doThemeUpload = async (ctx?: import('../background-jobs').JobContext) => {
    try {
      ctx?.progress(20, 'Installing uploaded theme zip…');
      const { stdout } = await wp(domain, ['theme', 'install', zipPath]);
      return { domain, output: stdout };
    } finally {
      if (existsSync(zipPath)) unlinkSync(zipPath);
    }
  };

  if (req.body?.async === true || req.body?.async === 'true') {
    const jobId = createBackgroundJob(
      { type: 'wordpress.theme_upload', resource: domain, metadata: { domain }, createdBy: (req as any).user?.username || 'admin' },
      (ctx) => doThemeUpload(ctx),
    );
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    const result = await doThemeUpload();
    res.json({ output: result.output });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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

const SCHEDULE_MAP: Record<string, string> = {
  daily:   '0 3 * * *',
  weekly:  '0 3 * * 0',
  monthly: '0 3 1 * *',
};

async function syncWpCrontab() {
  const jobs = db.prepare('SELECT * FROM wp_auto_updates').all() as any[];
  try {
    const { stdout } = await runFile('crontab', ['-l']).catch(() => ({ stdout: '', stderr: '' }));
    const existing = stdout.split('\n').filter(l => !l.includes('# wp-autoupdate:'));
    const newEntries = jobs.map(j => {
      const sched = SCHEDULE_MAP[j.schedule] || SCHEDULE_MAP.weekly;
      const parts: string[] = [];
      if (j.update_core)    parts.push('core update');
      if (j.update_plugins) parts.push('plugin update --all');
      if (j.update_themes)  parts.push('theme update --all');
      if (!parts.length) return null;
      // domain comes from the wp_auto_updates table, which is only written
      // through the PUT /auto-updates/:domain validator above (DOMAIN regex),
      // so it's safe to embed in this crontab command string.
      const cmds = parts.map(p => `wp --path="${wpPath(j.domain)}" --allow-root ${p}`).join(' && ');
      return `${sched} ${cmds} # wp-autoupdate:${j.domain}`;
    }).filter(Boolean);
    const { writeFileSync, unlinkSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const tmp = join(tmpdir(), `cron_wp_${Date.now()}`);
    writeFileSync(tmp, [...existing, ...newEntries].join('\n') + '\n');
    await runFile('crontab', [tmp]);
    try { unlinkSync(tmp); } catch {}
  } catch {}
}

router.put('/auto-updates/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const { update_core = 1, update_plugins = 1, update_themes = 1, schedule = 'weekly' } = req.body;
  db.prepare(`
    INSERT INTO wp_auto_updates (domain, update_core, update_plugins, update_themes, schedule)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET update_core=excluded.update_core, update_plugins=excluded.update_plugins, update_themes=excluded.update_themes, schedule=excluded.schedule
  `).run(domain, update_core ? 1 : 0, update_plugins ? 1 : 0, update_themes ? 1 : 0, schedule);
  await syncWpCrontab();
  res.json({ success: true });
});

router.delete('/auto-updates/:domain', async (req: Request, res: Response) => {
  db.prepare('DELETE FROM wp_auto_updates WHERE domain = ?').run(req.params.domain);
  await syncWpCrontab();
  res.json({ success: true });
});

/* ── Uninstall WordPress from a domain ───────────────────────── */

// Standard WordPress file/dir names — only these get removed, so anything
// custom the user dropped into public_html (other apps, static files,
// /.well-known) is preserved. Glob like wp-* would also catch unrelated
// directories the operator may have named that way, so we list explicitly.
const WP_PATHS = [
  'wp-admin', 'wp-content', 'wp-includes',
  'index.php', 'license.txt', 'readme.html', 'xmlrpc.php',
  'wp-activate.php', 'wp-blog-header.php', 'wp-comments-post.php',
  'wp-config.php', 'wp-config-sample.php', 'wp-cron.php', 'wp-links-opml.php',
  'wp-load.php', 'wp-login.php', 'wp-mail.php', 'wp-settings.php',
  'wp-signup.php', 'wp-trackback.php',
];

const adminOnly = requireRole('superadmin', 'admin');

function parseWpConfigDb(installDir: string): string | null {
  // Pull DB_NAME out of wp-config.php so we know which database to drop on
  // uninstall. Returns null if the file is missing or the constant isn't set
  // — in that case we just skip the DB drop.
  try {
    const content = readFileSync(path.join(installDir, 'wp-config.php'), 'utf8');
    const m = content.match(/define\s*\(\s*['"]DB_NAME['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
    return m && /^[a-zA-Z0-9_]+$/.test(m[1]) ? m[1] : null;
  } catch {
    return null;
  }
}

router.delete('/:domain', adminOnly, async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!validateDomain(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const dropDb = req.query.dropDb !== '0' && req.query.dropDb !== 'false';

  const installDir = wpPath(domain);
  if (!existsSync(path.join(installDir, 'wp-includes', 'version.php'))) {
    return res.status(404).json({ error: 'No WordPress install found at this domain' });
  }

  const dbName = dropDb ? parseWpConfigDb(installDir) : null;

  try {
    // Remove WP files / dirs one by one — never `rm -rf installDir` because
    // public_html may also hold non-WordPress content the operator wants.
    for (const name of WP_PATHS) {
      await fsp.rm(path.join(installDir, name), { recursive: true, force: true });
    }
    // Drop the WP database if we found one and the caller didn't opt out.
    // The DB user is left in place — it may be reused for other databases,
    // and the operator can clean it up from the Database Manager.
    let dbDropped = false;
    if (dbName) {
      const dbEnv: NodeJS.ProcessEnv = { ...process.env };
      if (process.env.DB_ROOT_PASS) dbEnv.MYSQL_PWD = process.env.DB_ROOT_PASS;
      const dbUser = process.env.DB_ROOT_USER || 'root';
      await execFileAsync('mysql', [`-u${dbUser}`, '-e', `DROP DATABASE IF EXISTS \`${dbName}\``], { env: dbEnv });
      dbDropped = true;
    }
    // Forget any auto-update schedule for this domain so syncWpCrontab
    // doesn't keep trying to update files that no longer exist.
    db.prepare('DELETE FROM wp_auto_updates WHERE domain = ?').run(domain);
    await syncWpCrontab();

    res.json({ success: true, dbDropped, dbName, domain });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
