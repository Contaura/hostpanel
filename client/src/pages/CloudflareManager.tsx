import { useEffect, useState } from 'react';
import { Plus, Trash2, RefreshCw, Cloud, CloudOff, Zap } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/cloudflare${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

export default function CloudflareManager() {
  const toast = useToast();
  const [zones, setZones] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [dns, setDns] = useState<any[]>([]);
  const [tab, setTab] = useState<'dns' | 'analytics'>('dns');
  const [analytics, setAnalytics] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState('');

  useEffect(() => { loadZones(); }, []);

  async function loadZones() {
    const r = await api('/');
    setZones(await r.json());
  }

  async function addZone() {
    if (!token.trim()) return;
    const r = await api('/', { method: 'POST', body: JSON.stringify({ api_token: token }) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Cloudflare zones imported');
    setAdding(false); setToken('');
    loadZones();
  }

  async function selectZone(zone: any) {
    setSelected(zone);
    const r = await api(`/${zone.cf_zone_id}/dns`);
    setDns(await r.json());
    if (tab === 'analytics') loadAnalytics(zone.cf_zone_id);
  }

  async function loadAnalytics(id: string) {
    const r = await api(`/${id}/analytics`);
    setAnalytics(await r.json());
  }

  async function toggleProxy(zoneId: string, recordId: string, current: boolean) {
    await api(`/${zoneId}/dns/${recordId}/proxy`, { method: 'PATCH', body: JSON.stringify({ proxied: !current }) });
    toast.success(`Proxy ${!current ? 'enabled' : 'disabled'}`);
    const r = await api(`/${zoneId}/dns`);
    setDns(await r.json());
  }

  async function purge(zoneId: string) {
    await api(`/${zoneId}/purge`, { method: 'POST' });
    toast.success('Cache purged');
  }

  async function togglePause(zone: any) {
    await api(`/${zone.cf_zone_id}/pause`, { method: 'PATCH', body: JSON.stringify({ paused: !zone.paused }) });
    toast.success(zone.paused ? 'Zone unpaused' : 'Zone paused');
    loadZones();
  }

  async function deleteZone(id: number) {
    if (!confirm('Remove this zone from HostPanel?')) return;
    await api(`/${id}`, { method: 'DELETE' });
    setSelected(null);
    loadZones();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Cloudflare CDN</h1>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />Add API Token</button>
      </div>

      {adding && (
        <div className="card space-y-3">
          <p className="text-sm font-medium">Enter Cloudflare API Token (needs Zone:Read + Zone:Edit permissions)</p>
          <div className="flex gap-2">
            <input className="input flex-1" type="password" placeholder="CF API Token" value={token} onChange={e => setToken(e.target.value)} />
            <button className="btn-primary" onClick={addZone}>Import Zones</button>
            <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Zone list */}
        <div className="space-y-2">
          {zones.length === 0 && <p className="text-sm text-slate-500">No zones yet</p>}
          {zones.map((z: any) => (
            <div
              key={z.id}
              onClick={() => selectZone(z)}
              className={`card cursor-pointer transition-colors ${selected?.id === z.id ? 'ring-2 ring-indigo-500' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-sm">{z.domain}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{z.paused ? 'Paused' : 'Active'}</p>
                </div>
                <div className="flex gap-1">
                  <button className="btn-icon" title={z.paused ? 'Unpause' : 'Pause'} onClick={e => { e.stopPropagation(); togglePause(z); }}>
                    {z.paused ? <Cloud size={13} className="text-amber-500" /> : <CloudOff size={13} />}
                  </button>
                  <button className="btn-icon" title="Purge cache" onClick={e => { e.stopPropagation(); purge(z.cf_zone_id); }}>
                    <Zap size={13} />
                  </button>
                  <button className="btn-icon text-red-500" onClick={e => { e.stopPropagation(); deleteZone(z.id); }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Zone details */}
        {selected && (
          <div className="col-span-2 space-y-4">
            <div className="tab-bar">
              <button className={`tab-item ${tab === 'dns' ? 'tab-item-active' : ''}`} onClick={() => setTab('dns')}>DNS Records</button>
              <button className={`tab-item ${tab === 'analytics' ? 'tab-item-active' : ''}`} onClick={() => { setTab('analytics'); loadAnalytics(selected.cf_zone_id); }}>Analytics</button>
            </div>

            {tab === 'dns' && (
              <div className="card overflow-hidden p-0">
                <table className="w-full text-sm">
                  <thead><tr>{['Type', 'Name', 'Content', 'Proxy', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
                  <tbody>
                    {dns.length === 0 && <tr><td colSpan={5} className="table-cell text-center text-slate-500">No records</td></tr>}
                    {dns.map((r: any) => (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="table-cell"><span className="badge-info text-xs">{r.type}</span></td>
                        <td className="table-cell text-xs font-mono">{r.name}</td>
                        <td className="table-cell text-xs text-slate-500 max-w-[200px] truncate">{r.content}</td>
                        <td className="table-cell">
                          <button
                            className={`text-xs px-2 py-0.5 rounded-full ${r.proxied ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700'}`}
                            onClick={() => toggleProxy(selected.cf_zone_id, r.id, r.proxied)}
                          >
                            {r.proxied ? '☁ Proxied' : '⬜ DNS only'}
                          </button>
                        </td>
                        <td className="table-cell text-xs text-slate-400">{r.ttl === 1 ? 'Auto' : `${r.ttl}s`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'analytics' && analytics && (
              <div className="grid grid-cols-3 gap-4">
                {[
                  ['Requests', analytics.requests?.all ?? '—'],
                  ['Cached', analytics.requests?.cached ?? '—'],
                  ['Bandwidth', analytics.bandwidth?.all ? `${(analytics.bandwidth.all / 1e6).toFixed(1)} MB` : '—'],
                  ['Threats', analytics.threats?.all ?? '—'],
                  ['Page Views', analytics.pageviews?.all ?? '—'],
                  ['Unique IPs', analytics.uniques?.all ?? '—'],
                ].map(([label, val]) => (
                  <div key={label as string} className="card">
                    <p className="text-2xl font-bold">{val}</p>
                    <p className="text-xs text-slate-500 mt-1">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
