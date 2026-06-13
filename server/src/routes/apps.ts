import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import db from '../db';
import { requireRole } from '../middleware/auth';
import { runFile } from '../utils/process-runner';
import { createBackgroundJob } from '../background-jobs';

// Every mutating endpoint here shells out to pm2 via execFile. If pm2 isn't
// installed (fresh box that hasn't run the install.sh npm step yet) the
// spawn fails with bare ENOENT, which used to surface as a 500 with "spawn
// pm2 ENOENT" in the response. Pre-check pm2's presence and return a clean
// 503 instead. `pm2 jlist` in the read path stays as-is because it's
// wrapped in a try/catch that returns [] when pm2 is missing.
function pm2NotInstalled(res: Response): boolean {
  if (existsSync('/usr/local/bin/pm2') || existsSync('/usr/bin/pm2')) return false;
  res.status(503).json({ error: 'pm2 is not installed on this server. Install it with `npm install -g pm2` to use this feature.' });
  return true;
}

const router = Router();
const execFileAsync = promisify(execFile);
const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';

// Mutating endpoints in /api/apps run pm2/cp/rsync against operator-supplied
// paths and env vars. Keep them off reseller/readonly tokens — both the
// env-var injection vector and the staging cp/rsync would otherwise be open
// to anyone with a JWT.
const adminOnly = requireRole('superadmin', 'admin');

function buildEnvArg(envVarsJson: string | null | undefined): string[] {
  // Build pm2 --env-var=KEY1=val1,KEY2=val2 as a single argv element. Strip
  // characters that would be expanded inside double quotes if this ever lands
  // back in a shell (`, $, \), and forbid commas/newlines that would break
  // pm2's own parsing of the comma list.
  const obj = (() => { try { return JSON.parse(envVarsJson || '{}'); } catch { return {}; } })();
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) continue;
    const safeV = String(v).replace(/[`$\\"\r\n,]/g, '');
    parts.push(`${k}=${safeV}`);
  }
  return parts.length ? ['--env-var', parts.join(',')] : [];
}

function asyncRequested(value: unknown): boolean {
  return value === true || value === 'true';
}

/* ── List apps ───────────────────────────────────────────── */

router.get('/', async (_req: Request, res: Response) => {
  const apps = db.prepare('SELECT * FROM managed_apps ORDER BY created_at DESC').all() as any[];

  // Enrich with live PM2 status
  try {
    const { stdout } = await runFile('pm2', ['jlist']);
    const pm2list: any[] = JSON.parse(stdout);
    for (const app of apps) {
      const pm2 = pm2list.find((p: any) => p.name === app.name);
      if (pm2) {
        app.status  = pm2.pm2_env?.status || app.status;
        app.pm2_id  = String(pm2.pm_id);
        app.cpu     = pm2.monit?.cpu;
        app.memory  = pm2.monit?.memory;
        app.uptime  = pm2.pm2_env?.pm_uptime;
        app.restarts = pm2.pm2_env?.restart_time;
      }
    }
  } catch (_) {}

  res.json(apps);
});

/* ── Create / deploy app ─────────────────────────────────── */

const DOMAIN_RE   = /^[a-zA-Z0-9][a-zA-Z0-9.-]{1,253}[a-zA-Z0-9]$/;
const SAFE_PATH_RE = /^\/[a-zA-Z0-9_./ -]+$/;

function isSafePath(p: string): boolean {
  return SAFE_PATH_RE.test(p) && !/["$`\\!]/.test(p);
}

router.post('/', adminOnly, async (req: Request, res: Response) => {
  const { name, type, domain, port, start_script, working_dir, env_vars, async: isAsync } = req.body;
  if (!name || !domain || !port || !start_script || !working_dir) {
    return res.status(400).json({ error: 'name, domain, port, start_script, working_dir are required' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid app name' });
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) return res.status(400).json({ error: 'Invalid port' });
  if (!isSafePath(start_script)) return res.status(400).json({ error: 'Invalid start_script path' });
  if (!isSafePath(working_dir))  return res.status(400).json({ error: 'Invalid working_dir path' });

  const doCreate = async () => {
    if (!existsSync(working_dir)) {
      try { mkdirSync(working_dir, { recursive: true }); } catch (_) {}
    }
    const r = db.prepare(`
      INSERT INTO managed_apps (name, type, domain, port, start_script, working_dir, status, env_vars)
      VALUES (?, ?, ?, ?, ?, ?, 'stopped', ?)
    `).run(name, type || 'nodejs', domain, portNum, start_script, working_dir, JSON.stringify(env_vars || {}));

    // Create Apache reverse proxy vhost
    const vhostConf = `
<VirtualHost *:80>
  ServerName ${domain}
  ProxyPreserveHost On
  ProxyPass / http://127.0.0.1:${portNum}/
  ProxyPassReverse / http://127.0.0.1:${portNum}/
</VirtualHost>
`.trim();
    writeFileSync(path.join(VHOST_DIR, `app_${name}.conf`), vhostConf);
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));

    return db.prepare('SELECT * FROM managed_apps WHERE id = ?').get(r.lastInsertRowid) as any;
  };

  if (asyncRequested(isAsync)) {
    const jobId = createBackgroundJob({ type: 'app.create', resource: name }, async (ctx) => {
      ctx.progress(10, `Creating app ${name}`);
      const created = await doCreate();
      ctx.progress(90, `App ${name} created`);
      return created;
    });
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    res.json(await doCreate());
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'App name already exists' });
    res.status(500).json({ error: err.message });
  }
});

/* ── Control (start / stop / restart) ───────────────────── */

router.post('/:name/start', adminOnly, async (req: Request, res: Response) => {
  if (pm2NotInstalled(res)) return;
  const app = db.prepare('SELECT * FROM managed_apps WHERE name = ?').get(req.params.name) as any;
  if (!app) return res.status(404).json({ error: 'App not found' });
  try {
    await execFileAsync('pm2', [
      'start', app.start_script,
      '--name', app.name,
      ...buildEnvArg(app.env_vars),
      '--cwd', app.working_dir,
    ]);
    // pm2_id is the numeric process id pm2 assigns (see line ~48 where we
    // populate it from `pm2 jlist`'s pm_id). The previous bind wrote the
    // app *name* into pm2_id by accident, which made the column lie about
    // the actual pm2 process. Leave it NULL here; the next `pm2 jlist`
    // enrichment in the GET handler fills it with the real id.
    db.prepare("UPDATE managed_apps SET status='running', pm2_id=NULL WHERE name=?").run(app.name);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/stop', adminOnly, async (req: Request, res: Response) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid app name' });
  if (pm2NotInstalled(res)) return;
  try {
    await execFileAsync('pm2', ['stop', req.params.name]);
    db.prepare("UPDATE managed_apps SET status='stopped' WHERE name=?").run(req.params.name);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/restart', adminOnly, async (req: Request, res: Response) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid app name' });
  if (pm2NotInstalled(res)) return;
  try {
    await execFileAsync('pm2', ['restart', req.params.name]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/logs', async (req: Request, res: Response) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid app name' });
  if (pm2NotInstalled(res)) return;
  try {
    const { stdout } = await execFileAsync('pm2', ['logs', req.params.name, '--lines', '100', '--nostream']);
    res.json({ logs: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Delete app ──────────────────────────────────────────── */

router.delete('/:name', adminOnly, async (req: Request, res: Response) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid app name' });
  const app = db.prepare('SELECT * FROM managed_apps WHERE name = ?').get(req.params.name) as any;
  if (!app) return res.status(404).json({ error: 'App not found' });
  const { async: isAsync } = req.body || {};

  const doDelete = async () => {
    await execFileAsync('pm2', ['delete', app.name]).catch(() => {});
    const conf = path.join(VHOST_DIR, `app_${app.name}.conf`);
    if (existsSync(conf)) require('fs').unlinkSync(conf);
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));
    db.prepare('DELETE FROM managed_apps WHERE name = ?').run(app.name);
    return { success: true, appName: app.name };
  };

  if (asyncRequested(isAsync)) {
    const jobId = createBackgroundJob({ type: 'app.delete', resource: app.name }, async (ctx) => {
      ctx.progress(10, `Deleting app ${app.name}`);
      const result = await doDelete();
      ctx.progress(90, `App ${app.name} deleted`);
      return result;
    });
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    res.json(await doDelete());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Staging environments ────────────────────────────────── */

db.exec(`CREATE TABLE IF NOT EXISTS app_staging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_name TEXT NOT NULL,
  staging_name TEXT NOT NULL UNIQUE,
  staging_port INTEGER NOT NULL,
  staging_dir TEXT NOT NULL,
  branch TEXT DEFAULT 'staging',
  status TEXT DEFAULT 'stopped',
  created_at TEXT DEFAULT (datetime('now'))
)`);

router.get('/:name/staging', (req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM app_staging WHERE app_name = ?').all(req.params.name));
});

router.post('/:name/stage', adminOnly, async (req: Request, res: Response) => {
  const app = db.prepare('SELECT * FROM managed_apps WHERE name = ?').get(req.params.name) as any;
  if (!app) return res.status(404).json({ error: 'App not found' });
  const { port, branch = 'staging', async: isAsync } = req.body;
  if (!port) return res.status(400).json({ error: 'port required' });
  const stagingName = `${app.name}-staging`;
  const stagingDir = app.working_dir.replace(/\/?$/, '-staging');

  const doStage = async () => {
    if (!existsSync(stagingDir)) {
      await execFileAsync('cp', ['-r', app.working_dir, stagingDir]);
    }
    await execFileAsync('pm2', [
      'start', app.start_script,
      '--name', stagingName,
      ...buildEnvArg(app.env_vars),
      '--cwd', stagingDir,
    ]).catch(() => {});
    const r = db.prepare('INSERT OR REPLACE INTO app_staging (app_name, staging_name, staging_port, staging_dir, branch, status) VALUES (?, ?, ?, ?, ?, ?)').run(app.name, stagingName, parseInt(port), stagingDir, branch, 'running');
    return db.prepare('SELECT * FROM app_staging WHERE id = ?').get(r.lastInsertRowid) as any;
  };

  if (asyncRequested(isAsync)) {
    const jobId = createBackgroundJob({ type: 'app.stage', resource: app.name }, async (ctx) => {
      ctx.progress(10, `Creating staging environment for ${app.name}`);
      const staged = await doStage();
      ctx.progress(90, `Staging environment ${stagingName} ready`);
      return { stagingName: staged.staging_name, stagingPort: staged.staging_port, stagingDir: staged.staging_dir };
    });
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    res.json(await doStage());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/promote', adminOnly, async (req: Request, res: Response) => {
  const app = db.prepare('SELECT * FROM managed_apps WHERE name = ?').get(req.params.name) as any;
  if (!app) return res.status(404).json({ error: 'App not found' });
  const staging = db.prepare('SELECT * FROM app_staging WHERE app_name = ?').get(app.name) as any;
  if (!staging) return res.status(404).json({ error: 'No staging environment found' });
  const { async: isAsync } = req.body || {};

  const doPromote = async () => {
    await execFileAsync('pm2', ['stop', app.name]).catch(() => {});
    await runFile('rsync', ['-a', '--delete', `${staging.staging_dir}/`, `${app.working_dir}/`]);
    await execFileAsync('pm2', ['restart', app.name]);
    db.prepare("UPDATE managed_apps SET status='running' WHERE name=?").run(app.name);
    return { success: true, appName: app.name, message: `Staging promoted to production for ${app.name}` };
  };

  if (asyncRequested(isAsync)) {
    const jobId = createBackgroundJob({ type: 'app.promote', resource: app.name }, async (ctx) => {
      ctx.progress(10, `Promoting staging to production for ${app.name}`);
      const result = await doPromote();
      ctx.progress(90, result.message);
      return result;
    });
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }

  try {
    res.json(await doPromote());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:name/staging', adminOnly, async (req: Request, res: Response) => {
  const staging = db.prepare('SELECT * FROM app_staging WHERE app_name = ?').get(req.params.name) as any;
  if (!staging) return res.status(404).json({ error: 'No staging environment' });
  try {
    await execFileAsync('pm2', ['delete', staging.staging_name]).catch(() => {});
    db.prepare('DELETE FROM app_staging WHERE app_name = ?').run(req.params.name);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
