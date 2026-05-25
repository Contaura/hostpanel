import { Router, Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';
import { runFile } from '../utils/process-runner';

const router = Router();

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

async function readFileSafe(file: string): Promise<string> {
  try { return await fs.readFile(file, 'utf-8'); } catch { return ''; }
}

async function getAccounts(): Promise<{ email: string; domain: string; quota: string }[]> {
  const text = await readFileSafe(PASSWD_FILE);
  return text
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(line => {
      const [email, , , , , , quota] = line.split(':');
      const [, domain] = (email || '').split('@');
      return { email: email || '', domain: domain || '', quota: quota?.replace('userdb_quota_rule=*:bytes=', '') || 'Unlimited' };
    });
}

// Rewrite a newline-delimited file, keeping only lines for which `keep` returns true.
// Used instead of `sed -i '/pattern/d'` so user-supplied strings never reach a shell.
async function filterFileLines(file: string, keep: (line: string) => boolean): Promise<void> {
  const text = await readFileSafe(file);
  if (!text) return;
  const out = text.split('\n').filter((line, idx, arr) => {
    // Preserve trailing newline behaviour: the final split element is '' if file ends with \n.
    if (idx === arr.length - 1 && line === '') return true;
    return keep(line);
  }).join('\n');
  await fs.writeFile(file, out);
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
    const mailboxMap = path.join(VMAIL_DIR, 'mailbox');
    await fs.appendFile(mailboxMap, `${email}    ${domain}/${user}/\n`);
    await runFile('postmap', [mailboxMap]).catch(() => ({ stdout: '', stderr: '' }));

    // Ensure the domain is in the virtual_mailbox_domains map so Postfix
    // accepts mail for it. Right-side value is irrelevant; just needs to exist.
    const domainsFile = path.join(VMAIL_DIR, 'domains');
    try {
      const existing = await readFileSafe(domainsFile);
      if (!new RegExp(`^${domain}\\b`, 'm').test(existing)) {
        await fs.appendFile(domainsFile, `${domain} OK\n`);
        await runFile('postmap', [domainsFile]).catch(() => ({ stdout: '', stderr: '' }));
      }
    } catch { /* domains map is optional; ignore */ }

    // Create the Maildir under MAIL_HOME, owned by vmail (uid 5000) so
    // Dovecot's LMTP can write to it.
    const maildir = path.join(MAIL_HOME, domain, user);
    await fs.mkdir(maildir, { recursive: true });
    await runFile('chown', ['-R', '5000:5000', maildir]).catch(() => ({ stdout: '', stderr: '' }));
    await runFile('chmod', ['700', maildir]).catch(() => ({ stdout: '', stderr: '' }));

    res.json({ message: `Mailbox ${email} created` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/accounts/:email', async (req: AuthRequest, res: Response) => {
  const { email } = req.params;
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  try {
    // Remove the user entry from the Dovecot passwd-file: keep every line that
    // does NOT start with "<email>:". Comparing exact prefix avoids the regex
    // escaping the old sed call was doing.
    const passwdPrefix = `${email}:`;
    await filterFileLines(PASSWD_FILE, line => !line.startsWith(passwdPrefix));

    // Remove from postfix mailbox map: lines start with the email followed by whitespace.
    const mailboxMap = path.join(VMAIL_DIR, 'mailbox');
    await filterFileLines(mailboxMap, line => {
      if (!line.startsWith(email)) return true;
      const next = line.charAt(email.length);
      // Keep the line if the next char is part of a different identifier
      // (e.g. "jane@example.come" vs "jane@example.com"). Postfix map lines
      // separate key/value with whitespace.
      return !(next === '' || next === ' ' || next === '\t');
    });
    await runFile('postmap', [mailboxMap]).catch(() => ({ stdout: '', stderr: '' }));

    res.json({ message: `Mailbox ${email} deleted` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/forwarders', async (_req: AuthRequest, res: Response) => {
  const text = await readFileSafe(path.join(VMAIL_DIR, 'aliases'));
  const forwarders = text
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(line => {
      const [from, to] = line.split(/\s+/);
      return { from: from || '', to: to || '' };
    });
  res.json(forwarders);
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
    const aliasesFile = path.join(VMAIL_DIR, 'aliases');
    await fs.appendFile(aliasesFile, `${from}    ${to}\n`);
    await runFile('postmap', [aliasesFile]).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ message: 'Forwarder created' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/forwarders/:from', async (req: AuthRequest, res: Response) => {
  const { from } = req.params;
  if (!EMAIL_RE.test(from)) return res.status(400).json({ error: 'Invalid email address' });
  try {
    const aliasesFile = path.join(VMAIL_DIR, 'aliases');
    await filterFileLines(aliasesFile, line => {
      if (!line.startsWith(from)) return true;
      const next = line.charAt(from.length);
      return !(next === '' || next === ' ' || next === '\t');
    });
    await runFile('postmap', [aliasesFile]).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ message: 'Forwarder deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
