import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { BarChart2, TrendingUp, AlertTriangle, Download, RefreshCw, Filter } from 'lucide-react';
import { fetchApi, openAuthenticatedDownload } from '../lib/api';
import { useToast } from '../components/Toast';

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899'];

function formatBytes(b: number) {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(2) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB';
  return b + ' B';
}

export default function Analytics() {
  const toast = useToast();
  const [tab, setTab] = useState<'overview' | 'timeseries' | 'paths' | 'errors' | 'mail'>('overview');

  // Filters
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');
  const [interval, setInterval] = useState<'day' | 'hour'>('day');

  // Data
  const [visitors, setVisitors]     = useState<any>(null);
  const [bandwidth, setBandwidth]   = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [topPaths, setTopPaths]     = useState<any[]>([]);
  const [errors, setErrors]         = useState<any>(null);
  const [mailStats, setMailStats]   = useState<any>(null);
  const [rawLogs, setRawLogs]       = useState<any[]>([]);
  const [loading, setLoading]       = useState(false);

  const qs = useCallback(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to)   p.set('to', to);
    return p.toString() ? '?' + p.toString() : '';
  }, [from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = qs();
      const [v, bw, ts, tp, e, ms, raw] = await Promise.all([
        fetchApi(`/api/analytics/visitors${q}`).then(r => r.json()),
        fetchApi(`/api/analytics/bandwidth${q}`).then(r => r.json()),
        fetchApi(`/api/analytics/timeseries?interval=${interval}${q ? q.replace('?','&') : ''}`).then(r => r.json()),
        fetchApi(`/api/analytics/top-paths?limit=20${q ? q.replace('?','&') : ''}`).then(r => r.json()),
        fetchApi(`/api/analytics/errors${q}`).then(r => r.json()),
        fetchApi(`/api/mail-trace/stats${q}`).then(r => r.json()).catch(() => null),
        fetchApi('/api/analytics/raw-access').then(r => r.json()),
      ]);
      setVisitors(v);
      setBandwidth(bw);
      setTimeseries((ts.points || []).map((p: any) => ({ ...p, bytes: Number(p.bytes) })));
      setTopPaths(tp.paths || []);
      setErrors(e);
      setMailStats(ms);
      setRawLogs(raw.files || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load analytics');
    }
    setLoading(false);
  }, [qs, interval, toast]);

  useEffect(() => {
    document.title = 'Analytics — HostPanel';
    load();
    return () => { document.title = 'HostPanel'; };
  }, [load]);

  const statusData = visitors
    ? Object.entries(visitors.statusCodes || {}).map(([code, hits]) => ({ code, hits: Number(hits) }))
    : [];
  const mailStatusData = mailStats
    ? Object.entries(mailStats.byStatus || {}).map(([st, count]) => ({ st, count: Number(count) }))
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Web traffic, bandwidth, error rates, and mail delivery stats</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Filter size={14} className="text-slate-400" />
          <input type="date" className="input w-36 text-sm" value={from} onChange={e => setFrom(e.target.value)} placeholder="From" />
          <input type="date" className="input w-36 text-sm" value={to} onChange={e => setTo(e.target.value)} placeholder="To" />
          <button className="btn-secondary flex gap-1 items-center" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Apply
          </button>
          {rawLogs[0] && (
            <button className="btn-secondary flex gap-1 items-center text-sm"
              onClick={() => openAuthenticatedDownload(
                `/api/analytics/export${qs()}`,
                { filename: `access-export.csv` }
              )}>
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Hits', value: visitors?.hits ?? '—', icon: <BarChart2 size={16} /> },
          { label: 'Bandwidth', value: bandwidth ? formatBytes(bandwidth.totalBytes) : '—', icon: <TrendingUp size={16} /> },
          { label: 'HTTP Errors', value: errors ? Object.values(errors.httpStatuses || {}).reduce((a: number, b) => a + Number(b), 0) : '—', icon: <AlertTriangle size={16} /> },
          { label: 'Unique IPs', value: visitors ? new Set(visitors.topIps?.map((x: any) => x.value)).size : '—', icon: <BarChart2 size={16} /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="card p-4 flex items-center gap-3">
            <span className="text-indigo-500">{icon}</span>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
              <div className="text-lg font-bold text-slate-900 dark:text-slate-100">{String(value)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {(['overview','timeseries','paths','errors','mail'] as const).map(t => (
          <button key={t} className={tab === t ? 'tab-item-active' : 'tab-item'} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Hits over time</h2>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timeseries}>
                <defs>
                  <linearGradient id="hits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="hits" stroke="#6366f1" fill="url(#hits)" name="Hits" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Status codes pie */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">HTTP Status Codes</h2>
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={statusData} dataKey="hits" nameKey="code" cx="50%" cy="50%" outerRadius={70} label={({ code, hits }) => `${code}: ${hits}`}>
                      {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-slate-400">No data</p>}
            </div>

            {/* Top IPs */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Top IPs</h2>
              <div className="space-y-1 max-h-44 overflow-auto">
                {(visitors?.topIps || []).slice(0, 10).map((item: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400 font-mono text-xs">{item.value}</span>
                    <span className="font-medium">{item.hits}</span>
                  </div>
                ))}
                {!(visitors?.topIps?.length) && <p className="text-sm text-slate-400">No data</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Timeseries tab */}
      {tab === 'timeseries' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button className={`btn-secondary text-xs ${interval === 'day' ? 'ring-2 ring-indigo-500' : ''}`} onClick={() => setInterval('day')}>By Day</button>
            <button className={`btn-secondary text-xs ${interval === 'hour' ? 'ring-2 ring-indigo-500' : ''}`} onClick={() => setInterval('hour')}>By Hour</button>
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Hits & Errors over time</h2>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={timeseries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="hits" stroke="#6366f1" fill="#6366f133" name="Hits" />
                <Area type="monotone" dataKey="errors" stroke="#ef4444" fill="#ef444433" name="Errors" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Bandwidth (bytes)</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={timeseries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => formatBytes(Number(v))} />
                <Tooltip formatter={(v: any) => formatBytes(Number(v))} />
                <Bar dataKey="bytes" fill="#10b981" name="Bandwidth" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top paths tab */}
      {tab === 'paths' && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Top Requested Paths (top 20)</h2>
          {topPaths.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, topPaths.length * 28)}>
              <BarChart data={topPaths} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="path" tick={{ fontSize: 11 }} width={220} />
                <Tooltip />
                <Bar dataKey="hits" fill="#6366f1" name="Hits" />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-slate-400">No data for selected period</p>}
        </div>
      )}

      {/* Errors tab */}
      {tab === 'errors' && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">HTTP Error Breakdown</h2>
            {statusData.filter(s => Number(s.code) >= 400).length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statusData.filter(s => Number(s.code) >= 400)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="code" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="hits" fill="#ef4444" name="Errors" />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-sm text-slate-400">No HTTP errors in this period</p>}
          </div>
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Recent Server Error Log (last 200 lines)</h2>
            <div className="max-h-64 overflow-auto bg-slate-950 rounded p-3 text-xs font-mono text-slate-300 space-y-px">
              {(errors?.errorLog || []).slice(0, 50).map((line: string, i: number) => (
                <div key={i}>{line}</div>
              ))}
              {!(errors?.errorLog?.length) && <div className="text-slate-500">No error log entries</div>}
            </div>
          </div>
        </div>
      )}

      {/* Mail delivery stats tab */}
      {tab === 'mail' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-secondary flex gap-1 items-center text-sm"
              onClick={() => openAuthenticatedDownload(`/api/mail-trace/export${qs()}`, { filename: 'mail-trace.csv' })}>
              <Download size={13} /> Export Mail Trace CSV
            </button>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { label: 'Total Deliveries', value: mailStats?.total ?? '—' },
              { label: 'Sent', value: mailStats?.byStatus?.sent ?? 0 },
              { label: 'Bounced / Failed', value: (mailStats?.byStatus?.bounced ?? 0) + (mailStats?.byStatus?.deferred ?? 0) },
            ].map(({ label, value }) => (
              <div key={label} className="card p-4">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{String(value)}</div>
              </div>
            ))}
          </div>

          {mailStatusData.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Delivery Status Breakdown</h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={mailStatusData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="st" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#10b981" name="Count" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Top Senders</h2>
              <div className="space-y-1 max-h-40 overflow-auto">
                {(mailStats?.topSenders || []).map((s: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400 truncate text-xs font-mono">{s.key}</span>
                    <span className="font-medium ml-2">{s.count}</span>
                  </div>
                ))}
                {!mailStats?.topSenders?.length && <p className="text-sm text-slate-400">No data</p>}
              </div>
            </div>
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Top Recipient Domains</h2>
              <div className="space-y-1 max-h-40 overflow-auto">
                {(mailStats?.topDomains || []).map((d: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400 text-xs font-mono">{d.key}</span>
                    <span className="font-medium ml-2">{d.count}</span>
                  </div>
                ))}
                {!mailStats?.topDomains?.length && <p className="text-sm text-slate-400">No data</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
