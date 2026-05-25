import { Router, Request, Response } from 'express';
import { existsSync, readFileSync } from 'fs';

const router = Router();
const DEFAULT_LOGS = ['/var/log/maillog', '/var/log/mail.log'];

type Event = { timestamp: string; queueId: string; sender?: string; recipient?: string; status?: string; relay?: string; delay?: string; diagnostic?: string; raw: string };

function logFile() { return process.env.MAIL_LOG_FILE || DEFAULT_LOGS.find(existsSync) || DEFAULT_LOGS[0]; }
function readLines() { const f = logFile(); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []; }
function field(line: string, re: RegExp) { return line.match(re)?.[1]; }
function timestamp(line: string) { return line.slice(0, 15).trim(); }

function parseEvents(lines: string[]): Event[] {
  const senders = new Map<string, string>();
  for (const line of lines) {
    const q = field(line, /:\s*([A-Z0-9]+):\s/);
    const from = field(line, /from=<([^>]*)>/);
    if (q && from) senders.set(q, from);
  }
  return lines.map(line => {
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

router.get('/search', (req: Request, res: Response) => {
  const { sender, recipient, queueId, status } = req.query as Record<string, string>;
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 1000);
  let events = parseEvents(readLines());
  if (sender) events = events.filter(e => e.sender?.toLowerCase().includes(sender.toLowerCase()));
  if (recipient) events = events.filter(e => e.recipient?.toLowerCase().includes(recipient.toLowerCase()));
  if (queueId) events = events.filter(e => e.queueId.toLowerCase() === queueId.toLowerCase());
  if (status) events = events.filter(e => e.status?.toLowerCase() === status.toLowerCase());
  res.json({ source: logFile(), events: events.slice(-limit).reverse() });
});

export default router;
