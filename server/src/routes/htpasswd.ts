import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

const WEBROOT  = process.env.WEBROOT   || '/var/www';
const HTPW_DIR = process.env.HTPW_DIR  || '/etc/httpd/htpasswd';

function safeDir(dir: string): string {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(WEBROOT)) throw new Error('Directory must be inside web root');
  return resolved;
}

router.get('/list', async (_req: AuthRequest, res: Response) => {
  try {
    await fs.mkdir(HTPW_DIR, { recursive: true });
    const files = await fs.readdir(HTPW_DIR).catch(() => [] as string[]);
    const entries = await Promise.all(
      files.filter(f => f.endsWith('.htpasswd')).map(async f => {
        const content = await fs.readFile(path.join(HTPW_DIR, f), 'utf8').catch(() => '');
        const users = content.split('\n').filter(l => l.includes(':')).map(l => l.split(':')[0]);
        return { directory: Buffer.from(f.replace('.htpasswd', ''), 'hex').toString(), users };
      })
    );
    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/protect', async (req: AuthRequest, res: Response) => {
  const { directory, username, password, realm = 'Protected Area' } = req.body;
  if (!directory || !username || !password) return res.status(400).json({ error: 'directory, username, password required' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Invalid username' });

  try {
    const absDir = safeDir(directory);
    await fs.mkdir(HTPW_DIR, { recursive: true });
    const htpasswdFile = path.join(HTPW_DIR, `${Buffer.from(directory).toString('hex')}.htpasswd`);
    await execAsync(`htpasswd -b${(await fs.access(htpasswdFile).then(() => '').catch(() => 'c'))} "${htpasswdFile}" "${username}" "${password}"`);

    // Write .htaccess
    const htaccess = `AuthType Basic\nAuthName "${realm}"\nAuthUserFile ${htpasswdFile}\nRequire valid-user\n`;
    await fs.writeFile(path.join(absDir, '.htaccess'), htaccess);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/add-user', async (req: AuthRequest, res: Response) => {
  const { directory, username, password } = req.body;
  if (!directory || !username || !password) return res.status(400).json({ error: 'directory, username, password required' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  const htpasswdFile = path.join(HTPW_DIR, `${Buffer.from(directory).toString('hex')}.htpasswd`);
  try {
    await execAsync(`htpasswd -b "${htpasswdFile}" "${username}" "${password}"`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/unprotect', async (req: AuthRequest, res: Response) => {
  const { directory } = req.body;
  if (!directory) return res.status(400).json({ error: 'directory required' });
  try {
    const absDir = safeDir(directory);
    const htpasswdFile = path.join(HTPW_DIR, `${Buffer.from(directory).toString('hex')}.htpasswd`);
    await fs.unlink(htpasswdFile).catch(() => {});
    await fs.unlink(path.join(absDir, '.htaccess')).catch(() => {});
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
