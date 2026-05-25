import { Router, Response } from 'express';
import { runFile } from '../utils/process-runner';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();

const WEBROOT = process.env.WEBROOT || '/var/www';
const ERROR_CODES = [400, 401, 403, 404, 500, 502, 503];

function safeDocRoot(domain: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/.test(domain)) throw new Error('Invalid domain');
  return path.join(WEBROOT, domain, 'public_html');
}

router.get('/read', async (req: AuthRequest, res: Response) => {
  const { domain, code } = req.query as { domain: string; code: string };
  if (!domain || !code) return res.status(400).json({ error: 'domain and code required' });
  const num = parseInt(code);
  if (!ERROR_CODES.includes(num)) return res.status(400).json({ error: 'Invalid error code' });
  try {
    const docRoot = safeDocRoot(domain);
    const file = path.join(docRoot, `error${num}.html`);
    const content = await fs.readFile(file, 'utf8').catch(() => defaultPage(num));
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/save', async (req: AuthRequest, res: Response) => {
  const { domain, code, content } = req.body;
  if (!domain || !code || content === undefined) return res.status(400).json({ error: 'domain, code, content required' });
  const num = parseInt(code);
  if (!ERROR_CODES.includes(num)) return res.status(400).json({ error: 'Invalid error code' });
  try {
    const docRoot = safeDocRoot(domain);
    await fs.mkdir(docRoot, { recursive: true });
    const file = path.join(docRoot, `error${num}.html`);
    await fs.writeFile(file, content);

    // Ensure vhost has ErrorDocument directive
    const vhostFile = path.join(process.env.VHOST_DIR || '/etc/httpd/conf.d', `${domain}.conf`);
    let vhost = await fs.readFile(vhostFile, 'utf8').catch(() => '');
    if (vhost && !vhost.includes(`ErrorDocument ${num}`)) {
      vhost = vhost.replace('</VirtualHost>', `    ErrorDocument ${num} /error${num}.html\n</VirtualHost>`);
      await fs.writeFile(vhostFile, vhost);
      await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function defaultPage(code: number): string {
  const messages: Record<number, string> = {
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Page Not Found', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
  };
  return `<!DOCTYPE html>
<html>
<head><title>${code} ${messages[code] || 'Error'}</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;}
.box{text-align:center;}.code{font-size:6rem;font-weight:700;color:#6366f1;line-height:1;}.msg{font-size:1.5rem;color:#475569;}</style>
</head>
<body><div class="box"><div class="code">${code}</div><div class="msg">${messages[code] || 'Error'}</div></div></body>
</html>`;
}

export default router;
