import { Router, Response } from 'express';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

// Reads virtual mailbox map from Postfix + Dovecot userdb.
// VMAIL_DIR — flat-file Postfix maps (mailbox, aliases, domains, *.db).
//             Stays under /etc/postfix because that's where Postfix looks for
//             its config-class files.
// MAIL_HOME — actual Maildir storage. Must live OUTSIDE /etc, because
//             Dovecot's SELinux domain (dovecot_t) can't traverse
//             /etc/postfix (postfix_etc_t) and the systemd unit also marks
//             /etc as read-only via ProtectSystem=full. /var/mail/vhosts is
//             the FHS-correct path and is already labeled mail_spool_t.
const VMAIL_DIR = process.env.VMAIL_DIR || '/etc/postfix/vmail';
const MAIL_HOME = process.env.MAIL_HOME || '/var/mail/vhosts';
const PASSWD_FILE = process.env.MAIL_PASSWD || '/etc/dovecot/users';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function doveadmHashStdin(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('doveadm', ['pw', '-s', 'SHA512-CRYPT']);
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stdin.write(password + '\n' + password + '\n');
    proc.stdin.end();
    proc.on('close', code => (code === 0 ? resolve(out.trim()) : reject(new Error(`doveadm exited ${code}`))));
    proc.on('error', reject);
  });
}

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
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  const [user, domain] = email.split('@');

  try {
    // Create system user entry in Dovecot passwd-file
    const quotaRule = quota ? `userdb_quota_rule=*:bytes=${quota}` : '';
    const hash = await doveadmHashStdin(password);
    const entry = `${email}:${hash}:5000:5000::${MAIL_HOME}/${domain}/${user}::${quotaRule}`;
    await fs.appendFile(PASSWD_FILE, entry + '\n');

    // Add to virtual mailbox map (Postfix maps live in /etc/postfix/vmail)
    await fs.appendFile(path.join(VMAIL_DIR, 'mailbox'), `${email}    ${domain}/${user}/\n`);
    await execAsync(`postmap ${VMAIL_DIR}/mailbox 2>/dev/null || true`);
    // Ensure the domain is in the virtual_mailbox_domains map so Postfix
    // accepts mail for it. Right-side value is irrelevant; just needs to exist.
    const domainsFile = path.join(VMAIL_DIR, 'domains');
    try {
      const existing = await fs.readFile(domainsFile, 'utf-8').catch(() => '');
      if (!new RegExp(`^${domain}\\b`, 'm').test(existing)) {
        await fs.appendFile(domainsFile, `${domain} OK\n`);
        await execAsync(`postmap ${domainsFile} 2>/dev/null || true`);
      }
    } catch { /* domains map is optional; ignore */ }

    // Create the Maildir under MAIL_HOME, owned by vmail (uid 5000) so
    // Dovecot's LMTP can write to it.
    await fs.mkdir(path.join(MAIL_HOME, domain, user), { recursive: true });
    await execAsync(`chown -R 5000:5000 ${MAIL_HOME}/${domain}/${user} 2>/dev/null || true`);
    await execAsync(`chmod 700 ${MAIL_HOME}/${domain}/${user} 2>/dev/null || true`);

    res.json({ message: `Mailbox ${email} created` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/accounts/:email', async (req: AuthRequest, res: Response) => {
  const { email } = req.params;
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
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
  if (!EMAIL_RE.test(from) || !EMAIL_RE.test(to)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  try {
    await fs.appendFile(path.join(VMAIL_DIR, 'aliases'), `${from}    ${to}\n`);
    await execAsync(`postmap ${VMAIL_DIR}/aliases 2>/dev/null || true`);
    res.json({ message: 'Forwarder created' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/forwarders/:from', async (req: AuthRequest, res: Response) => {
  const { from } = req.params;
  if (!EMAIL_RE.test(from)) return res.status(400).json({ error: 'Invalid email address' });
  try {
    await execAsync(`sed -i '/^${from.replace(/[.@]/g, '\\$&')}/d' ${VMAIL_DIR}/aliases 2>/dev/null || true`);
    await execAsync(`postmap ${VMAIL_DIR}/aliases 2>/dev/null || true`);
    res.json({ message: 'Forwarder deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
