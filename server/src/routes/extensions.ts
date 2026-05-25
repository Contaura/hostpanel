import { Router, Request, Response } from 'express';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { runFile } from '../utils/process-runner';

const router = Router();
const PLUGIN_DIR = () => process.env.PLUGIN_DIR || path.join(process.cwd(), 'plugins');

router.get('/updates', async (_req: Request, res: Response) => {
  const current = await runFile('git', ['rev-parse', '--short', 'HEAD']).catch(() => ({ stdout: '', stderr: '' }));
  const remote = await runFile('git', ['ls-remote', 'origin', 'HEAD']).catch(() => ({ stdout: '', stderr: '' }));
  const npmAudit = await runFile('npm', ['audit', '--json'], { timeout: 120000 }).catch(() => ({ stdout: '{}', stderr: '' }));
  const remoteRevision = remote.stdout.trim().split(/\s+/)[0]?.slice(0, 7) || '';
  let audit: any = {};
  try { audit = JSON.parse(npmAudit.stdout || '{}'); } catch { audit = {}; }
  res.json({ currentRevision: current.stdout.trim(), remoteRevision, updateAvailable: Boolean(remoteRevision && !current.stdout.trim().startsWith(remoteRevision)), audit: audit.metadata || audit });
});

function readPlugins() {
  const dir = PLUGIN_DIR();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
    const manifest = path.join(dir, d.name, 'plugin.json');
    if (!existsSync(manifest)) return null;
    try { return { id: d.name, ...JSON.parse(readFileSync(manifest, 'utf8')) }; } catch { return { id: d.name, error: 'Invalid plugin.json' }; }
  }).filter(Boolean);
}

router.get('/plugins', (_req: Request, res: Response) => res.json({ directory: PLUGIN_DIR(), plugins: readPlugins() }));
router.post('/plugins/refresh', (_req: Request, res: Response) => res.json({ directory: PLUGIN_DIR(), plugins: readPlugins(), refreshed: true }));

export default router;
