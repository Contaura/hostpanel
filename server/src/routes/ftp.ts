import { Router, Response } from 'express';
import { spawn } from 'child_process';
import { runFile } from '../utils/process-runner';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();

const FTP_USER_DIR = process.env.FTP_USER_DIR || '/etc/vsftpd/users';
const VSFTPD_USER_LIST = process.env.VSFTPD_USER_LIST || '/etc/vsftpd/user_list';
const WEBROOT = process.env.WEBROOT || '/var/www';

function chpasswdStdin(username: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('chpasswd', [], { shell: false });
    proc.stdin.write(`${username}:${password}\n`);
    proc.stdin.end();
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`chpasswd exited ${code}`))));
    proc.on('error', reject);
  });
}

router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const content = await fs.readFile(VSFTPD_USER_LIST, 'utf-8').catch(() => '');
    const users = content
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(username => ({ username: username.trim(), directory: path.join(WEBROOT, username.trim()) }));
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', async (req: AuthRequest, res: Response) => {
  const { username, password, directory } = req.body;
  if (!username || !password || !/^[a-zA-Z0-9_]+$/.test(username)) {
    res.status(400).json({ error: 'Invalid username' });
    return;
  }

  const homeDir = directory || path.join(WEBROOT, username);
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(homeDir)) {
    res.status(400).json({ error: 'Invalid directory path' });
    return;
  }
  const maxRate = req.body.max_rate ? Number(req.body.max_rate) : 0;

  try {
    // Create system user locked to FTP only
    await runFile('useradd', ['-m', '-d', homeDir, '-s', '/sbin/nologin', username]).catch(() => ({ stdout: '', stderr: '' }));
    await chpasswdStdin(username, password);
    await fs.mkdir(homeDir, { recursive: true });
    await runFile('chown', [`${username}:${username}`, homeDir]);

    // Add to vsftpd user list
    await fs.appendFile(VSFTPD_USER_LIST, `${username}\n`);

    // Write per-user vsftpd config
    await fs.mkdir(FTP_USER_DIR, { recursive: true });
    const rateConfig = maxRate > 0 ? `local_max_rate=${maxRate}\n` : '';
    await fs.writeFile(
      path.join(FTP_USER_DIR, username),
      `local_root=${homeDir}\nwrite_enable=YES\nanon_world_readable_only=NO\n${rateConfig}`
    );

    res.json({ message: `FTP user ${username} created`, directory: homeDir });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:username/password', async (req: AuthRequest, res: Response) => {
  const { username } = req.params;
  const { password } = req.body;
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  try {
    await chpasswdStdin(username, password);
    res.json({ message: 'Password updated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:username/limits', async (req: AuthRequest, res: Response) => {
  const { username } = req.params;
  const maxRate = Number(req.body.max_rate) || 0;
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
  const cfgPath = path.join(FTP_USER_DIR, username);
  try {
    let cfg = await fs.readFile(cfgPath, 'utf-8').catch(() => '');
    cfg = cfg.replace(/^local_max_rate=.*$/m, '').replace(/\n+$/, '\n');
    if (maxRate > 0) cfg += `local_max_rate=${maxRate}\n`;
    await fs.writeFile(cfgPath, cfg);
    res.json({ message: 'Limits updated' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:username', async (req: AuthRequest, res: Response) => {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    res.status(400).json({ error: 'Invalid username' });
    return;
  }

  try {
    await runFile('userdel', ['-r', username]).catch(() => ({ stdout: '', stderr: '' }));
    const list = await fs.readFile(VSFTPD_USER_LIST, 'utf8').catch(() => '');
    const filtered = list.split('\n').filter(line => line.trim() && line.trim() !== username).join('\n');
    await fs.writeFile(VSFTPD_USER_LIST, filtered ? `${filtered}\n` : '');
    await fs.unlink(path.join(FTP_USER_DIR, username)).catch(() => {});
    res.json({ message: `FTP user ${username} deleted` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
