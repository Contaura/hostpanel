import { Router, Request, Response } from 'express';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import fs from 'fs/promises';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { runFile } from '../utils/process-runner';

const router = Router();
const PLUGIN_DIR = () => process.env.PLUGIN_DIR || path.join(process.cwd(), 'plugins');
const ROLLBACK_DIR = () => process.env.PLUGIN_ROLLBACK_DIR || path.join(PLUGIN_DIR(), '.rollbacks');

function safeId(id: string) { return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id || ''); }
function safePackage(p: string) {
  const full = path.resolve(p || '');
  return (full.startsWith('/root/') || full.startsWith('/home/') || full.startsWith('/var/backups/') || full.startsWith(os.tmpdir())) && /\.(tar\.gz|tgz)$/.test(full);
}
async function sha256File(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function pluginPath(id: string) { return path.join(PLUGIN_DIR(), id); }
function rollbackName(id: string) { return `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`; }
async function copyIfExists(from: string, to: string) { if (existsSync(from)) await fs.cp(from, to, { recursive: true, force: true, preserveTimestamps: true }); }
function publicManifest(id: string, manifest: any) {
  const { signature, sha256, installScript, postinstall, hooks, ...rest } = manifest || {};
  return { id, ...rest, signed: Boolean(signature || sha256 || rest.package_sha256), enabled: rest.enabled !== false };
}
function readManifest(dir: string): any {
  const manifest = path.join(dir, 'plugin.json');
  if (!existsSync(manifest)) throw new Error('plugin.json missing');
  return JSON.parse(readFileSync(manifest, 'utf8'));
}
async function writeManifest(dir: string, manifest: any) {
  await fs.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
}
async function createRollback(id: string): Promise<string | null> {
  const current = pluginPath(id);
  if (!existsSync(current)) return null;
  const target = path.join(ROLLBACK_DIR(), rollbackName(id));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(current, target, { recursive: true, force: true, preserveTimestamps: true });
  return target;
}
async function verifiedExtract(packagePath: string, expectedSha256?: string) {
  if (!safePackage(packagePath)) throw new Error('Plugin package must be .tar.gz/.tgz under /root, /home, /var/backups, or temp');
  if (!existsSync(packagePath)) throw new Error('Plugin package not found');
  const actualSha256 = await sha256File(packagePath);
  if (expectedSha256 && actualSha256.toLowerCase() !== String(expectedSha256).toLowerCase()) throw new Error('Plugin package sha256 mismatch');
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-plugin-'));
  await runFile('tar', ['-xzf', packagePath, '-C', staging], { timeout: 120000 });
  const entries = await fs.readdir(staging, { withFileTypes: true });
  const roots = entries.filter(e => e.isDirectory()).map(e => path.join(staging, e.name));
  const candidate = existsSync(path.join(staging, 'plugin.json')) ? staging : roots.find(d => existsSync(path.join(d, 'plugin.json')));
  if (!candidate) throw new Error('Plugin archive must contain plugin.json at root or one top-level directory');
  const manifest = readManifest(candidate);
  const id = String(manifest.id || manifest.name || '').trim().replace(/\s+/g, '-').toLowerCase();
  if (!safeId(id)) throw new Error('Plugin manifest requires safe id or name');
  if (manifest.sha256 && String(manifest.sha256).toLowerCase() !== actualSha256.toLowerCase()) throw new Error('Plugin manifest sha256 does not match package');
  return { staging, candidate, manifest: { ...manifest, id }, id, actualSha256 };
}

function readPlugins() {
  const dir = PLUGIN_DIR();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => {
    const plugDir = path.join(dir, d.name);
    try { return publicManifest(d.name, readManifest(plugDir)); } catch { return { id: d.name, error: 'Invalid plugin.json' }; }
  });
}
function readRollbacks(id?: string) {
  const dir = ROLLBACK_DIR();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => {
    const full = path.join(dir, d.name); const st = statSync(full);
    const plugId = d.name.replace(/-\d{4}-\d{2}-\d{2}T.*$/, '');
    return { id: d.name, pluginId: plugId, created: st.mtime.toISOString(), path: full };
  }).filter(r => !id || r.pluginId === id).sort((a,b)=>b.created.localeCompare(a.created));
}

router.get('/updates', async (_req: Request, res: Response) => {
  const current = await runFile('git', ['rev-parse', '--short', 'HEAD']).catch(() => ({ stdout: '', stderr: '' }));
  const remote = await runFile('git', ['ls-remote', 'origin', 'HEAD']).catch(() => ({ stdout: '', stderr: '' }));
  const npmAudit = await runFile('npm', ['audit', '--json'], { timeout: 120000 }).catch(() => ({ stdout: '{}', stderr: '' }));
  const remoteRevision = remote.stdout.trim().split(/\s+/)[0]?.slice(0, 7) || '';
  let audit: any = {};
  try { audit = JSON.parse(npmAudit.stdout || '{}'); } catch { audit = {}; }
  res.json({ currentRevision: current.stdout.trim(), remoteRevision, updateAvailable: Boolean(remoteRevision && !current.stdout.trim().startsWith(remoteRevision)), audit: audit.metadata || audit });
});

router.get('/plugins', (_req: Request, res: Response) => res.json({ directory: PLUGIN_DIR(), rollbackDirectory: ROLLBACK_DIR(), plugins: readPlugins(), rollbacks: readRollbacks() }));
router.post('/plugins/refresh', (_req: Request, res: Response) => res.json({ directory: PLUGIN_DIR(), plugins: readPlugins(), rollbacks: readRollbacks(), refreshed: true }));

router.post('/plugins/install', async (req: Request, res: Response) => {
  const packagePath = String(req.body?.packagePath || '');
  const expectedSha256 = req.body?.sha256 ? String(req.body.sha256) : undefined;
  let extracted: Awaited<ReturnType<typeof verifiedExtract>> | null = null;
  try {
    extracted = await verifiedExtract(packagePath, expectedSha256);
    await fs.mkdir(PLUGIN_DIR(), { recursive: true });
    const target = pluginPath(extracted.id);
    const rollback = await createRollback(extracted.id);
    await fs.rm(target, { recursive: true, force: true });
    const manifest = { ...extracted.manifest, enabled: extracted.manifest.enabled !== false, installed_at: new Date().toISOString(), package_sha256: extracted.actualSha256 };
    await fs.cp(extracted.candidate, target, { recursive: true, force: true, preserveTimestamps: true });
    await writeManifest(target, manifest);
    res.json({ installed: true, plugin: publicManifest(extracted.id, manifest), rollback });
  } catch (err: any) { res.status(400).json({ error: err.message }); }
  finally { if (extracted?.staging) await fs.rm(extracted.staging, { recursive: true, force: true }).catch(() => {}); }
});

async function updatePluginState(id: string, enabled: boolean | undefined) {
  if (!safeId(id)) throw new Error('Invalid plugin id');
  const dir = pluginPath(id);
  if (!existsSync(dir)) { const e: any = new Error('Plugin not found'); e.status = 404; throw e; }
  const rollback = await createRollback(id);
  const manifest = readManifest(dir);
  if (typeof enabled === 'boolean') manifest.enabled = enabled;
  manifest.updated_at = new Date().toISOString();
  await writeManifest(dir, manifest);
  return { plugin: publicManifest(id, manifest), rollback };
}
router.patch('/plugins/:id', async (req: Request, res: Response) => {
  try { res.json(await updatePluginState(String(req.params.id || ''), typeof req.body?.enabled === 'boolean' ? req.body.enabled : undefined)); }
  catch (err: any) { res.status(err.status || (/Invalid/.test(err.message) ? 400 : 500)).json({ error: err.message }); }
});
router.post('/plugins/:id/enable', async (req: Request, res: Response) => {
  try { res.json(await updatePluginState(String(req.params.id || ''), true)); }
  catch (err: any) { res.status(err.status || (/Invalid/.test(err.message) ? 400 : 500)).json({ error: err.message }); }
});
router.post('/plugins/:id/disable', async (req: Request, res: Response) => {
  try { res.json(await updatePluginState(String(req.params.id || ''), false)); }
  catch (err: any) { res.status(err.status || (/Invalid/.test(err.message) ? 400 : 500)).json({ error: err.message }); }
});

router.post('/plugins/:id/rollback', async (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  if (!safeId(id)) return res.status(400).json({ error: 'Invalid plugin id' });
  const selected = req.body?.rollbackId ? readRollbacks(id).find(r => r.id === req.body.rollbackId) : readRollbacks(id)[0];
  if (!selected) return res.status(404).json({ error: 'No rollback available for plugin' });
  try {
    await createRollback(id);
    const target = pluginPath(id);
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(selected.path, target, { recursive: true, force: true, preserveTimestamps: true });
    res.json({ rolledBack: true, plugin: publicManifest(id, readManifest(target)), rollback: selected.id });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
