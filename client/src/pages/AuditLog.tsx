import { useEffect, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/audit-log${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

export default function AuditLog() {
  const toast = useToast();
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [user, setUser] = useState('');
  const perPage = 50;

  async function load(p = 1) {
    const params = new URLSearchParams({ page: String(p), per_page: String(perPage) });
    if (search) params.set('search', search);
    if (user) params.set('user', user);
    const r = await api(`/?${params}`);
    const d = await r.json();
    setLogs(Array.isArray(d.logs) ? d.logs : []);
    setTotal(d.total || 0);
    setPage(p);
  }

  useEffect(() => { load(); }, []);

  async function clearOld() {
    if (!confirm('Delete all audit log entries older than 90 days?')) return;
    await api('/clear', { method: 'DELETE' });
    toast.success('Old logs cleared');
    load();
  }

  const methodColor: Record<string, string> = {
    POST: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    PUT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    PATCH: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Audit Log</h1>
        <button className="btn-danger text-xs" onClick={clearOld}><Trash2 size={12} className="mr-1" />Clear Old (&gt;90d)</button>
      </div>

      <div className="card flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-8" placeholder="Search path or IP…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(1)} />
        </div>
        <input className="input w-40" placeholder="Username filter" value={user} onChange={e => setUser(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(1)} />
        <button className="btn-primary" onClick={() => load(1)}>Search</button>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr>{['Time', 'User', 'Method', 'Path', 'Status', 'IP'].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={6} className="table-cell text-center text-slate-500">No entries</td></tr>}
            {logs.map((l: any) => (
              <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="table-cell text-xs text-slate-500">{new Date(l.created_at).toLocaleString()}</td>
                <td className="table-cell text-xs font-medium">{l.user || '—'}</td>
                <td className="table-cell">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-bold ${methodColor[l.method] || 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{l.method}</span>
                </td>
                <td className="table-cell text-xs font-mono text-slate-600 dark:text-slate-400 max-w-[250px] truncate">{l.path}</td>
                <td className="table-cell">
                  <span className={`text-xs font-mono ${l.status >= 400 ? 'text-red-500' : 'text-emerald-600'}`}>{l.status}</span>
                </td>
                <td className="table-cell text-xs text-slate-500 font-mono">{l.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > perPage && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{total} total entries</span>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" disabled={page === 1} onClick={() => load(page - 1)}>Previous</button>
            <span>Page {page} of {Math.ceil(total / perPage)}</span>
            <button className="btn-ghost text-xs" disabled={page >= Math.ceil(total / perPage)} onClick={() => load(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
