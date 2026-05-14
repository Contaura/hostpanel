import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync } from 'fs';
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

  // Validate iniPath is a real php.ini
  if (!iniPath.endsWith('.ini')) return res.status(400).json({ error: 'Invalid ini path' });

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

export default router;
