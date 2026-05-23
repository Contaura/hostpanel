import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

const KEY_TABLE     = '/etc/opendkim/KeyTable';
const SIGNING_TABLE = '/etc/opendkim/SigningTable';

// Register a freshly-generated key with OpenDKIM so it actually gets used to
// sign mail. opendkim-genkey only writes the key files; until KeyTable and
// SigningTable reference them, opendkim treats the domain as unsigned.
//
// KeyTable format:    <handle> <domain>:<selector>:<private-key-path>
// SigningTable line:  *@<domain> <handle>
// Where <handle> is conventionally "<selector>._domainkey.<domain>".
export async function registerDkimKey(domain: string, selector = 'default'): Promise<void> {
  const handle  = `${selector}._domainkey.${domain}`;
  const privKey = `/etc/opendkim/keys/${domain}/${selector}.private`;
  const keyLine     = `${handle} ${domain}:${selector}:${privKey}`;
  const signingLine = `*@${domain} ${handle}`;

  await execAsync(`chown opendkim:opendkim ${privKey} 2>/dev/null || true`);
  await execAsync(`chmod 600 ${privKey} 2>/dev/null || true`);

  await removeDkimLines(KEY_TABLE,     new RegExp(`^${escapeRe(handle)}\\b`, 'm'));
  await removeDkimLines(SIGNING_TABLE, new RegExp(`^\\*@${escapeRe(domain)}\\b`, 'm'));
  await fs.appendFile(KEY_TABLE,     keyLine     + '\n');
  await fs.appendFile(SIGNING_TABLE, signingLine + '\n');

  // SIGUSR1 reloads the tables without dropping in-flight connections.
  await execAsync('systemctl reload opendkim 2>/dev/null || systemctl restart opendkim 2>/dev/null || true');
}

async function removeDkimLines(path: string, match: RegExp): Promise<void> {
  const content = await fs.readFile(path, 'utf-8').catch(() => '');
  if (!match.test(content)) return;
  const cleaned = content.split('\n').filter(l => !match.test(l)).join('\n');
  await fs.writeFile(path, cleaned);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
