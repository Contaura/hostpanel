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
)`);

function groups() {
  return FEATURE_CATALOG.reduce<Record<string, string[]>>((acc, f) => {
    (acc[f.group] ||= []).push(f.key);
    return acc;
  }, {});
}

function parseRow(row: any) { return { ...row, features: JSON.parse(row.features || '[]') }; }

router.get('/catalog', (_req: Request, res: Response) => res.json({ features: FEATURE_CATALOG, groups: groups() }));

router.get('/', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT * FROM feature_lists ORDER BY name').all().map(parseRow);
  res.json(rows);
});

router.post('/', (req: Request, res: Response) => {
  const { name, description = '', features = [] } = req.body || {};
  if (!name || !Array.isArray(features)) return res.status(400).json({ error: 'name and features[] required' });
  const valid = new Set(FEATURE_CATALOG.map(f => f.key));
  const clean = [...new Set(features.map(String))].filter(f => valid.has(f));
  db.prepare(`INSERT INTO feature_lists (name, description, features, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET description=excluded.description, features=excluded.features, updated_at=datetime('now')`).run(name, description, JSON.stringify(clean));
  const row = db.prepare('SELECT * FROM feature_lists WHERE name = ?').get(name);
  res.json(parseRow(row));
});

router.get('/effective/:planId', (req: Request, res: Response) => {
  const plan: any = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.planId);
  res.json({ planId: Number(req.params.planId), plan: plan || null, features: FEATURE_CATALOG.map(f => f.key), source: 'default-all' });
});

export default router;
