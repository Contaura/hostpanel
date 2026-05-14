import { useEffect, useState } from 'react';
import { Server, Cpu, HardDrive, Activity, RefreshCw } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string) => fetch(`/api/server-info${p}`, { headers: { Authorization: `Bearer ${localStorage.getItem('hp_token')}` } });

export default function ServerInfo() {
  const toast = useToast();
  const [info, setInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api('/');
      const d = await r.json();
      setInfo(d);
    } catch { toast.error('Failed to load server info'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-6 text-slate-400">Loading server information…</div>;
  if (!info) return null;

  const memUsedPct = info.memory?.total_mb ? Math.round((1 - info.memory.available_mb / info.memory.total_mb) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Server Information</h1>
        <button className="btn-secondary" onClick={load}><RefreshCw size={14} /></button>
      </div>

      {/* System overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ['Hostname', info.hostname],
          ['OS', info.os],
          ['Kernel', info.kernel],
          ['Uptime', info.uptime],
        ].map(([label, val]) => (
          <div key={label as string} className="card">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 break-all">{val || '—'}</p>
          </div>
        ))}
      </div>

      {/* CPU + Memory + Disk */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold"><Cpu size={15} /> CPU</div>
          <p className="text-xs text-slate-600 dark:text-slate-400">{info.cpu?.model || 'Unknown'}</p>
          <p className="text-xs text-slate-500">{info.cpu?.cores} core{info.cpu?.cores !== 1 ? 's' : ''}</p>
          <p className="text-xs text-slate-500">Load: {info.load_avg}</p>
        </div>
        <div className="card space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold"><Activity size={15} /> Memory</div>
          <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${memUsedPct > 85 ? 'bg-red-500' : memUsedPct > 65 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${memUsedPct}%` }} />
          </div>
          <p className="text-xs text-slate-500">{memUsedPct}% used — {info.memory?.available_mb} MB available of {info.memory?.total_mb} MB</p>
        </div>
        <div className="card space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold"><HardDrive size={15} /> Disk (/)</div>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">{info.disk || '—'}</p>
        </div>
      </div>

      {/* Software versions */}
      <div className="card">
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Software Versions</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(info.software || {}).map(([key, val]) => (
            <div key={key} className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <p className="text-xs text-slate-500 uppercase font-bold tracking-wide mb-1">{key}</p>
              <p className="text-xs font-mono text-slate-700 dark:text-slate-300 break-all">{val ? String(val).split('\n')[0] : <span className="text-slate-400">Not found</span>}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Services */}
      <div className="card">
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Service Status</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(info.services || []).map((svc: any) => (
            <div key={svc.name} className="flex items-center gap-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
              <div className={`h-2 w-2 rounded-full flex-shrink-0 ${svc.active ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
              <span className="text-sm font-mono">{svc.name}</span>
              <span className={`ml-auto text-[10px] font-medium ${svc.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>{svc.active ? 'running' : 'stopped'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
