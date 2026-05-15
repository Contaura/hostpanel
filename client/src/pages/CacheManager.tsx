import { useEffect, useState } from 'react';
import { RefreshCw, Trash2, Play, Square } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/cache${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

export default function CacheManager() {
  const toast = useToast();
  const [opcache, setOpcache] = useState<any>(null);
  const [redis, setRedis] = useState<any>(null);
  const [memcached, setMemcached] = useState<any>(null);
  const [tab, setTab] = useState<'opcache' | 'redis' | 'memcached'>('opcache');
  const [flushing, setFlushing] = useState<string | null>(null);

  async function loadAll() {
    const [o, r, m] = await Promise.all([
      api('/opcache').then(r => r.json()),
      api('/redis').then(r => r.json()),
      api('/memcached').then(r => r.json()),
    ]);
    setOpcache(o); setRedis(r); setMemcached(m);
  }

  useEffect(() => { loadAll(); }, []);

  async function flush(type: string) {
    setFlushing(type);
    try {
      const r = await api(`/${type}/flush`, { method: 'POST' });
      const d = await r.json();
      if (d.error) toast.error(d.error);
      else { toast.success(`${type} flushed`); loadAll(); }
    } finally { setFlushing(null); }
  }

  async function redisAction(action: 'start' | 'stop') {
    const r = await api(`/redis/${action}`, { method: 'POST' });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success(`Redis ${action}ped`); loadAll(); }
  }

  const Stat = ({ label, value }: { label: string; value: any }) => (
    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-semibold text-sm mt-0.5">{value ?? '—'}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Cache Manager</h1>
        <button className="btn-ghost" onClick={loadAll}><RefreshCw size={14} /></button>
      </div>

      <div className="tab-bar">
        {(['opcache', 'redis', 'memcached'] as const).map(t => (
          <button key={t} className={`tab-item ${tab === t ? 'tab-item-active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'opcache' && opcache && (
        <div className="space-y-4">
          <div className="card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${opcache.enabled ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="font-medium text-sm">OPcache {opcache.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            <button className="btn-danger text-xs" disabled={flushing === 'opcache'} onClick={() => flush('opcache')}><Trash2 size={12} className="mr-1" />Flush OPcache</button>
          </div>
          {opcache.memory_usage && (
            <div className="card">
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 mb-4">
                <div
                  className="bg-indigo-500 h-2 rounded-full"
                  style={{ width: `${Math.round(opcache.memory_usage.used_memory / (opcache.memory_usage.used_memory + opcache.memory_usage.free_memory) * 100)}%` }}
                />
              </div>
              <div className="grid grid-cols-4 gap-3">
                <Stat label="Used Memory" value={`${(opcache.memory_usage.used_memory / 1e6).toFixed(1)} MB`} />
                <Stat label="Free Memory" value={`${(opcache.memory_usage.free_memory / 1e6).toFixed(1)} MB`} />
                <Stat label="Cached Scripts" value={opcache.opcache_statistics?.num_cached_scripts} />
                <Stat label="Hit Rate" value={opcache.opcache_statistics?.opcache_hit_rate ? `${Number(opcache.opcache_statistics.opcache_hit_rate).toFixed(1)}%` : '—'} />
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'redis' && redis && (
        <div className="space-y-4">
          <div className="card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${redis.running ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="font-medium text-sm">Redis {redis.running ? 'Running' : 'Stopped'}</span>
              {redis.version && <span className="text-xs text-slate-500">v{redis.version}</span>}
            </div>
            <div className="flex gap-2">
              {redis.running ? (
                <>
                  <button className="btn-danger text-xs" disabled={flushing === 'redis'} onClick={() => flush('redis')}><Trash2 size={12} className="mr-1" />Flush All</button>
                  <button className="btn-ghost text-xs" onClick={() => redisAction('stop')}><Square size={12} className="mr-1" />Stop</button>
                </>
              ) : (
                <button className="btn-secondary text-xs" onClick={() => redisAction('start')}><Play size={12} className="mr-1" />Start</button>
              )}
            </div>
          </div>
          {redis.running && (
            <div className="card grid grid-cols-4 gap-3">
              <Stat label="Connected Clients" value={redis.connected_clients} />
              <Stat label="Used Memory" value={redis.used_memory_human} />
              <Stat label="Total Keys (DB0)" value={redis.db0_keys} />
              <Stat label="Uptime" value={redis.uptime_in_days ? `${redis.uptime_in_days}d` : '—'} />
            </div>
          )}
        </div>
      )}

      {tab === 'memcached' && memcached && (
        <div className="space-y-4">
          <div className="card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${memcached.running ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="font-medium text-sm">Memcached {memcached.running ? 'Running' : 'Stopped'}</span>
            </div>
            {memcached.running && (
              <button className="btn-danger text-xs" disabled={flushing === 'memcached'} onClick={() => flush('memcached')}><Trash2 size={12} className="mr-1" />Flush All</button>
            )}
          </div>
          {memcached.running && (
            <div className="card grid grid-cols-4 gap-3">
              <Stat label="Current Items" value={memcached.curr_items} />
              <Stat label="Total Items" value={memcached.total_items} />
              <Stat label="Bytes Used" value={memcached.bytes ? `${(memcached.bytes / 1e6).toFixed(1)} MB` : '—'} />
              <Stat label="Limit Maxbytes" value={memcached.limit_maxbytes ? `${(memcached.limit_maxbytes / 1e6).toFixed(0)} MB` : '—'} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
