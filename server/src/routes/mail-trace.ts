import { Router, Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';

const router = Router();
const DEFAULT_LOGS = ['/var/log/maillog', '/var/log/mail.log'];

type Event = { timestamp: string; queueId: string; sender?: string; recipient?: string; status?: string; relay?: string; delay?: string; diagnostic?: string; raw: string };

function logFile() { return process.env.MAIL_LOG_FILE || DEFAULT_LOGS.find(existsSync) || DEFAULT_LOGS[0]; }
function readLines() { const f = logFile(); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []; }
function field(line: string, re: RegExp) { return line.match(re)?.[1]; }
function timestamp(line: string) { return line.slice(0, 15).trim(); }

/**
 * Convert syslog timestamp (e.g. "May 25 10:01:02") to a rough ISO prefix
 * so we can do date-range comparisons. Year is taken from current year.
 */
const MONTH_MAP: Record<string, string> = {
  Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'
};
function syslogToIso(ts: string): string {
  const m = ts.match(/^(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})/);
  if (!m) return '';
  const year = new Date().getFullYear();
  const month = MONTH_MAP[m[1]] || '01';
  const day = m[2].padStart(2, '0');
  return `${year}-${month}-${day}T${m[3]}Z`;
}

function parseEvents(logLines: string[]): Event[] {
  const senders = new Map<string, string>();
  for (const line of logLines) {
    const q = field(line, /:\s*([A-Z0-9]+):\s/);
    const from = field(line, /from=<([^>]*)>/);
    if (q && from) senders.set(q, from);
  }
  return logLines.map(line => {
    const queueId = field(line, /:\s*([A-Z0-9]+):\s/);
    if (!queueId) return null;
    const sender = field(line, /from=<([^>]*)>/) || senders.get(queueId);
    const recipient = field(line, /to=<([^>]*)>/);
    const status = field(line, /status=([a-zA-Z0-9_-]+)/);
    const relay = field(line, /relay=([^,]+)/);
    const delay = field(line, /delay=([^,]+)/);
    const diagnostic = field(line, /status=[a-zA-Z0-9_-]+\s*\((.*)\)/);
    if (!recipient && !status) return null;
    return { timestamp: timestamp(line), queueId, sender, recipient, status, relay, delay, diagnostic, raw: line };
  }).filter(Boolean) as Event[];
}

function filterEventsByDate(events: Event[], from?: string, to?: string): Event[] {
  if (!from && !to) return events;
  return events.filter(e => {
    const iso = syslogToIso(e.timestamp);
    if (!iso) return true; // unparseable timestamps pass through
    if (from && iso < from) return false;
    if (to) {
      const toVal = to.length === 10 ? `${to}T23:59:59Z` : to;
      if (iso > toVal) return false;
    }
    return true;
  });
}

router.get('/search', (req: Request, res: Response) => {
  const { sender, recipient, queueId, status, from, to } = req.query as Record<string, string>;
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000);
  let events = parseEvents(readLines());
  events = filterEventsByDate(events, from, to);
  if (sender) events = events.filter(e => e.sender?.toLowerCase().includes(sender.toLowerCase()));
  if (recipient) events = events.filter(e => e.recipient?.toLowerCase().includes(recipient.toLowerCase()));
  if (queueId) events = events.filter(e => e.queueId.toLowerCase() === queueId.toLowerCase());
  if (status) events = events.filter(e => e.status?.toLowerCase() === status.toLowerCase());
  res.json({ source: logFile(), events: events.slice(-limit).reverse() });
});

/** Delivery stats: counts by status, top senders, top recipients, top domains */
router.get('/stats', (req: Request, res: Response) => {
  const { from, to } = req.query as Record<string, string>;
  let events = parseEvents(readLines());
  events = filterEventsByDate(events, from, to);

  const byStatus: Record<string, number> = {};
  const senderCounts: Record<string, number> = {};
  const recipientCounts: Record<string, number> = {};
  const domainCounts: Record<string, number> = {};

  for (const e of events) {
    if (!e.recipient) continue; // only delivery events have recipients
    const st = e.status || 'unknown';
    byStatus[st] = (byStatus[st] || 0) + 1;
    if (e.sender) { senderCounts[e.sender] = (senderCounts[e.sender] || 0) + 1; }
    recipientCounts[e.recipient] = (recipientCounts[e.recipient] || 0) + 1;
    const domain = e.recipient.split('@')[1];
    if (domain) domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  }

  function topN(map: Record<string, number>, n = 20) {
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, n).map(([key, count]) => ({ key, count }));
  }

  const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
  res.json({ total, byStatus, topSenders: topN(senderCounts), topRecipients: topN(recipientCounts), topDomains: topN(domainCounts) });
});

/** CSV export of filtered mail trace events */
router.get('/export', (req: Request, res: Response) => {
  const { sender, recipient, queueId, status, from, to } = req.query as Record<string, string>;
  const limit = Math.min(Math.max(Number(req.query.limit || 50000), 1), 100000);
  let events = parseEvents(readLines());
  events = filterEventsByDate(events, from, to);
  if (sender) events = events.filter(e => e.sender?.toLowerCase().includes(sender.toLowerCase()));
  if (recipient) events = events.filter(e => e.recipient?.toLowerCase().includes(recipient.toLowerCase()));
  if (queueId) events = events.filter(e => e.queueId.toLowerCase() === queueId.toLowerCase());
  if (status) events = events.filter(e => e.status?.toLowerCase() === status.toLowerCase());

  const csvEscape = (s?: string) => `"${(s || '').replace(/"/g, '""')}"`;
  const header = 'timestamp,queueId,sender,recipient,status,relay,delay,diagnostic\n';
  const body = events.slice(-limit).map(e =>
    [csvEscape(e.timestamp), csvEscape(e.queueId), csvEscape(e.sender), csvEscape(e.recipient), csvEscape(e.status), csvEscape(e.relay), csvEscape(e.delay), csvEscape(e.diagnostic)].join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="mail-trace-${Date.now()}.csv"`);
  res.send(header + body);
});

export default router;
