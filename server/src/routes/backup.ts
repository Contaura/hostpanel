import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

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

export default router;
