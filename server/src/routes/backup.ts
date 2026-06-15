import { Router, Response } from 'express';
import { spawn } from 'child_process';
import { createReadStream, createWriteStream, readdirSync, readFileSync, statSync, existsSync, mkdirSync, unlinkSync, writeFileSync, mkdtempSync } from 'fs';
import zlib from 'zlib';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { AuthRequest } from '../middleware/auth';
import db from '../db';
import { runFile } from '../utils/process-runner';
import { createBackgroundJob, JobContext } from '../background-jobs';

const router = Router();

function writeTempCrontab(lines: string[]): string {
  // Use mkdtempSync to avoid the predictable `/tmp/hp_*_${Date.now()}` race:
  // two requests landing in the same millisecond can no longer collide on the
  // same path, and an attacker can't pre-create the file to race the write.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hp_backup_cron_'));
  const file = path.join(dir, 'crontab');
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

function getBackupDir(): string {
  const dir = process.env.BACKUP_DIR || '/var/backups/hostpanel';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getDrillReportDir(): string {
  const dir = process.env.DRILL_REPORT_DIR || path.join(getBackupDir(), 'drills');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFileName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '');
}

function safeArchiveEntry(entry: string): boolean {
  return !!entry && !entry.startsWith('/') && !entry.includes('..') && !entry.includes('\0');
}

function summarizeDrillReport(file: string) {
  const full = path.join(getDrillReportDir(), file);
  const parsed = JSON.parse(readFileSync(full, 'utf8'));
  const st = statSync(full);
  const restorePlan = parsed.restorePlan || {};
  const archive = parsed.archive && typeof parsed.archive === 'object'
    ? {
        size: typeof parsed.archive.size === 'number' ? parsed.archive.size : null,
        sha256: typeof parsed.archive.sha256 === 'string' ? parsed.archive.sha256 : null,
      }
    : null;
  return {
    file,
    backup: String(parsed.backup || ''),
    success: parsed.success === true,
    drill: parsed.drill === true,
    verifiedAt: parsed.verifiedAt || st.mtime.toISOString(),
    created: st.mtime.toISOString(),
    archive,
    restorePlan: {
      type: restorePlan.type || null,
      count: typeof restorePlan.count === 'number' ? restorePlan.count : null,
      dryRun: typeof restorePlan.dryRun === 'boolean' ? restorePlan.dryRun : null,
      actionCount: Array.isArray(restorePlan.actions) ? restorePlan.actions.length : 0,
    },
  };
}

function archiveIntegrity(file: string) {
  const contents = readFileSync(file);
  return {
    size: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

async function tarEntries(file: string): Promise<string[]> {
  const { stdout } = await runFile('tar', ['-tzf', file], { timeout: 120000 });
  return stdout.split('\n').map(s => s.trim()).filter(safeArchiveEntry);
}

function selectedEntries(all: string[], requested: unknown): string[] {
  if (!Array.isArray(requested) || !requested.length) return all;
  const wanted = new Set(requested.map(String).filter(safeArchiveEntry));
  return all.filter(e => wanted.has(e) || [...wanted].some(w => e.startsWith(w.endsWith('/') ? w : `${w}/`)));
}

// Spawn `command argv` and pipe its stdout through gzip into outFile.
function spawnDumpToGzipFile(command: string, args: string[], outFile: string, env: NodeJS.ProcessEnv, timeoutMs = 300000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, shell: false });
    const gz = zlib.createGzip();
    const out = createWriteStream(outFile);
    let stderr = '';
    let settled = false;
    const done = (err?: Error) => { if (settled) return; settled = true; err ? reject(err) : resolve(); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(new Error(`${command} timed out`)); }, timeoutMs);
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => { clearTimeout(timer); done(err); });
    out.on('error', err => { clearTimeout(timer); try { child.kill(); } catch {} done(err); });
    gz.on('error', err => { clearTimeout(timer); try { child.kill(); } catch {} done(err); });
    out.on('finish', () => { clearTimeout(timer); done(); });
    child.on('exit', code => {
      if (code !== 0) { clearTimeout(timer); try { gz.destroy(); out.destroy(); } catch {} done(new Error(`${command} exited ${code}: ${stderr}`)); }
    });
    child.stdout.pipe(gz).pipe(out);
  });
}

// Pipe gunzipped contents of inFile into `command argv` stdin.
function gunzipFileIntoStdin(inFile: string, command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 300000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, shell: false });
    const gun = zlib.createGunzip();
    const src = createReadStream(inFile);
    let stderr = '';
    let settled = false;
    const done = (err?: Error) => { if (settled) return; settled = true; err ? reject(err) : resolve(); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} done(new Error(`${command} timed out`)); }, timeoutMs);
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => { clearTimeout(timer); done(err); });
    src.on('error', err => { clearTimeout(timer); try { child.kill(); } catch {} done(err); });
    gun.on('error', err => { clearTimeout(timer); try { child.kill(); } catch {} done(err); });
    child.on('exit', code => {
      clearTimeout(timer);
      if (code !== 0) done(new Error(`${command} exited ${code}: ${stderr}`));
      else done();
    });
    src.pipe(gun).pipe(child.stdin);
  });
}

router.get('/list', (_req: AuthRequest, res: Response) => {
  try {
    const dir = getBackupDir();
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.tar.gz') || f.endsWith('.sql.gz'))
      .map(f => {
        const full = path.join(dir, f);
        const st = statSync(full);
        return { name: f, size: st.size, created: st.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function createBackup(type: string, target: string | undefined, ctx?: JobContext) {
  const dir = getBackupDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let filename: string;
  if (type === 'files') {
    const webroot = process.env.WEBROOT || '/var/www';
    const srcDir = target
      ? path.resolve(path.join(webroot, target))
      : path.resolve(webroot);
    if (!srcDir.startsWith(path.resolve(webroot))) throw new Error('Invalid target path');
    const label = target ? target.replace(/[^a-zA-Z0-9]/g, '_') : 'all';
    filename = `files_${label}_${ts}.tar.gz`;
    const out = path.join(dir, filename);
    ctx?.progress(25, `Archiving files from ${srcDir}`);
    await runFile('tar', ['-czf', out, '-C', srcDir, '.'], { timeout: 300000 });
  } else if (type === 'database') {
    if (!target || !/^[a-zA-Z0-9_]+$/.test(target)) throw new Error('Invalid database name');
    filename = `db_${target}_${ts}.sql.gz`;
    const out = path.join(dir, filename);
    const user = process.env.DB_ROOT_USER || 'root';
    const pass = process.env.DB_ROOT_PASS || '';
    const dbEnv: NodeJS.ProcessEnv = pass ? { ...process.env, MYSQL_PWD: pass } : process.env;
    const host = process.env.DB_HOST || '127.0.0.1';
    ctx?.progress(25, `Dumping database ${target}`);
    await spawnDumpToGzipFile('mysqldump', [`-u${user}`, `-h${host}`, target], out, dbEnv);
  } else {
    throw new Error('type must be files or database');
  }
  const st = statSync(path.join(dir, filename));
  const result = { name: filename, size: st.size, created: new Date().toISOString() };
  ctx?.progress(90, 'Backup archive written');
  ctx?.log('Backup completed', result);
  return result;
}

router.post('/create', async (req: AuthRequest, res: Response) => {
  const { type, target } = req.body;

  if (req.body?.async === true) {
    try {
      if (!['files', 'database'].includes(type)) return res.status(400).json({ error: 'type must be files or database' });
      if (type === 'database' && (!target || !/^[a-zA-Z0-9_]+$/.test(target))) return res.status(400).json({ error: 'Invalid database name' });
      const jobId = createBackgroundJob({ type: 'backup.create', resource: String(target || type), metadata: { type, target } }, ctx => createBackup(type, target, ctx));
      return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const result = await createBackup(type, target);
    res.json(result);
  } catch (err: any) {
    const status = /Invalid|type must/.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.get('/download/:name', (req: AuthRequest, res: Response) => {
  const name = safeFileName(req.params.name);
  const file = path.join(getBackupDir(), name);
  if (!existsSync(file)) return res.status(404).json({ error: 'File not found' });
  res.download(file);
});

async function runRestoreDrill(name: string, body: any, ctx?: JobContext) {
  ctx?.progress(10, 'Starting restore dry-run drill');
  const file = path.join(getBackupDir(), name);
  const restorePlan = await restoreBackupFile(name, { ...(body || {}), dryRun: true }, ctx);
  const report = {
    success: true,
    drill: true,
    backup: name,
    verifiedAt: new Date().toISOString(),
    archive: archiveIntegrity(file),
    restorePlan,
  };
  const stamp = report.verifiedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(getDrillReportDir(), `${name}-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o640 });
  ctx?.progress(90, 'Restore drill verification report written');
  ctx?.log('Disaster-recovery restore drill completed', { backup: name, reportPath });
  return { ...report, reportPath };
}

router.post('/drill/:name', async (req: AuthRequest, res: Response) => {
  const name = safeFileName(req.params.name);
  const file = path.join(getBackupDir(), name);
  if (!existsSync(file)) return res.status(404).json({ error: 'Backup file not found' });
  if (req.body?.async === true) {
    const jobId = createBackgroundJob({ type: 'backup.drill', resource: name, metadata: { name, ...req.body }, createdBy: req.user?.username || 'system' }, (ctx) => runRestoreDrill(name, req.body || {}, ctx));
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }
  try { res.json(await runRestoreDrill(name, req.body || {})); }
  catch (err: any) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/drills', (_req: AuthRequest, res: Response) => {
  try {
    const dir = getDrillReportDir();
    const reports = readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(summarizeDrillReport)
      .sort((a, b) => new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime());
    res.json({ dir, latest: reports[0] || null, reports });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/restore/:name/plan', async (req: AuthRequest, res: Response) => {
  const name = safeFileName(req.params.name);
  const file = path.join(getBackupDir(), name);
  if (!existsSync(file)) return res.status(404).json({ error: 'Backup file not found' });
  try {
    if (name.endsWith('.sql.gz')) {
      const dbName = name.replace(/^db_/, '').replace(/_\d{4}-.*\.sql\.gz$/, '');
      return res.json({ type: 'database', name, database: dbName, dryRunSupported: true, selectable: false });
    }
    if (name.endsWith('.tar.gz')) {
      const entries = await tarEntries(file);
      return res.json({ type: 'files', name, entries, count: entries.length, dryRunSupported: true, selectable: true });
    }
    res.status(400).json({ error: 'Unknown backup format' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function restoreBackupFile(name: string, body: any, ctx?: JobContext) {
  const file = path.join(getBackupDir(), name);
  if (!existsSync(file)) { const e: any = new Error('Backup file not found'); e.status = 404; throw e; }
  const dryRun = Boolean(body?.dryRun);
  if (name.endsWith('.sql.gz')) {
    const dbName = name.replace(/^db_/, '').replace(/_\d{4}-.*\.sql\.gz$/, '');
    if (!/^[a-zA-Z0-9_]+$/.test(dbName)) { const e: any = new Error('Cannot determine database name from filename'); e.status = 400; throw e; }
    if (dryRun) return { success: true, dryRun: true, type: 'database', database: dbName, actions: [`Would restore database ${dbName}`] };
    ctx?.progress(20, `Restoring database ${dbName}`);
    const user = process.env.DB_ROOT_USER || 'root';
    const pass = process.env.DB_ROOT_PASS || '';
    const dbEnv: NodeJS.ProcessEnv = pass ? { ...process.env, MYSQL_PWD: pass } : process.env;
    const host = process.env.DB_HOST || '127.0.0.1';
    await gunzipFileIntoStdin(file, 'mysql', [`-u${user}`, `-h${host}`, dbName], dbEnv);
    ctx?.progress(90, `Database ${dbName} restored`);
    return { success: true, message: `Database ${dbName} restored`, database: dbName };
  }
  if (name.endsWith('.tar.gz')) {
    const webroot = process.env.WEBROOT || '/var/www';
    const restoreTarget = body?.target ? path.resolve(path.join(webroot, String(body.target))) : path.resolve(webroot);
    if (!restoreTarget.startsWith(path.resolve(webroot))) { const e: any = new Error('Invalid restore target'); e.status = 400; throw e; }
    ctx?.progress(10, 'Reading archive entries');
    const entries = await tarEntries(file);
    const selected = entries.length ? selectedEntries(entries, body?.entries) : [];
    if (!entries.length && !Array.isArray(body?.entries) && !dryRun) {
      ctx?.progress(35, `Extracting archive to ${webroot}`);
      await runFile('tar', ['-xzf', file, '-C', webroot], { timeout: 300000 });
      return { success: true, message: `Files restored to ${webroot}`, restored: [] };
    }
    if (!selected.length) { const e: any = new Error('No matching entries selected'); e.status = 400; throw e; }
    if (dryRun) return { success: true, dryRun: true, type: 'files', target: restoreTarget, selected, count: selected.length, actions: selected.map(e => `Would restore ${e}`) };
    ctx?.progress(35, `Restoring ${selected.length} archive entries`);
    if (selected.length === entries.length && !Array.isArray(body?.entries) && !body?.target) {
      await runFile('tar', ['-xzf', file, '-C', webroot], { timeout: 300000 });
    } else {
      await runFile('tar', ['-xzf', file, '-C', restoreTarget, ...selected], { timeout: 300000 });
    }
    ctx?.progress(90, `Files restored to ${restoreTarget}`);
    return { success: true, message: `Files restored to ${restoreTarget}`, restored: selected, target: restoreTarget };
  }
  const e: any = new Error('Unknown backup format'); e.status = 400; throw e;
}

router.post('/restore/:name', async (req: AuthRequest, res: Response) => {
  const name = safeFileName(req.params.name);
  const file = path.join(getBackupDir(), name);
  if (!existsSync(file)) return res.status(404).json({ error: 'Backup file not found' });
  if (req.body?.async && !req.body?.dryRun) {
    const jobId = createBackgroundJob({ type: 'backup.restore', resource: name, metadata: { name, ...req.body }, createdBy: req.user?.username || 'system' }, (ctx) => restoreBackupFile(name, req.body || {}, ctx));
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }
  try { res.json(await restoreBackupFile(name, req.body || {})); }
  catch (err: any) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/:name', (req: AuthRequest, res: Response) => {
  const name = safeFileName(req.params.name);
  const file = path.join(getBackupDir(), name);
  if (!existsSync(file)) return res.status(404).json({ error: 'File not found' });
  try {
    unlinkSync(file);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


/* ── Backup schedule management ─────────────────────────── */

db.exec(`CREATE TABLE IF NOT EXISTS backup_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  target TEXT,
  schedule TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_run TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`);

router.get('/schedules', (_req: AuthRequest, res: Response) => {
  res.json(db.prepare('SELECT * FROM backup_schedules ORDER BY created_at DESC').all());
});

async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await runFile('crontab', ['-l']);
    return stdout;
  } catch {
    return '';
  }
}

router.post('/schedules', async (req: AuthRequest, res: Response) => {
  const { type, target, schedule } = req.body;
  if (!type || !schedule) return res.status(400).json({ error: 'type and schedule required' });
  if (!['files', 'database'].includes(type)) return res.status(400).json({ error: 'type must be files or database' });
  if (target && !/^[a-zA-Z0-9_]+$/.test(target)) return res.status(400).json({ error: 'Invalid target' });
  if (!/^[\d*/,\- ]+$/.test(schedule) || schedule.trim().split(/\s+/).length !== 5) {
    return res.status(400).json({ error: 'Invalid cron schedule (must be 5 fields: min hour dom mon dow)' });
  }

  const r = db.prepare('INSERT INTO backup_schedules (type, target, schedule) VALUES (?, ?, ?)').run(type, target || null, schedule);

  // Use schedule ID in cron line — no user data interpolated into the shell command
  const id = r.lastInsertRowid;
  const port = process.env.PORT || 3001;
  const cronCmd = `curl -s -X POST "http://localhost:${port}/api/backup/run-schedule/${id}" > /dev/null 2>&1`;
  const cronLine = `${schedule} ${cronCmd} # hostpanel-backup-${id}`;
  try {
    const existing = await readCrontab();
    const lines = existing.split('\n').filter(l => !l.includes(`hostpanel-backup-${id}`));
    lines.push(cronLine);
    const tmp = writeTempCrontab(lines);
    await runFile('crontab', [tmp]);
    unlinkSync(tmp);
  } catch {}

  res.json(db.prepare('SELECT * FROM backup_schedules WHERE id = ?').get(id));
});

router.delete('/schedules/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  db.prepare('DELETE FROM backup_schedules WHERE id = ?').run(parseInt(id));
  // Remove from crontab
  try {
    const stdout = await readCrontab();
    const lines = stdout.split('\n').filter(l => !l.includes(`hostpanel-backup-${id}`));
    const tmp = writeTempCrontab(lines);
    await runFile('crontab', [tmp]);
    unlinkSync(tmp);
  } catch {}
  res.json({ success: true });
});

/* ── Remote / S3 backup config ───────────────────────────── */

router.get('/remote-config', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all('backup_%') as { key: string; value: string }[];
  const cfg: Record<string, string> = {};
  for (const r of rows) cfg[r.key.replace('backup_', '')] = r.value;
  res.json(cfg);
});

router.put('/remote-config', (req: AuthRequest, res: Response) => {
  const allowed = ['provider', 'bucket', 'region', 'access_key', 'secret_key', 'path_prefix'];
  const upsert = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at");
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    upsert.run(`backup_${k}`, String(v));
  }
  res.json({ success: true });
});

router.post('/push-remote/:name', async (req: AuthRequest, res: Response) => {
  const name = safeFileName(req.params.name);
  const file = path.join(getBackupDir(), name);
  if (!existsSync(file)) return res.status(404).json({ error: 'Backup not found' });

  const get = (k: string) => {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(`backup_${k}`) as any;
    return r?.value || '';
  };

  const provider = get('provider');
  const bucket   = get('bucket');
  const region   = get('region') || 'us-east-1';
  const accessKey = get('access_key');
  const secretKey = get('secret_key');
  const prefix   = get('path_prefix') || 'hostpanel-backups';

  if (!bucket) return res.status(400).json({ error: 'Remote backup not configured. Set bucket first.' });

  if (!/^[a-zA-Z0-9._-]+$/.test(bucket)) return res.status(400).json({ error: 'Invalid bucket name' });
  if (prefix && !/^[a-zA-Z0-9._/-]+$/.test(prefix)) return res.status(400).json({ error: 'Invalid path prefix' });

  try {
    let command = '';
    let args: string[] = [];
    const execEnv: NodeJS.ProcessEnv = { ...process.env };

    if (provider === 's3' || !provider) {
      if (accessKey) {
        execEnv.AWS_ACCESS_KEY_ID = accessKey;
        execEnv.AWS_SECRET_ACCESS_KEY = secretKey;
        execEnv.AWS_DEFAULT_REGION = region;
      }
      command = 'aws';
      args = ['s3', 'cp', file, `s3://${bucket}/${prefix}/${name}`];
    } else if (provider === 'b2') {
      execEnv.B2_APPLICATION_KEY_ID = accessKey;
      execEnv.B2_APPLICATION_KEY = secretKey;
      command = 'b2';
      args = ['upload-file', bucket, file, `${prefix}/${name}`];
    } else if (/^[a-zA-Z0-9_-]+$/.test(provider)) {
      command = 'rclone';
      args = ['copy', file, `${provider}:${bucket}/${prefix}`];
    } else {
      return res.status(400).json({ error: 'Invalid provider' });
    }
    const { stdout } = await runFile(command, args, { timeout: 300000, env: execEnv });
    res.json({ success: true, output: stdout });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

export default router;
