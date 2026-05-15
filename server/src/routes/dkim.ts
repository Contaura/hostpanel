import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const router = Router();
const execAsync = promisify(exec);
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

  let dkimPublicKey = '';
  if (existsSync(pubKeyPath)) {
    dkimPublicKey = readFileSync(pubKeyPath, 'utf8').replace(/\n/g, '').replace(/\t/g, '');
  }

  // Try to detect SPF/DMARC from zone file
  const zoneFile = path.join(NAMED_DIR, `${domain}.zone`);
  let spfRecord = '', dmarcRecord = '';
  if (existsSync(zoneFile)) {
    const content = readFileSync(zoneFile, 'utf8');
    const spfMatch = content.match(/"(v=spf1[^"]+)"/);
    const dmarcMatch = content.match(/"(v=DMARC1[^"]+)"/);
    if (spfMatch)   spfRecord   = spfMatch[1];
    if (dmarcMatch) dmarcRecord = dmarcMatch[1];
  }

  res.json({ domain, selector, dkimPublicKey: dkimPublicKey || null, spfRecord, dmarcRecord });
});

router.post('/:domain/generate-dkim', async (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const selector = req.body.selector || 'default';
  if (!SELECTOR_RE.test(selector)) return res.status(400).json({ error: 'Invalid selector' });
  const keyDir = path.join(DKIM_DIR, domain);
  try {
    await execAsync(`mkdir -p "${keyDir}"`);
    await execAsync(`opendkim-genkey -b 2048 -d "${domain}" -s "${selector}" -D "${keyDir}"`);
    await execAsync(`chown opendkim:opendkim "${keyDir}/${selector}.private"`);
    const pubKey = readFileSync(path.join(keyDir, `${selector}.txt`), 'utf8');
    // Extract the p= value for DNS TXT record
    const match = pubKey.match(/p=([A-Za-z0-9+/=]+)/);
    const dnsRecord = match ? `v=DKIM1; k=rsa; p=${match[1]}` : pubKey;
    await execAsync('systemctl restart opendkim').catch(() => {});
    res.json({ success: true, selector, dnsRecord, host: `${selector}._domainkey.${domain}` });
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
    const { stdout: spf } = await execAsync(`dig +short TXT "${domain}" 2>/dev/null | grep spf`).catch(() => ({ stdout: '' }));
    const { stdout: dmarc } = await execAsync(`dig +short TXT "_dmarc.${domain}" 2>/dev/null`).catch(() => ({ stdout: '' }));
    const { stdout: dkim } = await execAsync(`dig +short TXT "default._domainkey.${domain}" 2>/dev/null`).catch(() => ({ stdout: '' }));
    results.spf   = { value: spf.trim(), found: spf.includes('v=spf1') };
    results.dmarc = { value: dmarc.trim(), found: dmarc.includes('v=DMARC1') };
    results.dkim  = { value: dkim.trim(), found: dkim.includes('v=DKIM1') };
    res.json(results);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
