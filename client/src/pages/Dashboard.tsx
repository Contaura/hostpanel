import { useEffect, useState } from 'react';
import axios from 'axios';
import { Cpu, HardDrive, MemoryStick, Activity, CheckCircle2, XCircle, Clock, ShieldCheck } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useTheme } from '../context/ThemeContext';

interface Stats {
  cpu: { load: number; cores: number };
  memory: { total: number; used: number; percent: number };
  disk: { total: number; used: number; percent: number; mount: string } | null;
  network: { rx: number; tx: number };
  os: { distro: string; release: string; kernel: string; hostname: string };
  uptime: number;
}
interface Service { name: string; status: 'running' | 'stopped' | 'unknown' }
interface MailStats {
  installed: boolean;
  running:   boolean;
  version?:  string | null;
  uptime?:   number | null;
  scanned?:  number | null;
  actions?:  Record<string, number> | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}
function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function MailActivityBar({ scanned, actions }: { scanned: number; actions: Record<string, number> }) {
  const buckets = [
    { key: 'no action',       label: 'Clean',    color: 'bg-emerald-500', text: 'text-emerald-600' },
    { key: 'greylist',        label: 'Greylist', color: 'bg-blue-500',    text: 'text-blue-600'    },
    { key: 'add header',      label: 'Tagged',   color: 'bg-amber-500',   text: 'text-amber-600'   },
    { key: 'rewrite subject', label: 'Rewrite',  color: 'bg-amber-500',   text: 'text-amber-600'   },
    { key: 'soft reject',     label: 'Deferred', color: 'bg-orange-500',  text: 'text-orange-600'  },
    { key: 'reject',          label: 'Rejected', color: 'bg-rose-500',    text: 'text-rose-600'    },
  ];
  const total = scanned || buckets.reduce((s, b) => s + (actions[b.key] || 0), 0);
  if (total === 0) {
    return <p className="text-xs text-slate-500">No mail scanned yet — verdicts will appear as mail flows through.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
        {buckets.map(b => {
          const v = actions[b.key] || 0;
          if (!v) return null;
          return <div key={b.key} className={b.color} style={{ width: `${(v / total) * 100}%` }} title={`${b.label}: ${v}`} />;
        })}
      </div>
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-xs">
        {buckets.map(b => (
          <div key={b.key} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${b.color}`} />
            <span className="text-slate-500">{b.label}</span>
            <span className={`font-semibold ${b.text}`}>{(actions[b.key] || 0).toLocaleString()}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">Total scanned: {total.toLocaleString()}</p>
    </div>
  );
}

function StatCard({ label, value, sub, percent, gradient, icon: Icon }: {
  label: string; value: string; sub?: string; percent?: number;
  gradient: string; icon: React.ElementType;
}) {
  return (
    <div className={`rounded-2xl p-5 text-white relative overflow-hidden shadow-lg ${gradient}`}>
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10" />
      <div className="absolute -right-1 -bottom-6 h-20 w-20 rounded-full bg-white/5" />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">{label}</span>
          <div className="p-1.5 rounded-lg bg-white/20"><Icon size={14} strokeWidth={2.5} /></div>
        </div>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
        {sub && <p className="text-xs text-white/60 mt-1">{sub}</p>}
        {percent !== undefined && (
          <div className="mt-3">
            <div className="h-1 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-white/80 transition-all duration-500" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-[11px] text-white/60 mt-1">{percent}% used</p>
          </div>
        )}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.stroke }} className="font-semibold">
          {p.dataKey === 'cpu' ? 'CPU' : 'Mem'}: {p.value}%
        </p>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const [stats, setStats] = useState<Stats | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [history, setHistory] = useState<{ t: string; cpu: number; mem: number }[]>([]);
  const [mail, setMail] = useState<MailStats | null>(null);

  useEffect(() => {
    document.title = 'Dashboard — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => {
    // Seed chart from DB-persisted history so it isn't empty on page load
    axios.get<{ cpu: number; mem: number; created_at: string }[]>('/api/stats/history').then(r => {
      const seeded = r.data.map(row => ({
        t: new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        cpu: row.cpu,
        mem: row.mem,
      }));
      setHistory(seeded);
    }).catch(() => {});

    async function load() {
      try {
        const [s, sv] = await Promise.all([
          axios.get<Stats>('/api/stats'),
          axios.get<Service[]>('/api/stats/services'),
        ]);
        setStats(s.data);
        setServices(sv.data);
        setHistory(prev => [
          ...prev.slice(-59),
          {
            t: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            cpu: s.data.cpu.load,
            mem: s.data.memory.percent,
          },
        ]);
      } catch {}
    }
    // Mail stats refresh on a slower cadence — rspamd updates aren't sub-second.
    async function loadMail() {
      try { setMail((await axios.get<MailStats>('/api/rspamd/status')).data); } catch {}
    }
    load(); loadMail();
    const id     = setInterval(load,     5000);
    const mailId = setInterval(loadMail, 15000);
    return () => { clearInterval(id); clearInterval(mailId); };
  }, []);

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          Loading server stats…
        </div>
      </div>
    );
  }

  const runningCount = services.filter(s => s.status === 'running').length;
  const axisColor = dark ? '#64748b' : '#94a3b8';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            <span className="font-medium text-slate-700 dark:text-slate-300">{stats.os.hostname}</span>
            {' · '}{stats.os.distro} {stats.os.release}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Clock size={14} />
          <span>Up {formatUptime(stats.uptime)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="CPU Load"    value={`${stats.cpu.load}%`}           sub={`${stats.cpu.cores} cores`}          percent={stats.cpu.load}    gradient="stat-card-blue"   icon={Cpu} />
        <StatCard label="Memory"      value={formatBytes(stats.memory.used)}  sub={`of ${formatBytes(stats.memory.total)}`} percent={stats.memory.percent} gradient="stat-card-purple" icon={MemoryStick} />
        <StatCard label={`Disk ${stats.disk?.mount || '/'}`} value={stats.disk ? formatBytes(stats.disk.used) : 'N/A'} sub={stats.disk ? `of ${formatBytes(stats.disk.total)}` : undefined} percent={stats.disk?.percent} gradient="stat-card-orange" icon={HardDrive} />
        <StatCard label="Network Out" value={`${formatBytes(stats.network.tx)}/s`} sub={`In: ${formatBytes(stats.network.rx)}/s`} gradient="stat-card-green"  icon={Activity} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Performance History</h2>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Last 60 snapshots · refreshes every 5s</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" /> CPU
              </span>
              <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <span className="inline-block h-2 w-2 rounded-full bg-violet-400" /> Memory
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={history} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#a78bfa" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={dark ? '#334155' : '#f1f5f9'} vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: axisColor }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: axisColor }} tickLine={false} axisLine={false} unit="%" />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="cpu" stroke="#6366f1" strokeWidth={2} fill="url(#gCpu)" dot={false} />
              <Area type="monotone" dataKey="mem" stroke="#a78bfa" strokeWidth={2} fill="url(#gMem)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Services</h2>
            <span className="badge badge-green">{runningCount}/{services.length} running</span>
          </div>
          <div className="space-y-2 flex-1">
            {services.map(svc => (
              <div key={svc.name} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2.5">
                  {svc.status === 'running'
                    ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                    : <XCircle     size={14} className="text-rose-400 flex-shrink-0" />
                  }
                  <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{svc.name}</span>
                </div>
                <span className={`badge ${svc.status === 'running' ? 'badge-green' : 'badge-red'}`}>
                  {svc.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {mail?.installed && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-emerald-500" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Mail Activity</h2>
            </div>
            <span className={`badge ${mail.running ? 'badge-green' : 'badge-red'}`}>
              {mail.running ? `Rspamd ${mail.version || ''}` : 'Rspamd stopped'}
            </span>
          </div>
          <MailActivityBar scanned={mail.scanned || 0} actions={mail.actions || {}} />
        </div>
      )}

      <div className="card p-5">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">System Information</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Hostname', value: stats.os.hostname },
            { label: 'OS',       value: `${stats.os.distro} ${stats.os.release}` },
            { label: 'Kernel',   value: stats.os.kernel },
            { label: 'Uptime',   value: formatUptime(stats.uptime) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2.5">
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">{label}</p>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 font-mono truncate">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
