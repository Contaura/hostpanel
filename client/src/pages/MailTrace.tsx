import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Search, Download, Mail, RefreshCw, Filter } from 'lucide-react';
import { fetchApi, openAuthenticatedDownload } from '../lib/api';
import { useToast } from '../components/Toast';

export default function MailTrace() {
  const toast = useToast();

  // Filters
  const [sender, setSender]       = useState('');
  const [recipient, setRecipient] = useState('');
  const [queueId, setQueueId]     = useState('');
  const [status, setStatus]       = useState('');
  const [from, setFrom]           = useState('');
  const [to, setTo]               = useState('');

  // Data
  const [events, setEvents]     = useState<any[]>([]);
  const [stats, setStats]       = useState<any>(null);
  const [loading, setLoading]   = useState(false);
  const [tab, setTab]           = useState<'search' | 'stats'>('search');

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (sender)    p.set('sender', sender);
    if (recipient) p.set('recipient', recipient);
    if (queueId)   p.set('queueId', queueId);
    if (status)    p.set('status', status);
    if (from)      p.set('from', from);
    if (to)        p.set('to', to);
    p.set('limit', '200');
    return '?' + p.toString();
  }, [sender, recipient, queueId, status, from, to]);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchApi(`/api/mail-trace/search${qs()}`);
      const d = await r.json();
      if (d.error) toast.error(d.error);
      else setEvents(d.events || []);
    } catch (err: any) { toast.error(err.message || 'Failed to search'); }
    setLoading(false);
  }, [qs, toast]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (from) p.set('from', from);
      if (to)   p.set('to', to);
      const q = p.toString() ? '?' + p.toString() : '';
      const r = await fetchApi(`/api/mail-trace/stats${q}`);
      const d = await r.json();
      if (d.error) toast.error(d.error);
      else setStats(d);
    } catch (err: any) { toast.error(err.message || 'Failed to load stats'); }
    setLoading(false);
  }, [from, to, toast]);

  useEffect(() => {
    document.title = 'Mail Trace — HostPanel';
    search();
    return () => { document.title = 'HostPanel'; };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const statusColors: Record<string, string> = {
    sent: 'text-emerald-600', bounced: 'text-red-500', deferred: 'text-amber-500',
    rejected: 'text-red-600', expired: 'text-orange-500',
  };

  const statusData = stats
    ? Object.entries(stats.byStatus || {}).map(([st, count]) => ({ st, count: Number(count) }))
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Mail Trace</h1>
          <p className="page-subtitle">Search and analyse Postfix mail delivery events</p>
        </div>
        <button className="btn-secondary flex gap-1 items-center text-sm"
          onClick={() => openAuthenticatedDownload(`/api/mail-trace/export${qs()}`, { filename: 'mail-trace.csv' })}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        <button className={tab === 'search' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('search')}>
          <Search size={13} /> Search Events
        </button>
        <button className={tab === 'stats' ? 'tab-item-active' : 'tab-item'} onClick={() => { setTab('stats'); loadStats(); }}>
          <Mail size={13} /> Delivery Stats
        </button>
      </div>

      {/* Shared date filter */}
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <Filter size={13} className="text-slate-400" />
        <input type="date" className="input w-36 text-sm" value={from} onChange={e => setFrom(e.target.value)} />
        <span className="text-slate-400">–</span>
        <input type="date" className="input w-36 text-sm" value={to} onChange={e => setTo(e.target.value)} />
      </div>

      {/* Search tab */}
      {tab === 'search' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="grid md:grid-cols-4 gap-3">
              <input className="input" placeholder="Sender" value={sender} onChange={e => setSender(e.target.value)} />
              <input className="input" placeholder="Recipient" value={recipient} onChange={e => setRecipient(e.target.value)} />
              <input className="input" placeholder="Queue ID" value={queueId} onChange={e => setQueueId(e.target.value)} />
              <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
                <option value="">Any status</option>
                {['sent','bounced','deferred','rejected','expired'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <button className="btn-primary flex gap-1 items-center" onClick={search} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Search
            </button>
          </div>

          <div className="card divide-y divide-slate-100 dark:divide-slate-800">
            {events.length === 0 && !loading && (
              <p className="p-6 text-sm text-slate-400 text-center">No events found — adjust filters and search.</p>
            )}
            {events.map((e, i) => (
              <div key={i} className="p-3 grid md:grid-cols-6 gap-2 text-xs items-start">
                <span className="font-mono text-slate-400 col-span-1">{e.timestamp}</span>
                <span className="font-mono text-indigo-500 col-span-1">{e.queueId}</span>
                <span className="col-span-1 truncate">{e.sender || '—'}</span>
                <span className="col-span-1 truncate">{e.recipient || '—'}</span>
                <span className={`font-semibold col-span-1 ${statusColors[e.status || ''] || 'text-slate-500'}`}>{e.status || '—'}</span>
                <span className="text-slate-500 col-span-1 truncate">{e.diagnostic || e.relay || ''}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400">{events.length} events shown (max 200)</p>
        </div>
      )}

      {/* Stats tab */}
      {tab === 'stats' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total', value: stats?.total ?? '—' },
              { label: 'Sent', value: stats?.byStatus?.sent ?? '—' },
              { label: 'Bounced', value: stats?.byStatus?.bounced ?? '—' },
              { label: 'Deferred', value: stats?.byStatus?.deferred ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="card p-4">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{String(value)}</div>
              </div>
            ))}
          </div>

          {statusData.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Delivery Status Breakdown</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statusData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="st" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" name="Count" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">Top Senders</h2>
              <div className="space-y-1 max-h-48 overflow-auto">
                {(stats?.topSenders || []).map((s: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-400 truncate">{s.key}</span>
                    <span className="font-medium ml-2 shrink-0">{s.count}</span>
                  </div>
                ))}
                {!stats?.topSenders?.length && <p className="text-sm text-slate-400">No data</p>}
              </div>
            </div>
            <div className="card p-5">
              <h2 className="text-sm font-semibold mb-2 text-slate-700 dark:text-slate-300">Top Recipient Domains</h2>
              <div className="space-y-1 max-h-48 overflow-auto">
                {(stats?.topDomains || []).map((d: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-400">{d.key}</span>
                    <span className="font-medium ml-2 shrink-0">{d.count}</span>
                  </div>
                ))}
                {!stats?.topDomains?.length && <p className="text-sm text-slate-400">No data</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
