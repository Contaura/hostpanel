import { Router, Request, Response } from 'express';
import { runFile } from '../utils/process-runner';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import db from '../db';

const router = Router();
const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';

/* ── Detect installed PHP versions ──────────────────────── */

router.get('/versions', async (_req: Request, res: Response) => {
  try {
    let versions: string[] = [];
    try {
      const { readdirSync } = require('fs');
      const fpm = readdirSync('/etc/php-fpm.d').map((f: string) => (f.match(/^(\d+\.\d+)/) || [])[1]).filter(Boolean) as string[];
      versions = Array.from(new Set(fpm)).sort();
    } catch {}
    // Also detect via php-fpm sockets
    let fromSockets: string[] = [];
    try {
      const { readdirSync } = require('fs');
      const dirs = ['/var/run/php-fpm', '/run/php'];
      for (const d of dirs) { try { fromSockets.push(...readdirSync(d).map((f: string) => (f.match(/(\d+\.\d+)/) || [])[1]).filter(Boolean) as string[]); } catch {} }
    } catch {}
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
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));
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
    const { stdout: installed } = await runFile('node', ['--version']).catch(() => ({ stdout: '', stderr: '' }));
    const { stdout: current }   = await runFile('node', ['--version']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({
      current:   current.trim(),
      installed: installed.trim().split('\n').filter(Boolean).map(v => v.replace(/[*>→\s]/g, '')).filter(v => v.startsWith('v')),
      available: [],
    });
  } catch { res.json({ current: '', installed: [], available: [] }); }
});

router.post('/node-install', async (req: Request, res: Response) => {
  const { version } = req.body;
  if (!version || !/^v?\d+(\.\d+)*$/.test(version)) return res.status(400).json({ error: 'Invalid version' });
  try {
    const { stdout } = await runFile('bash', ['-lc', `source ~/.nvm/nvm.sh && nvm install ${version.replace(/[^0-9v.]/g, '')}`], { timeout: 300000 });
    res.json({ success: true, output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── pyenv (Python version manager) ─────────────────────── */

router.get('/python-versions', async (_req: Request, res: Response) => {
  try {
    const { stdout: current }   = await runFile('python3', ['--version']).catch(() => ({ stdout: '', stderr: '' }));
    const { stdout: installed } = await runFile('pyenv', ['versions', '--bare']).catch(() => ({ stdout: '', stderr: '' }));
    const { stdout: availRaw } = await runFile('pyenv', ['install', '--list']).catch(() => ({ stdout: '', stderr: '' }));
    const available = availRaw.split('\n').filter(l => /^\s+3\./.test(l)).slice(-10).join('\n');
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
    const { stdout } = await runFile('pyenv', ['install', version], { timeout: 600000 });
    res.json({ success: true, output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
