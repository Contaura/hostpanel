import { Router, Request, Response } from 'express';
import { runFile } from '../utils/process-runner';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { registerDkimKey } from '../utils/opendkim';

const router = Router();
const NAMED_DIR = process.env.NAMED_DIR || '/var/named';
const DKIM_DIR  = process.env.DKIM_DIR  || '/etc/opendkim/keys';

const DOMAIN_RE   = /^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;
const SELECTOR_RE = /^[a-zA-Z0-9_-]+$/;

/* ── DKIM key generation & status ───────────────────────── */

router.get('/:domain', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const selector = 'default';
  const pubKeyPath = path.join(DKIM_DIR, domain, `${selector}.txt`);

  // opendkim-genkey writes a BIND-style TXT record split across multiple
  // quoted segments. Reassemble them into the single concatenated string
  // that actually goes into DNS — the page renders this verbatim, so
  // it has to be the publishable TXT value, not the raw file.
  let dkim: { dns_record: string; host: string } | null = null;
  if (existsSync(pubKeyPath)) {
    const raw = readFileSync(pubKeyPath, 'utf8');
    const parts = raw.match(/"([^"]*)"/g) || [];
    const joined = parts.map(p => p.slice(1, -1)).join('').trim();
    if (joined) {
      dkim = { dns_record: joined, host: `${selector}._domainkey.${domain}` };
    }
  }

  // Try to detect SPF/DMARC from zone file
  const zoneFile = path.join(NAMED_DIR, `${domain}.zone`);
  let spf = '', dmarc = '';
  if (existsSync(zoneFile)) {
    const content = readFileSync(zoneFile, 'utf8');
    const spfMatch   = content.match(/"(v=spf1[^"]+)"/);
    const dmarcMatch = content.match(/"(v=DMARC1[^"]+)"/);
    if (spfMatch)   spf   = spfMatch[1];
    if (dmarcMatch) dmarc = dmarcMatch[1];
  }

  res.json({ domain, selector, dkim, spf, dmarc });
});

router.post('/:domain/generate-dkim', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const selector = req.body.selector || 'default';
  if (!SELECTOR_RE.test(selector)) return res.status(400).json({ error: 'Invalid selector' });
  const keyDir = path.join(DKIM_DIR, domain);
  try {
    mkdirSync(keyDir, { recursive: true });
    await runFile('opendkim-genkey', ['-b', '2048', '-d', domain, '-s', selector, '-D', keyDir]);
    // registerDkimKey chowns the private key, adds entries to KeyTable +
    // SigningTable, and reloads opendkim so signing starts immediately.
    await registerDkimKey(domain, selector);
    const pubKey = readFileSync(path.join(keyDir, `${selector}.txt`), 'utf8');
    const match = pubKey.match(/p=([A-Za-z0-9+/=]+)/);
    const dns_record = match ? `v=DKIM1; k=rsa; p=${match[1]}` : pubKey;
    // Nest under `dkim` and use snake_case `dns_record` so the page's
    // optimistic `setData(d => ({ ...d, dkim: result }))` lands on the
    // same shape the GET endpoint returns.
    res.json({ success: true, selector, dkim: { dns_record, host: `${selector}._domainkey.${domain}` } });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/:domain/spf', async (req: Request, res: Response) => {
  const { domain } = req.params;
  const { policy, includes, mechanisms } = req.body;
  // Build SPF record
  const parts = ['v=spf1'];
  if (Array.isArray(includes)) includes.forEach((h: string) => parts.push(`include:${h}`));
  if (Array.isArray(mechanisms)) mechanisms.forEach((m: string) => parts.push(m));
  parts.push(policy || '~all');
  const spfRecord = parts.join(' ');
  res.json({ success: true, spfRecord, dnsRecord: { host: `@`, type: 'TXT', value: spfRecord } });
});

router.post('/:domain/dmarc', async (req: Request, res: Response) => {
  const { domain } = req.params;
  const { policy, pct, rua, ruf, sp } = req.body;
  const parts = [`v=DMARC1`, `p=${policy || 'none'}`];
  if (pct && pct < 100) parts.push(`pct=${pct}`);
  // Accept either "mailto:admin@…" or just "admin@…" — DMARC requires the
  // mailto: scheme but a caller that already includes it would otherwise
  // produce "rua=mailto:mailto:admin@…".
  const ensureMailto = (v: string) => v.startsWith('mailto:') ? v : `mailto:${v}`;
  if (rua) parts.push(`rua=${ensureMailto(rua)}`);
  if (ruf) parts.push(`ruf=${ensureMailto(ruf)}`);
  if (sp)  parts.push(`sp=${sp}`);
  const dmarcRecord = parts.join('; ');
  res.json({ success: true, dmarcRecord, dnsRecord: { host: `_dmarc.${domain}`, type: 'TXT', value: dmarcRecord } });
});

/* ── Verify DNS propagation ──────────────────────────────── */

router.get('/:domain/verify', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const results: Record<string, any> = {};
  try {
    const { stdout: spfRaw } = await runFile('dig', ['+short', 'TXT', domain]).catch(() => ({ stdout: '', stderr: '' }));
    const spf = spfRaw.split('\n').filter(l => l.includes('spf')).join('\n');
    const { stdout: dmarc } = await runFile('dig', ['+short', 'TXT', `_dmarc.${domain}`]).catch(() => ({ stdout: '', stderr: '' }));
    const { stdout: dkim } = await runFile('dig', ['+short', 'TXT', `default._domainkey.${domain}`]).catch(() => ({ stdout: '', stderr: '' }));
    results.spf   = { value: spf.trim(), found: spf.includes('v=spf1') };
    results.dmarc = { value: dmarc.trim(), found: dmarc.includes('v=DMARC1') };
    results.dkim  = { value: dkim.trim(), found: dkim.includes('v=DKIM1') };
    res.json(results);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
