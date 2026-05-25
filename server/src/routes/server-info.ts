import { Router, Request, Response } from 'express';
import { runFile } from '../utils/process-runner';
import { readFileSync } from 'fs';

const router = Router();

async function rf(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await runFile(cmd, args, { timeout: 10000 });
    return stdout.trim();
  } catch { return ''; }
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const osRelease = (() => { try { return readFileSync('/etc/os-release', 'utf8'); } catch { return ''; } })();
    const osMatch = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    const os = osMatch ? osMatch[1] : '';

    const [
      kernel, uptime, hostname,
      cpuRaw, cpuCores, memRaw,
      apache, mysql, php, nginx,
      dfRaw, loadRaw,
    ] = await Promise.all([
      rf('uname', ['-r']),
      rf('uptime', ['-p']),
      rf('hostname', ['-f']),
      rf('lscpu', []),
      rf('nproc', []),
      rf('free', ['-m']),
      rf('httpd', ['-v']),
      rf('mysql', ['--version']),
      rf('php', ['-v']),
      rf('nginx', ['-v']),
      rf('df', ['-h', '/']),
      (async () => { try { return readFileSync('/proc/loadavg', 'utf8').trim(); } catch { return ''; } })(),
    ]);

    const cpuModel = (cpuRaw.match(/Model name:\s*(.+)/) || [])[1] || '';
    const memLine = memRaw.split('\n').find(l => l.startsWith('Mem:')) || '';
    const memParts = memLine.trim().split(/\s+/);
    const totalMem = memParts[1] || '0';
    const freeMem = memParts[6] || memParts[3] || '0';
    const apacheFirst = apache.split('\n')[0] || '';
    const mysqlFirst = mysql.split('\n')[0] || '';
    const phpFirst = php.split('\n')[0] || '';
    const nginxFirst = nginx.split('\n')[0] || '';
    const dfLines = dfRaw.split('\n');
    const dfData = (dfLines[dfLines.length - 1] || '').trim().split(/\s+/);
    const disk = dfData.length >= 5 ? `${dfData[1]} total, ${dfData[2]} used, ${dfData[3]} free, ${dfData[4]} used` : '';
    const loadFields = loadRaw.split(/\s+/);
    const loadAvg = loadFields.length >= 3 ? `${loadFields[0]} ${loadFields[1]} ${loadFields[2]}` : '';

    const services = await Promise.all(
      ['httpd', 'nginx', 'mariadb', 'mysqld', 'postfix', 'dovecot', 'named', 'vsftpd', 'sshd', 'php-fpm'].map(async svc => {
        const active = await rf('systemctl', ['is-active', svc]);
        return { name: svc, active: active === 'active' };
      })
    );

    res.json({
      hostname, os, kernel, uptime,
      cpu: { model: cpuModel.trim(), cores: parseInt(cpuCores) || 1 },
      memory: { total_mb: parseInt(totalMem) || 0, available_mb: parseInt(freeMem) || 0 },
      disk, load_avg: loadAvg,
      software: { apache: apacheFirst || null, nginx: nginxFirst || null, mysql: mysqlFirst || null, php: phpFirst || null },
      services,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
