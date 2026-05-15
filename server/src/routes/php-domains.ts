import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import db from '../db';

const router = Router();
const execAsync = promisify(exec);
const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';

/* ── Detect installed PHP versions ──────────────────────── */

router.get('/versions', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('ls /etc/php-fpm.d/ 2>/dev/null | grep -oP "^\\d+\\.\\d+" | sort -V | uniq || ls /usr/bin/php* 2>/dev/null | grep -oP "php\\K[0-9.]+"').catch(() => ({ stdout: '' }));
    const versions = stdout.trim().split('\n').filter(v => v && /^\d+\.\d+$/.test(v.trim()));
    // Also detect via php-fpm sockets
    const { stdout: sockets } = await execAsync('ls /var/run/php-fpm/ 2>/dev/null || ls /run/php/ 2>/dev/null || echo ""').catch(() => ({ stdout: '' }));
    const fromSockets = sockets.trim().split('\n').filter(Boolean).map(s => s.match(/(\d+\.\d+)/)?.[1]).filter(Boolean) as string[];
    const allVersions = [...new Set([...versions, ...fromSockets])].sort();
    res.json(allVersions.length ? allVersions : ['8.1', '8.2', '8.3']);
  } catch { res.json(['8.1', '8.2', '8.3']); }
});

/* ── List per-domain PHP assignments ────────────────────── */

router.get('/', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM php_domain_versions ORDER BY domain').all());
});

/* ── Set PHP version for a domain ───────────────────────── */

router.post('/', async (req: Request, res: Response) => {
  const { domain, php_version } = req.body;
  if (!domain || !php_version) return res.status(400).json({ error: 'domain and php_version required' });
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,253}[a-zA-Z0-9]$/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!/^\d+\.\d+$/.test(php_version)) return res.status(400).json({ error: 'Invalid PHP version format' });

  try {
    // Update vhost config to use the correct php-fpm socket
    const vhostFile = path.join(VHOST_DIR, `${domain}.conf`);
    if (existsSync(vhostFile)) {
      let conf = readFileSync(vhostFile, 'utf8');
      // Update SetHandler or ProxyPassMatch for php-fpm
      const socketPath = `/var/run/php-fpm/php${php_version}-fpm.sock`;
      const altSocket  = `/run/php/php${php_version}-fpm.sock`;
      const sock = existsSync(socketPath) ? socketPath : altSocket;
      conf = conf.replace(/unix:\/[^|]+\|fcgi:\/\/localhost/, `unix:${sock}|fcgi://localhost`);
      conf = conf.replace(/SetHandler "proxy:unix:\/[^"]+\|fcgi:\/\/localhost"/, `SetHandler "proxy:unix:${sock}|fcgi://localhost"`);
      writeFileSync(vhostFile, conf);
    }

    db.prepare("INSERT INTO php_domain_versions (domain, php_version) VALUES (?, ?) ON CONFLICT(domain) DO UPDATE SET php_version=excluded.php_version, updated_at=datetime('now')")
      .run(domain, php_version);
    await execAsync('apachectl graceful').catch(() => {});
    res.json({ success: true, domain, php_version });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:domain', (req: Request, res: Response) => {
  db.prepare('DELETE FROM php_domain_versions WHERE domain = ?').run(req.params.domain);
  res.json({ success: true });
});

/* ── nvm (Node.js version manager) ──────────────────────── */

router.get('/node-versions', async (_req: Request, res: Response) => {
  try {
    const { stdout: installed } = await execAsync('nvm list --no-colors 2>/dev/null || ~/.nvm/nvm.sh && nvm list 2>/dev/null || node --version 2>/dev/null').catch(() => ({ stdout: '' }));
    const { stdout: current }   = await execAsync('node --version 2>/dev/null').catch(() => ({ stdout: '' }));
    const { stdout: available } = await execAsync('nvm ls-remote --lts --no-colors 2>/dev/null | tail -10').catch(() => ({ stdout: '' }));
    res.json({
      current:   current.trim(),
      installed: installed.trim().split('\n').filter(Boolean).map(v => v.replace(/[*>→\s]/g, '')).filter(v => v.startsWith('v')),
      available: available.trim().split('\n').filter(Boolean).map(v => v.trim().split(/\s+/)[0]).filter(Boolean),
    });
  } catch { res.json({ current: '', installed: [], available: [] }); }
});

router.post('/node-install', async (req: Request, res: Response) => {
  const { version } = req.body;
  if (!version || !/^v?\d+(\.\d+)*$/.test(version)) return res.status(400).json({ error: 'Invalid version' });
  try {
    const { stdout } = await execAsync(`bash -c "source ~/.nvm/nvm.sh && nvm install ${version}" 2>&1`, { timeout: 300000 });
    res.json({ success: true, output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── pyenv (Python version manager) ─────────────────────── */

router.get('/python-versions', async (_req: Request, res: Response) => {
  try {
    const { stdout: current }   = await execAsync('python3 --version 2>/dev/null').catch(() => ({ stdout: '' }));
    const { stdout: installed } = await execAsync('pyenv versions --bare 2>/dev/null').catch(() => ({ stdout: '' }));
    const { stdout: available } = await execAsync('pyenv install --list 2>/dev/null | grep -E "^  3\\." | tail -10').catch(() => ({ stdout: '' }));
    res.json({
      current:   current.trim(),
      installed: installed.trim().split('\n').filter(Boolean),
      available: available.trim().split('\n').map(v => v.trim()).filter(Boolean),
    });
  } catch { res.json({ current: '', installed: [], available: [] }); }
});

router.post('/python-install', async (req: Request, res: Response) => {
  const { version } = req.body;
  if (!version || !/^\d+\.\d+(\.\d+)?$/.test(version)) return res.status(400).json({ error: 'Invalid version' });
  try {
    const { stdout } = await execAsync(`pyenv install ${version} 2>&1`, { timeout: 600000 });
    res.json({ success: true, output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
