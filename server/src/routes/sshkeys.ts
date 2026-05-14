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

export default router;
