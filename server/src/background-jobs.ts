import db from './db';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

db.exec(`CREATE TABLE IF NOT EXISTS background_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  resource TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  logs TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export function serializeJob(row: any) {
  return {
    ...row,
    metadata: parseJson(row.metadata, {}),
    result: parseJson(row.result, {}),
    logs: parseJson(row.logs, []),
  };
}

export function getJob(id: number) {
  const row = db.prepare('SELECT * FROM background_jobs WHERE id=?').get(id) as any;
  return row ? serializeJob(row) : null;
}

export function listJobs(filters: { status?: string; type?: string } = {}) {
  const where: string[] = [];
  const args: any[] = [];
  if (filters.status) { where.push('status=?'); args.push(filters.status); }
  if (filters.type) { where.push('type=?'); args.push(filters.type); }
  const sql = `SELECT * FROM background_jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 200`;
  return (db.prepare(sql).all(...args) as any[]).map(serializeJob);
}

function updateJob(id: number, patch: Partial<{ status: JobStatus; progress: number; result: any; error: string; started_at: string; completed_at: string; logs: any[] }>) {
  const sets: string[] = ['updated_at=datetime(\'now\')'];
  const args: any[] = [];
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key}=?`);
    args.push(key === 'result' || key === 'logs' ? JSON.stringify(value) : value);
  }
  args.push(id);
  db.prepare(`UPDATE background_jobs SET ${sets.join(', ')} WHERE id=?`).run(...args);
}

export type JobContext = {
  id: number;
  log: (message: string, detail?: any) => void;
  progress: (percent: number, message?: string) => void;
};

export function appendJobLog(id: number, message: string, detail: any = {}) {
  const row = db.prepare('SELECT logs FROM background_jobs WHERE id=?').get(id) as any;
  if (!row) return;
  const logs = parseJson<any[]>(row.logs, []);
  logs.push({ at: new Date().toISOString(), message, detail });
  updateJob(id, { logs });
}

export function setJobProgress(id: number, progress: number, message?: string) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  updateJob(id, { progress: pct });
  if (message) appendJobLog(id, message, { progress: pct });
}

export function createBackgroundJob<T>(opts: { type: string; resource?: string; metadata?: any; createdBy?: string }, work: (ctx: JobContext) => Promise<T>): number {
  const r: any = db.prepare(`INSERT INTO background_jobs (type,status,resource,metadata,created_by,updated_at) VALUES (?,?,?,?,?,datetime('now'))`).run(
    opts.type,
    'queued',
    opts.resource || '',
    JSON.stringify(opts.metadata || {}),
    opts.createdBy || 'system',
  );
  const id = Number(r.lastInsertRowid);
  const ctx: JobContext = {
    id,
    log: (message, detail = {}) => appendJobLog(id, message, detail),
    progress: (percent, message) => setJobProgress(id, percent, message),
  };
  setImmediate(async () => {
    try {
      updateJob(id, { status: 'running', started_at: new Date().toISOString(), progress: 1 });
      appendJobLog(id, 'Job started');
      const result = await work(ctx);
      updateJob(id, { status: 'completed', progress: 100, result: result ?? {}, completed_at: new Date().toISOString() });
      appendJobLog(id, 'Job completed');
    } catch (err: any) {
      updateJob(id, { status: 'failed', error: err?.message || String(err), completed_at: new Date().toISOString() });
      appendJobLog(id, 'Job failed', { error: err?.message || String(err) });
    }
  });
  return id;
}
