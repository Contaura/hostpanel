import { useEffect, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/resource-limits${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

export default function ResourceLimits() {
  const toast = useToast();
  const [tab, setTab] = useState<'cgroups' | 'nginx'>('cgroups');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [vhosts, setVhosts] = useState<any[]>([]);
  const [limits, setLimits] = useState<Record<string, any>>({});
  const [newVhost, setNewVhost] = useState({ domain: '', root: '', php_fpm_socket: '' });
  const [addingVhost, setAddingVhost] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const r = await api('/');
    setAccounts(Array.isArray(await r.clone().json()) ? await r.json() : []);
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
    await api(`/nginx/vhosts/${domain}`, { method: 'DELETE' });
    loadVhosts();
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Resource Limits</h1>

      <div className="tab-bar">
        <button className={`tab-item ${tab === 'cgroups' ? 'tab-item-active' : ''}`} onClick={() => setTab('cgroups')}>cgroup Limits</button>
        <button className={`tab-item ${tab === 'nginx' ? 'tab-item-active' : ''}`} onClick={() => { setTab('nginx'); loadVhosts(); }}>Nginx Vhosts</button>
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

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead><tr>{['Domain', 'Server Name', 'Root', 'Status', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
              <tbody>
                {vhosts.length === 0 && <tr><td colSpan={5} className="table-cell text-center text-slate-500">No vhosts</td></tr>}
                {vhosts.map((v: any) => (
                  <tr key={v.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="table-cell font-mono text-xs">{v.name}</td>
                    <td className="table-cell text-xs">{v.serverName}</td>
                    <td className="table-cell text-xs text-slate-500 truncate max-w-[180px]">{v.root}</td>
                    <td className="table-cell"><span className={`badge-${v.enabled ? 'success' : 'warning'}`}>{v.enabled ? 'Enabled' : 'Disabled'}</span></td>
                    <td className="table-cell"><button className="btn-icon text-red-500" onClick={() => deleteVhost(v.name)}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
