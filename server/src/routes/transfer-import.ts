import { Router, Request, Response } from 'express';
import { existsSync, statSync } from 'fs';
import path from 'path';
import db from '../db';
import { runFile } from '../utils/process-runner';

const router = Router();
db.exec(`CREATE TABLE IF NOT EXISTS transfer_imports (id INTEGER PRIMARY KEY AUTOINCREMENT, archive_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'planned', report TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
function safeArchive(p: string) { const full = path.resolve(p || ''); return (full.startsWith('/root/') || full.startsWith('/home/') || full.startsWith('/var/backups/')) && /\.(tar\.gz|tgz|tar)$/.test(full); }
router.get('/', (_req: Request, res: Response) => res.json(db.prepare('SELECT * FROM transfer_imports ORDER BY created_at DESC').all().map((r:any)=>({...r, report: JSON.parse(r.report||'{}')}))));
router.post('/inspect', async (req: Request, res: Response) => { const archivePath = String(req.body?.archivePath || ''); if (!safeArchive(archivePath)) return res.status(400).json({ error: 'Archive path must be a .tar/.tar.gz/.tgz under /root, /home or /var/backups' }); if (!existsSync(archivePath)) return res.status(404).json({ error: 'Archive not found' }); const list = await runFile('tar', ['-tf', archivePath], { timeout: 120000 }).catch((e:any)=>({ stdout:'', stderr:e.message })); const files = list.stdout.split('\n').filter(Boolean).slice(0, 500); const report = { archivePath, size: statSync(archivePath).size, filesScanned: files.length, hasCpbackup: files.some(f=>f.includes('cpbackup') || f.includes('cpmove')), domains: files.filter(f=>/userdata\/.*\.com/.test(f)).slice(0,20), databases: files.filter(f=>/mysql\/.*\.sql/.test(f)).slice(0,20), dryRunOnly: true, stderr: list.stderr }; const r = db.prepare('INSERT INTO transfer_imports (archive_path,status,report) VALUES (?,?,?)').run(archivePath, 'inspected', JSON.stringify(report)); res.json({ id: r.lastInsertRowid, report }); });
router.post('/:id/execute', (_req: Request, res: Response) => res.status(409).json({ error: 'Import execution is intentionally gated. Review dry-run report and enable per-section restore in a future guarded release.' }));
export default router;
