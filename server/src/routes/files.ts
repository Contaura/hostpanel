import { Router, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';

const router = Router();

const BASE_DIR = process.env.FILES_BASE_DIR || '/var/www';

function safePath(userPath: string): string {
  const resolved = path.resolve(BASE_DIR, userPath.replace(/^\/+/, ''));
  if (!resolved.startsWith(path.resolve(BASE_DIR))) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const dest = safePath((req.query.path as string) || '');
        cb(null, dest);
      } catch (e: any) {
        cb(e, '');
      }
    },
    filename: (_req, file, cb) => cb(null, file.originalname),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const dir = safePath((req.query.path as string) || '');
    const entries = await fs.readdir(dir, { withFileTypes: true });

    const items = await Promise.all(
      entries.map(async entry => {
        try {
          const stat = await fs.stat(path.join(dir, entry.name));
          return {
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modified: stat.mtime,
            permissions: (stat.mode & 0o777).toString(8),
          };
        } catch {
          return { name: entry.name, type: 'file', size: 0, modified: new Date(), permissions: '000' };
        }
      })
    );

    items.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });

    res.json({ path: dir.replace(path.resolve(BASE_DIR), '') || '/', items });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/read', async (req: AuthRequest, res: Response) => {
  try {
    const filePath = safePath((req.query.path as string) || '');
    const stat = await fs.stat(filePath);

    if (stat.size > 2 * 1024 * 1024) {
      res.status(413).json({ error: 'File too large to edit in browser (> 2MB)' });
      return;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/write', async (req: AuthRequest, res: Response) => {
  try {
    const { path: filePath, content } = req.body;
    const resolved = safePath(filePath);
    await fs.writeFile(resolved, content, 'utf-8');
    res.json({ message: 'File saved' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/mkdir', async (req: AuthRequest, res: Response) => {
  try {
    const { path: dirPath } = req.body;
    const resolved = safePath(dirPath);
    await fs.mkdir(resolved, { recursive: true });
    res.json({ message: 'Directory created' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/delete', async (req: AuthRequest, res: Response) => {
  try {
    const { path: targetPath } = req.body;
    const resolved = safePath(targetPath);
    await fs.rm(resolved, { recursive: true, force: true });
    res.json({ message: 'Deleted' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/rename', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.body;
    const resolvedFrom = safePath(from);
    const resolvedTo = safePath(to);
    await fs.rename(resolvedFrom, resolvedTo);
    res.json({ message: 'Renamed' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/upload', upload.array('files'), (req: AuthRequest, res: Response) => {
  const files = req.files as Express.Multer.File[];
  res.json({ message: `Uploaded ${files?.length || 0} file(s)` });
});

router.get('/download', async (req: AuthRequest, res: Response) => {
  try {
    const filePath = safePath((req.query.path as string) || '');
    res.download(filePath);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/compress', async (req: AuthRequest, res: Response) => {
  const { paths, destination, format } = req.body; // paths: string[], destination: string, format: 'zip'|'tar.gz'
  if (!paths?.length || !destination) return res.status(400).json({ error: 'paths and destination required' });
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execA = promisify(exec);
  try {
    const dest = safePath(destination);
    const srcList = (paths as string[]).map(p => `"${safePath(p)}"`).join(' ');
    if (format === 'zip') {
      await execA(`zip -r "${dest}" ${srcList}`);
    } else {
      await execA(`tar -czf "${dest}" ${srcList}`);
    }
    res.json({ message: 'Archive created', destination });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/extract', async (req: AuthRequest, res: Response) => {
  const { path: archivePath, destination } = req.body;
  if (!archivePath) return res.status(400).json({ error: 'path required' });
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execA = promisify(exec);
  try {
    const src = safePath(archivePath);
    const dest = destination ? safePath(destination) : path.dirname(src);
    const ext = archivePath.toLowerCase();
    let cmd = '';
    if (ext.endsWith('.zip'))    cmd = `unzip -o "${src}" -d "${dest}"`;
    else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) cmd = `tar -xzf "${src}" -C "${dest}"`;
    else if (ext.endsWith('.tar.bz2')) cmd = `tar -xjf "${src}" -C "${dest}"`;
    else if (ext.endsWith('.tar'))     cmd = `tar -xf "${src}" -C "${dest}"`;
    else return res.status(400).json({ error: 'Unsupported archive format' });
    await execA(cmd);
    res.json({ message: 'Extracted successfully' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/chmod', async (req: AuthRequest, res: Response) => {
  const { path: p, mode, recursive } = req.body;
  if (!p || !mode) return res.status(400).json({ error: 'path and mode required' });
  if (!/^[0-7]{3,4}$/.test(mode)) return res.status(400).json({ error: 'Invalid mode (e.g. 755)' });
  try {
    const target = safePath(p);
    const flag = recursive ? '-R ' : '';
    await fs.chmod(target, parseInt(mode, 8));
    if (recursive) {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      await promisify(exec)(`chmod -R ${mode} "${target}"`);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
