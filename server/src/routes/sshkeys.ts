import { Router, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { AuthRequest } from '../middleware/auth';

const router = Router();

const AUTH_KEYS = path.join(os.homedir(), '.ssh', 'authorized_keys');
const SSH_DIR   = path.join(os.homedir(), '.ssh');

interface SSHKey {
  id: number;
  type: string;
  key: string;
  comment: string;
  raw: string;
}

async function readKeys(): Promise<SSHKey[]> {
  try {
    await fs.mkdir(SSH_DIR, { recursive: true, mode: 0o700 });
    const content = await fs.readFile(AUTH_KEYS, 'utf8').catch(() => '');
    return content
      .split('\n')
      .filter(l => l.trim() && !l.trim().startsWith('#'))
      .map((raw, id) => {
        const parts = raw.trim().split(/\s+/);
        return { id, type: parts[0] || '', key: parts[1] || '', comment: parts[2] || '', raw: raw.trim() };
      });
  } catch {
    return [];
  }
}

async function writeKeys(keys: SSHKey[]): Promise<void> {
  await fs.mkdir(SSH_DIR, { recursive: true, mode: 0o700 });
  const content = keys.map(k => k.raw).join('\n') + (keys.length ? '\n' : '');
  await fs.writeFile(AUTH_KEYS, content, { mode: 0o600 });
}

router.get('/list', async (_req: AuthRequest, res: Response) => {
  res.json(await readKeys());
});

router.post('/add', async (req: AuthRequest, res: Response) => {
  const { key } = req.body;
  if (!key?.trim()) return res.status(400).json({ error: 'Key is required' });
  const trimmed = key.trim();
  const validTypes = ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-dss'];
  const firstWord = trimmed.split(/\s+/)[0];
  if (!validTypes.includes(firstWord)) return res.status(400).json({ error: 'Invalid SSH key type' });
  try {
    const keys = await readKeys();
    if (keys.some(k => k.raw === trimmed)) return res.status(409).json({ error: 'Key already exists' });
    const parts = trimmed.split(/\s+/);
    keys.push({ id: keys.length, type: parts[0], key: parts[1] || '', comment: parts[2] || '', raw: trimmed });
    await writeKeys(keys);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id);
  try {
    const keys = await readKeys();
    if (id < 0 || id >= keys.length) return res.status(404).json({ error: 'Key not found' });
    keys.splice(id, 1);
    await writeKeys(keys);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Per-account SSH key management ──────────────────────── */

const ACCT_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,30}$/;

async function readAccountKeys(username: string): Promise<SSHKey[]> {
  const authKeysPath = path.join('/home', username, '.ssh', 'authorized_keys');
  const content = await fs.readFile(authKeysPath, 'utf8').catch(() => '');
  return content
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#'))
    .map((raw, id) => {
      const parts = raw.trim().split(/\s+/);
      return { id, type: parts[0] || '', key: parts[1] || '', comment: parts[2] || '', raw: raw.trim() };
    });
}

async function writeAccountKeys(username: string, keys: SSHKey[]): Promise<void> {
  const sshDir = path.join('/home', username, '.ssh');
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
  const authKeysPath = path.join(sshDir, 'authorized_keys');
  const content = keys.map(k => k.raw).join('\n') + (keys.length ? '\n' : '');
  await fs.writeFile(authKeysPath, content, { mode: 0o600 });
  await import('child_process').then(({ exec }) => {
    const { promisify } = require('util');
    return promisify(exec)(`chown -R ${username}:${username} ${sshDir} 2>/dev/null || true`);
  }).catch(() => {});
}

// Resolve a username to its uid via `id -u`; rejects unknown users. Same
// pattern as the cron-account check — without this, writeAccountKeys was
// happily creating /home/<nosuchuser>/.ssh/authorized_keys owned by root
// (the chown -R falls back silently when the user doesn't exist), which
// would then leak any keys back to a future OS user with that name.
async function osUserExists(username: string): Promise<boolean> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  try { await promisify(exec)(`id -u "${username}"`); return true; }
  catch { return false; }
}

router.get('/account/:username', async (req: AuthRequest, res: Response) => {
  const { username } = req.params;
  if (!ACCT_RE.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!await osUserExists(username)) return res.status(404).json({ error: `No OS user named '${username}'` });
  res.json(await readAccountKeys(username));
});

router.post('/account/:username/add', async (req: AuthRequest, res: Response) => {
  const { username } = req.params;
  if (!ACCT_RE.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!await osUserExists(username)) {
    return res.status(404).json({ error: `No OS user named '${username}'. Create the user (useradd ${username}) before managing per-account SSH keys.` });
  }
  const { key } = req.body;
  if (!key?.trim()) return res.status(400).json({ error: 'Key is required' });
  const trimmed = key.trim();
  const validTypes = ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-dss'];
  if (!validTypes.includes(trimmed.split(/\s+/)[0])) return res.status(400).json({ error: 'Invalid SSH key type' });
  try {
    const keys = await readAccountKeys(username);
    if (keys.some(k => k.raw === trimmed)) return res.status(409).json({ error: 'Key already exists' });
    const parts = trimmed.split(/\s+/);
    keys.push({ id: keys.length, type: parts[0], key: parts[1] || '', comment: parts[2] || '', raw: trimmed });
    await writeAccountKeys(username, keys);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/account/:username/:id', async (req: AuthRequest, res: Response) => {
  const { username } = req.params;
  const id = parseInt(req.params.id);
  if (!ACCT_RE.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (!await osUserExists(username)) return res.status(404).json({ error: `No OS user named '${username}'` });
  try {
    const keys = await readAccountKeys(username);
    if (id < 0 || id >= keys.length) return res.status(404).json({ error: 'Key not found' });
    keys.splice(id, 1);
    await writeAccountKeys(username, keys);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
