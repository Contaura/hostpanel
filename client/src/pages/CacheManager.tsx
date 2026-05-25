import { useEffect, useState } from 'react';
import { RefreshCw, Trash2, Play, Square } from 'lucide-react';
import { useToast } from '../components/Toast';
import { fetchApi } from '../lib/api';

export default function CacheManager() {
  const toast = useToast();
  const [opcache, setOpcache] = useState<any>(null);
  const [redis, setRedis] = useState<any>(null);
  const [memcached, setMemcached] = useState<any>(null);
  const [tab, setTab] = useState<'opcache' | 'redis' | 'memcached'>('opcache');
  const [flushing, setFlushing] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  async function loadAll() {
    try {
      const [o, r, m] = await Promise.all([
        fetchApi('/api/cache/opcache').then(r => r.json()),
        fetchApi('/api/cache/redis').then(r => r.json()),
        fetchApi('/api/cache/memcached').then(r => r.json()),
      ]);
      setOpcache(o); setRedis(r); setMemcached(m);
    } finally { setPageLoading(false); }
  }

  useEffect(() => {
    document.title = 'Cache Manager — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => { loadAll(); }, []);

  async function flush(type: string) {
    setFlushing(type);
    try {
      const r = await fetchApi(`/api/cache/${type}/flush`, { method: 'POST' });
      const d = await r.json();
      if (d.error) toast.error(d.error);
      else { toast.success(`${type} flushed`); loadAll(); }
    } finally { setFlushing(null); }
  }

  async function redisAction(action: 'start' | 'stop') {
    const r = await fetchApi('/api/cache/redis/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled: action === 'start' }),
    });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success(`Redis ${action === 'start' ? 'started' : 'stopped'}`); loadAll(); }
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

      {pageLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
      <>

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
          {opcache.enabled && (
            <div className="card">
              <div className="grid grid-cols-4 gap-3">
                <Stat label="Used Memory" value={opcache.used ? `${(Number(opcache.used) / 1e6).toFixed(1)} MB` : '—'} />
                <Stat label="Free Memory" value={opcache.free ? `${(Number(opcache.free) / 1e6).toFixed(1)} MB` : '—'} />
                <Stat label="Cached Files" value={opcache.cached_files ?? '—'} />
                <Stat label="Hit Rate" value={opcache.hit_rate ? `${Number(opcache.hit_rate).toFixed(1)}%` : '—'} />
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'redis' && redis && (
        <div className="space-y-4">
          <div className="card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${redis.enabled ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="font-medium text-sm">Redis {redis.enabled ? 'Running' : 'Stopped'}</span>
              {redis.version && <span className="text-xs text-slate-500">v{redis.version}</span>}
            </div>
            <div className="flex gap-2">
              {redis.enabled ? (
                <>
                  <button className="btn-danger text-xs" disabled={flushing === 'redis'} onClick={() => flush('redis')}><Trash2 size={12} className="mr-1" />Flush All</button>
                  <button className="btn-ghost text-xs" onClick={() => redisAction('stop')}><Square size={12} className="mr-1" />Stop</button>
                </>
              ) : (
                <button className="btn-secondary text-xs" onClick={() => redisAction('start')}><Play size={12} className="mr-1" />Start</button>
              )}
            </div>
          </div>
          {redis.enabled && (
            <div className="card grid grid-cols-4 gap-3">
              <Stat label="Connected Clients" value={redis.connected ?? '—'} />
              <Stat label="Used Memory" value={redis.memory ?? '—'} />
              <Stat label="Total Keys (DB0)" value={redis.keys ?? '0'} />
              <Stat label="Uptime" value={redis.uptime ? `${Math.floor(Number(redis.uptime) / 86400)}d` : '—'} />
            </div>
          )}
        </div>
      )}

      {tab === 'memcached' && memcached && (
        <div className="space-y-4">
          <div className="card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${memcached.enabled ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="font-medium text-sm">Memcached {memcached.enabled ? 'Running' : 'Stopped'}</span>
            </div>
            {memcached.enabled && (
              <button className="btn-danger text-xs" disabled={flushing === 'memcached'} onClick={() => flush('memcached')}><Trash2 size={12} className="mr-1" />Flush All</button>
            )}
          </div>
          {memcached.enabled && (
            <div className="card grid grid-cols-4 gap-3">
              <Stat label="Current Items" value={memcached.curr_items} />
              <Stat label="Total Items" value={memcached.total_items} />
              <Stat label="Bytes Used" value={memcached.bytes ? `${(memcached.bytes / 1e6).toFixed(1)} MB` : '—'} />
              <Stat label="Limit Maxbytes" value={memcached.limit_maxbytes ? `${(memcached.limit_maxbytes / 1e6).toFixed(0)} MB` : '—'} />
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
