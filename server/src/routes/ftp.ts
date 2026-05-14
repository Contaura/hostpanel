import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

const FTP_USER_DIR = process.env.FTP_USER_DIR || '/etc/vsftpd/users';
const WEBROOT = process.env.WEBROOT || '/var/www';

router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const content = await fs.readFile('/etc/vsftpd/user_list', 'utf-8').catch(() => '');
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
  const maxRate = req.body.max_rate ? Number(req.body.max_rate) : 0;

  try {
    // Create system user locked to FTP only
    await execAsync(`useradd -m -d ${homeDir} -s /sbin/nologin ${username} 2>/dev/null || true`);
    await execAsync(`echo '${username}:${password.replace(/'/g, "'\\''")}' | chpasswd`);
    await execAsync(`mkdir -p ${homeDir}`);
    await execAsync(`chown ${username}:${username} ${homeDir}`);

    // Add to vsftpd user list
    await fs.appendFile('/etc/vsftpd/user_list', `${username}\n`);

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
  if (!password || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  try {
    await execAsync(`echo '${username}:${password.replace(/'/g, "'\\''")}' | chpasswd`);
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
    await execAsync(`userdel -r ${username} 2>/dev/null || true`);
    await execAsync(`sed -i '/^${username}$/d' /etc/vsftpd/user_list 2>/dev/null || true`);
    await fs.unlink(path.join(FTP_USER_DIR, username)).catch(() => {});
    res.json({ message: `FTP user ${username} deleted` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
