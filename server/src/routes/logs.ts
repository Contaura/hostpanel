import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

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
    const { stdout } = await execAsync(`tail -n ${lines} "${log.path}" 2>&1`);
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
    // Use fgrep for literal search to avoid regex injection
    const { stdout } = await execAsync(
      `fgrep -i ${JSON.stringify(query)} "${log.path}" 2>/dev/null | tail -500`
    );
    res.json({ content: stdout, path: log.path });
  } catch {
    res.json({ content: '', path: log.path });
  }
});

/* ── Per-domain log viewer ───────────────────────────────── */

const HTTPD_LOG_DIR = process.env.HTTPD_LOG_DIR || '/var/log/httpd';

router.get('/domain-list', async (_req: AuthRequest, res: Response) => {
  try {
    const { stdout } = await execAsync(`ls "${HTTPD_LOG_DIR}"/*-access.log 2>/dev/null || true`);
    const domains = stdout.trim().split('\n').filter(Boolean)
      .map(f => f.replace(/-access\.log$/, '').replace(/.*\//, ''));
    res.json(domains);
  } catch { res.json([]); }
});

router.get('/domain/:domain/:type', async (req: AuthRequest, res: Response) => {
  const { domain, type } = req.params;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}$/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!['access', 'error'].includes(type)) return res.status(400).json({ error: 'type must be access or error' });
  const lines = Math.min(parseInt((req.query.lines as string) || '300'), 2000);
  const search = (req.query.q as string || '').trim();
  const logPath = `${HTTPD_LOG_DIR}/${domain}-${type}.log`;
  if (!existsSync(logPath)) return res.status(404).json({ error: `No ${type} log found for ${domain}`, path: logPath });
  try {
    const grepPart = search ? `| fgrep -i ${JSON.stringify(search)}` : '';
    const { stdout } = await execAsync(`tail -n ${lines} "${logPath}" ${grepPart} 2>/dev/null || true`);
    res.json({ content: stdout, path: logPath, domain, type });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
