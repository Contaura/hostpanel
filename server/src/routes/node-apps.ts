import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);
const WEBROOT = process.env.WEBROOT || '/var/www';

async function pm2List() {
  try {
    const { stdout } = await execAsync('pm2 jlist 2>/dev/null');
    return JSON.parse(stdout || '[]');
  } catch { return []; }
}

/* ── Node.js / PM2 ────────────────────────────────────────── */

router.get('/node', async (_req: AuthRequest, res: Response) => {
  try {
    const apps = await pm2List();
    res.json(apps.map((a: any) => ({
      id: a.pm_id,
      name: a.name,
      status: a.pm2_env?.status,
      pid: a.pid,
      uptime: a.pm2_env?.pm_uptime,
      restarts: a.pm2_env?.restart_time,
      cpu: a.monit?.cpu,
      memory: a.monit?.memory,
      script: a.pm2_env?.pm_exec_path,
      cwd: a.pm2_env?.pm_cwd,
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/node', async (req: AuthRequest, res: Response) => {
  const { name, script, cwd, interpreter = 'node', env = '' } = req.body;
  if (!name || !script) return res.status(400).json({ error: 'name and script required' });
  try {
    const envFlag = env ? `--env-file "${env}"` : '';
    const interpFlag = interpreter !== 'node' ? `--interpreter "${interpreter}"` : '';
    await execAsync(`pm2 start "${script}" --name "${name}" ${interpFlag} ${envFlag} --cwd "${cwd || WEBROOT}"`, { timeout: 30000 });
    await execAsync('pm2 save');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/node/:id/action', async (req: AuthRequest, res: Response) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid app id' });
  const { action } = req.body; // start | stop | restart | delete
  const allowed = ['start', 'stop', 'restart', 'delete'];
  if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  try {
    await execAsync(`pm2 ${action} ${req.params.id}`);
    if (action !== 'delete') await execAsync('pm2 save');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/node/:id/logs', async (req: AuthRequest, res: Response) => {
  try {
    const apps = await pm2List();
    const app = apps.find((a: any) => String(a.pm_id) === req.params.id);
    if (!app) return res.status(404).json({ error: 'App not found' });
    const logPath = app.pm2_env?.pm_out_log_path;
    if (!logPath || !existsSync(logPath)) return res.json({ lines: [] });
    const { stdout } = await execAsync(`tail -200 "${logPath}"`);
    res.json({ lines: stdout.split('\n').filter(Boolean) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Python / virtualenv ──────────────────────────────────── */

router.get('/python', async (_req: AuthRequest, res: Response) => {
  try {
    // List python apps running under pm2 with python interpreter
    const apps = await pm2List();
    const pyApps = apps.filter((a: any) => a.pm2_env?.exec_interpreter?.includes('python') || a.pm2_env?.pm_exec_path?.endsWith('.py'));
    res.json(pyApps.map((a: any) => ({
      id: a.pm_id, name: a.name, status: a.pm2_env?.status,
      script: a.pm2_env?.pm_exec_path, cwd: a.pm2_env?.pm_cwd,
      cpu: a.monit?.cpu, memory: a.monit?.memory,
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/python', async (req: AuthRequest, res: Response) => {
  const { name, script, cwd, venv } = req.body;
  if (!name || !script) return res.status(400).json({ error: 'name and script required' });
  const interpreter = venv ? `${venv}/bin/python` : 'python3';
  try {
    await execAsync(`pm2 start "${script}" --name "${name}" --interpreter "${interpreter}" --cwd "${cwd || WEBROOT}"`);
    await execAsync('pm2 save');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/python/create-venv', async (req: AuthRequest, res: Response) => {
  const { path: venvPath } = req.body;
  if (!venvPath) return res.status(400).json({ error: 'path required' });
  try {
    await execAsync(`python3 -m venv "${venvPath}"`, { timeout: 60000 });
    res.json({ success: true, path: venvPath });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── PM2 startup ──────────────────────────────────────────── */

router.post('/pm2-startup', async (_req: AuthRequest, res: Response) => {
  try {
    const { stdout } = await execAsync('pm2 startup systemd -u root --hp /root 2>&1 | tail -3');
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
