import { useEffect, useState } from 'react';
import { RefreshCw, Power, Trash2, Download, Zap, Upload, Search } from 'lucide-react';
import { useRef } from 'react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/wordpress${p}`, {
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o,
});

export default function WordPressManager() {
  const toast = useToast();
  const [sites, setSites] = useState<any[]>([]);
  const [selected, setSelected] = useState('');
  const [info, setInfo] = useState<any>(null);
  const [plugins, setPlugins] = useState<any[]>([]);
  const [themes, setThemes] = useState<any[]>([]);
  const [tab, setTab] = useState<'overview' | 'plugins' | 'themes' | 'tools' | 'auto-update' | 'upload'>('overview');
  const [autoUpdates, setAutoUpdates] = useState<any[]>([]);
  const [autoUpdateForm, setAutoUpdateForm] = useState({ update_core: true, update_plugins: true, update_themes: true, schedule: 'weekly' });
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [srForm, setSrForm] = useState({ search: '', replace: '' });
  const [uploading, setUploading] = useState(false);
  const [uploadOutput, setUploadOutput] = useState('');
  const [pluginSearch, setPluginSearch] = useState('');
  const [themeSearch, setThemeSearch] = useState('');
  const pluginZipRef = useRef<HTMLInputElement>(null);
  const themeZipRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api('/sites').then(r => r.json()).then(d => setSites(Array.isArray(d) ? d : []));
    api('/auto-updates').then(r => r.json()).then(d => setAutoUpdates(Array.isArray(d) ? d : []));
  }, []);

  async function selectSite(domain: string) {
    setSelected(domain); setOutput(''); setInfo(null); setPlugins([]); setThemes([]);
    const [i, pl, th] = await Promise.all([
      api(`/${domain}/info`).then(r => r.json()),
      api(`/${domain}/plugins`).then(r => r.json()),
      api(`/${domain}/themes`).then(r => r.json()),
    ]);
    setInfo(i); setPlugins(Array.isArray(pl) ? pl : []); setThemes(Array.isArray(th) ? th : []);
  }

  async function run(path: string, msg: string) {
    setLoading(true); setOutput('Running…');
    const r = await api(path, { method: 'POST' });
    const d = await r.json();
    setOutput(d.output || d.core || d.error || 'Done');
    if (d.error) toast.error(d.error); else toast.success(msg);
    setLoading(false);
    selectSite(selected);
  }

  async function togglePlugin(slug: string, active: string) {
    setLoading(true);
    try {
      await api(`/${selected}/plugins/${slug}/toggle`, { method: 'POST', body: JSON.stringify({ active: active === 'active' }) });
      const r = await api(`/${selected}/plugins`).then(r => r.json());
      setPlugins(Array.isArray(r) ? r : []);
    } finally { setLoading(false); }
  }

  async function activateTheme(slug: string) {
    setLoading(true);
    try {
      await api(`/${selected}/themes/${slug}/activate`, { method: 'POST' });
      const r = await api(`/${selected}/themes`).then(r => r.json());
      setThemes(Array.isArray(r) ? r : []);
      toast.success(`Theme ${slug} activated`);
    } finally { setLoading(false); }
  }

  async function uploadZip(type: 'plugins' | 'themes', file: File) {
    setUploading(true); setUploadOutput('Uploading…');
    const fd = new FormData();
    fd.append('zip', file);
    const r = await fetch(`/api/wordpress/${selected}/${type}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('hp_token')}` },
      body: fd,
    });
    const d = await r.json();
    setUploadOutput(d.output || d.error || 'Done');
    if (d.error) toast.error(d.error);
    else { toast.success(`${type === 'plugins' ? 'Plugin' : 'Theme'} uploaded and installed`); selectSite(selected); }
    setUploading(false);
  }

  async function searchReplace() {
    if (!srForm.search || !srForm.replace) return;
    setLoading(true); setOutput('Running search-replace…');
    const r = await api(`/${selected}/search-replace`, { method: 'POST', body: JSON.stringify(srForm) });
    const d = await r.json();
    setOutput(d.output || d.error || 'Done');
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">WordPress Manager</h1>

      <div className="card flex gap-3 items-center">
        <select className="input flex-1" value={selected} onChange={e => selectSite(e.target.value)}>
          <option value="">Select a WordPress site…</option>
          {sites.map(s => <option key={s.domain} value={s.domain}>{s.domain}</option>)}
        </select>
        <button className="btn-ghost" onClick={() => api('/sites').then(r => r.json()).then(d => setSites(Array.isArray(d) ? d : []))}><RefreshCw size={14} /></button>
      </div>

      {sites.length === 0 && <p className="text-sm text-slate-500">No WordPress installations found. Install one via Script Installer.</p>}

      {selected && info && (
        <>
          <div className="tab-bar">
            {(['overview', 'plugins', 'themes', 'tools', 'auto-update', 'upload'] as const).map(t => (
              <button key={t} className={`tab-item ${tab === t ? 'tab-item-active' : ''}`} onClick={() => setTab(t)}>
                {t === 'auto-update' ? 'Auto-Update' : t === 'upload' ? 'Upload Zip' : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="card grid grid-cols-3 gap-4">
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-500">WordPress Version</p>
                  <p className="font-bold text-lg mt-0.5">{info.version || '—'}</p>
                  {info.core_updates?.length > 0 && <span className="badge-warning text-xs mt-1">Update available</span>}
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Site URL</p>
                  <a href={info.url} target="_blank" rel="noopener noreferrer" className="text-indigo-500 text-sm font-mono truncate block mt-0.5">{info.url}</a>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <p className="text-xs text-slate-500">Plugins / Themes</p>
                  <p className="font-bold text-lg mt-0.5">{plugins.length} / {themes.length}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button className="btn-primary" onClick={() => run(`/${selected}/core-update`, 'Core updated')} disabled={loading}>
                  <Download size={14} className="mr-1" />Update Core
                </button>
                <button className="btn-secondary" onClick={() => run(`/${selected}/update-all`, 'All updated')} disabled={loading}>
                  <Zap size={14} className="mr-1" />Update Everything
                </button>
              </div>
              {output && <pre className="bg-slate-900 text-emerald-400 text-xs p-3 rounded-lg max-h-48 overflow-y-auto whitespace-pre-wrap">{output}</pre>}
            </div>
          )}

          {tab === 'plugins' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input className="input pl-8 w-48 text-sm" placeholder="Search plugins…" value={pluginSearch} onChange={e => setPluginSearch(e.target.value)} />
                </div>
              </div>
              <div className="card overflow-hidden p-0">
                <table className="w-full text-sm">
                  <thead><tr>{['Plugin', 'Version', 'Status', 'Update', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
                  <tbody>
                    {(() => {
                      const q = pluginSearch.trim().toLowerCase();
                      const visible = q ? plugins.filter((p: any) => [p.title, p.name, p.status].some((v: any) => String(v ?? '').toLowerCase().includes(q))) : plugins;
                      if (plugins.length === 0) return <tr><td colSpan={5} className="table-cell text-center text-slate-500">No plugins found</td></tr>;
                      if (visible.length === 0) return <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No plugins match "{pluginSearch}"</td></tr>;
                      return visible.map((p: any) => (
                        <tr key={p.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="table-cell font-medium">{p.title || p.name}</td>
                          <td className="table-cell text-xs text-slate-500">{p.version}</td>
                          <td className="table-cell">
                            <button onClick={() => togglePlugin(p.name, p.status)} disabled={loading} className={`text-xs px-2 py-0.5 rounded-full font-medium disabled:opacity-50 ${p.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700'}`}>
                              {p.status}
                            </button>
                          </td>
                          <td className="table-cell">
                            {p.update === 'available' && (
                              <button className="btn-ghost text-xs text-amber-600" disabled={loading} onClick={() => run(`/${selected}/plugins/${p.name}/update`, `${p.name} updated`)}>
                                <Download size={11} className="mr-1" />Update
                              </button>
                            )}
                          </td>
                          <td className="table-cell">
                            <button className="btn-icon text-red-500" disabled={loading} onClick={() => run(`/${selected}/plugins/${p.name}/delete`, `${p.name} deleted`)}><Trash2 size={13} /></button>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'themes' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input className="input pl-8 w-48 text-sm" placeholder="Search themes…" value={themeSearch} onChange={e => setThemeSearch(e.target.value)} />
                </div>
              </div>
              <div className="card overflow-hidden p-0">
                <table className="w-full text-sm">
                  <thead><tr>{['Theme', 'Version', 'Status', 'Update', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
                  <tbody>
                    {(() => {
                      const q = themeSearch.trim().toLowerCase();
                      const visible = q ? themes.filter((t: any) => [t.title, t.name, t.status].some((v: any) => String(v ?? '').toLowerCase().includes(q))) : themes;
                      if (themes.length === 0) return <tr><td colSpan={5} className="table-cell text-center text-slate-500">No themes found</td></tr>;
                      if (visible.length === 0) return <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No themes match "{themeSearch}"</td></tr>;
                      return visible.map((t: any) => (
                        <tr key={t.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="table-cell font-medium">{t.title || t.name}</td>
                          <td className="table-cell text-xs text-slate-500">{t.version}</td>
                          <td className="table-cell">
                            {t.status === 'active'
                              ? <span className="badge-success text-xs">Active</span>
                              : <button className="btn-ghost text-xs" disabled={loading} onClick={() => activateTheme(t.name)}><Power size={11} className="mr-1" />Activate</button>}
                          </td>
                          <td className="table-cell">
                            {t.update === 'available' && (
                              <button className="btn-ghost text-xs text-amber-600" disabled={loading} onClick={() => run(`/${selected}/themes/${t.name}/update`, `${t.name} updated`)}>
                                <Download size={11} className="mr-1" />Update
                              </button>
                            )}
                          </td>
                          <td className="table-cell text-slate-400 text-xs">{t.status !== 'active' ? '—' : ''}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'tools' && (
            <div className="card space-y-4">
              <p className="text-sm font-medium">Search & Replace (URL migration)</p>
              <p className="text-xs text-slate-500">Use when moving from staging to production. Runs <code>wp search-replace</code> across all tables.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Search</label><input className="input font-mono" placeholder="http://staging.example.com" value={srForm.search} onChange={e => setSrForm(f => ({ ...f, search: e.target.value }))} /></div>
                <div><label className="label">Replace</label><input className="input font-mono" placeholder="https://example.com" value={srForm.replace} onChange={e => setSrForm(f => ({ ...f, replace: e.target.value }))} /></div>
              </div>
              <button className="btn-primary" onClick={searchReplace} disabled={loading}>Run Search-Replace</button>
              {output && <pre className="bg-slate-900 text-emerald-400 text-xs p-3 rounded-lg max-h-40 overflow-y-auto whitespace-pre-wrap">{output}</pre>}
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-4">
              <div className="card p-5 space-y-5 max-w-lg">
                <p className="text-sm text-slate-600 dark:text-slate-400">Upload a plugin or theme as a ZIP file and install it directly into {selected}.</p>

                <div>
                  <p className="text-sm font-medium mb-2">Install Plugin</p>
                  <input ref={pluginZipRef} type="file" accept=".zip" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadZip('plugins', f); e.target.value = ''; }} />
                  <button className="btn-primary" onClick={() => pluginZipRef.current?.click()} disabled={uploading}>
                    <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload Plugin ZIP'}
                  </button>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Install Theme</p>
                  <input ref={themeZipRef} type="file" accept=".zip" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadZip('themes', f); e.target.value = ''; }} />
                  <button className="btn-primary" onClick={() => themeZipRef.current?.click()} disabled={uploading}>
                    <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload Theme ZIP'}
                  </button>
                </div>

                {uploadOutput && (
                  <pre className="bg-slate-900 text-emerald-400 text-xs p-3 rounded-lg max-h-40 overflow-y-auto whitespace-pre-wrap">{uploadOutput}</pre>
                )}
              </div>
            </div>
          )}

          {tab === 'auto-update' && (
            <div className="space-y-4">
              <div className="card p-5 space-y-4 max-w-md">
                <p className="text-sm font-bold">Configure Auto-Update for {selected}</p>
                <div className="space-y-2">
                  {([['update_core', 'Update Core'], ['update_plugins', 'Update Plugins'], ['update_themes', 'Update Themes']] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input type="checkbox" checked={autoUpdateForm[k]} onChange={e => setAutoUpdateForm(f => ({ ...f, [k]: e.target.checked }))} />
                      {label}
                    </label>
                  ))}
                </div>
                <div>
                  <label className="label">Schedule</label>
                  <select className="input" value={autoUpdateForm.schedule} onChange={e => setAutoUpdateForm(f => ({ ...f, schedule: e.target.value }))}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={async () => {
                    await api(`/auto-updates/${selected}`, { method: 'PUT', body: JSON.stringify(autoUpdateForm) });
                    const d = await api('/auto-updates').then(r => r.json());
                    setAutoUpdates(Array.isArray(d) ? d : []);
                    toast.success('Auto-update schedule saved');
                  }}>Save Schedule</button>
                  <button className="btn-secondary text-red-500" onClick={async () => {
                    await api(`/auto-updates/${selected}`, { method: 'DELETE' });
                    const d = await api('/auto-updates').then(r => r.json());
                    setAutoUpdates(Array.isArray(d) ? d : []);
                    toast.success('Auto-update removed');
                  }}>Remove</button>
                </div>
              </div>

              <div className="card overflow-hidden p-0">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide px-4 py-3 border-b border-slate-100 dark:border-slate-700">All Scheduled Auto-Updates</p>
                <table className="w-full text-sm">
                  <thead><tr>{['Domain', 'Core', 'Plugins', 'Themes', 'Schedule'].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
                  <tbody>
                    {autoUpdates.length === 0 && <tr><td colSpan={5} className="table-cell text-center text-slate-400">No auto-updates configured</td></tr>}
                    {autoUpdates.map((u: any) => (
                      <tr key={u.domain} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="table-cell font-medium">{u.domain}</td>
                        <td className="table-cell">{u.update_core ? '✓' : '—'}</td>
                        <td className="table-cell">{u.update_plugins ? '✓' : '—'}</td>
                        <td className="table-cell">{u.update_themes ? '✓' : '—'}</td>
                        <td className="table-cell">
                          <span className="badge-blue text-xs">{u.schedule}</span>
                          <span className="ml-2 badge-success text-xs">cron wired</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
