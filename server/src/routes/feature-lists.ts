import { Router, Request, Response } from 'express';
import db from '../db';

const router = Router();

export const FEATURE_CATALOG = [
  { key: 'webdav', label: 'Web Disk / WebDAV', group: 'files' },
  { key: 'file-manager', label: 'File Manager', group: 'files' },
  { key: 'backup-wizard', label: 'Guided Backup Wizard', group: 'files' },
  { key: 'email-accounts', label: 'Email Accounts', group: 'email' },
  { key: 'mail-trace', label: 'Track Delivery / Mail Trace', group: 'email' },
  { key: 'mail-reporting', label: 'Deep Mail Delivery Reporting', group: 'email' },
  { key: 'address-importer', label: 'Address Importer', group: 'email' },
  { key: 'analytics', label: 'Visitor/Error/Bandwidth Analytics', group: 'metrics' },
  { key: 'raw-access', label: 'Raw Access Logs', group: 'metrics' },
  { key: 'awstats', label: 'Awstats/Webalizer-style Reports', group: 'metrics' },
  { key: 'phpmyadmin', label: 'phpMyAdmin Integration', group: 'databases' },
  { key: 'team-users', label: 'User Manager / Team Subaccounts', group: 'accounts' },
  { key: 'reseller-privileges', label: 'Granular Reseller Privileges', group: 'accounts' },
  { key: 'feature-lists', label: 'WHM Feature Lists', group: 'accounts' },
  { key: 'dns-clustering', label: 'DNS Clustering', group: 'dns' },
  { key: 'nameserver-automation', label: 'Nameserver Automation', group: 'dns' },
  { key: 'transfer-tool', label: 'Account Transfer / Import Tool', group: 'transfers' },
  { key: 'server-updates', label: 'Server Updates', group: 'system' },
  { key: 'plugins', label: 'Plugin Registry', group: 'system' },
];

db.exec(`CREATE TABLE IF NOT EXISTS feature_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  features TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plan_feature_lists (
  plan_id INTEGER PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
  feature_list_id INTEGER NOT NULL REFERENCES feature_lists(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS reseller_privileges (
  reseller_id INTEGER PRIMARY KEY REFERENCES resellers(id) ON DELETE CASCADE,
  features TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

function groups() {
  return FEATURE_CATALOG.reduce<Record<string, string[]>>((acc, f) => {
    (acc[f.group] ||= []).push(f.key);
    return acc;
  }, {});
}

function parseRow(row: any) { return { ...row, features: JSON.parse(row.features || '[]') }; }
function cleanFeatures(features: unknown): string[] {
  const valid = new Set(FEATURE_CATALOG.map(f => f.key));
  return Array.isArray(features) ? [...new Set(features.map(String))].filter(f => valid.has(f)) : [];
}

router.get('/catalog', (_req: Request, res: Response) => res.json({ features: FEATURE_CATALOG, groups: groups() }));

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM feature_lists ORDER BY name').all().map(parseRow);
  res.json(rows);
});

router.post('/', (req: Request, res: Response) => {
  const { name, description = '', features = [] } = req.body || {};
  if (!name || !Array.isArray(features)) return res.status(400).json({ error: 'name and features[] required' });
  const clean = cleanFeatures(features);
  db.prepare(`INSERT INTO feature_lists (name, description, features, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET description=excluded.description, features=excluded.features, updated_at=datetime('now')`).run(name, description, JSON.stringify(clean));
  const row = db.prepare('SELECT * FROM feature_lists WHERE name = ?').get(name);
  res.json(parseRow(row));
});

router.post('/assign-plan', (req: Request, res: Response) => {
  const { planId, featureListId } = req.body || {};
  const plan = db.prepare('SELECT id, name FROM plans WHERE id = ?').get(planId) as any;
  const list = db.prepare('SELECT * FROM feature_lists WHERE id = ?').get(featureListId) as any;
  if (!plan || !list) return res.status(404).json({ error: 'Plan or feature list not found' });
  db.prepare(`INSERT INTO plan_feature_lists (plan_id, feature_list_id, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(plan_id) DO UPDATE SET feature_list_id=excluded.feature_list_id, updated_at=datetime('now')`).run(planId, featureListId);
  res.json({ plan, featureList: parseRow(list) });
});

router.get('/assignments/plans', (_req: Request, res: Response) => {
  const rows = db.prepare(`SELECT p.id AS plan_id, p.name AS plan_name, fl.id AS feature_list_id, fl.name AS feature_list_name, fl.features
    FROM plans p LEFT JOIN plan_feature_lists pfl ON pfl.plan_id=p.id LEFT JOIN feature_lists fl ON fl.id=pfl.feature_list_id ORDER BY p.name`).all() as any[];
  res.json(rows.map(r => ({ ...r, features: r.features ? JSON.parse(r.features) : FEATURE_CATALOG.map(f => f.key) })));
});

router.post('/reseller/:id', (req: Request, res: Response) => {
  const reseller = db.prepare('SELECT * FROM resellers WHERE id=?').get(req.params.id) as any;
  if (!reseller) return res.status(404).json({ error: 'Reseller not found' });
  const features = cleanFeatures(req.body?.features || []);
  db.prepare(`INSERT INTO reseller_privileges (reseller_id, features, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(reseller_id) DO UPDATE SET features=excluded.features, updated_at=datetime('now')`).run(req.params.id, JSON.stringify(features));
  res.json({ resellerId: Number(req.params.id), features });
});

router.get('/reseller/:id', (req: Request, res: Response) => {
  const row = db.prepare('SELECT features FROM reseller_privileges WHERE reseller_id=?').get(req.params.id) as any;
  res.json({ resellerId: Number(req.params.id), features: row ? JSON.parse(row.features || '[]') : FEATURE_CATALOG.map(f => f.key), source: row ? 'custom' : 'default-all' });
});

router.get('/effective/:planId', (req: Request, res: Response) => {
  const plan: any = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.planId);
  const row: any = db.prepare(`SELECT fl.* FROM plan_feature_lists pfl JOIN feature_lists fl ON fl.id=pfl.feature_list_id WHERE pfl.plan_id=?`).get(req.params.planId);
  res.json({ planId: Number(req.params.planId), plan: plan || null, features: row ? JSON.parse(row.features || '[]') : FEATURE_CATALOG.map(f => f.key), source: row ? 'feature-list' : 'default-all', featureList: row ? parseRow(row) : null });
});

export default router;
