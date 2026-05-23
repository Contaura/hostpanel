import { Fragment, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useToast } from '../components/Toast';
import { fetchApi } from '../lib/api';

interface RspamdStatus {
  installed: boolean;
  running: boolean;
  version?: string | null;
  uptime?: number | null;
  scanned?: number | null;
  learned?: number | null;
  actions?: Record<string, number> | null;
  connections?: number | null;
  error?: string;
}
interface HistoryRow {
  unix_time: number;
  time?: string;
  ip?: string;
  user?: string;
  sender_mime?: string;
  rcpt_mime?: string[];
  action: string;
  score: number;
  required_score: number;
  subject?: string;
  symbols?: Record<string, { score?: number; name?: string }>;
}

const ACTION_STYLE: Record<string, string> = {
  'no action':       'badge-success',
  'greylist':        'badge-info',
  'add header':      'badge-warning',
  'rewrite subject': 'badge-warning',
  'soft reject':     'badge-warning',
  'reject':          'badge-danger',
};

function formatUptime(s: number | null | undefined): string {
  if (!s || s < 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

export default function SpamFilter() {
  const toast = useToast();
  const [status, setStatus]   = useState<RspamdStatus | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        fetchApi('/api/rspamd/status').then(r => r.json()),
        fetchApi('/api/rspamd/history').then(r => r.json()).catch(() => ({ rows: [] })),
      ]);
      setStatus(s);
      setHistory(Array.isArray(h?.rows) ? h.rows : []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load Rspamd status');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    document.title = 'Spam Filter — HostPanel';
    load();
    return () => { document.title = 'HostPanel'; };
  }, []);

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (!status?.installed) {
    return (
      <div className="card p-6 flex items-start gap-3">
        <AlertCircle className="text-amber-500 shrink-0" size={20} />
        <div>
          <p className="font-medium">Rspamd is not installed</p>
          <p className="text-sm text-slate-500 mt-1">
            Re-run <code className="font-mono">install.sh</code> or <code className="font-mono">dnf install rspamd redis</code> to enable spam filtering.
          </p>
        </div>
      </div>
    );
  }

  const actions = status.actions || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Spam Filter</h1>
        <button className="btn-ghost" onClick={load}><RefreshCw size={14} /></button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Status"      value={status.running ? 'Running' : 'Stopped'} accent={status.running ? 'bg-emerald-500' : 'bg-red-500'} />
        <Stat label="Version"     value={status.version ?? '—'} />
        <Stat label="Uptime"      value={formatUptime(status.uptime)} />
        <Stat label="Scanned"     value={(status.scanned ?? 0).toLocaleString()} />
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><ShieldAlert size={14} /> Actions taken</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {[
            ['no action',       'Clean',    'text-emerald-500'],
            ['greylist',        'Greylist', 'text-blue-500'],
            ['add header',      'Tagged',   'text-amber-500'],
            ['rewrite subject', 'Rewritten','text-amber-500'],
            ['reject',          'Rejected', 'text-red-500'],
          ].map(([k, label, color]) => (
            <div key={k} className="bg-slate-50 dark:bg-slate-800/50 rounded-md p-3">
              <p className={`text-2xl font-bold ${color}`}>{(actions[k] ?? 0).toLocaleString()}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">Recent scans</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['', 'Time', 'From', 'To', 'Subject', 'Score', 'Action'].map(h => (
                  <th key={h} className="table-header-cell">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={7} className="table-cell text-center text-slate-500 py-6">No scan history yet — mail through this server will appear here.</td></tr>
              )}
              {history.map((row, i) => {
                const open = expanded === i;
                const ts = new Date((row.unix_time || 0) * 1000);
                const symbolEntries = Object.entries(row.symbols || {});
                return (
                  <Fragment key={i}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => setExpanded(open ? null : i)}>
                      <td className="table-cell w-6">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="table-cell text-xs text-slate-500">{ts.toLocaleString()}</td>
                      <td className="table-cell text-xs">{row.sender_mime || '—'}</td>
                      <td className="table-cell text-xs">{(row.rcpt_mime || []).slice(0, 2).join(', ')}{(row.rcpt_mime || []).length > 2 ? '…' : ''}</td>
                      <td className="table-cell text-xs truncate max-w-[260px]">{row.subject || ''}</td>
                      <td className="table-cell text-xs font-mono">{row.score?.toFixed(1) ?? '0.0'} / {row.required_score?.toFixed(1) ?? '15.0'}</td>
                      <td className="table-cell"><span className={ACTION_STYLE[row.action] || 'badge-info'}>{row.action}</span></td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-50/50 dark:bg-slate-800/30">
                        <td colSpan={7} className="px-4 py-3">
                          <p className="text-xs text-slate-500 mb-2">IP: {row.ip || '—'} · User: {row.user || '—'}</p>
                          {symbolEntries.length === 0 && <p className="text-xs text-slate-400">No symbols recorded.</p>}
                          <div className="flex flex-wrap gap-1.5">
                            {symbolEntries.map(([k, v]) => (
                              <span key={k} className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700">
                                {k} {typeof v?.score === 'number' ? `(${v.score > 0 ? '+' : ''}${v.score.toFixed(1)})` : ''}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500">Full Rspamd controller UI at <code className="font-mono">http://127.0.0.1:11334/</code> on the server (loopback only).</p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="card flex items-center gap-4">
      {accent && <div className={`w-3 h-3 rounded-full ${accent}`} />}
      <div>
        <p className="text-xl font-semibold">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}
