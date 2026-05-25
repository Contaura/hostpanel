import { Router, Request, Response } from 'express';
import { runFile } from '../utils/process-runner';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const router = Router();
const MODSEC_CONF = process.env.MODSEC_CONF || '/etc/httpd/conf.d/mod_security.conf';
const MODSEC_RULES_DIR = process.env.MODSEC_RULES_DIR || '/etc/httpd/modsecurity.d';

/* ── ModSecurity status & toggle ─────────────────────────── */

router.get('/modsec', async (_req: Request, res: Response) => {
  try {
    const { stdout: modsecRaw } = await runFile('httpd', ['-M']).catch(() => ({ stdout: '', stderr: '' }));
    const stdout = modsecRaw.split('\n').filter(l => l.includes('security2')).join('\n');
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
    await runFile('apachectl', ['graceful']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/modsec/rules', async (_req: Request, res: Response) => {
  try {
    let files: { file: string; name: string|undefined }[] = [];
    try {
      const { readdirSync } = require('fs');
      files = readdirSync(MODSEC_RULES_DIR).filter((f: string) => f.endsWith('.conf')).map((f: string) => ({ file: `${MODSEC_RULES_DIR}/${f}`, name: f }));
    } catch {}
    res.json(files);
  } catch { res.json([]); }
});

/* ── Fail2Ban ────────────────────────────────────────────── */

router.get('/fail2ban', async (_req: Request, res: Response) => {
  try {
    const { stdout: status } = await runFile('fail2ban-client', ['status']);
    const jailMatch = status.match(/Jail list:\s+(.+)/);
    const jailNames = jailMatch ? jailMatch[1].split(',').map(j => j.trim()).filter(Boolean) : [];

    const jails = await Promise.all(jailNames.map(async name => {
      try {
        const { stdout: info } = await runFile('fail2ban-client', ['status', name]);
        const banned  = info.match(/Banned IP list:\s+(.+)/)?.[1]?.trim().split(/\s+/).filter(Boolean) || [];
        const total   = info.match(/Total banned:\s+(\d+)/)?.[1] || '0';
        const current = info.match(/Currently banned:\s+(\d+)/)?.[1] || '0';
        return { name, total: parseInt(total), current: parseInt(current), banned };
      } catch { return { name, total: 0, current: 0, banned: [] }; }
    }));

    res.json({ installed: true, jails });
  } catch { res.json({ installed: false, jails: [] }); }
});

const JAIL_RE = /^[a-zA-Z0-9_-]+$/;

// fail2ban-client returns 127 (not found) when fail2ban isn't installed,
// which used to surface as a bare 500 with "command not found" in the
// error message. Detect the missing binary and return a clear 503 so the
// UI can render "fail2ban isn't installed on this server" instead of a
// scary internal error.
const FAIL2BAN_BIN = '/usr/bin/fail2ban-client';
function fail2banNotInstalled(res: Response): boolean {
  if (!existsSync(FAIL2BAN_BIN) && !existsSync('/usr/sbin/fail2ban-client')) {
    res.status(503).json({ error: 'fail2ban is not installed on this server. Install fail2ban to use this feature.' });
    return true;
  }
  return false;
}

router.post('/fail2ban/unban', async (req: Request, res: Response) => {
  const { jail, ip } = req.body;
  if (!jail || !ip) return res.status(400).json({ error: 'jail and ip required' });
  if (!JAIL_RE.test(jail)) return res.status(400).json({ error: 'Invalid jail name' });
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return res.status(400).json({ error: 'Invalid IP' });
  if (fail2banNotInstalled(res)) return;
  try {
    await runFile('fail2ban-client', ['set', jail, 'unbanip', ip]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/fail2ban/ban', async (req: Request, res: Response) => {
  const { jail, ip } = req.body;
  if (!jail || !ip) return res.status(400).json({ error: 'jail and ip required' });
  if (!JAIL_RE.test(jail)) return res.status(400).json({ error: 'Invalid jail name' });
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return res.status(400).json({ error: 'Invalid IP' });
  if (fail2banNotInstalled(res)) return;
  try {
    await runFile('fail2ban-client', ['set', jail, 'banip', ip]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/fail2ban/:jail/toggle', async (req: Request, res: Response) => {
  if (!JAIL_RE.test(req.params.jail)) return res.status(400).json({ error: 'Invalid jail name' });
  if (fail2banNotInstalled(res)) return;
  const { action } = req.body; // 'start' | 'stop'
  try {
    await runFile('fail2ban-client', [action === 'stop' ? 'stop' : 'start', req.params.jail]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
