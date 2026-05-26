import { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import db from '../db';
import { runFile } from '../utils/process-runner';
import { createBackgroundJob, JobContext } from '../background-jobs';

const router = Router();
db.exec(`CREATE TABLE IF NOT EXISTS dns_cluster_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  host TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'secondary',
  api_url TEXT NOT NULL DEFAULT '',
  tsig_name TEXT NOT NULL DEFAULT '',
  tsig_secret TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_check TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const domainOk = (s: string) => /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}[a-zA-Z0-9]$/.test(s || '');
const nameOk = (s: string) => /^[a-zA-Z0-9_.-]{1,128}$/.test(s || '');
const hostOk = (s: string) => /^[a-zA-Z0-9_.:-]{1,253}$/.test(s || '');
const roleOk = (s: string) => ['primary', 'secondary', 'hidden-primary'].includes(s || '');
const tsigSecretOk = (s: string) => !s || /^[A-Za-z0-9+/=._:-]{8,512}$/.test(s);

type DnsNode = {
  id: number;
  name: string;
  host: string;
  role: string;
  api_url: string;
  tsig_name: string;
  tsig_secret: string;
  enabled: number;
  last_check?: string | null;
  created_at?: string;
};

function publicNode(n: DnsNode) {
  const { tsig_secret: _secret, ...rest } = n;
  return { ...rest, authenticated: !!(n.tsig_name && n.tsig_secret) };
}

function syncAction(n: DnsNode, domain: string, dryRun: boolean) {
  return {
    node: n.name,
    host: n.host,
    role: n.role,
    action: dryRun ? 'would-transfer-zone' : 'transfer-zone',
    authenticated: !!(n.tsig_name && n.tsig_secret),
    command: n.tsig_name && n.tsig_secret ? `rndc -s ${n.host} -k <managed-key-file> retransfer ${domain}` : `rndc -s ${n.host} retransfer ${domain}`,
  };
}

async function withRndcKeyFile<T>(node: DnsNode, fn: (keyFile?: string) => Promise<T>): Promise<T> {
  if (!node.tsig_name && !node.tsig_secret) return fn(undefined);
  if (!nameOk(node.tsig_name) || !tsigSecretOk(node.tsig_secret)) throw new Error(`Invalid TSIG credentials for node ${node.name}`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-rndc-'));
  const keyFile = path.join(dir, 'rndc.key');
  try {
    await fs.writeFile(keyFile, `key "${node.tsig_name}" {\n  algorithm hmac-sha256;\n  secret "${node.tsig_secret}";\n};\n`, { mode: 0o600 });
    return await fn(keyFile);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function triggerRetransfer(node: DnsNode, domain: string) {
  if (!hostOk(node.host)) throw new Error(`Invalid host for node ${node.name}`);
  return withRndcKeyFile(node, async (keyFile) => {
    const args = ['-s', node.host];
    if (keyFile) args.push('-k', keyFile);
    args.push('retransfer', domain);
    const out = await runFile('rndc', args, { timeout: 120000 });
    db.prepare('UPDATE dns_cluster_nodes SET last_check=datetime(\'now\') WHERE id=?').run(node.id);
    return { id: node.id, node: node.name, host: node.host, ok: true, output: out.stdout || out.stderr || 'rndc retransfer requested' };
  });
}

router.get('/nodes', (_req: Request, res: Response) => {
  const nodes = db.prepare('SELECT id,name,host,role,api_url,tsig_name,tsig_secret,enabled,last_check,created_at FROM dns_cluster_nodes ORDER BY name').all() as DnsNode[];
  res.json(nodes.map(publicNode));
});

router.post('/nodes', (req: Request, res: Response) => {
  const { name, host, role='secondary', api_url='', tsig_name='', tsig_secret='', enabled=1 } = req.body || {};
  if (!nameOk(name) || !hostOk(host)) return res.status(400).json({ error: 'Valid node name and host required' });
  if (!roleOk(role)) return res.status(400).json({ error: 'Valid node role required' });
  if (tsig_name && !nameOk(tsig_name)) return res.status(400).json({ error: 'Valid TSIG key name required' });
  if (tsig_secret && !tsigSecretOk(tsig_secret)) return res.status(400).json({ error: 'Valid TSIG secret required' });
  db.prepare(`INSERT INTO dns_cluster_nodes (name,host,role,api_url,tsig_name,tsig_secret,enabled) VALUES (?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET host=excluded.host, role=excluded.role, api_url=excluded.api_url, tsig_name=excluded.tsig_name, tsig_secret=excluded.tsig_secret, enabled=excluded.enabled`).run(name,host,role,api_url,tsig_name,tsig_secret,enabled?1:0);
  const node = db.prepare('SELECT id,name,host,role,api_url,tsig_name,tsig_secret,enabled,last_check,created_at FROM dns_cluster_nodes WHERE name=?').get(name) as DnsNode;
  res.json(publicNode(node));
});

router.delete('/nodes/:id', (req: Request, res: Response) => { db.prepare('DELETE FROM dns_cluster_nodes WHERE id=?').run(req.params.id); res.json({ success: true }); });

router.post('/health-check', async (_req: Request, res: Response) => {
  const nodes = db.prepare('SELECT * FROM dns_cluster_nodes WHERE enabled=1').all() as DnsNode[];
  const checks = [];
  for (const n of nodes) {
    const out = await runFile('dig', ['+short', '@'+n.host, 'localhost']).catch((e: any) => ({ stdout: '', stderr: e.message }));
    db.prepare('UPDATE dns_cluster_nodes SET last_check=datetime(\'now\') WHERE id=?').run(n.id);
    checks.push({ id:n.id, name:n.name, host:n.host, ok: !out.stderr, output: out.stdout || out.stderr });
  }
  res.json({ checks });
});

router.post('/sync-preview', (req: Request, res: Response) => {
  const { domain } = req.body || {};
  if (!domainOk(domain)) return res.status(400).json({ error: 'Valid domain required' });
  const nodes = db.prepare('SELECT * FROM dns_cluster_nodes WHERE enabled=1').all() as DnsNode[];
  res.json({ domain, dryRun: true, actions: nodes.map(n => syncAction(n, domain, true)) });
});

async function runDnsSync(domain: string, nodeIds?: any[], ctx?: JobContext) {
  const allNodes = db.prepare('SELECT * FROM dns_cluster_nodes WHERE enabled=1').all() as DnsNode[];
  const allow = Array.isArray(nodeIds) && nodeIds.length ? new Set(nodeIds.map((id: any) => Number(id))) : null;
  const nodes = allow ? allNodes.filter(n => allow.has(n.id)) : allNodes;
  if (!nodes.length) { const e: any = new Error('No enabled DNS cluster nodes selected'); e.status = 400; throw e; }
  const results = [];
  let done = 0;
  for (const node of nodes) {
    ctx?.progress(Math.max(5, Math.round((done / nodes.length) * 90)), `Requesting DNS retransfer on ${node.name}`);
    try { results.push(await triggerRetransfer(node, domain)); }
    catch (e: any) { results.push({ id: node.id, node: node.name, host: node.host, ok: false, error: e.message }); }
    done += 1;
  }
  ctx?.progress(95, `DNS sync completed for ${domain}`);
  return { domain, dryRun: false, actions: nodes.map(n => syncAction(n, domain, false)), results };
}

router.post('/sync', async (req: Request, res: Response) => {
  const { domain, nodeIds } = req.body || {};
  if (!domainOk(domain)) return res.status(400).json({ error: 'Valid domain required' });
  if (req.body?.async) {
    const jobId = createBackgroundJob({ type: 'dns.sync', resource: domain, metadata: { domain, nodeIds } }, (ctx) => runDnsSync(domain, nodeIds, ctx));
    return res.status(202).json({ jobId, statusUrl: `/api/jobs/${jobId}` });
  }
  const result = await runDnsSync(domain, nodeIds);
  res.status(result.results.some(r => !r.ok) ? 207 : 200).json(result);
});

router.post('/nameserver-plan', (req: Request, res: Response) => {
  const { domain, ns1='ns1', ns2='ns2', ip1='', ip2='' } = req.body || {};
  if (!domainOk(domain)) return res.status(400).json({ error: 'Valid domain required' });
  res.json({ domain, records: [{ type:'NS', name:'@', value:`${ns1}.${domain}.` }, { type:'NS', name:'@', value:`${ns2}.${domain}.` }, { type:'A', name:ns1, value:ip1 }, { type:'A', name:ns2, value:ip2 }], registrar: ['Create/verify glue records for '+ns1+'.'+domain+' and '+ns2+'.'+domain, 'Set domain nameservers at registrar', 'Verify with dig +trace '+domain] });
});
export default router;
