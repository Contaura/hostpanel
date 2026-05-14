import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

// Reads virtual mailbox map from Postfix + Dovecot userdb
const VMAIL_DIR = process.env.VMAIL_DIR || '/etc/postfix/virtual';
const PASSWD_FILE = process.env.MAIL_PASSWD || '/etc/dovecot/users';

async function getAccounts(): Promise<{ email: string; domain: string; quota: string }[]> {
  try {
    const { stdout } = await execAsync(`cat ${PASSWD_FILE} 2>/dev/null || true`);
    return stdout
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(line => {
        const [email, , , , , , quota] = line.split(':');
        const [, domain] = (email || '').split('@');
        return { email: email || '', domain: domain || '', quota: quota?.replace('userdb_quota_rule=*:bytes=', '') || 'Unlimited' };
      });
  } catch {
    return [];
  }
}

router.get('/accounts', async (_req: AuthRequest, res: Response) => {
  const accounts = await getAccounts();
  res.json(accounts);
});

router.post('/accounts', async (req: AuthRequest, res: Response) => {
  const { email, password, quota } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  const [user, domain] = email.split('@');
  if (!user || !domain) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  try {
    // Create system user entry in Dovecot passwd-file
    const quotaRule = quota ? `userdb_quota_rule=*:bytes=${quota}` : '';
    const cmd = `doveadm pw -s SHA512-CRYPT -p '${password.replace(/'/g, "'\\''")}'`;
    const { stdout: hash } = await execAsync(cmd);
    const entry = `${email}:${hash.trim()}:5000:5000::${VMAIL_DIR}/${domain}/${user}::${quotaRule}`;
    await execAsync(`echo '${entry}' >> ${PASSWD_FILE}`);

    // Add to virtual mailbox
    await execAsync(`echo '${email}    ${domain}/${user}/' >> ${VMAIL_DIR}/mailbox`);
    await execAsync(`postmap ${VMAIL_DIR}/mailbox 2>/dev/null || true`);
    await execAsync(`mkdir -p ${VMAIL_DIR}/${domain}/${user}`);

    res.json({ message: `Mailbox ${email} created` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/accounts/:email', async (req: AuthRequest, res: Response) => {
  const { email } = req.params;
  try {
    await execAsync(`sed -i '/^${email.replace(/[.@]/g, '\\$&')}:/d' ${PASSWD_FILE} 2>/dev/null || true`);
    await execAsync(`sed -i '/^${email.replace(/[.@]/g, '\\$&')}/d' ${VMAIL_DIR}/mailbox 2>/dev/null || true`);
    await execAsync(`postmap ${VMAIL_DIR}/mailbox 2>/dev/null || true`);
    res.json({ message: `Mailbox ${email} deleted` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/forwarders', async (_req: AuthRequest, res: Response) => {
  try {
    const { stdout } = await execAsync(`cat ${VMAIL_DIR}/aliases 2>/dev/null || true`);
    const forwarders = stdout
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(line => {
        const [from, to] = line.split(/\s+/);
        return { from: from || '', to: to || '' };
      });
    res.json(forwarders);
  } catch {
    res.json([]);
  }
});

router.post('/forwarders', async (req: AuthRequest, res: Response) => {
  const { from, to } = req.body;
  if (!from || !to) {
    res.status(400).json({ error: 'From and To required' });
    return;
  }

  try {
    await execAsync(`echo '${from}    ${to}' >> ${VMAIL_DIR}/aliases`);
    await execAsync(`postmap ${VMAIL_DIR}/aliases 2>/dev/null || true`);
    res.json({ message: 'Forwarder created' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/forwarders/:from', async (req: AuthRequest, res: Response) => {
  const { from } = req.params;
  try {
    await execAsync(`sed -i '/^${from.replace(/[.@]/g, '\\$&')}/d' ${VMAIL_DIR}/aliases 2>/dev/null || true`);
    await execAsync(`postmap ${VMAIL_DIR}/aliases 2>/dev/null || true`);
    res.json({ message: 'Forwarder deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
