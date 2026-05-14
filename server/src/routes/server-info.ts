import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const router = Router();
const execAsync = promisify(exec);

async function run(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: 10000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const [
      os, kernel, uptime, hostname,
      cpuModel, cpuCores, totalMem, freeMem,
      apache, mysql, php, nginx,
      disk, loadAvg,
    ] = await Promise.all([
      run('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\' '),
      run('uname -r'),
      run('uptime -p 2>/dev/null || uptime'),
      run('hostname -f'),
      run('lscpu | grep "Model name" | cut -d: -f2 | xargs'),
      run('nproc'),
      run('free -m | awk \'/Mem:/{print $2}\''),
      run('free -m | awk \'/Mem:/{print $7}\''),
      run('httpd -v 2>/dev/null | head -1 || apache2 -v 2>/dev/null | head -1 || echo ""'),
      run('mysql --version 2>/dev/null || mariadb --version 2>/dev/null || echo ""'),
      run('php -v 2>/dev/null | head -1 || echo ""'),
      run('nginx -v 2>&1 | head -1 || echo ""'),
      run('df -h / | tail -1 | awk \'{print $2" total,",$3" used,",$4" free,",$5" used"}\''),
      run('cat /proc/loadavg | awk \'{print $1,$2,$3}\''),
    ]);

    const services = await Promise.all(
      ['httpd', 'nginx', 'mariadb', 'mysqld', 'postfix', 'dovecot', 'named', 'vsftpd', 'sshd', 'php-fpm'].map(async svc => {
        const active = await run(`systemctl is-active ${svc} 2>/dev/null`);
        return { name: svc, active: active === 'active' };
      })
    ).then(all => all.filter(s => {
      // Deduplicate: if both httpd and nginx are stopped, keep both; if mariadb active skip mysqld
      return true;
    }));

    res.json({
      hostname,
      os,
      kernel,
      uptime,
      cpu: { model: cpuModel, cores: parseInt(cpuCores) || 1 },
      memory: { total_mb: parseInt(totalMem) || 0, available_mb: parseInt(freeMem) || 0 },
      disk,
      load_avg: loadAvg,
      software: {
        apache: apache || null,
        nginx: nginx || null,
        mysql: mysql || null,
        php: php || null,
      },
      services,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
