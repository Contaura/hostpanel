import fs from 'fs/promises';
import path from 'path';
import { runFile } from './process-runner';

const KEY_TABLE     = process.env.OPENDKIM_KEY_TABLE || '/etc/opendkim/KeyTable';
const SIGNING_TABLE = process.env.OPENDKIM_SIGNING_TABLE || '/etc/opendkim/SigningTable';
const KEY_DIR       = process.env.OPENDKIM_KEY_DIR || '/etc/opendkim/keys';

// Register a freshly-generated key with OpenDKIM so it actually gets used to
// sign mail. opendkim-genkey only writes the key files; until KeyTable and
// SigningTable reference them, opendkim treats the domain as unsigned.
//
// KeyTable format:    <handle> <domain>:<selector>:<private-key-path>
// SigningTable line:  *@<domain> <handle>
// Where <handle> is conventionally "<selector>._domainkey.<domain>".
export async function registerDkimKey(domain: string, selector = 'default'): Promise<void> {
  const handle  = `${selector}._domainkey.${domain}`;
  const privKey = path.join(KEY_DIR, domain, `${selector}.private`);
  const keyLine     = `${handle} ${domain}:${selector}:${privKey}`;
  const signingLine = `*@${domain} ${handle}`;

  await runFile('chown', ['opendkim:opendkim', privKey]);
  await runFile('chmod', ['600', privKey]);

  await removeDkimLines(KEY_TABLE,     new RegExp(`^${escapeRe(handle)}\\b`, 'm'));
  await removeDkimLines(SIGNING_TABLE, new RegExp(`^\\*@${escapeRe(domain)}\\b`, 'm'));
  await fs.mkdir(path.dirname(KEY_TABLE), { recursive: true });
  await fs.mkdir(path.dirname(SIGNING_TABLE), { recursive: true });
  await fs.appendFile(KEY_TABLE,     keyLine     + '\n');
  await fs.appendFile(SIGNING_TABLE, signingLine + '\n');

  // SIGUSR1 reloads the tables without dropping in-flight connections.
  await runFile('systemctl', ['reload', 'opendkim'], { timeout: 120000 })
    .catch(() => runFile('systemctl', ['restart', 'opendkim'], { timeout: 120000 }))
    .catch(() => ({ stdout: '', stderr: '' }));
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
