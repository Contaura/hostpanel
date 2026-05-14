import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import db from '../db';

const router = Router();
const execAsync = promisify(exec);

/* ── List deployments ────────────────────────────────────── */

router.get('/', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM git_deployments ORDER BY created_at DESC').all());
});

/* ── Create deployment ───────────────────────────────────── */

router.post('/', async (req: Request, res: Response) => {
  const { name, repo_url, branch, deploy_path, deploy_command } = req.body;
  if (!name || !repo_url || !deploy_path) return res.status(400).json({ error: 'name, repo_url, deploy_path required' });
  const webhook_secret = crypto.randomBytes(20).toString('hex');
  try {
    const r = db.prepare(`
      INSERT INTO git_deployments (name, repo_url, branch, deploy_path, deploy_command, webhook_secret)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, repo_url, branch || 'main', deploy_path, deploy_command || 'git pull && npm install && pm2 restart all', webhook_secret);
    const row = db.prepare('SELECT * FROM git_deployments WHERE id = ?').get(r.lastInsertRowid) as Record<string, any>;
    res.json({ ...row, webhook_secret });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Name already exists' });
    res.status(500).json({ error: err.message });
  }
});

/* ── Update deployment ───────────────────────────────────── */

router.put('/:id', (req: Request, res: Response) => {
  const { repo_url, branch, deploy_path, deploy_command } = req.body;
  db.prepare('UPDATE git_deployments SET repo_url=?, branch=?, deploy_path=?, deploy_command=? WHERE id=?')
    .run(repo_url, branch, deploy_path, deploy_command, req.params.id);
  res.json(db.prepare('SELECT * FROM git_deployments WHERE id = ?').get(req.params.id));
});

/* ── Delete deployment ───────────────────────────────────── */

router.delete('/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM git_deployments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── Manual deploy trigger ───────────────────────────────── */

router.post('/:id/deploy', async (req: Request, res: Response) => {
  const dep = db.prepare('SELECT * FROM git_deployments WHERE id = ?').get(req.params.id) as any;
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });
  try {
    const { stdout, stderr } = await execAsync(`cd ${dep.deploy_path} && ${dep.deploy_command}`, { timeout: 120000 });
    db.prepare("UPDATE git_deployments SET last_deployed=datetime('now'), last_status='success' WHERE id=?").run(dep.id);
    res.json({ success: true, output: stdout + stderr });
  } catch (err: any) {
    db.prepare("UPDATE git_deployments SET last_deployed=datetime('now'), last_status='failed' WHERE id=?").run(dep.id);
    res.status(500).json({ error: err.message, output: err.stdout + err.stderr });
  }
});

/* ── Webhook receiver (public — no auth) ─────────────────── */

router.post('/webhook/:name', async (req: Request, res: Response) => {
  const dep = db.prepare('SELECT * FROM git_deployments WHERE name = ?').get(req.params.name) as any;
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });

  // Verify HMAC signature if secret is set
  if (dep.webhook_secret) {
    const sig = req.headers['x-hub-signature-256'] as string || req.headers['x-gitlab-token'] as string || '';
    if (sig.startsWith('sha256=')) {
      const expected = 'sha256=' + crypto.createHmac('sha256', dep.webhook_secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Only deploy on the configured branch
  const ref = req.body?.ref || req.body?.object_attributes?.ref || '';
  if (ref && !ref.endsWith(dep.branch)) return res.json({ skipped: true, reason: 'Branch mismatch' });

  try {
    await execAsync(`cd ${dep.deploy_path} && ${dep.deploy_command}`, { timeout: 120000 });
    db.prepare("UPDATE git_deployments SET last_deployed=datetime('now'), last_status='success' WHERE id=?").run(dep.id);
    res.json({ success: true });
  } catch (err: any) {
    db.prepare("UPDATE git_deployments SET last_deployed=datetime('now'), last_status='failed' WHERE id=?").run(dep.id);
    res.status(500).json({ error: err.message });
  }
});

export default router;
