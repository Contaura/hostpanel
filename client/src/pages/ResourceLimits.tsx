import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, BarChart2, Search } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/resource-limits${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

export default function ResourceLimits() {
  const toast = useToast();
  const [tab, setTab] = useState<'cgroups' | 'nginx' | 'quotas' | 'io-stats'>('cgroups');
  const [diskQuotas, setDiskQuotas] = useState<any[]>([]);
  const [quotaForm, setQuotaForm] = useState<Record<string, { soft: string; hard: string }>>({});
  const [accounts, setAccounts] = useState<any[]>([]);
  const [vhosts, setVhosts] = useState<any[]>([]);
  const [limits, setLimits] = useState<Record<string, any>>({});
  const [newVhost, setNewVhost] = useState({ domain: '', root: '', php_fpm_socket: '' });
  const [addingVhost, setAddingVhost] = useState(false);
  const [vhostSearch, setVhostSearch] = useState('');
  const [quotaSearch, setQuotaSearch] = useState('');
  const [deletingVhost, setDeletingVhost] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api('/');
      setAccounts(Array.isArray(await r.clone().json()) ? await r.json() : []);
    } finally { setPageLoading(false); }
  }

  async function loadVhosts() {
    const r = await api('/nginx/vhosts');
    setVhosts(await r.json());
  }

  async function saveLimits(username: string) {
    const l = limits[username] || {};
    const r = await api(`/${username}`, { method: 'POST', body: JSON.stringify(l) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else toast.success(`Limits set for ${username}`);
  }

  async function createVhost() {
    const r = await api('/nginx/vhosts', { method: 'POST', body: JSON.stringify(newVhost) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success('Vhost created'); setAddingVhost(false); setNewVhost({ domain: '', root: '', php_fpm_socket: '' }); loadVhosts(); }
  }

  async function deleteVhost(domain: string) {
    if (!confirm(`Delete vhost for ${domain}?`)) return;
    setDeletingVhost(domain);
    try {
      await api(`/nginx/vhosts/${domain}`, { method: 'DELETE' });
      loadVhosts();
    } finally { setDeletingVhost(null); }
  }

  const [ioUser, setIoUser] = useState('');
  const [ioStats, setIoStats] = useState<any>(null);
  const [ioLoading, setIoLoading] = useState(false);

  async function loadIoStats() {
    if (!ioUser.trim()) return;
    setIoLoading(true);
    const r = await api(`/${ioUser.trim()}/io-stats`);
    const d = await r.json();
    setIoStats(d.error ? null : d);
    if (d.error) toast.error(d.error);
    setIoLoading(false);
  }

  async function loadDiskQuotas() {
    const r = await api('/disk-quotas');
    const d = await r.json();
    setDiskQuotas(Array.isArray(d) ? d : []);
  }

  async function setDiskQuota(username: string) {
    const q = quotaForm[username] || {};
    const r = await api(`/disk-quotas/${username}`, { method: 'POST', body: JSON.stringify({ block_soft_mb: parseInt(q.soft) || 0, block_hard_mb: parseInt(q.hard) || 0 }) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success(`Quota set for ${username}`); loadDiskQuotas(); }
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Resource Limits</h1>

      {pageLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
      <>

      <div className="tab-bar">
        <button className={`tab-item ${tab === 'cgroups' ? 'tab-item-active' : ''}`} onClick={() => setTab('cgroups')}>cgroup Limits</button>
        <button className={`tab-item ${tab === 'nginx' ? 'tab-item-active' : ''}`} onClick={() => { setTab('nginx'); loadVhosts(); }}>Nginx Vhosts</button>
        <button className={`tab-item ${tab === 'quotas' ? 'tab-item-active' : ''}`} onClick={() => { setTab('quotas'); loadDiskQuotas(); }}>Disk Quotas</button>
        <button className={`tab-item ${tab === 'io-stats' ? 'tab-item-active' : ''}`} onClick={() => setTab('io-stats')}><BarChart2 size={13} /> Disk I/O</button>
      </div>

      {tab === 'cgroups' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Set per-account CPU, memory and I/O limits via Linux cgroup v2. Requires the server to have cgroup v2 mounted at <code>/sys/fs/cgroup</code>.</p>
          {accounts.length === 0 && <p className="text-sm text-slate-500">No hosting accounts found.</p>}
          {accounts.map((a: any) => (
            <div key={a.username} className="card space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{a.username}</span>
                <span className="text-xs text-slate-500">{a.plan_name}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">CPU Quota (%)</label>
                  <input
                    className="input"
                    type="number" min="1" max="400" placeholder="e.g. 100"
                    value={limits[a.username]?.cpu_quota ?? ''}
                    onChange={e => setLimits(l => ({ ...l, [a.username]: { ...l[a.username], cpu_quota: Number(e.target.value) } }))}
                  />
                </div>
                <div>
                  <label className="label">Memory Limit (MB)</label>
                  <input
                    className="input"
                    type="number" min="64" placeholder="e.g. 512"
                    value={limits[a.username]?.memory_limit_mb ?? ''}
                    onChange={e => setLimits(l => ({ ...l, [a.username]: { ...l[a.username], memory_limit_mb: Number(e.target.value) } }))}
                  />
                </div>
                <div>
                  <label className="label">I/O Weight (1–1000)</label>
                  <input
                    className="input"
                    type="number" min="1" max="1000" placeholder="e.g. 100"
                    value={limits[a.username]?.io_weight ?? ''}
                    onChange={e => setLimits(l => ({ ...l, [a.username]: { ...l[a.username], io_weight: Number(e.target.value) } }))}
                  />
                </div>
              </div>
              <button className="btn-primary text-xs" onClick={() => saveLimits(a.username)}><Save size={12} className="mr-1" />Apply Limits</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'nginx' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setAddingVhost(true)}><Plus size={14} className="mr-1" />New Vhost</button>
          </div>

          {addingVhost && (
            <div className="card space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Domain</label><input className="input" placeholder="example.com" value={newVhost.domain} onChange={e => setNewVhost(v => ({ ...v, domain: e.target.value }))} /></div>
                <div><label className="label">Root Path</label><input className="input" placeholder="/var/www/example.com/public_html" value={newVhost.root} onChange={e => setNewVhost(v => ({ ...v, root: e.target.value }))} /></div>
                <div className="col-span-2"><label className="label">PHP-FPM Socket (optional)</label><input className="input font-mono" placeholder="/var/run/php-fpm/php8.1-fpm.sock" value={newVhost.php_fpm_socket} onChange={e => setNewVhost(v => ({ ...v, php_fpm_socket: e.target.value }))} /></div>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-sm" onClick={createVhost}>Create</button>
                <button className="btn-ghost text-sm" onClick={() => setAddingVhost(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search vhosts…" value={vhostSearch} onChange={e => setVhostSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead><tr>{['Domain', 'Server Name', 'Root', 'Status', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
                <tbody>
                  {(() => {
                    const q = vhostSearch.trim().toLowerCase();
                    const visible = q ? vhosts.filter((v: any) => [v.name, v.serverName, v.root].some((x: any) => String(x ?? '').toLowerCase().includes(q))) : vhosts;
                    if (vhosts.length === 0) return <tr><td colSpan={5} className="table-cell text-center text-slate-500">No vhosts</td></tr>;
                    if (visible.length === 0) return <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No vhosts match "{vhostSearch}"</td></tr>;
                    return visible.map((v: any) => (
                      <tr key={v.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="table-cell font-mono text-xs">{v.name}</td>
                        <td className="table-cell text-xs">{v.serverName}</td>
                        <td className="table-cell text-xs text-slate-500 truncate max-w-[180px]">{v.root}</td>
                        <td className="table-cell"><span className={`badge-${v.enabled ? 'success' : 'warning'}`}>{v.enabled ? 'Enabled' : 'Disabled'}</span></td>
                        <td className="table-cell"><button className="btn-icon text-red-500" disabled={deletingVhost === v.name} onClick={() => deleteVhost(v.name)}><Trash2 size={13} /></button></td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {tab === 'quotas' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">Set disk space limits per user via <code>setquota</code>. Requires quota kernel support and the <code>quota</code> package.</p>
          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search users…" value={quotaSearch} onChange={e => setQuotaSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead><tr>
                  {['User', 'Used', 'Soft Limit (MB)', 'Hard Limit (MB)', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}
                </tr></thead>
                <tbody>
                  {(() => {
                    const q = quotaSearch.trim().toLowerCase();
                    const visible = q ? diskQuotas.filter((dq: any) => String(dq.user ?? '').toLowerCase().includes(q)) : diskQuotas;
                    if (diskQuotas.length === 0) return <tr><td colSpan={5} className="table-cell text-center text-slate-400 py-8">No quota data. Click an account username below to set quotas.</td></tr>;
                    if (visible.length === 0) return <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No users match "{quotaSearch}"</td></tr>;
                    return visible.map((dq: any) => (
                      <tr key={dq.user} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="table-cell font-mono font-bold">{dq.user}</td>
                        <td className="table-cell text-xs">{dq.block_used}</td>
                        <td className="table-cell"><input type="number" className="input w-24 text-xs" placeholder="MB" value={quotaForm[dq.user]?.soft || ''} onChange={e => setQuotaForm(f => ({ ...f, [dq.user]: { ...(f[dq.user] || {}), soft: e.target.value } }))} /></td>
                        <td className="table-cell"><input type="number" className="input w-24 text-xs" placeholder="MB" value={quotaForm[dq.user]?.hard || ''} onChange={e => setQuotaForm(f => ({ ...f, [dq.user]: { ...(f[dq.user] || {}), hard: e.target.value } }))} /></td>
                        <td className="table-cell"><button className="btn-primary text-xs" onClick={() => setDiskQuota(dq.user)}><Save size={12} /> Set</button></td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card p-4 space-y-3 max-w-sm">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Set quota for a specific user</p>
            {accounts.map((a: any) => (
              <div key={a.username} className="flex items-center gap-2">
                <span className="text-sm w-28 truncate font-mono">{a.username}</span>
                <input type="number" className="input w-20 text-xs" placeholder="Soft MB" value={quotaForm[a.username]?.soft || ''} onChange={e => setQuotaForm(f => ({ ...f, [a.username]: { ...(f[a.username] || {}), soft: e.target.value } }))} />
                <input type="number" className="input w-20 text-xs" placeholder="Hard MB" value={quotaForm[a.username]?.hard || ''} onChange={e => setQuotaForm(f => ({ ...f, [a.username]: { ...(f[a.username] || {}), hard: e.target.value } }))} />
                <button className="btn-primary text-xs" onClick={() => setDiskQuota(a.username)}><Save size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'io-stats' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">View real-time cgroup v2 I/O statistics and disk usage for a hosting account.</p>
          <div className="card p-5 max-w-md space-y-3">
            <div className="flex gap-2">
              <input className="input flex-1 font-mono" placeholder="username" value={ioUser}
                onChange={e => setIoUser(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadIoStats()} />
              <button className="btn-primary" onClick={loadIoStats} disabled={ioLoading}>
                <BarChart2 size={14} /> {ioLoading ? 'Loading…' : 'Load Stats'}
              </button>
            </div>
          </div>

          {ioStats && (
            <div className="space-y-3 max-w-xl">
              <div className="grid grid-cols-2 gap-3">
                <div className="card p-4">
                  <p className="text-xs text-slate-500 mb-1">Disk Used</p>
                  <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    {(ioStats.disk_used_bytes / 1024 / 1024).toFixed(1)} MB
                  </p>
                </div>
                <div className="card p-4">
                  <p className="text-xs text-slate-500 mb-1">cgroup Path</p>
                  <p className="text-xs font-mono text-slate-600 dark:text-slate-400 break-all mt-1">{ioStats.cgroup_path}</p>
                </div>
              </div>

              {ioStats.io_stat?.length > 0 && (
                <div className="card overflow-hidden">
                  <p className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide border-b border-slate-100 dark:border-slate-700">I/O Statistics</p>
                  <table className="w-full text-sm">
                    <thead><tr>
                      {['rbytes', 'wbytes', 'rios', 'wios'].map(h => (
                        <th key={h} className="table-header-cell">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {ioStats.io_stat.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="table-cell font-mono text-xs">{((row.rbytes || 0) / 1024 / 1024).toFixed(2)} MB</td>
                          <td className="table-cell font-mono text-xs">{((row.wbytes || 0) / 1024 / 1024).toFixed(2)} MB</td>
                          <td className="table-cell font-mono text-xs">{row.rios ?? 0}</td>
                          <td className="table-cell font-mono text-xs">{row.wios ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
