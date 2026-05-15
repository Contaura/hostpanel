import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

const EDITABLE_SETTINGS = [
  'memory_limit',
  'max_execution_time',
  'upload_max_filesize',
  'post_max_size',
  'max_input_vars',
  'max_file_uploads',
  'display_errors',
  'error_reporting',
  'default_timezone',
  'session.gc_maxlifetime',
];

router.get('/info', async (_req: AuthRequest, res: Response) => {
  try {
    const [versionRes, iniRes, extRes] = await Promise.all([
      execAsync('php -v 2>/dev/null | head -1').catch(() => ({ stdout: 'PHP not found' })),
      execAsync('php -i 2>/dev/null | grep "Loaded Configuration File" | cut -d">" -f2').catch(() => ({ stdout: '' })),
      execAsync('php -m 2>/dev/null').catch(() => ({ stdout: '' })),
    ]);

    const extensions = versionRes.stdout.includes('not found')
      ? []
      : extRes.stdout.split('\n').filter(e => e.trim() && !e.startsWith('['));

    res.json({
      version: versionRes.stdout.trim(),
      iniPath: iniRes.stdout.trim().replace(/^\s*=>\s*/, '').trim(),
      extensions,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/settings', async (_req: AuthRequest, res: Response) => {
  try {
    const results: Record<string, string> = {};
    await Promise.all(
      EDITABLE_SETTINGS.map(async key => {
        try {
          const { stdout } = await execAsync(`php -r "echo ini_get('${key}');"`);
          results[key] = stdout.trim();
        } catch {
          results[key] = '';
        }
      })
    );
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', async (req: AuthRequest, res: Response) => {
  const { iniPath, settings } = req.body;
  if (!iniPath || typeof settings !== 'object') {
    return res.status(400).json({ error: 'iniPath and settings are required' });
  }

  if (!path.isAbsolute(iniPath) || iniPath.includes('..') || !iniPath.endsWith('.ini')) {
    return res.status(400).json({ error: 'Invalid ini path' });
  }

  try {
    let content = readFileSync(iniPath, 'utf8');
    for (const [key, value] of Object.entries(settings as Record<string, string>)) {
      if (!EDITABLE_SETTINGS.includes(key)) continue;
      const safeVal = String(value).replace(/[^\w\s.EMGKB\-+]/gi, '');
      const re = new RegExp(`^(;?\\s*${key.replace('.', '\\.')}\\s*=.*)$`, 'm');
      if (re.test(content)) {
        content = content.replace(re, `${key} = ${safeVal}`);
      } else {
        content += `\n${key} = ${safeVal}\n`;
      }
    }
    writeFileSync(iniPath, content);
    await execAsync('systemctl reload php-fpm 2>/dev/null || true');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PHP-FPM pool editor per-domain ─────────────────────── */

const FPM_POOL_DIR = process.env.FPM_POOL_DIR || '/etc/php-fpm.d';
const FPM_POOL_KEYS = ['pm', 'pm.max_children', 'pm.start_servers', 'pm.min_spare_servers', 'pm.max_spare_servers', 'pm.max_requests', 'request_terminate_timeout', 'rlimit_files'];

function poolPath(domain: string) {
  return `${FPM_POOL_DIR}/${domain.replace(/[^a-zA-Z0-9._-]/g, '')}.conf`;
}

router.get('/fpm-pool/:domain', (_req: AuthRequest, res: Response) => {
  const p = poolPath(_req.params.domain);
  try {
    const { existsSync: ex, readFileSync: rf } = require('fs');
    if (!ex(p)) return res.json({ exists: false, settings: {} });
    const raw = rf(p, 'utf8') as string;
    const settings: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([a-zA-Z_.]+)\s*=\s*(.+)/);
      if (m) settings[m[1].trim()] = m[2].trim();
    }
    res.json({ exists: true, settings });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/fpm-pool/:domain', async (req: AuthRequest, res: Response) => {
  const domain = req.params.domain.replace(/[^a-zA-Z0-9._-]/g, '');
  const p = poolPath(domain);
  const settings: Record<string, string> = req.body || {};
  try {
    const { writeFileSync: wf, mkdirSync: mk, existsSync: ex } = require('fs');
    if (!ex(FPM_POOL_DIR)) mk(FPM_POOL_DIR, { recursive: true });
    const user = (settings.user || domain).replace(/[^a-zA-Z0-9._-]/g, '');
    const lines = [
      `[${domain}]`,
      `user = ${user}`,
      `group = ${user}`,
      `listen = /var/run/php-fpm/${domain}.sock`,
      `listen.owner = apache`,
      `listen.group = apache`,
    ];
    for (const k of FPM_POOL_KEYS) {
      if (settings[k]) lines.push(`${k} = ${String(settings[k]).replace(/[^a-zA-Z0-9 _.]/g, '')}`);
    }
    wf(p, lines.join('\n') + '\n');
    await execAsync('systemctl reload php-fpm 2>/dev/null || true');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/fpm-pool/:domain', async (req: AuthRequest, res: Response) => {
  const p = poolPath(req.params.domain);
  try {
    const { unlinkSync, existsSync } = require('fs');
    if (existsSync(p)) unlinkSync(p);
    await execAsync('systemctl reload php-fpm 2>/dev/null || true');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Per-domain .user.ini editor ─────────────────────────── */

const WEBROOT = process.env.WEBROOT || '/var/www';
const USER_INI_KEYS = ['memory_limit', 'max_execution_time', 'upload_max_filesize', 'post_max_size', 'max_input_vars', 'display_errors', 'default_timezone'];

function iniPath(domain: string) {
  // sanitize
  const safe = domain.replace(/[^a-zA-Z0-9._-]/g, '');
  return `${WEBROOT}/${safe}/public_html/.user.ini`;
}

router.get('/user-ini/:domain', async (req: AuthRequest, res: Response) => {
  const p = iniPath(req.params.domain);
  try {
    const { readFileSync, existsSync } = await import('fs');
    if (!existsSync(p)) return res.json({});
    const raw = readFileSync(p, 'utf8');
    const settings: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([a-zA-Z_.]+)\s*=\s*(.+)/);
      if (m) settings[m[1].trim()] = m[2].trim();
    }
    res.json(settings);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/user-ini/:domain', async (req: AuthRequest, res: Response) => {
  const p = iniPath(req.params.domain);
  const settings: Record<string, string> = req.body || {};
  try {
    const { mkdirSync, writeFileSync } = await import('fs');
    const { dirname } = await import('path');
    mkdirSync(dirname(p), { recursive: true });
    const lines = USER_INI_KEYS
      .filter(k => settings[k] !== undefined && settings[k] !== '')
      .map(k => `${k} = ${String(settings[k]).replace(/[^\w\s.EMGKB\-+]/gi, '')}`);
    writeFileSync(p, lines.join('\n') + '\n');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

