import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import db from '../db';

const router = Router();
const execAsync = promisify(exec);

const VIRTUAL_FILE = process.env.VIRTUAL_FILE || '/etc/postfix/virtual';

/* ── Forwarders (Postfix virtual aliases) ────────────────── */

function readForwarders(): { source: string; dest: string }[] {
  if (!existsSync(VIRTUAL_FILE)) return [];
  return readFileSync(VIRTUAL_FILE, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const [source, dest] = l.trim().split(/\s+/);
      return source && dest ? { source, dest } : null;
    })
    .filter(Boolean) as { source: string; dest: string }[];
}

function writeForwarders(list: { source: string; dest: string }[]) {
  const content = '# Managed by HostPanel\n' +
    list.map(f => `${f.source}\t${f.dest}`).join('\n') + '\n';
  writeFileSync(VIRTUAL_FILE, content, 'utf8');
}

router.get('/forwarders', (_req: Request, res: Response) => {
  try {
    res.json(readForwarders());
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/forwarders', async (req: Request, res: Response) => {
  const { source, dest } = req.body;
  if (!source || !dest) return res.status(400).json({ error: 'source and dest required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(source) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  try {
    const list = readForwarders();
    if (list.find(f => f.source === source)) return res.status(409).json({ error: 'Forwarder already exists' });
    list.push({ source, dest });
    writeForwarders(list);
    await execAsync('postmap ' + VIRTUAL_FILE).catch(() => {});
    await execAsync('postfix reload').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/forwarders/:source', async (req: Request, res: Response) => {
  try {
    const source = decodeURIComponent(req.params.source);
    const list = readForwarders().filter(f => f.source !== source);
    writeForwarders(list);
    await execAsync('postmap ' + VIRTUAL_FILE).catch(() => {});
    await execAsync('postfix reload').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Autoresponders (stored in SQLite) ───────────────────── */

router.get('/autoresponders', (_req: Request, res: Response) => {
  res.json(db.prepare('SELECT * FROM autoresponders ORDER BY created_at DESC').all());
});

router.post('/autoresponders', (req: Request, res: Response) => {
  const { email, subject, body, start_date, end_date } = req.body;
  if (!email || !body) return res.status(400).json({ error: 'email and body required' });
  try {
    const r = db.prepare(`
      INSERT INTO autoresponders (email, subject, body, start_date, end_date)
      VALUES (?, ?, ?, ?, ?)
    `).run(email, subject || 'Auto Reply', body, start_date || null, end_date || null);
    res.json(db.prepare('SELECT * FROM autoresponders WHERE id = ?').get(r.lastInsertRowid));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/autoresponders/:id', (req: Request, res: Response) => {
  const { email, subject, body, start_date, end_date, enabled } = req.body;
  try {
    db.prepare(`
      UPDATE autoresponders SET email=?, subject=?, body=?, start_date=?, end_date=?, enabled=?
      WHERE id=?
    `).run(email, subject, body, start_date || null, end_date || null, enabled ? 1 : 0, req.params.id);
    res.json(db.prepare('SELECT * FROM autoresponders WHERE id = ?').get(req.params.id));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/autoresponders/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM autoresponders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

/* ── SpamAssassin config ─────────────────────────────────── */

const SA_CONFIG = process.env.SA_CONFIG || '/etc/mail/spamassassin/local.cf';
const SA_DEFAULTS = { required_score: '5.0', rewrite_header: 'Subject ***SPAM***', report_safe: '0', use_bayes: '1', bayes_auto_learn: '1' };

router.get('/spam', (_req: Request, res: Response) => {
  try {
    if (!existsSync(SA_CONFIG)) return res.json(SA_DEFAULTS);
    const lines = readFileSync(SA_CONFIG, 'utf8').split('\n');
    const config: Record<string, string> = { ...SA_DEFAULTS };
    for (const line of lines) {
      const m = line.match(/^(\w+)\s+(.+)$/);
      if (m) config[m[1]] = m[2].trim();
    }
    res.json(config);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/spam', async (req: Request, res: Response) => {
  const allowed = new Set(['required_score', 'rewrite_header', 'report_safe', 'use_bayes', 'bayes_auto_learn', 'skip_rbl_checks', 'whitelist_from', 'blacklist_from']);
  try {
    const lines = Object.entries(req.body)
      .filter(([k]) => allowed.has(k))
      .map(([k, v]) => `${k} ${String(v).replace(/[\r\n]/g, '')}`);
    writeFileSync(SA_CONFIG, '# Managed by HostPanel\n' + lines.join('\n') + '\n');
    await execAsync('systemctl restart spamassassin').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── Email disk quotas (quota CLI) ───────────────────────── */

router.get('/quotas', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('repquota -a -s 2>/dev/null || echo ""');
    const lines = stdout.split('\n').filter(l => l.trim() && !l.startsWith('-') && !l.startsWith('Block'));
    const quotas = lines.map(l => {
      const parts = l.trim().split(/\s+/);
      return parts.length >= 4 ? { user: parts[0], used: parts[1], limit: parts[2], grace: parts[3] } : null;
    }).filter(Boolean);
    res.json(quotas);
  } catch (err: any) { res.json([]); }
});

/* ── Per-domain spam rules (blacklist / whitelist) ───────── */

db.exec(`CREATE TABLE IF NOT EXISTS domain_spam_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('whitelist','blacklist')),
  address TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);

const DOMAIN_SA_DIR = process.env.SA_DOMAIN_DIR || '/etc/mail/spamassassin/domains';

function writeDomainRules(domain: string) {
  const rules = db.prepare("SELECT * FROM domain_spam_rules WHERE domain = ? ORDER BY type").all(domain) as any[];
  const lines = ['# Managed by HostPanel'];
  for (const r of rules) {
    lines.push(`${r.type}_from ${r.address}`);
  }
  const dir = DOMAIN_SA_DIR;
  try {
    const { mkdirSync, writeFileSync } = require('fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${domain}.cf`, lines.join('\n') + '\n');
  } catch {}
}

const SA_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{1,253}[a-zA-Z0-9]$/;

router.get('/spam-rules/:domain', (req: Request, res: Response) => {
  if (!SA_DOMAIN_RE.test(req.params.domain)) return res.status(400).json({ error: 'Invalid domain' });
  const rules = db.prepare("SELECT * FROM domain_spam_rules WHERE domain = ? ORDER BY type, address").all(req.params.domain);
  res.json(rules);
});

router.post('/spam-rules/:domain', (req: Request, res: Response) => {
  const { domain } = req.params;
  if (!SA_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  const { type, address } = req.body;
  if (!['whitelist', 'blacklist'].includes(type) || !address) {
    return res.status(400).json({ error: 'type (whitelist|blacklist) and address required' });
  }
  db.prepare("INSERT INTO domain_spam_rules (domain, type, address) VALUES (?, ?, ?)").run(domain, type, address);
  writeDomainRules(domain);
  res.json({ success: true });
});

router.delete('/spam-rules/:domain/:id', (req: Request, res: Response) => {
  const { domain, id } = req.params;
  if (!SA_DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  db.prepare("DELETE FROM domain_spam_rules WHERE id = ? AND domain = ?").run(parseInt(id), domain);
  writeDomainRules(domain);
  res.json({ success: true });
});

/* ── Catch-all address (Postfix virtual, @domain form) ───── */

router.get('/catch-all', (_req: Request, res: Response) => {
  try {
    const all = readForwarders();
    const catchAlls = all.filter(f => f.source.startsWith('@'));
    res.json(catchAlls);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/catch-all', async (req: Request, res: Response) => {
  const { domain, dest } = req.body;
  if (!domain || !dest) return res.status(400).json({ error: 'domain and dest required' });
  if (!SA_DOMAIN_RE.test(domain.replace(/^@/, ''))) return res.status(400).json({ error: 'Invalid domain' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) return res.status(400).json({ error: 'Invalid destination email' });
  const source = `@${domain.replace(/^@/, '')}`;
  try {
    const list = readForwarders();
    if (list.find(f => f.source === source)) {
      // update existing
      const updated = list.map(f => f.source === source ? { source, dest } : f);
      writeForwarders(updated);
    } else {
      list.push({ source, dest });
      writeForwarders(list);
    }
    await execAsync('postmap ' + VIRTUAL_FILE).catch(() => {});
    await execAsync('postfix reload').catch(() => {});
    res.json({ success: true, source, dest });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/catch-all/:domain', async (req: Request, res: Response) => {
  const source = `@${req.params.domain}`;
  try {
    const list = readForwarders().filter(f => f.source !== source);
    writeForwarders(list);
    await execAsync('postmap ' + VIRTUAL_FILE).catch(() => {});
    await execAsync('postfix reload').catch(() => {});
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

