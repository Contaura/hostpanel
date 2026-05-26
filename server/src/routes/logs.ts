import { Router, Response } from 'express';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';
import { runFile } from '../utils/process-runner';

const router = Router();

const LOG_FILES: Record<string, { label: string; path: string }> = {
  apache_access: { label: 'Apache Access', path: '/var/log/httpd/access_log' },
  apache_error:  { label: 'Apache Error',  path: '/var/log/httpd/error_log' },
  mariadb:       { label: 'MariaDB',        path: '/var/log/mariadb/mariadb.log' },
  auth:          { label: 'Auth (Secure)',  path: '/var/log/secure' },
  syslog:        { label: 'System',         path: '/var/log/messages' },
  cron:          { label: 'Cron',           path: '/var/log/cron' },
  ftp:           { label: 'FTP',            path: '/var/log/vsftpd.log' },
  mail:          { label: 'Mail',           path: '/var/log/maillog' },
};

async function tailFile(filePath: string, lines: number) {
  const { stdout } = await runFile('tail', ['-n', String(lines), '--', filePath], { timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
  return stdout;
}

router.get('/list', (_req: AuthRequest, res: Response) => {
  const list = Object.entries(LOG_FILES).map(([key, { label, path }]) => ({
    key,
    label,
    path,
    exists: existsSync(path),
  }));
  res.json(list);
});

router.get('/read/:key', async (req: AuthRequest, res: Response) => {
  const { key } = req.params;
  const lines = Math.min(parseInt(req.query.lines as string) || 200, 2000);
  const log = LOG_FILES[key];
  if (!log) return res.status(400).json({ error: 'Unknown log key' });
  if (!existsSync(log.path)) return res.status(404).json({ error: 'Log file not found on this server' });
  try {
    const stdout = await tailFile(log.path, lines);
    res.json({ content: stdout, path: log.path });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search/:key', async (req: AuthRequest, res: Response) => {
  const { key } = req.params;
  const query = (req.query.q as string || '').trim();
  if (!query) return res.status(400).json({ error: 'Query parameter q is required' });
  const log = LOG_FILES[key];
  if (!log || !existsSync(log.path)) return res.status(404).json({ error: 'Log not found' });
  try {
    const stdout = await tailFile(log.path, 10000);
    const lq = query.toLowerCase();
    const content = stdout.split('\n').filter(l => l.toLowerCase().includes(lq)).slice(-500).join('\n');
    res.json({ content, path: log.path });
  } catch {
    res.json({ content: '', path: log.path });
  }
});

/* ── Per-domain log viewer ───────────────────────────────── */

const HTTPD_LOG_DIR = process.env.HTTPD_LOG_DIR || '/var/log/httpd';

router.get('/domain-list', async (_req: AuthRequest, res: Response) => {
  try {
    const files = await fs.readdir(HTTPD_LOG_DIR);
    const domains = files
      .filter(f => f.endsWith('-access.log'))
      .map(f => f.replace(/-access\.log$/, ''));
    res.json(domains);
  } catch { res.json([]); }
});

router.get('/domain/:domain/:type', async (req: AuthRequest, res: Response) => {
  const { domain, type } = req.params;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}$/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!['access', 'error'].includes(type)) return res.status(400).json({ error: 'type must be access or error' });
  const lines = Math.min(parseInt((req.query.lines as string) || '300'), 2000);
  const search = (req.query.q as string || '').trim();
  const logPath = path.join(HTTPD_LOG_DIR, `${domain}-${type}.log`);
  if (!existsSync(logPath)) return res.status(404).json({ error: `No ${type} log found for ${domain}`, path: logPath });
  try {
    const stdout = await tailFile(logPath, lines);
    const content = search
      ? stdout.split('\n').filter(l => l.toLowerCase().includes(search.toLowerCase())).join('\n')
      : stdout;
    res.json({ content, path: logPath, domain, type });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
