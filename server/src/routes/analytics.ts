import { Router, Request, Response } from 'express';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';

const router = Router();
const accessLogs = () => [process.env.ACCESS_LOG_FILE || '/var/log/httpd/access_log', '/var/log/apache2/access.log'].filter((v, i, a) => v && a.indexOf(v) === i);
const errorLogs = () => [process.env.ERROR_LOG_FILE || '/var/log/httpd/error_log', '/var/log/apache2/error.log'].filter((v, i, a) => v && a.indexOf(v) === i);

type Access = { ip: string; date: string; method: string; url: string; status: string; bytes: number; referrer: string; agent: string; raw: string };
function parseAccess(line: string): Access | null {
  const m = line.match(/^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) ([^"\s]+)[^"]*" (\d{3}) (\S+) "([^"]*)" "([^"]*)"/);
  if (!m) return null;
  return { ip: m[1], date: m[2], method: m[3], url: m[4], status: m[5], bytes: m[6] === '-' ? 0 : Number(m[6]), referrer: m[7], agent: m[8], raw: line };
}
function lines(files: string[]) { return files.flatMap(f => existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []); }
function access() { return lines(accessLogs()).map(parseAccess).filter(Boolean) as Access[]; }
function top<T extends string>(vals: T[]) { const m: Record<string, number> = {}; vals.forEach(v => { m[v] = (m[v] || 0) + 1; }); return Object.entries(m).map(([key, hits]) => ({ [key.includes('/') ? 'path' : 'value']: key, hits })); }

router.get('/visitors', (_req: Request, res: Response) => {
  const rows = access();
  res.json({ hits: rows.length, topPages: top(rows.map(r => r.url)).sort((a: any, b: any) => b.hits - a.hits), topIps: top(rows.map(r => r.ip)), statusCodes: rows.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}), referrers: top(rows.map(r => r.referrer).filter(r => r && r !== '-')), userAgents: top(rows.map(r => r.agent).filter(Boolean)) });
});
router.get('/errors', (_req: Request, res: Response) => {
  const rows = access(); const httpStatuses = rows.filter(r => Number(r.status) >= 400).reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  res.json({ httpStatuses, errorLog: lines(errorLogs()).slice(-200).reverse() });
});
router.get('/bandwidth', (_req: Request, res: Response) => {
  const rows = access(); const byDay: Record<string, number> = {}; rows.forEach(r => { const day = r.date.split(':')[0]; byDay[day] = (byDay[day] || 0) + r.bytes; });
  res.json({ totalBytes: rows.reduce((s, r) => s + r.bytes, 0), byDay });
});
router.get('/raw-access', (_req: Request, res: Response) => {
  const files = accessLogs().filter(existsSync).map(f => ({ name: path.basename(f), path: f, size: statSync(f).size }));
  res.json({ files });
});
router.get('/raw-access/:name/download', (req: Request, res: Response) => {
  const file = accessLogs().find(f => path.basename(f) === req.params.name && existsSync(f));
  if (!file) return res.status(404).json({ error: 'Log not found' });
  res.download(file);
});
router.get('/awstats', (_req: Request, res: Response) => {
  const rows = access(); const unique = new Set(rows.map(r => r.ip)).size;
  res.json({ source: 'hostpanel-log-summary', summary: { visits: rows.length, uniqueVisitors: unique, bandwidth: rows.reduce((s, r) => s + r.bytes, 0), errors: rows.filter(r => Number(r.status) >= 400).length } });
});

export default router;
