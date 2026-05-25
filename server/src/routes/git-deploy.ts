import { Router, Request, Response } from 'express';
import { parseDeployCommandPlan } from '../utils/deploy-plan';
import { runFile } from '../utils/process-runner';
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import db from '../db';

const router = Router();

async function resolveDeployPath(p: string): Promise<string> {
  if (!p || typeof p !== 'string') throw new Error('deploy_path required');
  const resolved = path.resolve(p);
  if (resolved !== p) throw new Error('deploy_path must be an absolute, normalized path');
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) throw new Error('deploy_path is not a directory');
  return resolved;
}

async function runDeploy(deployPath: string, deployCommand: string) {
  const cwd = await resolveDeployPath(deployPath);
  const outputs: string[] = [];
  for (const step of parseDeployCommandPlan(deployCommand)) {
    const { stdout, stderr } = await runFile(step.command, step.args, { cwd, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    outputs.push(`$ ${step.command} ${step.args.join(' ')}`);
    if (stdout) outputs.push(stdout);
    if (stderr) outputs.push(stderr);
  }
  return { stdout: outputs.join('\n'), stderr: '' };
}

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
  // Partial PUT — every column we touch here is NOT NULL.
  const current: any = db.prepare('SELECT * FROM git_deployments WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Deployment not found' });
  const pick = <T,>(k: string, fb: T) => (req.body[k] !== undefined ? req.body[k] : fb);
  db.prepare('UPDATE git_deployments SET repo_url=?, branch=?, deploy_path=?, deploy_command=? WHERE id=?')
    .run(
      pick('repo_url',       current.repo_url),
      pick('branch',         current.branch),
      pick('deploy_path',    current.deploy_path),
      pick('deploy_command', current.deploy_command),
      req.params.id,
    );
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
    const { stdout, stderr } = await runDeploy(dep.deploy_path, dep.deploy_command);
    db.prepare("UPDATE git_deployments SET last_deployed=datetime('now'), last_status='success' WHERE id=?").run(dep.id);
    res.json({ success: true, output: stdout + stderr });
  } catch (err: any) {
    db.prepare("UPDATE git_deployments SET last_deployed=datetime('now'), last_status='failed' WHERE id=?").run(dep.id);
    res.status(500).json({ error: err.message, output: (err.stdout || '') + (err.stderr || '') });
  }
});

/* ── Webhook receiver (public — no auth) ─────────────────── */

function timingSafeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

router.post('/webhook/:name', async (req: Request, res: Response) => {
  const dep = db.prepare('SELECT * FROM git_deployments WHERE name = ?').get(req.params.name) as any;
  if (!dep) return res.status(404).json({ error: 'Deployment not found' });

  // index.ts mounts express.raw for /api/git-deploy/webhook so req.body is a
  // Buffer here. HMAC verification has to run over those exact bytes; using
  // JSON.stringify(parsed) would re-serialize with different key order and
  // whitespace, so the signature would never validate.
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

  if (dep.webhook_secret) {
    const hubSig    = (req.headers['x-hub-signature-256'] as string) || '';
    const gitlabTok = (req.headers['x-gitlab-token']      as string) || '';

    if (hubSig) {
      const expected = 'sha256=' + crypto.createHmac('sha256', dep.webhook_secret).update(rawBody).digest('hex');
      if (!hubSig.startsWith('sha256=') || !timingSafeStrEqual(hubSig, expected)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } else if (gitlabTok) {
      if (!timingSafeStrEqual(gitlabTok, dep.webhook_secret)) {
        return res.status(401).json({ error: 'Invalid token' });
      }
    } else {
      return res.status(401).json({ error: 'Missing webhook signature' });
    }
  }

  // Parse the body ourselves now that signature verification has passed.
  let payload: any = {};
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch { /* empty/non-json body — fine */ }

  // Only deploy on the configured branch. The previous `ref.endsWith(branch)`
  // would accept refs/heads/feature-main when branch=main, so we exact-match
  // against the GitHub/GitLab ref form.
  const ref: string = payload?.ref || payload?.object_attributes?.ref || '';
  if (ref && dep.branch && ref !== `refs/heads/${dep.branch}` && ref !== `refs/tags/${dep.branch}`) {
    return res.json({ skipped: true, reason: 'Branch mismatch' });
  }

  try {
    await runDeploy(dep.deploy_path, dep.deploy_command);
    db.prepare("UPDATE git_deployments SET last_deployed=datetime('now'), last_status='success' WHERE id=?").run(dep.id);
    res.json({ success: true });
  } catch (err: any) {
    db.prepare("UPDATE git_deployments SET last_deployed=datetime('now'), last_status='failed' WHERE id=?").run(dep.id);
    res.status(500).json({ error: err.message });
  }
});

export default router;
