import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { AuthRequest } from '../middleware/auth';
import db from '../db';

const router = Router();
const execAsync = promisify(exec);

function getBackupDir(): string {
  const dir = process.env.BACKUP_DIR || '/var/backups/hostpanel';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFileName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '');
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

router.post('/create', async (req: AuthRequest, res: Response) => {
  const { type, target } = req.body;
  const dir = getBackupDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  try {
    let filename: string;
    if (type === 'files') {
      const srcDir = target
        ? path.join(process.env.WEBROOT || '/var/www', target)
        : (process.env.WEBROOT || '/var/www');
      const label = target ? target.replace(/[^a-zA-Z0-9]/g, '_') : 'all';
      filename = `files_${label}_${ts}.tar.gz`;
      const out = path.join(dir, filename);
      await execAsync(`tar -czf "${out}" -C "${srcDir}" . 2>&1`, { timeout: 300000 });
    } else if (type === 'database') {
      if (!target || !/^[a-zA-Z0-9_]+$/.test(target)) {
        return res.status(400).json({ error: 'Invalid database name' });
      }
      filename = `db_${target}_${ts}.sql.gz`;
      const out = path.join(dir, filename);
      const user = process.env.DB_ROOT_USER || 'root';
      const pass = process.env.DB_ROOT_PASS || '';
      const passArg = pass ? `-p${pass}` : '';
      await execAsync(`mysqldump -u${user} ${passArg} ${target} | gzip > "${out}"`, { timeout: 300000 });
    } else {
      return res.status(400).json({ error: 'type must be files or database' });
    }

    const st = statSync(path.join(dir, filename));
    res.json({ name: filename, size: st.size, created: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/download/:name', (req: AuthRequest, res: Response) => {
  const name = safeFileName(req.params.name);
  const file = path.join(getBackupDir(), name);
  if (!existsSync(file)) return res.status(404).json({ error: 'File not found' });
  res.download(file);
});

router.post('/restore/:name', async (req: AuthRequest, res: Response) => {
  const name = safeFileName(req.params.name);
  const file = path.join(getBackupDir(), name);
  if (!existsSync(file)) return res.status(404).json({ error: 'Backup file not found' });

  try {
    if (name.endsWith('.sql.gz')) {
      // Database restore
      const dbName = name.replace(/^db_/, '').replace(/_\d{4}-.*\.sql\.gz$/, '');
      if (!/^[a-zA-Z0-9_]+$/.test(dbName)) return res.status(400).json({ error: 'Cannot determine database name from filename' });
      const user = process.env.DB_ROOT_USER || 'root';
      const pass = process.env.DB_ROOT_PASS || '';
      const passArg = pass ? `-p${pass}` : '';
      await execAsync(`gunzip -c "${file}" | mysql -u${user} ${passArg} ${dbName}`, { timeout: 300000 });
      res.json({ success: true, message: `Database ${dbName} restored` });
    } else if (name.endsWith('.tar.gz')) {
      // Files restore — extract back to webroot
      const webroot = process.env.WEBROOT || '/var/www';
      await execAsync(`tar -xzf "${file}" -C "${webroot}"`, { timeout: 300000 });
      res.json({ success: true, message: `Files restored to ${webroot}` });
    } else {
      res.status(400).json({ error: 'Unknown backup format' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
    const { stdout: existing } = await execAsync('crontab -l 2>/dev/null || echo ""');
    const lines = existing.split('\n').filter(l => !l.includes(`hostpanel-backup-${id}`));
    lines.push(cronLine);
    const tmp = `/tmp/hp_backup_cron_${Date.now()}`;
    const { writeFileSync: wf, unlinkSync: ul } = await import('fs');
    wf(tmp, lines.join('\n') + '\n');
    await execAsync(`crontab ${tmp}`);
    ul(tmp);
  } catch {}

  res.json(db.prepare('SELECT * FROM backup_schedules WHERE id = ?').get(id));
});

router.delete('/schedules/:id', async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  db.prepare('DELETE FROM backup_schedules WHERE id = ?').run(parseInt(id));
  // Remove from crontab
  try {
    const { stdout } = await execAsync('crontab -l 2>/dev/null || echo ""');
    const lines = stdout.split('\n').filter(l => !l.includes(`hostpanel-backup-${id}`));
    const { writeFileSync: wf, unlinkSync: ul } = await import('fs');
    const tmp = `/tmp/hp_backup_cron_rm_${Date.now()}`;
    wf(tmp, lines.join('\n') + '\n');
    await execAsync(`crontab ${tmp}`);
    ul(tmp);
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

  try {
    let cmd = '';
    if (provider === 's3' || !provider) {
      const env = accessKey ? `AWS_ACCESS_KEY_ID=${accessKey} AWS_SECRET_ACCESS_KEY=${secretKey} AWS_DEFAULT_REGION=${region} ` : '';
      cmd = `${env}aws s3 cp "${file}" "s3://${bucket}/${prefix}/${name}" 2>&1`;
    } else if (provider === 'b2') {
      cmd = `B2_APPLICATION_KEY_ID=${accessKey} B2_APPLICATION_KEY=${secretKey} b2 upload-file ${bucket} "${file}" "${prefix}/${name}" 2>&1`;
    } else {
      cmd = `rclone copy "${file}" "${provider}:${bucket}/${prefix}" 2>&1`;
    }
    const { stdout } = await execAsync(cmd, { timeout: 300000 });
    res.json({ success: true, output: stdout });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

export default router;

