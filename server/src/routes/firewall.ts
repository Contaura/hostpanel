import { Router, Response } from 'express';
import { runFile } from '../utils/process-runner';
import { AuthRequest } from '../middleware/auth';

const router = Router();

const IP_RE   = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const IPV6_RE = /^[0-9a-fA-F:]+(:\/\d{1,3})?$/;
const PORT_RE = /^\d{1,5}$/;

router.get('/status', async (_req: AuthRequest, res: Response) => {
  try {
    const [svcOut, portOut, richOut, stateOut] = await Promise.all([
      runFile('firewall-cmd', ['--list-services']).then(r => r.stdout).catch(() => ''),
      runFile('firewall-cmd', ['--list-ports']).then(r => r.stdout).catch(() => ''),
      runFile('firewall-cmd', ['--list-rich-rules']).then(r => r.stdout).catch(() => ''),
      runFile('systemctl', ['is-active', 'firewalld']).then(r => r.stdout).catch(() => 'inactive'),
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
    await runFile('firewall-cmd', [`--add-port=${port}/${protocol}`, '--permanent']);
    await runFile('firewall-cmd', ['--reload']);
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
    await runFile('firewall-cmd', [`--remove-port=${port}/${protocol}`, '--permanent']);
    await runFile('firewall-cmd', ['--reload']);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/block-ip', async (req: AuthRequest, res: Response) => {
  const { ip } = req.body;
  if (!ip || !IP_RE.test(ip)) return res.status(400).json({ error: 'Invalid IP address' });
  try {
    await runFile('firewall-cmd', ['--add-rich-rule', `rule family="ipv4" source address="${ip}" reject`, '--permanent']);
    await runFile('firewall-cmd', ['--reload']);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/block-ip/:ip', async (req: AuthRequest, res: Response) => {
  const ip = decodeURIComponent(req.params.ip);
  if (!IP_RE.test(ip)) return res.status(400).json({ error: 'Invalid IP address' });
  try {
    await runFile('firewall-cmd', ['--remove-rich-rule', `rule family="ipv4" source address="${ip}" reject`, '--permanent']);
    await runFile('firewall-cmd', ['--reload']);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── IPv6 blocking ───────────────────────────────────────── */

router.get('/ipv6-blocks', async (_req: AuthRequest, res: Response) => {
  try {
    const { stdout } = await runFile('firewall-cmd', ['--list-rich-rules']).catch(() => ({ stdout: '', stderr: '' }));
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
    await runFile('firewall-cmd', ['--add-rich-rule', `rule family="ipv6" source address="${ip}" reject`, '--permanent']);
    await runFile('firewall-cmd', ['--reload']);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/ipv6-blocks/:ip', async (req: AuthRequest, res: Response) => {
  const ip = decodeURIComponent(req.params.ip);
  if (!IPV6_RE.test(ip)) return res.status(400).json({ error: 'Invalid IPv6 address' });
  try {
    await runFile('firewall-cmd', ['--remove-rich-rule', `rule family="ipv6" source address="${ip}" reject`, '--permanent']);
    await runFile('firewall-cmd', ['--reload']);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Geo / country-level blocking ─────────────────────────── */

const COUNTRY_SET = 'hp-geo-block';

router.get('/geo-blocks', async (_req: AuthRequest, res: Response) => {
  try {
    const { stdout } = await runFile('ipset', ['list', COUNTRY_SET]).catch(() => ({ stdout: '', stderr: '' }));
    const comments: string[] = [];
    for (const line of stdout.split('\n')) {
      const m = line.match(/comment\s+"([A-Z]{2})"/);
      if (m) comments.push(m[1]);
    }
    // Also try to read from a simple text file if ipset isn't available
    const { stdout: richOut } = await runFile('firewall-cmd', ['--list-rich-rules']).catch(() => ({ stdout: '', stderr: '' }));
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
    await runFile('ipset', ['create', COUNTRY_SET, 'hash:net']).catch(() => ({ stdout: '', stderr: '' }));
    // Download country IP ranges from ipdeny.com without a shell pipeline.
    const response = await fetch(`https://www.ipdeny.com/ipblocks/data/countries/${country_code.toLowerCase()}.zone`);
    if (!response.ok) throw new Error(`Failed to fetch country block list: ${response.status}`);
    const cidrs = (await response.text()).split('\n').map(l => l.trim()).filter(Boolean);
    for (const cidr of cidrs) {
      await runFile('ipset', ['add', COUNTRY_SET, cidr]).catch(() => ({ stdout: '', stderr: '' }));
    }
    await runFile('firewall-cmd', ['--add-rich-rule', `rule source ipset="${COUNTRY_SET}" comment="hp-geo-${country_code}" reject`, '--permanent']).catch(() => ({ stdout: '', stderr: '' }));
    await runFile('firewall-cmd', ['--reload']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true, country_code });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/geo-blocks/:code', async (req: AuthRequest, res: Response) => {
  const code = req.params.code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return res.status(400).json({ error: 'Invalid country code' });
  try {
    await runFile('firewall-cmd', ['--remove-rich-rule', `rule source ipset="${COUNTRY_SET}" comment="hp-geo-${code}" reject`, '--permanent']).catch(() => ({ stdout: '', stderr: '' }));
    await runFile('firewall-cmd', ['--reload']).catch(() => ({ stdout: '', stderr: '' }));
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
    await runFile('systemctl', [action, service]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
