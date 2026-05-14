import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

const IP_RE   = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const IPV6_RE = /^[0-9a-fA-F:]+(:\/\d{1,3})?$/;
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

/* ── IPv6 blocking ───────────────────────────────────────── */

router.get('/ipv6-blocks', async (_req: AuthRequest, res: Response) => {
  try {
    const { stdout } = await execAsync('firewall-cmd --list-rich-rules 2>/dev/null || echo ""');
    const blocks = stdout.split('\n')
      .filter(l => l.includes('family="ipv6"') && l.includes('reject'))
      .map(l => { const m = l.match(/source address="([^"]+)"/); return m?.[1] || null; })
      .filter(Boolean) as string[];
    res.json(blocks);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/ipv6-blocks', async (req: AuthRequest, res: Response) => {
  const { ip } = req.body;
  if (!ip || !IPV6_RE.test(ip)) return res.status(400).json({ error: 'Invalid IPv6 address' });
  try {
    await execAsync(`firewall-cmd --add-rich-rule='rule family="ipv6" source address="${ip}" reject' --permanent`);
    await execAsync('firewall-cmd --reload');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/ipv6-blocks/:ip', async (req: AuthRequest, res: Response) => {
  const ip = decodeURIComponent(req.params.ip);
  if (!IPV6_RE.test(ip)) return res.status(400).json({ error: 'Invalid IPv6 address' });
  try {
    await execAsync(`firewall-cmd --remove-rich-rule='rule family="ipv6" source address="${ip}" reject' --permanent`);
    await execAsync('firewall-cmd --reload');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Geo / country-level blocking ─────────────────────────── */

const COUNTRY_SET = 'hp-geo-block';

router.get('/geo-blocks', async (_req: AuthRequest, res: Response) => {
  try {
    const { stdout } = await execAsync(`ipset list ${COUNTRY_SET} 2>/dev/null || echo ""`);
    const comments: string[] = [];
    for (const line of stdout.split('\n')) {
      const m = line.match(/comment\s+"([A-Z]{2})"/);
      if (m) comments.push(m[1]);
    }
    // Also try to read from a simple text file if ipset isn't available
    const { stdout: richOut } = await execAsync('firewall-cmd --list-rich-rules 2>/dev/null || echo ""');
    const geoRules = richOut.split('\n')
      .filter(l => l.includes('hp-geo-'))
      .map(l => { const m = l.match(/hp-geo-([A-Z]{2})/); return m?.[1] || null; })
      .filter(Boolean) as string[];
    const all = [...new Set([...comments, ...geoRules])];
    res.json(all);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/geo-blocks', async (req: AuthRequest, res: Response) => {
  const { country_code } = req.body;
  if (!country_code || !/^[A-Z]{2}$/.test(country_code)) {
    return res.status(400).json({ error: 'country_code must be 2-letter ISO code (e.g. CN, RU)' });
  }
  try {
    // Use ipset if available, fallback to a firewalld ipset zone
    await execAsync(`ipset create ${COUNTRY_SET} hash:net 2>/dev/null || true`);
    // Download country IP ranges from ipdeny.com
    await execAsync(
      `curl -sL "https://www.ipdeny.com/ipblocks/data/countries/${country_code.toLowerCase()}.zone" | while read cidr; do ipset add ${COUNTRY_SET} "$cidr" 2>/dev/null || true; done`,
      { timeout: 60000 }
    );
    await execAsync(
      `firewall-cmd --add-rich-rule='rule source ipset="${COUNTRY_SET}" comment="hp-geo-${country_code}" reject' --permanent 2>/dev/null || true`
    );
    await execAsync('firewall-cmd --reload 2>/dev/null || true');
    res.json({ success: true, country_code });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/geo-blocks/:code', async (req: AuthRequest, res: Response) => {
  const code = req.params.code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return res.status(400).json({ error: 'Invalid country code' });
  try {
    await execAsync(
      `firewall-cmd --remove-rich-rule='rule source ipset="${COUNTRY_SET}" comment="hp-geo-${code}" reject' --permanent 2>/dev/null || true`
    );
    await execAsync('firewall-cmd --reload 2>/dev/null || true');
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
