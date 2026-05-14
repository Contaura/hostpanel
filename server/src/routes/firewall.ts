import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const PORT_RE = /^\d{1,5}$/;

router.get('/status', async (_req: AuthRequest, res: Response) => {
  try {
    const [svcOut, portOut, richOut, stateOut] = await Promise.all([
      execAsync('firewall-cmd --list-services 2>/dev/null || echo ""').then(r => r.stdout),
      execAsync('firewall-cmd --list-ports 2>/dev/null || echo ""').then(r => r.stdout),
      execAsync('firewall-cmd --list-rich-rules 2>/dev/null || echo ""').then(r => r.stdout),
      execAsync('systemctl is-active firewalld 2>/dev/null || echo "inactive"').then(r => r.stdout),
    ]);

    const blockedIPs = richOut.split('\n')
      .filter(l => l.includes('reject') && l.includes('source address'))
      .map(l => { const m = l.match(/source address="([^"]+)"/); return m ? m[1] : null; })
      .filter(Boolean) as string[];

    res.json({
      active: stateOut.trim() === 'active',
      services: svcOut.trim().split(/\s+/).filter(Boolean),
      ports: portOut.trim().split(/\s+/).filter(Boolean),
      blockedIPs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ports', async (req: AuthRequest, res: Response) => {
  const { port, protocol = 'tcp' } = req.body;
  if (!PORT_RE.test(String(port)) || +port < 1 || +port > 65535) {
    return res.status(400).json({ error: 'Invalid port number' });
  }
  if (!['tcp', 'udp'].includes(protocol)) return res.status(400).json({ error: 'Invalid protocol' });
  try {
    await execAsync(`firewall-cmd --add-port=${port}/${protocol} --permanent`);
    await execAsync('firewall-cmd --reload');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/ports/:port/:protocol', async (req: AuthRequest, res: Response) => {
  const { port, protocol } = req.params;
  if (!PORT_RE.test(port)) return res.status(400).json({ error: 'Invalid port' });
  if (!['tcp', 'udp'].includes(protocol)) return res.status(400).json({ error: 'Invalid protocol' });
  try {
    await execAsync(`firewall-cmd --remove-port=${port}/${protocol} --permanent`);
    await execAsync('firewall-cmd --reload');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/block-ip', async (req: AuthRequest, res: Response) => {
  const { ip } = req.body;
  if (!ip || !IP_RE.test(ip)) return res.status(400).json({ error: 'Invalid IP address' });
  try {
    await execAsync(`firewall-cmd --add-rich-rule='rule family="ipv4" source address="${ip}" reject' --permanent`);
    await execAsync('firewall-cmd --reload');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/block-ip/:ip', async (req: AuthRequest, res: Response) => {
  const ip = decodeURIComponent(req.params.ip);
  if (!IP_RE.test(ip)) return res.status(400).json({ error: 'Invalid IP address' });
  try {
    await execAsync(`firewall-cmd --remove-rich-rule='rule family="ipv4" source address="${ip}" reject' --permanent`);
    await execAsync('firewall-cmd --reload');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/service', async (req: AuthRequest, res: Response) => {
  const { service, action } = req.body;
  if (!['start', 'stop', 'restart'].includes(action)) return res.status(400).json({ error: 'Invalid action' });
  const allowed = ['httpd', 'mariadb', 'postfix', 'dovecot', 'named', 'vsftpd', 'sshd', 'firewalld'];
  if (!allowed.includes(service)) return res.status(400).json({ error: 'Unknown service' });
  try {
    await execAsync(`systemctl ${action} ${service}`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
