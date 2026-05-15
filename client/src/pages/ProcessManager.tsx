import { useEffect, useState } from 'react';
import axios from 'axios';
import { Activity, RefreshCw, Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';

interface Process {
  user: string;
  pid: string;
  cpu: string;
  mem: string;
  stat: string;
  command: string;
}

const LIMIT = 50;

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700 sticky top-0 z-10';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

function cpuBar(val: string) {
  const pct = Math.min(parseFloat(val) || 0, 100);
  const color = pct > 80 ? 'bg-rose-500' : pct > 40 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-xs w-8">{val}%</span>
    </div>
  );
}

export default function ProcessManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const [procs, setProcs] = useState<Process[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [killing, setKilling] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  async function load(p = page) {
    setLoading(true);
    try {
      const { data } = await axios.get<{ data: Process[]; total: number; page: number; limit: number }>(
        `/api/processes/list?page=${p}&limit=${LIMIT}`
      );
      setProcs(data.data);
      setTotal(data.total);
    } catch { toast.error('Failed to load processes'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    document.title = 'Process Manager — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => { load(); }, []);

  function goToPage(p: number) {
    setPage(p);
    setFilter('');
    load(p);
  }

  async function killProcess(pid: string, cmd: string) {
    if (!await confirm(`Kill process ${pid} (${cmd.slice(0, 40)})?`)) return;
    setKilling(pid);
    try {
      await axios.delete(`/api/processes/${pid}`);
      toast.success(`Process ${pid} terminated`);
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setKilling(null); }
  }

  const filtered = filter
    ? procs.filter(p => p.command.toLowerCase().includes(filter.toLowerCase()) || p.user.includes(filter) || p.pid === filter)
    : procs;

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Process Manager</h1>
          <p className="page-subtitle">View and manage running server processes</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-56" placeholder="Filter by user, PID, or command…"
              value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
          <button onClick={() => load()} className="btn-secondary">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-auto max-h-[75vh]">
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="table-header-cell w-24">PID</th>
                <th className="table-header-cell w-24">User</th>
                <th className="table-header-cell w-36">CPU</th>
                <th className="table-header-cell w-12">MEM%</th>
                <th className="table-header-cell w-14">State</th>
                <th className="table-header-cell">Command</th>
                <th className="px-4 py-3 w-12" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center">
                  <Activity className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                  <p className="text-slate-400 text-sm">No processes found</p>
                </td></tr>
              ) : filtered.map(p => (
                <tr key={p.pid} className={rowCls}>
                  <td className="table-cell font-mono font-bold text-slate-900 dark:text-slate-100">{p.pid}</td>
                  <td className="table-cell text-slate-600 dark:text-slate-400">{p.user}</td>
                  <td className="table-cell">{cpuBar(p.cpu)}</td>
                  <td className="table-cell text-slate-600 dark:text-slate-400 tabular-nums">{p.mem}%</td>
                  <td className="table-cell">
                    <span className={`badge ${p.stat?.startsWith('S') ? 'badge-green' : p.stat?.startsWith('R') ? 'badge-blue' : 'badge-gray'}`}>
                      {p.stat}
                    </span>
                  </td>
                  <td className="table-cell font-mono text-xs text-slate-500 dark:text-slate-400 max-w-xs truncate" title={p.command}>
                    {p.command}
                  </td>
                  <td className="px-3 py-3">
                    <button onClick={() => killProcess(p.pid, p.command)}
                      disabled={killing === p.pid}
                      className="btn-icon opacity-0 group-hover:opacity-100 hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30"
                      title="Kill process">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!filter && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700 text-sm text-slate-500">
            <span>{total} processes · page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button className="btn-icon" onClick={() => goToPage(page - 1)} disabled={page <= 1}><ChevronLeft size={14} /></button>
              <button className="btn-icon" onClick={() => goToPage(page + 1)} disabled={page >= totalPages}><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
