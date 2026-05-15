import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

const REDIRECT_CONF = process.env.REDIRECT_CONF || '/etc/httpd/conf.d/hostpanel_redirects.conf';

interface Redirect {
  id: number;
  domain: string;
  from: string;
  to: string;
  type: '301' | '302';
}

async function readRedirects(): Promise<Redirect[]> {
  try {
    const content = await fs.readFile(REDIRECT_CONF, 'utf8');
    const results: Redirect[] = [];
    let id = 0;
    // Parse: # REDIRECT domain|from|to|type
    for (const line of content.split('\n')) {
      const m = line.match(/^# REDIRECT (.+)\|(.+)\|(.+)\|(301|302)$/);
      if (m) results.push({ id: id++, domain: m[1], from: m[2], to: m[3], type: m[4] as '301' | '302' });
    }
    return results;
  } catch {
    return [];
  }
}

async function writeRedirects(redirects: Redirect[]): Promise<void> {
  const lines: string[] = ['# HostPanel Redirects — do not edit manually\n'];
  for (const r of redirects) {
    lines.push(`# REDIRECT ${r.domain}|${r.from}|${r.to}|${r.type}`);
    lines.push(`<VirtualHost *:80>`);
    lines.push(`    ServerName ${r.domain}`);
    lines.push(`    Redirect ${r.type} ${r.from} ${r.to}`);
    lines.push(`</VirtualHost>\n`);
  }
  await fs.writeFile(REDIRECT_CONF, lines.join('\n'));
  await execAsync('systemctl reload httpd 2>/dev/null || true');
}

router.get('/list', async (_req: AuthRequest, res: Response) => {
  res.json(await readRedirects());
});

const DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{1,253}[a-zA-Z0-9]$/;
const FROM_RE   = /^\/[^\r\n\s]*$/;
const TO_RE     = /^https?:\/\/[^\r\n\s]+$/;

router.post('/add', async (req: AuthRequest, res: Response) => {
  const { domain, from, to, type = '301' } = req.body;
  if (!domain || !from || !to) return res.status(400).json({ error: 'domain, from, and to are required' });
  if (!['301', '302'].includes(type)) return res.status(400).json({ error: 'type must be 301 or 302' });
  if (!DOMAIN_RE.test(domain)) return res.status(400).json({ error: 'Invalid domain' });
  if (!FROM_RE.test(from))     return res.status(400).json({ error: 'from must be an absolute path starting with /' });
  if (!TO_RE.test(to))         return res.status(400).json({ error: 'to must be an http/https URL' });
  try {
    const redirects = await readRedirects();
    redirects.push({ id: redirects.length, domain, from, to, type });
    await writeRedirects(redirects);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id);
  try {
    const redirects = await readRedirects();
    if (id < 0 || id >= redirects.length) return res.status(404).json({ error: 'Redirect not found' });
    redirects.splice(id, 1);
    await writeRedirects(redirects);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
