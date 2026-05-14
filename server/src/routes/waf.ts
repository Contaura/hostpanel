import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const router = Router();
const execAsync = promisify(exec);
const MODSEC_CONF = process.env.MODSEC_CONF || '/etc/httpd/conf.d/mod_security.conf';
const MODSEC_RULES_DIR = process.env.MODSEC_RULES_DIR || '/etc/httpd/modsecurity.d';

/* ── ModSecurity status & toggle ─────────────────────────── */

router.get('/modsec', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('httpd -M 2>/dev/null | grep security2').catch(() => ({ stdout: '' }));
    const enabled = stdout.includes('security2_module');
    let mode = 'DetectionOnly';
    if (existsSync(MODSEC_CONF)) {
      const conf = readFileSync(MODSEC_CONF, 'utf8');
      if (conf.includes('SecRuleEngine On')) mode = 'On';
      else if (conf.includes('SecRuleEngine Off')) mode = 'Off';
    }
    res.json({ installed: enabled, mode });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/modsec', async (req: Request, res: Response) => {
  const { mode } = req.body;
  if (!['On', 'Off', 'DetectionOnly'].includes(mode)) return res.status(400).json({ error: 'mode must be On, Off, or DetectionOnly' });
  try {
    if (existsSync(MODSEC_CONF)) {
      let conf = readFileSync(MODSEC_CONF, 'utf8');
      conf = conf.replace(/SecRuleEngine\s+\S+/, `SecRuleEngine ${mode}`);
      if (!conf.includes('SecRuleEngine')) conf += `\nSecRuleEngine ${mode}\n`;
      writeFileSync(MODSEC_CONF, conf);
    } else {
      writeFileSync(MODSEC_CONF, `<IfModule security2_module>\n  SecRuleEngine ${mode}\n</IfModule>\n`);
    }
    await execAsync('apachectl graceful').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/modsec/rules', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync(`ls ${MODSEC_RULES_DIR}/*.conf 2>/dev/null || echo ""`);
    const files = stdout.trim().split('\n').filter(Boolean).map(f => ({ file: f, name: f.split('/').pop() }));
    res.json(files);
  } catch { res.json([]); }
});

/* ── Fail2Ban ────────────────────────────────────────────── */

router.get('/fail2ban', async (_req: Request, res: Response) => {
  try {
    const { stdout: status } = await execAsync('fail2ban-client status 2>/dev/null');
    const jailMatch = status.match(/Jail list:\s+(.+)/);
    const jailNames = jailMatch ? jailMatch[1].split(',').map(j => j.trim()).filter(Boolean) : [];

    const jails = await Promise.all(jailNames.map(async name => {
      try {
        const { stdout: info } = await execAsync(`fail2ban-client status ${name} 2>/dev/null`);
        const banned  = info.match(/Banned IP list:\s+(.+)/)?.[1]?.trim().split(/\s+/).filter(Boolean) || [];
        const total   = info.match(/Total banned:\s+(\d+)/)?.[1] || '0';
        const current = info.match(/Currently banned:\s+(\d+)/)?.[1] || '0';
        return { name, total: parseInt(total), current: parseInt(current), banned };
      } catch { return { name, total: 0, current: 0, banned: [] }; }
    }));

    res.json({ installed: true, jails });
  } catch { res.json({ installed: false, jails: [] }); }
});

router.post('/fail2ban/unban', async (req: Request, res: Response) => {
  const { jail, ip } = req.body;
  if (!jail || !ip) return res.status(400).json({ error: 'jail and ip required' });
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return res.status(400).json({ error: 'Invalid IP' });
  try {
    await execAsync(`fail2ban-client set ${jail} unbanip ${ip}`);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/fail2ban/ban', async (req: Request, res: Response) => {
  const { jail, ip } = req.body;
  if (!jail || !ip) return res.status(400).json({ error: 'jail and ip required' });
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return res.status(400).json({ error: 'Invalid IP' });
  try {
    await execAsync(`fail2ban-client set ${jail} banip ${ip}`);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/fail2ban/:jail/toggle', async (req: Request, res: Response) => {
  const { action } = req.body; // 'start' | 'stop'
  try {
    await execAsync(`fail2ban-client ${action === 'stop' ? 'stop' : 'start'} ${req.params.jail}`);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
