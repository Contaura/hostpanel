import { Router, Request, Response } from 'express';
import { runFile } from '../utils/process-runner';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import db from '../db';

const router = Router();
const TRANSPORT_FILE = process.env.TRANSPORT_FILE || '/etc/postfix/transport';

/* ── Email routing / transport rules ────────────────────── */

function readTransport(): { domain: string; route: string }[] {
  if (!existsSync(TRANSPORT_FILE)) return [];
  return readFileSync(TRANSPORT_FILE, 'utf8')
    .split('\n').filter(l => l.trim() && !l.startsWith('#'))
    .map(l => { const [domain, ...rest] = l.trim().split(/\s+/); return { domain, route: rest.join(' ') }; })
    .filter(r => r.domain && r.route);
}

function writeTransport(rules: { domain: string; route: string }[]) {
  writeFileSync(TRANSPORT_FILE, '# Managed by HostPanel\n' + rules.map(r => `${r.domain}\t${r.route}`).join('\n') + '\n');
}

router.get('/', (_req: Request, res: Response) => {
  try { res.json(readTransport()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req: Request, res: Response) => {
  const { domain, route } = req.body;
  if (!domain || !route) return res.status(400).json({ error: 'domain and route required' });
  try {
    const rules = readTransport();
    if (rules.find(r => r.domain === domain)) return res.status(409).json({ error: 'Rule already exists' });
    rules.push({ domain, route });
    writeTransport(rules);
    await runFile('postmap', [TRANSPORT_FILE]).catch(() => ({ stdout: '', stderr: '' }));
    await runFile('postfix', ['reload']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:domain', async (req: Request, res: Response) => {
  try {
    const rules = readTransport().filter(r => r.domain !== req.params.domain);
    writeTransport(rules);
    await runFile('postmap', [TRANSPORT_FILE]).catch(() => ({ stdout: '', stderr: '' }));
    await runFile('postfix', ['reload']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Mailing lists (Mailman) ─────────────────────────────── */

router.get('/lists', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM mailing_lists ORDER BY created_at DESC').all());
});

router.post('/lists', async (req: Request, res: Response) => {
  const { name, domain, description, admin_email, admin_password } = req.body;
  if (!name || !domain || !admin_email) return res.status(400).json({ error: 'name, domain, admin_email required' });
  if (!/^[a-z0-9_-]+$/i.test(name)) return res.status(400).json({ error: 'Invalid list name' });
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(admin_email)) return res.status(400).json({ error: 'Invalid admin email' });
  const safePass = (admin_password || 'changeme').replace(/[^a-zA-Z0-9!@#%^&*_+=.,-]/g, '');
  try {
    await runFile('newlist', ['-q', `${name}@${domain}`, admin_email, safePass]).catch(() => ({ stdout: '', stderr: '' }));
    const r = db.prepare('INSERT INTO mailing_lists (name, domain, description, admin_email) VALUES (?, ?, ?, ?)').run(name, domain, description || '', admin_email);
    res.json(db.prepare('SELECT * FROM mailing_lists WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/lists/:id', async (req: Request, res: Response) => {
  const list = db.prepare('SELECT * FROM mailing_lists WHERE id = ?').get(req.params.id) as any;
  if (!list) return res.status(404).json({ error: 'Not found' });
  try {
    await runFile('rmlist', ['-a', `${list.name}@${list.domain}`]).catch(() => ({ stdout: '', stderr: '' }));
    db.prepare('DELETE FROM mailing_lists WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Mailing list members ────────────────────────────────── */

db.exec(`CREATE TABLE IF NOT EXISTS mailing_list_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  name TEXT,
  subscribed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(list_id, address)
)`);

router.get('/lists/:id/members', (req: Request, res: Response) => {
  const list = db.prepare('SELECT * FROM mailing_lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  res.json(db.prepare('SELECT * FROM mailing_list_members WHERE list_id = ? ORDER BY subscribed_at DESC').all(req.params.id));
});

router.post('/lists/:id/members', (req: Request, res: Response) => {
  const { address, name } = req.body;
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    return res.status(400).json({ error: 'Valid email address required' });
  }
  try {
    const r = db.prepare('INSERT INTO mailing_list_members (list_id, address, name) VALUES (?, ?, ?)').run(req.params.id, address, name || '');
    res.json(db.prepare('SELECT * FROM mailing_list_members WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Address already subscribed' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/lists/:id/members/:memberId', (req: Request, res: Response) => {
  db.prepare('DELETE FROM mailing_list_members WHERE id = ? AND list_id = ?').run(req.params.memberId, req.params.id);
  res.json({ success: true });
});

/* ── Webmail SSO link ────────────────────────────────────── */

router.get('/webmail', async (_req: Request, res: Response) => {
  const webmailUrl = process.env.WEBMAIL_URL || '';
  const installed: string[] = [];
  try {
    const rpm = await runFile('rpm', ['-q', 'roundcubemail']).then(() => true).catch(() => false);
    const dir = (await import('fs')).existsSync('/usr/share/roundcubemail');
    if (rpm || dir) installed.push('Roundcube');
  } catch (_) {}
  res.json({ webmailUrl, installed });
});

export default router;
