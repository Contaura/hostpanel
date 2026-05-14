import { useState, useEffect } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { ShieldOff, FileType, HardDrive, BarChart2, Lock, Plus, Trash2, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';

type Tab = 'hotlink' | 'mime' | 'diskusage' | 'bandwidth' | 'ssl';

function token() { return localStorage.getItem('hp_token') || ''; }
const authHeaders = () => ({ Authorization: 'Bearer ' + token() });
const api  = (p: string) => axios.get(p,  { headers: authHeaders() });
const aput = (p: string, d: any) => axios.put(p, d, { headers: authHeaders() });
const apost= (p: string, d: any) => axios.post(p, d, { headers: authHeaders() });
const adel = (p: string, d?: any) => axios.delete(p, { headers: authHeaders(), data: d });

export default function WebExtras() {
  const { success, error } = useToast();
  const [tab, setTab] = useState<Tab>('hotlink');

  // Hotlink
  const [hotlink, setHotlink] = useState({ enabled: false, allowed_domains: [] as string[], blocked_extensions: 'jpg,jpeg,png,gif,webp,mp4,mp3' });
  const [newDomain, setNewDomain] = useState('');

  // MIME
  const [mimeTypes, setMimeTypes] = useState<{ mime: string; extensions: string }[]>([]);
  const [newMime, setNewMime] = useState({ mime: '', extensions: '' });

  // Disk
  const [diskData, setDiskData] = useState<any>(null);
  const [diskLoading, setDiskLoading] = useState(false);

  // Bandwidth
  const [bwData, setBwData] = useState<any>(null);

  // SSL
  const [sslCerts, setSslCerts] = useState<any[]>([]);
  const [sslLoading, setSslLoading] = useState(false);

  useEffect(() => { loadTab(tab); }, [tab]);

  function loadTab(t: Tab) {
    if (t === 'hotlink') api('/api/web/hotlink').then(r => setHotlink(r.data)).catch(() => {});
    if (t === 'mime') api('/api/web/mime').then(r => setMimeTypes(r.data)).catch(() => {});
    if (t === 'diskusage') loadDisk();
    if (t === 'bandwidth') api('/api/web/bandwidth').then(r => setBwData(r.data)).catch(() => {});
    if (t === 'ssl') loadSsl();
  }

  async function loadDisk() { setDiskLoading(true); try { const r = await api('/api/web/diskusage'); setDiskData(r.data); } catch {} setDiskLoading(false); }
  async function loadSsl()  { setSslLoading(true);  try { const r = await api('/api/web/ssl');      setSslCerts(r.data); } catch {} setSslLoading(false); }

  async function saveHotlink() {
    try { await aput('/api/web/hotlink', hotlink); success('Hotlink protection updated'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function addMime() {
    if (!newMime.mime || !newMime.extensions) return;
    try { await apost('/api/web/mime', newMime); success('MIME type added'); setNewMime({ mime: '', extensions: '' }); loadTab('mime'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function deleteMime(mime: string) {
    try { await adel('/api/web/mime', { mime }); success('Removed'); loadTab('mime'); }
    catch (e: any) { error('Failed'); }
  }

  const tabs = [
    { id: 'hotlink' as Tab, label: 'Hotlink Protection', icon: ShieldOff },
    { id: 'mime'    as Tab, label: 'MIME Types',          icon: FileType  },
    { id: 'diskusage' as Tab, label: 'Disk Usage',        icon: HardDrive },
    { id: 'bandwidth' as Tab, label: 'Bandwidth',         icon: BarChart2 },
    { id: 'ssl'     as Tab, label: 'SSL Certificates',    icon: Lock      },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="page-title">Web Extras</h1>
        <p className="page-subtitle">Hotlink protection, MIME types, disk usage, bandwidth stats, and SSL certificates</p>
      </div>

      <div className="tab-bar">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? 'tab-item-active' : 'tab-item'}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Hotlink Protection */}
      {tab === 'hotlink' && (
        <div className="card p-5 space-y-4 max-w-xl">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Hotlink Protection</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded" checked={hotlink.enabled} onChange={e => setHotlink(p => ({ ...p, enabled: e.target.checked }))} />
              <span className="text-sm">{hotlink.enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
          <div>
            <label className="label">Blocked Extensions (comma-separated)</label>
            <input className="input" value={hotlink.blocked_extensions} onChange={e => setHotlink(p => ({ ...p, blocked_extensions: e.target.value }))} />
          </div>
          <div>
            <label className="label">Allowed Domains</label>
            <div className="flex gap-2 mb-2">
              <input className="input flex-1" placeholder="example.com" value={newDomain} onChange={e => setNewDomain(e.target.value)} />
              <button className="btn-secondary" onClick={() => { if (newDomain) { setHotlink(p => ({ ...p, allowed_domains: [...p.allowed_domains, newDomain] })); setNewDomain(''); }}}>Add</button>
            </div>
            {hotlink.allowed_domains.map(d => (
              <div key={d} className="flex items-center justify-between py-1">
                <span className="text-sm">{d}</span>
                <button className="btn-icon text-red-500" onClick={() => setHotlink(p => ({ ...p, allowed_domains: p.allowed_domains.filter(x => x !== d) }))}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <button className="btn-primary" onClick={saveHotlink}>Save</button>
        </div>
      )}

      {/* MIME Types */}
      {tab === 'mime' && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex gap-3">
              <input className="input flex-1" placeholder="application/x-custom" value={newMime.mime} onChange={e => setNewMime(p => ({ ...p, mime: e.target.value }))} />
              <input className="input flex-1" placeholder=".ext1 .ext2" value={newMime.extensions} onChange={e => setNewMime(p => ({ ...p, extensions: e.target.value }))} />
              <button className="btn-primary" onClick={addMime}><Plus size={14} /> Add</button>
            </div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell">MIME Type</th><th className="table-header-cell">Extensions</th><th className="table-header-cell w-16"></th></tr></thead>
              <tbody>
                {mimeTypes.length === 0 && <tr><td colSpan={3} className="table-cell text-slate-400 text-center py-8">No custom MIME types</td></tr>}
                {mimeTypes.map((m, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="table-cell font-mono text-xs">{m.mime}</td>
                    <td className="table-cell text-slate-600 dark:text-slate-400">{m.extensions}</td>
                    <td className="table-cell"><button className="btn-icon text-red-500" onClick={() => deleteMime(m.mime)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Disk Usage */}
      {tab === 'diskusage' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            {diskData?.disk && (
              <div className="flex gap-6 text-sm">
                <span className="text-slate-500">Total: <strong className="text-slate-900 dark:text-slate-100">{diskData.disk.total}</strong></span>
                <span className="text-slate-500">Used: <strong className="text-orange-500">{diskData.disk.used}</strong></span>
                <span className="text-slate-500">Free: <strong className="text-emerald-500">{diskData.disk.available}</strong></span>
              </div>
            )}
            <button className="btn-secondary" onClick={loadDisk} disabled={diskLoading}><RefreshCw size={14} className={diskLoading ? 'animate-spin' : ''} /> Refresh</button>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell">Path</th><th className="table-header-cell w-24">Size</th></tr></thead>
              <tbody>
                {diskLoading && <tr><td colSpan={2} className="table-cell text-center py-8 text-slate-400">Loading…</td></tr>}
                {!diskLoading && (diskData?.items || []).map((item: any, i: number) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="table-cell font-mono text-xs text-slate-700 dark:text-slate-300">{item.path}</td>
                    <td className="table-cell font-semibold text-indigo-600">{item.size}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bandwidth */}
      {tab === 'bandwidth' && (
        <div className="card p-5">
          {!bwData && <p className="text-slate-400 text-sm text-center py-8">Loading bandwidth data…</p>}
          {bwData?.source === 'none' && <p className="text-slate-400 text-sm text-center py-8">No bandwidth data available. Install vnstat for detailed stats.</p>}
          {bwData?.source === 'vnstat' && (
            <div>
              <p className="text-xs text-slate-500 mb-4">Interface: {bwData.interface} · Source: vnstat</p>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell">Month</th><th className="table-header-cell">Received</th><th className="table-header-cell">Transmitted</th></tr></thead>
                <tbody>
                  {(bwData.monthly || []).map((m: any) => (
                    <tr key={m.month} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="table-cell font-medium">{m.month}</td>
                      <td className="table-cell text-blue-600">{(m.rx / 1024 / 1024 / 1024).toFixed(2)} GB</td>
                      <td className="table-cell text-emerald-600">{(m.tx / 1024 / 1024 / 1024).toFixed(2)} GB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {bwData?.source === 'apache' && (
            <div>
              <p className="text-xs text-slate-500 mb-4">Source: Apache access log (install vnstat for monthly totals)</p>
              <pre className="text-xs font-mono bg-slate-50 dark:bg-slate-800 p-3 rounded overflow-x-auto">{(bwData.raw || []).join('\n')}</pre>
            </div>
          )}
        </div>
      )}

      {/* SSL Certificates */}
      {tab === 'ssl' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-secondary" onClick={loadSsl} disabled={sslLoading}><RefreshCw size={14} className={sslLoading ? 'animate-spin' : ''} /> Refresh</button>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell">Domain</th><th className="table-header-cell">Type</th><th className="table-header-cell">Expires</th><th className="table-header-cell">Days Left</th><th className="table-header-cell">Issuer</th></tr></thead>
              <tbody>
                {sslLoading && <tr><td colSpan={5} className="table-cell text-center py-8 text-slate-400">Scanning certificates…</td></tr>}
                {!sslLoading && sslCerts.length === 0 && <tr><td colSpan={5} className="table-cell text-slate-400 text-center py-8">No SSL certificates found</td></tr>}
                {sslCerts.map((cert, i) => {
                  const days = cert.daysLeft;
                  const color = days === null ? 'text-slate-400' : days < 14 ? 'text-red-600' : days < 30 ? 'text-orange-500' : 'text-emerald-600';
                  return (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="table-cell font-medium">{cert.domain}</td>
                      <td className="table-cell"><span className="badge-info">{cert.type}</span></td>
                      <td className="table-cell text-slate-600 dark:text-slate-400">{cert.notAfter?.slice(0, 24) || '—'}</td>
                      <td className={`table-cell font-semibold ${color}`}>
                        <div className="flex items-center gap-1">
                          {days !== null && days < 30 ? <AlertTriangle size={13} /> : days !== null ? <CheckCircle size={13} /> : null}
                          {days !== null ? `${days}d` : '—'}
                        </div>
                      </td>
                      <td className="table-cell text-xs text-slate-500">{cert.issuer?.slice(0, 40)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
