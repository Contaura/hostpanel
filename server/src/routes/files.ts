import { Router, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { assertSafeFileTarget, resolveInsideBase } from '../utils/file-path';
import { assertArchiveListingHasNoLinks, assertSafeArchiveEntryListing } from '../utils/archive-path';
import { buildArchiveCommand, buildArchiveExtractCommand, buildArchiveListCommand, runFile } from '../utils/process-runner';

const router = Router();

const BASE_DIR = process.env.FILES_BASE_DIR || '/var/www';

function safePath(userPath: string): string {
  return resolveInsideBase(userPath, BASE_DIR);
}

async function assertSafePath(resolvedPath: string): Promise<void> {
  await assertSafeFileTarget(resolvedPath, BASE_DIR);
}


async function assertArchiveSafeToExtract(src: string, archivePath: string): Promise<void> {
  const listCommand = buildArchiveListCommand(src || archivePath);
  const names = await runFile(listCommand.command, listCommand.args);
  assertSafeArchiveEntryListing(names.stdout);

  const [verboseCommand, ...verboseArgs] = listCommand.verboseArgs;
  const verbose = await runFile(verboseCommand, verboseArgs);
  assertArchiveListingHasNoLinks(verbose.stdout);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const dest = safePath((req.query.path as string) || '');
        await assertSafePath(dest);
        cb(null, dest);
      } catch (e: any) {
        cb(e, '');
      }
    },
    // multer doesn't sanitize the filename it gets handed. Strip any directory
    // components from originalname so an upload named ../../etc/passwd writes
    // as etc-passwd inside the validated destination instead of escaping it.
    filename: (_req, file, cb) => cb(null, path.basename(file.originalname || 'upload').replace(/^\.+/, '_').slice(0, 255) || 'upload'),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.get('/list', async (req: AuthRequest, res: Response) => {
  try {
    const dir = safePath((req.query.path as string) || '');
    await assertSafePath(dir);
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
    await assertSafePath(filePath);
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
    await assertSafePath(resolved);
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
    await assertSafePath(resolved);
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
    await assertSafePath(resolved);
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
    await assertSafePath(resolvedFrom);
    await assertSafePath(resolvedTo);
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
    await assertSafePath(filePath);
    res.download(filePath);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/compress', async (req: AuthRequest, res: Response) => {
  const { paths, destination, format } = req.body; // paths: string[], destination: string, format: 'zip'|'tar.gz'
  if (!paths?.length || !destination) return res.status(400).json({ error: 'paths and destination required' });
  try {
    const dest = safePath(destination);
    await assertSafePath(dest);
    const safeSources = await Promise.all((paths as string[]).map(async p => {
      const src = safePath(p);
      await assertSafePath(src);
      return src;
    }));
    const archive = buildArchiveCommand(format, dest, safeSources);
    await runFile(archive.command, archive.args);
    res.json({ message: 'Archive created', destination });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/extract', async (req: AuthRequest, res: Response) => {
  const { path: archivePath, destination } = req.body;
  if (!archivePath) return res.status(400).json({ error: 'path required' });
  try {
    const src = safePath(archivePath);
    const dest = destination ? safePath(destination) : path.dirname(src);
    await assertSafePath(src);
    await assertSafePath(dest);
    await assertArchiveSafeToExtract(src, archivePath);
    const extract = buildArchiveExtractCommand(src, dest);
    await runFile(extract.command, extract.args);
    res.json({ message: 'Extracted successfully' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/move', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    const resolvedFrom = safePath(from);
    const resolvedTo = safePath(to);
    await assertSafePath(resolvedFrom);
    await assertSafePath(resolvedTo);
    await fs.rename(resolvedFrom, resolvedTo);
    res.json({ message: 'Moved' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/bulk-delete', async (req: AuthRequest, res: Response) => {
  const { paths } = req.body;
  if (!Array.isArray(paths) || !paths.length) return res.status(400).json({ error: 'paths array required' });
  const errors: string[] = [];
  for (const p of paths) {
    try { const target = safePath(p); await assertSafePath(target); await fs.rm(target, { recursive: true, force: true }); }
    catch (e: any) { errors.push(`${p}: ${e.message}`); }
  }
  res.json({ message: `Deleted ${paths.length - errors.length} item(s)`, errors });
});

router.post('/chmod', async (req: AuthRequest, res: Response) => {
  const { path: p, mode, recursive } = req.body;
  if (!p || !mode) return res.status(400).json({ error: 'path and mode required' });
  if (!/^[0-7]{3,4}$/.test(mode)) return res.status(400).json({ error: 'Invalid mode (e.g. 755)' });
  try {
    const target = safePath(p);
    await assertSafePath(target);
    await fs.chmod(target, parseInt(mode, 8));
    if (recursive) {
      await runFile('chmod', ['-R', mode, target]);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
