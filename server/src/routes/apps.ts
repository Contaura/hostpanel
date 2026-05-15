import { Router, Request, Response } from 'express';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import db from '../db';
import { requireRole } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);
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

/* ── List apps ───────────────────────────────────────────── */

router.get('/', async (_req: Request, res: Response) => {
  const apps = db.prepare('SELECT * FROM managed_apps ORDER BY created_at DESC').all() as any[];

  // Enrich with live PM2 status
  try {
    const { stdout } = await execAsync('pm2 jlist 2>/dev/null');
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
  const { name, type, domain, port, start_script, working_dir, env_vars } = req.body;
  if (!name || !domain || !port || !start_script || !working_dir) {
    return res.status(400).json({ error: 'name, domain, port, start_script, working_dir are required' });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ error: 'Invalid app name' });
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) return res.status(400).json({ error: 'Invalid port' });
  if (!isSafePath(start_script)) return res.status(400).json({ error: 'Invalid start_script path' });
  if (!isSafePath(working_dir))  return res.status(400).json({ error: 'Invalid working_dir path' });
  if (!existsSync(working_dir)) {
    try { mkdirSync(working_dir, { recursive: true }); } catch (_) {}
  }

  try {
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
    await execAsync('apachectl graceful').catch(() => {});

    res.json(db.prepare('SELECT * FROM managed_apps WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'App name already exists' });
    res.status(500).json({ error: err.message });
  }
});

/* ── Control (start / stop / restart) ───────────────────── */

router.post('/:name/start', adminOnly, async (req: Request, res: Response) => {
  const app = db.prepare('SELECT * FROM managed_apps WHERE name = ?').get(req.params.name) as any;
  if (!app) return res.status(404).json({ error: 'App not found' });
  try {
    await execFileAsync('pm2', [
      'start', app.start_script,
      '--name', app.name,
      ...buildEnvArg(app.env_vars),
      '--cwd', app.working_dir,
    ]);
    db.prepare("UPDATE managed_apps SET status='running', pm2_id=? WHERE name=?").run(app.name, app.name);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/stop', adminOnly, async (req: Request, res: Response) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid app name' });
  try {
    await execFileAsync('pm2', ['stop', req.params.name]);
    db.prepare("UPDATE managed_apps SET status='stopped' WHERE name=?").run(req.params.name);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/restart', adminOnly, async (req: Request, res: Response) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid app name' });
  try {
    await execFileAsync('pm2', ['restart', req.params.name]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/logs', async (req: Request, res: Response) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.name)) return res.status(400).json({ error: 'Invalid app name' });
  try {
    const { stdout } = await execFileAsync('pm2', ['logs', req.params.name, '--lines', '100', '--nostream']);
    res.json({ logs: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Delete app ──────────────────────────────────────────── */

router.delete('/:name', adminOnly, async (req: Request, res: Response) => {
  const app = db.prepare('SELECT * FROM managed_apps WHERE name = ?').get(req.params.name) as any;
  if (!app) return res.status(404).json({ error: 'App not found' });
  try {
    await execFileAsync('pm2', ['delete', app.name]).catch(() => {});
    const conf = path.join(VHOST_DIR, `app_${app.name}.conf`);
    if (existsSync(conf)) require('fs').unlinkSync(conf);
    await execAsync('apachectl graceful').catch(() => {});
    db.prepare('DELETE FROM managed_apps WHERE name = ?').run(app.name);
    res.json({ success: true });
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
  const { port, branch = 'staging' } = req.body;
  if (!port) return res.status(400).json({ error: 'port required' });
  const stagingName = `${app.name}-staging`;
  const stagingDir = app.working_dir.replace(/\/?$/, '-staging');
  try {
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
    res.json(db.prepare('SELECT * FROM app_staging WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:name/promote', adminOnly, async (req: Request, res: Response) => {
  const app = db.prepare('SELECT * FROM managed_apps WHERE name = ?').get(req.params.name) as any;
  if (!app) return res.status(404).json({ error: 'App not found' });
  const staging = db.prepare('SELECT * FROM app_staging WHERE app_name = ?').get(app.name) as any;
  if (!staging) return res.status(404).json({ error: 'No staging environment found' });
  try {
    await execFileAsync('pm2', ['stop', app.name]).catch(() => {});
    await execFileAsync('rsync', ['-a', '--delete', `${staging.staging_dir}/`, `${app.working_dir}/`]);
    await execFileAsync('pm2', ['restart', app.name]);
    db.prepare("UPDATE managed_apps SET status='running' WHERE name=?").run(app.name);
    res.json({ success: true, message: `Staging promoted to production for ${app.name}` });
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
