import { Router, Request, Response } from 'express';
import db from '../db';
import { runFile } from '../utils/process-runner';

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
router.get('/nodes', (_req: Request, res: Response) => res.json(db.prepare('SELECT id,name,host,role,api_url,tsig_name,enabled,last_check,created_at FROM dns_cluster_nodes ORDER BY name').all()));
router.post('/nodes', (req: Request, res: Response) => { const { name, host, role='secondary', api_url='', tsig_name='', tsig_secret='', enabled=1 } = req.body || {}; if (!name || !host) return res.status(400).json({ error: 'name and host required' }); db.prepare(`INSERT INTO dns_cluster_nodes (name,host,role,api_url,tsig_name,tsig_secret,enabled) VALUES (?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET host=excluded.host, role=excluded.role, api_url=excluded.api_url, tsig_name=excluded.tsig_name, tsig_secret=excluded.tsig_secret, enabled=excluded.enabled`).run(name,host,role,api_url,tsig_name,tsig_secret,enabled?1:0); res.json(db.prepare('SELECT id,name,host,role,api_url,tsig_name,enabled,last_check,created_at FROM dns_cluster_nodes WHERE name=?').get(name)); });
router.delete('/nodes/:id', (req: Request, res: Response) => { db.prepare('DELETE FROM dns_cluster_nodes WHERE id=?').run(req.params.id); res.json({ success: true }); });
router.post('/health-check', async (_req: Request, res: Response) => { const nodes = db.prepare('SELECT * FROM dns_cluster_nodes WHERE enabled=1').all() as any[]; const checks = []; for (const n of nodes) { const out = await runFile('dig', ['+short', '@'+n.host, 'localhost']).catch((e: any) => ({ stdout: '', stderr: e.message })); db.prepare('UPDATE dns_cluster_nodes SET last_check=datetime(\'now\') WHERE id=?').run(n.id); checks.push({ id:n.id, name:n.name, host:n.host, ok: !out.stderr, output: out.stdout || out.stderr }); } res.json({ checks }); });
router.post('/sync-preview', (req: Request, res: Response) => { const { domain } = req.body || {}; if (!domainOk(domain)) return res.status(400).json({ error: 'Valid domain required' }); const nodes = db.prepare('SELECT id,name,host,role FROM dns_cluster_nodes WHERE enabled=1').all(); res.json({ domain, dryRun: true, actions: (nodes as any[]).map(n => ({ node: n.name, host: n.host, action: 'would-transfer-zone', command: `rndc retransfer ${domain}` })) }); });
router.post('/nameserver-plan', (req: Request, res: Response) => { const { domain, ns1='ns1', ns2='ns2', ip1='', ip2='' } = req.body || {}; if (!domainOk(domain)) return res.status(400).json({ error: 'Valid domain required' }); res.json({ domain, records: [{ type:'NS', name:'@', value:`${ns1}.${domain}.` }, { type:'NS', name:'@', value:`${ns2}.${domain}.` }, { type:'A', name:ns1, value:ip1 }, { type:'A', name:ns2, value:ip2 }], registrar: ['Create/verify glue records for '+ns1+'.'+domain+' and '+ns2+'.'+domain, 'Set domain nameservers at registrar', 'Verify with dig +trace '+domain] }); });
export default router;
