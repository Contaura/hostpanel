import { Router, Response } from 'express';
import si from 'systeminformation';
import { runFile } from '../utils/process-runner';
import cron from 'node-cron';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const [cpu, mem, disk, network, osInfo, uptime] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.osInfo(),
      si.time(),
    ]);

    const primaryDisk = disk.find(d => d.mount === '/') || disk[0];
    const primaryNet = network[0] || { rx_sec: 0, tx_sec: 0 };

    res.json({
      cpu: {
        load: Math.round(cpu.currentLoad),
        cores: cpu.cpus?.length || 1,
      },
      memory: {
        total: mem.total,
        used: mem.active,
        free: mem.available,
        percent: Math.round((mem.active / mem.total) * 100),
      },
      disk: primaryDisk
        ? {
            total: primaryDisk.size,
            used: primaryDisk.used,
            free: primaryDisk.size - primaryDisk.used,
            percent: Math.round(primaryDisk.use),
            mount: primaryDisk.mount,
          }
        : null,
      network: {
        rx: primaryNet.rx_sec || 0,
        tx: primaryNet.tx_sec || 0,
      },
      os: {
        distro: osInfo.distro,
        release: osInfo.release,
        kernel: osInfo.kernel,
        hostname: osInfo.hostname,
      },
      uptime: uptime.uptime,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/services', async (_req: AuthRequest, res: Response) => {
  const services = ['httpd', 'mariadb', 'postfix', 'dovecot', 'named', 'vsftpd', 'sshd'];

  const results = await Promise.all(
    services.map(async name => {
      try {
        const { stdout } = await runFile('systemctl', ['is-active', name]).catch(() => ({ stdout: '', stderr: '' }));
        return { name, status: stdout.trim() === 'active' ? 'running' : 'stopped' };
      } catch {
        return { name, status: 'unknown' };
      }
    })
  );

  res.json(results);
});

router.get('/history', (_req: AuthRequest, res: Response) => {
  const rows = db.prepare(
    `SELECT cpu, mem, disk, rx, tx, created_at FROM metric_snapshots ORDER BY created_at DESC LIMIT 60`
  ).all();
  res.json(rows.reverse());
});

// Collect a snapshot every minute
cron.schedule('* * * * *', async () => {
  try {
    const [cpu, mem, disk, net] = await Promise.all([
      si.currentLoad(), si.mem(), si.fsSize(), si.networkStats(),
    ]);
    const primaryDisk = disk.find((d: any) => d.mount === '/') || disk[0];
    const primaryNet  = net[0] || { rx_sec: 0, tx_sec: 0 };
    db.prepare(
      'INSERT INTO metric_snapshots (cpu, mem, disk, rx, tx) VALUES (?, ?, ?, ?, ?)'
    ).run(
      Math.round(cpu.currentLoad),
      Math.round((mem.active / mem.total) * 100),
      primaryDisk ? Math.round(primaryDisk.use) : 0,
      primaryNet.rx_sec || 0,
      primaryNet.tx_sec || 0,
    );
    // Keep only last 24 hours
    db.prepare(`DELETE FROM metric_snapshots WHERE created_at < datetime('now', '-1 day')`).run();
  } catch {}
});

export default router;
