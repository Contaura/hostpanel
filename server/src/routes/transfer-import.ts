import { Router, Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import db from '../db';
import { runFile } from '../utils/process-runner';

const router = Router();
db.exec(`CREATE TABLE IF NOT EXISTS transfer_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  report TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
)`);
try { db.prepare('ALTER TABLE transfer_imports ADD COLUMN updated_at TEXT').run(); } catch {}

const WEBROOT = process.env.WEBROOT || '/var/www';
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_ROOT_USER = process.env.DB_ROOT_USER || 'root';
const DB_ROOT_PASS = process.env.DB_ROOT_PASS || '';

function safeArchive(p: string) {
  const full = path.resolve(p || '');
  return (full.startsWith('/root/') || full.startsWith('/home/') || full.startsWith('/var/backups/')) && /\.(tar\.gz|tgz|tar)$/.test(full);
}
function safeArchiveEntry(entry: string): boolean { return !!entry && !entry.startsWith('/') && !entry.includes('..') && !entry.includes('\0'); }
function domainOk(s: string) { return /^[a-zA-Z0-9][a-zA-Z0-9.-]{1,253}$/.test(s || ''); }
function usernameOk(s: string) { return /^[a-zA-Z][a-zA-Z0-9_]{1,31}$/.test(s || ''); }
function dbNameOk(s: string) { return /^[a-zA-Z0-9_]{1,64}$/.test(s || ''); }
function parseReport(raw: any) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
function writeReport(id: number, status: string, report: any) { db.prepare('UPDATE transfer_imports SET status=?, report=?, updated_at=datetime(\'now\') WHERE id=?').run(status, JSON.stringify(report), id); }
function appendStep(report: any, step: string, detail: any = {}) { report.steps = [...(report.steps || []), { at: new Date().toISOString(), step, ...detail }]; }

async function listArchive(archivePath: string): Promise<string[]> {
  const list = await runFile('tar', ['-tf', archivePath], { timeout: 120000 }).catch((e:any)=>({ stdout:'', stderr:e.message }));
  if (list.stderr && !list.stdout) throw new Error(list.stderr);
  return list.stdout.split('\n').map(s => s.trim()).filter(safeArchiveEntry);
}
function inferRoot(files: string[]): string {
  const first = files.find(Boolean)?.split('/')[0] || '';
  return first;
}
function stripRoot(entry: string, root: string) { return root && entry.startsWith(`${root}/`) ? entry.slice(root.length + 1) : entry; }
function inferUsername(files: string[], archivePath: string): string {
  const root = inferRoot(files);
  const fromRoot = root.replace(/^cpmove-/, '').replace(/\.tar$/, '');
  if (usernameOk(fromRoot)) return fromRoot;
  const base = path.basename(archivePath).replace(/\.(tar\.gz|tgz|tar)$/i, '').replace(/^cpmove-/, '');
  return usernameOk(base) ? base : '';
}
function inferDomains(files: string[]): string[] {
  const root = inferRoot(files);
  const found = new Set<string>();
  for (const f of files) {
    const rel = stripRoot(f, root);
    const m = rel.match(/^userdata\/(?:[^/]+\/)?([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?:$|\/)/);
    if (m && domainOk(m[1])) found.add(m[1]);
  }
  return [...found];
}
function inferSqlFiles(files: string[]): string[] {
  const root = inferRoot(files);
  return files.filter(f => {
    const rel = stripRoot(f, root);
    return /^mysql\/.+\.sql$/i.test(rel) && safeArchiveEntry(f);
  });
}
function defaultDbName(sqlFile: string): string {
  const base = path.basename(sqlFile).replace(/\.sql$/i, '');
  return base.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
}
function findHomeDir(staging: string, root: string): string | null {
  const candidates = [
    path.join(staging, root, 'homedir'),
    path.join(staging, root, 'home'),
    path.join(staging, 'homedir'),
    path.join(staging, 'home'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}
function dbEnv(): NodeJS.ProcessEnv { return DB_ROOT_PASS ? { ...process.env, MYSQL_PWD: DB_ROOT_PASS } : process.env; }

function pipeFileToCommand(file: string, command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 300000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, shell: false });
    const src = createReadStream(file);
    let stderr = ''; let settled = false;
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(new Error(`${command} timed out`)); }, timeoutMs);
    const done = (err?: Error) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(); };
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', done); src.on('error', done);
    child.on('exit', code => code === 0 ? done() : done(new Error(`${command} exited ${code}: ${stderr}`)));
    src.pipe(child.stdin);
  });
}

async function restoreFiles(staging: string, root: string, domain: string, report: any) {
  const home = findHomeDir(staging, root);
  if (!home) { appendStep(report, 'files-skipped', { reason: 'No homedir found in archive' }); return null; }
  const source = existsSync(path.join(home, 'public_html')) ? path.join(home, 'public_html') : home;
  const target = path.resolve(path.join(WEBROOT, domain, 'public_html'));
  if (!target.startsWith(path.resolve(WEBROOT))) throw new Error('Resolved import target escapes WEBROOT');
  const rollbackDir = path.resolve(process.env.TRANSFER_ROLLBACK_DIR || '/var/backups/hostpanel-transfer-rollbacks');
  await fs.mkdir(rollbackDir, { recursive: true });
  const backup = path.join(rollbackDir, `${domain}-${Date.now()}-public_html`);
  if (existsSync(target)) {
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.rename(target, backup);
    appendStep(report, 'files-rollback-point', { target, backup });
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, force: true, preserveTimestamps: true });
  appendStep(report, 'files-restored', { source: 'homedir/public_html', target });
  return { target, backup: existsSync(backup) ? backup : null };
}

async function restoreDatabases(staging: string, sqlFiles: string[], report: any) {
  const restored: string[] = [];
  for (const archiveSql of sqlFiles) {
    const sqlPath = path.join(staging, archiveSql);
    if (!existsSync(sqlPath)) { appendStep(report, 'database-skipped', { archiveSql, reason: 'SQL file not extracted' }); continue; }
    const dbName = defaultDbName(archiveSql);
    if (!dbNameOk(dbName)) throw new Error(`Invalid database name derived from ${archiveSql}`);
    await runFile('mysql', [`-u${DB_ROOT_USER}`, `-h${DB_HOST}`, '-e', `CREATE DATABASE IF NOT EXISTS \`${dbName}\``], { env: dbEnv(), timeout: 120000 });
    await pipeFileToCommand(sqlPath, 'mysql', [`-u${DB_ROOT_USER}`, `-h${DB_HOST}`, dbName], dbEnv(), 300000);
    restored.push(dbName);
    appendStep(report, 'database-restored', { archiveSql, database: dbName });
  }
  return restored;
}

router.get('/', (_req: Request, res: Response) => res.json(db.prepare('SELECT * FROM transfer_imports ORDER BY created_at DESC').all().map((r:any)=>({...r, report: parseReport(r.report)}))));
router.get('/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM transfer_imports WHERE id=?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Import not found' });
  res.json({ ...row, report: parseReport(row.report) });
});

router.post('/inspect', async (req: Request, res: Response) => {
  const archivePath = String(req.body?.archivePath || '');
  if (!safeArchive(archivePath)) return res.status(400).json({ error: 'Archive path must be a .tar/.tar.gz/.tgz under /root, /home or /var/backups' });
  if (!existsSync(archivePath)) return res.status(404).json({ error: 'Archive not found' });
  try {
    const files = await listArchive(archivePath);
    const root = inferRoot(files);
    const domains = inferDomains(files);
    const username = inferUsername(files, archivePath);
    const databases = inferSqlFiles(files);
    const report = { archivePath, size: statSync(archivePath).size, root, username, filesScanned: files.length, hasCpbackup: files.some(f=>f.includes('cpbackup') || f.includes('cpmove')), domains, databases, dryRunOnly: false, executable: true, actions: ['extract-to-staging', 'restore-homedir-public_html-with-rollback', 'create-or-update-account-record', 'import-mysql-sql-files'] };
    const r = db.prepare('INSERT INTO transfer_imports (archive_path,status,report,updated_at) VALUES (?,?,?,datetime(\'now\'))').run(archivePath, 'inspected', JSON.stringify(report));
    res.json({ id: r.lastInsertRowid, report });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/execute', async (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM transfer_imports WHERE id=?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'Import not found' });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirm=true is required before import execution' });
  const archivePath = row.archive_path;
  if (!safeArchive(archivePath) || !existsSync(archivePath)) return res.status(400).json({ error: 'Stored archive path is no longer valid or accessible' });

  const report = { ...parseReport(row.report), startedAt: new Date().toISOString(), steps: parseReport(row.report).steps || [] };
  writeReport(row.id, 'running', report);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-transfer-'));
  let fileRollback: { target: string; backup: string | null } | null = null;
  try {
    appendStep(report, 'extract-started', { staging }); writeReport(row.id, 'running', report);
    await runFile('tar', ['-xf', archivePath, '-C', staging], { timeout: 300000 });
    const files = await listArchive(archivePath);
    const root = inferRoot(files);
    const requestedDomain = String(req.body?.domain || '').trim();
    const domain = requestedDomain || inferDomains(files)[0];
    const requestedUsername = String(req.body?.username || '').trim();
    const username = requestedUsername || inferUsername(files, archivePath) || (domain ? domain.split('.')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) : '');
    if (!domainOk(domain)) throw new Error('Cannot infer valid account domain; pass domain explicitly');
    if (!usernameOk(username)) throw new Error('Cannot infer valid account username; pass username explicitly');
    appendStep(report, 'metadata-resolved', { root, domain, username }); writeReport(row.id, 'running', report);

    const sections = req.body?.sections || {};
    const doFiles = sections.files !== false;
    const doDatabases = sections.databases !== false;
    const doAccount = sections.account !== false;

    if (doFiles) { fileRollback = await restoreFiles(staging, root, domain, report); writeReport(row.id, 'running', report); }
    if (doAccount) {
      const existing = db.prepare('SELECT id FROM accounts WHERE username=? OR domain=?').get(username, domain) as any;
      if (existing) db.prepare("UPDATE accounts SET username=?, domain=?, status='active', notes=? WHERE id=?").run(username, domain, `Imported from ${archivePath}`, existing.id);
      else db.prepare('INSERT INTO accounts (username, domain, notes) VALUES (?, ?, ?)').run(username, domain, `Imported from ${archivePath}`);
      appendStep(report, 'account-record-upserted', { username, domain }); writeReport(row.id, 'running', report);
    }
    if (doDatabases) {
      const sqlFiles = inferSqlFiles(files);
      report.databasesRestored = await restoreDatabases(staging, sqlFiles, report);
      writeReport(row.id, 'running', report);
    }

    report.completedAt = new Date().toISOString();
    report.success = true;
    writeReport(row.id, 'completed', report);
    res.json({ id: row.id, status: 'completed', report });
  } catch (err: any) {
    appendStep(report, 'failed', { error: err.message });
    if (fileRollback?.backup) {
      try { await fs.rm(fileRollback.target, { recursive: true, force: true }); await fs.rename(fileRollback.backup, fileRollback.target); appendStep(report, 'files-rolled-back', fileRollback); }
      catch (rollbackErr: any) { appendStep(report, 'rollback-failed', { error: rollbackErr.message }); }
    }
    report.failedAt = new Date().toISOString();
    report.success = false;
    writeReport(row.id, 'failed', report);
    res.status(500).json({ id: row.id, status: 'failed', error: err.message, report });
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
});
export default router;
