import { Router, Response } from 'express';
import si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

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
        const { stdout } = await execAsync(`systemctl is-active ${name} 2>/dev/null || true`);
        return { name, status: stdout.trim() === 'active' ? 'running' : 'stopped' };
      } catch {
        return { name, status: 'unknown' };
      }
    })
  );

  res.json(results);
});

export default router;
