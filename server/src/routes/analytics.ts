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

/** Parse Apache Combined Log date format: "25/May/2026:10:00:00 +0000" → ISO */
function apacheToIso(dateStr: string): string {
  const m = dateStr.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return dateStr;
  const months: Record<string, string> = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  return `${m[3]}-${months[m[2]] || '01'}-${m[1]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

function filterByDate(rows: Access[], from?: string, to?: string): Access[] {
  if (!from && !to) return rows;
  return rows.filter(r => {
    const iso = apacheToIso(r.date);
    if (from && iso < from) return false;
    if (to) {
      // to is inclusive: extend to end of day if no time given
      const toVal = to.length === 10 ? `${to}T23:59:59Z` : to;
      if (iso > toVal) return false;
    }
    return true;
  });
}

function filterByDomain(rows: Access[], domain?: string): Access[] {
  if (!domain) return rows;
  const prefix = `/${domain}/`;
  return rows.filter(r => r.url === `/${domain}` || r.url.startsWith(prefix));
}

function getFilters(query: Record<string, string>) {
  return { from: query.from || undefined, to: query.to || undefined, domain: query.domain || undefined };
}

router.get('/visitors', (req: Request, res: Response) => {
  const { from, to, domain } = getFilters(req.query as Record<string, string>);
  const rows = filterByDate(filterByDomain(access(), domain), from, to);
  res.json({ hits: rows.length, topPages: top(rows.map(r => r.url)).sort((a: any, b: any) => b.hits - a.hits), topIps: top(rows.map(r => r.ip)), statusCodes: rows.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}), referrers: top(rows.map(r => r.referrer).filter(r => r && r !== '-')), userAgents: top(rows.map(r => r.agent).filter(Boolean)) });
});

router.get('/errors', (req: Request, res: Response) => {
  const { from, to, domain } = getFilters(req.query as Record<string, string>);
  const rows = filterByDate(filterByDomain(access(), domain), from, to);
  const httpStatuses = rows.filter(r => Number(r.status) >= 400).reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
  res.json({ httpStatuses, errorLog: lines(errorLogs()).slice(-200).reverse() });
});

router.get('/bandwidth', (req: Request, res: Response) => {
  const { from, to, domain } = getFilters(req.query as Record<string, string>);
  const rows = filterByDate(filterByDomain(access(), domain), from, to);
  const byDay: Record<string, number> = {};
  rows.forEach(r => { const day = r.date.split(':')[0]; byDay[day] = (byDay[day] || 0) + r.bytes; });
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

router.get('/awstats', (req: Request, res: Response) => {
  const { from, to } = getFilters(req.query as Record<string, string>);
  const rows = filterByDate(access(), from, to);
  const unique = new Set(rows.map(r => r.ip)).size;
  res.json({ source: 'hostpanel-log-summary', summary: { visits: rows.length, uniqueVisitors: unique, bandwidth: rows.reduce((s, r) => s + r.bytes, 0), errors: rows.filter(r => Number(r.status) >= 400).length } });
});

/** Time-series: group visits/bytes by hour or day, chart-ready */
router.get('/timeseries', (req: Request, res: Response) => {
  const { from, to } = getFilters(req.query as Record<string, string>);
  const interval = (req.query.interval as string) === 'hour' ? 'hour' : 'day';
  const rows = filterByDate(access(), from, to);
  const buckets: Record<string, { hits: number; bytes: number; errors: number }> = {};
  for (const r of rows) {
    const iso = apacheToIso(r.date);
    const key = interval === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10);
    if (!buckets[key]) buckets[key] = { hits: 0, bytes: 0, errors: 0 };
    buckets[key].hits++;
    buckets[key].bytes += r.bytes;
    if (Number(r.status) >= 400) buckets[key].errors++;
  }
  const points = Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([time, v]) => ({ time, ...v }));
  res.json({ interval, from: from || null, to: to || null, points });
});

/** Top paths: filterable, sortable by hits */
router.get('/top-paths', (req: Request, res: Response) => {
  const { from, to, domain } = getFilters(req.query as Record<string, string>);
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 500);
  const rows = filterByDate(filterByDomain(access(), domain), from, to);
  const paths = top(rows.map(r => r.url)).sort((a: any, b: any) => b.hits - a.hits).slice(0, limit);
  res.json({ total: rows.length, paths });
});

/** CSV export of filtered access log entries */
router.get('/export', (req: Request, res: Response) => {
  const { from, to, domain } = getFilters(req.query as Record<string, string>);
  const rows = filterByDate(filterByDomain(access(), domain), from, to);
  const limit = Math.min(Math.max(Number(req.query.limit || 50000), 1), 100000);
  const header = 'ip,date,method,url,status,bytes,referrer,agent\n';
  const csvEscape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const body = rows.slice(-limit).map(r =>
    [r.ip, csvEscape(r.date), r.method, csvEscape(r.url), r.status, r.bytes, csvEscape(r.referrer), csvEscape(r.agent)].join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="access-${Date.now()}.csv"`);
  res.send(header + body);
});

export default router;
