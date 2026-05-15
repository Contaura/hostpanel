import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import db from '../db';

const router = Router();
const execAsync = promisify(exec);
const WEBROOT = process.env.WEBROOT || '/var/www';

// Malware scans and integrity rebuilds each fan out across the whole webroot
// — letting a single JWT call these every second under the global 300/min
// limit is enough to keep the CPU pegged. Pin them to a much tighter
// per-IP bucket.
const heavyLimit = rateLimit({
  windowMs: 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Scan rate limit hit; wait a minute before retrying.' },
});

// Integrity baseline store
db.exec(`CREATE TABLE IF NOT EXISTS file_hashes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  last_checked TEXT DEFAULT (datetime('now'))
)`);

/* ── ClamAV malware scan ─────────────────────────────────────── */

router.post('/scan', heavyLimit, async (req: Request, res: Response) => {
  const { target = WEBROOT } = req.body;
  const safePath = path.resolve(target.replace(/\.\./g, ''));
  // Reject shell metacharacters before interpolation. The previous form
  // resolved the path and prefix-checked it against WEBROOT, but the
  // result still landed inside `"${safePath}"` in a shell command, where
  // $() and backticks are expanded even inside double quotes — so a
  // target like "/var/www/$(rm -rf /)" passed the prefix check, kept
  // its command substitution intact, and ran as root once clamscan was
  // invoked.
  if (/[$`"'\\;&|<>\n*?(){}[\]!]/.test(safePath)) {
    return res.status(400).json({ error: 'Path contains invalid characters' });
  }
  if (!safePath.startsWith(path.resolve(WEBROOT)) && safePath !== WEBROOT) {
    return res.status(400).json({ error: 'Path outside webroot' });
  }

  try {
    // Check if clamav is available
    const which = await execAsync('which clamscan 2>/dev/null').catch(() => ({ stdout: '' }));
    if (!which.stdout.trim()) {
      return res.status(503).json({ error: 'ClamAV not installed. Install with: yum install clamav clamav-update' });
    }

    const { stdout, stderr } = await execAsync(
      `clamscan -r --infected --no-summary "${safePath}" 2>&1`,
      { timeout: 300000 }
    ).catch((e: any) => ({ stdout: e.stdout || '', stderr: e.stderr || '' }));

    const infected: string[] = [];
    const lines = (stdout + stderr).split('\n').filter(Boolean);
    for (const line of lines) {
      if (line.includes('FOUND')) infected.push(line.trim());
    }

    res.json({ target: safePath, infected_count: infected.length, infected, raw: lines.slice(-50) });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/update-definitions', heavyLimit, async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('freshclam 2>&1', { timeout: 120000 });
    res.json({ output: stdout });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

/* ── File integrity baseline ─────────────────────────────────── */

router.post('/integrity/baseline', heavyLimit, async (req: Request, res: Response) => {
  const { target = WEBROOT } = req.body;
  const safePath = path.resolve(target.replace(/\.\./g, ''));
  // Reject shell metacharacters before interpolation. The previous form
  // resolved the path and prefix-checked it against WEBROOT, but the
  // result still landed inside `"${safePath}"` in a shell command, where
  // $() and backticks are expanded even inside double quotes — so a
  // target like "/var/www/$(rm -rf /)" passed the prefix check, kept
  // its command substitution intact, and ran as root once clamscan was
  // invoked.
  if (/[$`"'\\;&|<>\n*?(){}[\]!]/.test(safePath)) {
    return res.status(400).json({ error: 'Path contains invalid characters' });
  }
  if (!safePath.startsWith(path.resolve(WEBROOT))) {
    return res.status(400).json({ error: 'Path outside webroot' });
  }
  try {
    const { stdout } = await execAsync(
      `find "${safePath}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | head -5000 | xargs sha256sum 2>/dev/null`,
      { timeout: 300000 }
    );
    // datetime("now") with double quotes is interpreted as an identifier
    // ("now" treated as a column name) — SQLite returns "no such column:
    // now" instead of the current timestamp. Use single quotes.
    const upsert = db.prepare("INSERT INTO file_hashes (file_path, sha256, last_checked) VALUES (?, ?, datetime('now')) ON CONFLICT(file_path) DO UPDATE SET sha256=excluded.sha256, last_checked=excluded.last_checked");
    const tx = db.transaction(() => {
      for (const line of stdout.split('\n').filter(Boolean)) {
        const parts = line.trim().split(/\s{2,}/);
        if (parts.length === 2) upsert.run(parts[1], parts[0]);
      }
    });
    tx();
    const count = (db.prepare('SELECT COUNT(*) as n FROM file_hashes WHERE file_path LIKE ?').get(`${safePath}%`) as any).n;
    res.json({ success: true, files_indexed: count });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/integrity/check', async (req: Request, res: Response) => {
  const target = (req.query.target as string) || WEBROOT;
  const safePath = path.resolve(target.replace(/\.\./g, ''));
  // Reject shell metacharacters before interpolation. The previous form
  // resolved the path and prefix-checked it against WEBROOT, but the
  // result still landed inside `"${safePath}"` in a shell command, where
  // $() and backticks are expanded even inside double quotes — so a
  // target like "/var/www/$(rm -rf /)" passed the prefix check, kept
  // its command substitution intact, and ran as root once clamscan was
  // invoked.
  if (/[$`"'\\;&|<>\n*?(){}[\]!]/.test(safePath)) {
    return res.status(400).json({ error: 'Path contains invalid characters' });
  }
  if (!safePath.startsWith(path.resolve(WEBROOT))) {
    return res.status(400).json({ error: 'Path outside webroot' });
  }

  try {
    const baseline = db.prepare('SELECT file_path, sha256 FROM file_hashes WHERE file_path LIKE ?').all(`${safePath}%`) as { file_path: string; sha256: string }[];
    if (baseline.length === 0) return res.json({ note: 'No baseline set for this path. Run /baseline first.', changed: [], missing: [], new_files: [] });

    const { stdout } = await execAsync(
      `find "${safePath}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | head -5000 | xargs sha256sum 2>/dev/null`,
      { timeout: 300000 }
    );

    const current: Record<string, string> = {};
    for (const line of stdout.split('\n').filter(Boolean)) {
      const parts = line.trim().split(/\s{2,}/);
      if (parts.length === 2) current[parts[1]] = parts[0];
    }

    const baselineMap: Record<string, string> = {};
    for (const b of baseline) baselineMap[b.file_path] = b.sha256;

    const changed = Object.keys(current).filter(f => baselineMap[f] && baselineMap[f] !== current[f]);
    const missing = Object.keys(baselineMap).filter(f => !current[f]);
    const newFiles = Object.keys(current).filter(f => !baselineMap[f]);

    res.json({ changed, missing, new_files: newFiles, total_baseline: baseline.length, total_current: Object.keys(current).length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/integrity/baseline', (_req: Request, res: Response) => {
  db.prepare('DELETE FROM file_hashes').run();
  res.json({ success: true });
});

export default router;
