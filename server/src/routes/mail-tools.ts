import { Router, Request, Response } from 'express';
import { runFile } from '../utils/process-runner';
import { createConnection } from 'net';

const router = Router();

/* ── MX record lookup + SMTP probe ─────────────────────────── */

router.get('/mx-check/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!domain || /[^a-zA-Z0-9._-]/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  try {
    const [mxOut, aOut, spfOut, dmarcOut] = await Promise.all([
      runFile('dig', ['+short', 'MX', domain]).then(r => r.stdout.trim()),
      runFile('dig', ['+short', 'A', domain]).then(r => r.stdout.trim()),
      runFile('dig', ['+short', 'TXT', domain]).then(r => r.stdout.split('\n').filter(l => l.toLowerCase().includes('spf')).join('\n').trim()).catch(() => ''),
      runFile('dig', ['+short', 'TXT', `_dmarc.${domain}`]).then(r => r.stdout.trim()).catch(() => ''),
    ]);

    const mxRecords = mxOut.split('\n').filter(Boolean).map(l => {
      const parts = l.trim().split(/\s+/);
      return { priority: parseInt(parts[0]) || 0, host: parts[1]?.replace(/\.$/, '') || l };
    }).sort((a, b) => a.priority - b.priority);

    // Test SMTP connection to primary MX
    let smtpReachable = false;
    let smtpBanner = '';
    if (mxRecords.length > 0) {
      smtpReachable = await new Promise<boolean>(resolve => {
        const sock = createConnection({ host: mxRecords[0].host, port: 25, timeout: 5000 });
        sock.on('data', d => { smtpBanner = d.toString().split('\n')[0].trim(); sock.destroy(); resolve(true); });
        sock.on('error', () => resolve(false));
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
      });
    }

    res.json({
      domain,
      mx_records: mxRecords,
      a_record: aOut,
      spf: spfOut || null,
      dmarc: dmarcOut || null,
      smtp_reachable: smtpReachable,
      smtp_banner: smtpBanner,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── DNSBL / RBL blacklist check ────────────────────────────── */

const DNSBLS = [
  'zen.spamhaus.org',
  'bl.spamcop.net',
  'b.barracudacentral.org',
  'dnsbl.sorbs.net',
  'ix.dnsbl.manitu.net',
  'psbl.surriel.com',
];

router.get('/dnsbl/:ip', async (req: Request, res: Response) => {
  const { ip } = req.params;
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return res.status(400).json({ error: 'Invalid IPv4 address' });

  // Reverse the IP for DNSBL lookup
  const reversed = ip.split('.').reverse().join('.');

  const results = await Promise.all(DNSBLS.map(async list => {
    try {
      const { stdout } = await runFile('dig', ['+short', 'A', `${reversed}.${list}`], { timeout: 5000 });
      const listed = stdout.trim().length > 0 && !stdout.includes('NXDOMAIN');
      const reason = listed ? stdout.trim().split('\n')[0] : null;
      return { list, listed, reason };
    } catch {
      return { list, listed: false, reason: null };
    }
  }));

  const blacklisted = results.filter(r => r.listed).length;
  res.json({ ip, checked: DNSBLS.length, blacklisted, results });
});

/* ── SMTP auth log viewer ───────────────────────────────────── */

const MAIL_LOG_PATHS = ['/var/log/maillog', '/var/log/mail.log', '/var/log/mail/mail.log'];

router.get('/smtp-auth-log', async (req: Request, res: Response) => {
  const search = (req.query.search as string) || '';
  try {
    let logPath = '';
    for (const p of MAIL_LOG_PATHS) {
      try { await import('fs').then(f => f.promises.access(p)); logPath = p; break; } catch {}
    }
    if (!logPath) return res.json({ lines: [], note: 'No mail log found' });

    const cleanedSearch = String(search).toLowerCase();
    const raw = (await import('fs')).readFileSync(logPath, 'utf8');
    const lines = raw.split('\n')
      .filter(l => /sasl|authentication|AUTH/i.test(l))
      .filter(l => !cleanedSearch || l.toLowerCase().includes(cleanedSearch))
      .slice(-300)
      .map((l, i) => ({ id: i, line: l }));
    res.json({ lines, log_file: logPath });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
