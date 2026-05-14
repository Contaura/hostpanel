import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import db from '../db';

const router = Router();
const execAsync = promisify(exec);
const CGROUP_BASE = '/sys/fs/cgroup';

/* ── List resource limits per account ───────────────────── */

router.get('/', (_req: Request, res: Response) => {
  const accounts = db.prepare(`
    SELECT a.*, p.disk_quota, p.bandwidth, p.name as plan_name
    FROM accounts a LEFT JOIN plans p ON a.plan_id = p.id
    ORDER BY a.username
  `).all() as any[];
  res.json(accounts);
});

/* ── Set cgroup limits for a user ───────────────────────── */

router.post('/:username', async (req: Request, res: Response) => {
  const { username } = req.params;
  if (!/^[a-zA-Z][a-zA-Z0-9_]{1,31}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });

  const { cpu_quota, memory_limit_mb, io_weight } = req.body;
  try {
    const cgroupPath = path.join(CGROUP_BASE, 'hostpanel', username);
    mkdirSync(cgroupPath, { recursive: true });

    if (cpu_quota !== undefined) {
      // cpu_quota in % (e.g. 50 = 50% of one CPU)
      const period = 100000; // 100ms
      const quota  = Math.round((cpu_quota / 100) * period);
      writeFileSync(path.join(cgroupPath, 'cpu.max'), `${quota} ${period}`);
    }
    if (memory_limit_mb !== undefined) {
      const bytes = memory_limit_mb * 1024 * 1024;
      writeFileSync(path.join(cgroupPath, 'memory.max'), String(bytes));
    }
    if (io_weight !== undefined) {
      writeFileSync(path.join(cgroupPath, 'io.weight'), `default ${io_weight}`);
    }

    res.json({ success: true, username, cpu_quota, memory_limit_mb, io_weight });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Get current usage for a user ───────────────────────── */

router.get('/:username/usage', async (req: Request, res: Response) => {
  const { username } = req.params;
  if (!/^[a-zA-Z][a-zA-Z0-9_]{1,31}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  try {
    const cgroupPath = path.join(CGROUP_BASE, 'hostpanel', username);
    const read = (file: string) => { try { return readFileSync(path.join(cgroupPath, file), 'utf8').trim(); } catch { return null; } };

    const cpuMax  = read('cpu.max');
    const memMax  = read('memory.max');
    const memCurr = read('memory.current');

    // Disk usage via du
    const { stdout: du } = await execAsync(`du -sb /var/www/${username} 2>/dev/null || echo "0"`).catch(() => ({ stdout: '0' }));
    const diskBytes = parseInt(du.trim().split(/\s+/)[0]) || 0;

    res.json({
      username,
      cpu_quota:  cpuMax ? parseInt(cpuMax.split(' ')[0]) / 1000 : null,
      memory_max_mb: memMax ? Math.round(parseInt(memMax) / 1024 / 1024) : null,
      memory_used_mb: memCurr ? Math.round(parseInt(memCurr) / 1024 / 1024) : null,
      disk_used_mb: Math.round(diskBytes / 1024 / 1024),
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Nginx vhost management ──────────────────────────────── */

const NGINX_DIR = process.env.NGINX_DIR || '/etc/nginx/sites-available';
const NGINX_EN  = process.env.NGINX_EN  || '/etc/nginx/sites-enabled';

router.get('/nginx/vhosts', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync(`ls ${NGINX_DIR}/*.conf 2>/dev/null || echo ""`);
    const files = stdout.trim().split('\n').filter(Boolean);
    const vhosts = files.map(f => {
      const name = path.basename(f, '.conf');
      const conf = existsSync(f) ? readFileSync(f, 'utf8') : '';
      const serverName = conf.match(/server_name\s+(\S+)/)?.[1] || name;
      const root = conf.match(/root\s+(\S+)/)?.[1] || '';
      const enabled = existsSync(path.join(NGINX_EN, path.basename(f)));
      return { name, serverName, root, enabled };
    });
    res.json(vhosts);
  } catch { res.json([]); }
});

router.post('/nginx/vhosts', async (req: Request, res: Response) => {
  const { domain, root, php_fpm_socket } = req.body;
  if (!domain || !root) return res.status(400).json({ error: 'domain and root required' });
  const conf = `server {
  listen 80;
  server_name ${domain} www.${domain};
  root ${root};
  index index.php index.html;

  location / { try_files $uri $uri/ /index.php?$query_string; }

  location ~ \\.php$ {
    fastcgi_pass unix:${php_fpm_socket || '/var/run/php-fpm/php8.1-fpm.sock'};
    fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
    include fastcgi_params;
  }

  location ~ /\\.ht { deny all; }
}
`;
  try {
    writeFileSync(path.join(NGINX_DIR, `${domain}.conf`), conf);
    await execAsync(`ln -sf ${NGINX_DIR}/${domain}.conf ${NGINX_EN}/${domain}.conf`).catch(() => {});
    await execAsync('nginx -t && systemctl reload nginx').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/nginx/vhosts/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!/^[a-z0-9.-]+$/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    await execAsync(`rm -f ${NGINX_DIR}/${domain}.conf ${NGINX_EN}/${domain}.conf`);
    await execAsync('systemctl reload nginx').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Disk quota enforcement (setquota) ───────────────────── */

router.get('/disk-quotas', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync("repquota -a -s 2>/dev/null || echo ''");
    const lines = stdout.split('\n').filter(l => /^\w/.test(l) && !l.startsWith('Block') && !l.startsWith('Disk'));
    const quotas = lines.map(l => {
      const parts = l.trim().split(/\s+/);
      if (parts.length < 6) return null;
      return {
        user: parts[0],
        block_used: parts[1] || '0',
        block_soft: parts[2] || '0',
        block_hard: parts[3] || '0',
        inode_used: parts[4] || '0',
        inode_soft: parts[5] || '0',
        inode_hard: parts[6] || '0',
      };
    }).filter(Boolean);
    res.json(quotas);
  } catch {
    res.json([]);
  }
});

router.post('/disk-quotas/:username', async (req: Request, res: Response) => {
  const { username } = req.params;
  if (!/^[a-zA-Z][a-zA-Z0-9_]{1,31}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  const { block_soft_mb, block_hard_mb } = req.body;
  if (!block_soft_mb && !block_hard_mb) return res.status(400).json({ error: 'Provide block_soft_mb or block_hard_mb' });

  const soft = Math.round((parseInt(block_soft_mb) || 0) * 1024);
  const hard = Math.round((parseInt(block_hard_mb) || soft * 1.1) * 1024);

  try {
    await execAsync(`setquota -u ${username} ${soft} ${hard} 0 0 / 2>&1`);
    res.json({ success: true, username, block_soft_kb: soft, block_hard_kb: hard });
  } catch (err: any) {
    res.status(500).json({ error: err.stderr || err.message });
  }
});

export default router;

