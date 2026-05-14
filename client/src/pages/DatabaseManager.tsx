import { useEffect, useState, FormEvent, useRef } from 'react';
import axios from 'axios';
import { Database, User, Plus, Trash2, Download, Upload, Shield, ExternalLink } from 'lucide-react';
import { useToast } from '../components/Toast';

interface DB { name: string; size_mb: number | null }
interface DBUser { user: string; host: string }

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

const ALL_PRIVS = ['SELECT','INSERT','UPDATE','DELETE','CREATE','DROP','INDEX','ALTER','CREATE TEMPORARY TABLES','LOCK TABLES','EXECUTE','CREATE VIEW','SHOW VIEW','CREATE ROUTINE','ALTER ROUTINE','EVENT','TRIGGER'];

export default function DatabaseManager() {
  const toast = useToast();
  const [databases, setDatabases] = useState<DB[]>([]);
  const [users, setUsers] = useState<DBUser[]>([]);
  const [tab, setTab] = useState<'databases' | 'users' | 'slow-query' | 'remote-access'>('databases');
  const [slowLog, setSlowLog] = useState<any>(null);
  const [slowLoading, setSlowLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [dbForm, setDbForm] = useState({ name: '' });
  const [userForm, setUserForm] = useState({ username: '', password: '', database: '', host: 'localhost' });
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [importTarget, setImportTarget] = useState('');
  const [privTarget, setPrivTarget] = useState<DBUser | null>(null);
  const [grants, setGrants] = useState<any>(null);
  const [newPrivs, setNewPrivs] = useState<Set<string>>(new Set());
  const [newPrivDb, setNewPrivDb] = useState('');
  const [pmaUrl, setPmaUrl] = useState<string | null>(null);
  const [remoteAccess, setRemoteAccess] = useState<{ user: string; host: string }[]>([]);
  const [raForm, setRaForm] = useState({ user: '', host: '%', database: '*', privileges: ['ALL PRIVILEGES'] });
  const [raLoading, setRaLoading] = useState(false);

  useEffect(() => {
    axios.get('/api/databases/phpmyadmin').then(r => { if (r.data?.installed) setPmaUrl(r.data.url || '/phpMyAdmin'); }).catch(() => {});
  }, []);

  async function load() {
    const [dbs, us] = await Promise.all([
      axios.get<DB[]>('/api/databases/databases'),
      axios.get<DBUser[]>('/api/databases/users'),
    ]);
    setDatabases(dbs.data); setUsers(us.data);
  }
  useEffect(() => { load(); }, []);

  async function createDb(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/databases/databases', dbForm);
      toast.success(`Database "${dbForm.name}" created`);
      setDbForm({ name: '' }); setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function deleteDb(name: string) {
    if (!confirm(`Drop database "${name}"? All data will be permanently deleted.`)) return;
    try { await axios.delete(`/api/databases/databases/${name}`); toast.success(`Database "${name}" dropped`); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function createUser(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/databases/users', userForm);
      toast.success(`User "${userForm.username}" created`);
      setUserForm({ username: '', password: '', database: '', host: 'localhost' }); setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function deleteUser(user: string, host: string) {
    if (!confirm(`Delete user "${user}"?`)) return;
    try { await axios.delete(`/api/databases/users/${user}`, { params: { host } }); toast.success(`User "${user}" deleted`); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  function exportDb(name: string) {
    const token = localStorage.getItem('hp_token') || '';
    const a = document.createElement('a');
    a.href = `/api/databases/${name}/export`;
    // set auth via a short-lived blob workaround isn't needed — use fetch+blob
    fetch(`/api/databases/${name}/export`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => { a.href = URL.createObjectURL(blob); a.download = `${name}.sql.gz`; a.click(); })
      .catch(() => toast.error('Export failed'));
  }

  async function openPrivEditor(u: DBUser) {
    setPrivTarget(u); setNewPrivs(new Set()); setNewPrivDb('');
    try {
      const r = await axios.get(`/api/databases/users/${u.user}/grants`, { params: { host: u.host } });
      setGrants(r.data);
    } catch { setGrants(null); }
  }

  async function grantPrivs() {
    if (!privTarget || !newPrivs.size) return;
    await axios.post(`/api/databases/users/${privTarget.user}/grants`, { host: privTarget.host, database: newPrivDb || undefined, privileges: Array.from(newPrivs) });
    toast.success('Privileges granted');
    openPrivEditor(privTarget);
  }

  async function revokeAll() {
    if (!privTarget) return;
    if (!confirm('Revoke ALL privileges for this user?')) return;
    await axios.delete(`/api/databases/users/${privTarget.user}/grants`, { data: { host: privTarget.host } });
    toast.success('All privileges revoked');
    openPrivEditor(privTarget);
  }

  async function loadRemoteAccess() {
    try { const { data } = await axios.get('/api/databases/remote-access'); setRemoteAccess(data); }
    catch { toast.error('Failed to load remote access users'); }
  }

  async function grantRemoteAccess() {
    if (!raForm.user || !raForm.host) { toast.error('User and host required'); return; }
    setRaLoading(true);
    try {
      await axios.post('/api/databases/remote-access', raForm);
      toast.success(`Remote access granted for ${raForm.user}@${raForm.host}`);
      setRaForm({ user: '', host: '%', database: '*', privileges: ['ALL PRIVILEGES'] });
      loadRemoteAccess();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setRaLoading(false); }
  }

  async function revokeRemoteAccess(user: string, host: string) {
    if (!confirm(`Revoke remote access for ${user}@${host}?`)) return;
    try {
      await axios.delete(`/api/databases/remote-access/${user}/${encodeURIComponent(host)}`);
      toast.success('Remote access revoked'); loadRemoteAccess();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function loadSlowLog() {
    setSlowLoading(true);
    try {
      const { data } = await axios.get('/api/databases/slow-query-log');
      setSlowLog(data);
    } catch (e: any) { toast.error('Failed to load slow query log'); }
    finally { setSlowLoading(false); }
  }

  async function importDb(file: File) {
    if (!importTarget) { toast.error('Select a database first'); return; }
    setImporting(importTarget);
    const fd = new FormData();
    fd.append('file', file);
    const token = localStorage.getItem('hp_token') || '';
    try {
      await axios.post(`/api/databases/${importTarget}/import`, fd, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } });
      toast.success(`Imported into ${importTarget}`);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Import failed'); }
    setImporting(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Database Management</h1>
          <p className="page-subtitle">Manage MariaDB databases and users</p>
        </div>
        <div className="flex gap-2">
          {pmaUrl && <a href={pmaUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary"><ExternalLink size={14} /> phpMyAdmin</a>}
          <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={14} /> New {tab === 'databases' ? 'Database' : 'User'}</button>
        </div>
      </div>

      <div className="tab-bar">
        {(['databases', 'users', 'slow-query', 'remote-access'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setShowForm(false); if (t === 'slow-query') loadSlowLog(); if (t === 'remote-access') loadRemoteAccess(); }}
            className={tab === t ? 'tab-item-active' : 'tab-item'}>
            {t === 'databases' ? `Databases (${databases.length})` : t === 'users' ? `Users (${users.length})` : t === 'slow-query' ? 'Slow Query Log' : 'Remote Access'}
          </button>
        ))}
      </div>

      {showForm && tab === 'databases' && (
        <form onSubmit={createDb} className="card p-5 space-y-4 max-w-sm">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Create Database</h2>
          <div>
            <label className="label">Database Name</label>
            <input className="input" placeholder="my_database" value={dbForm.name}
              onChange={e => setDbForm({ name: e.target.value })}
              pattern="[a-zA-Z0-9_]+" required />
            <p className="text-xs text-slate-400 mt-1">Alphanumeric and underscores only</p>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Creating…' : 'Create'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {showForm && tab === 'users' && (
        <form onSubmit={createUser} className="card p-5 space-y-4 max-w-md">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Create Database User</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Username</label>
              <input className="input" placeholder="dbuser" value={userForm.username}
                onChange={e => setUserForm({ ...userForm, username: e.target.value })} pattern="[a-zA-Z0-9_]+" required />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" placeholder="••••••••" value={userForm.password}
                onChange={e => setUserForm({ ...userForm, password: e.target.value })} required />
            </div>
            <div>
              <label className="label">Grant to database</label>
              <select className="input" value={userForm.database}
                onChange={e => setUserForm({ ...userForm, database: e.target.value })}>
                <option value="">— None —</option>
                {databases.map(db => <option key={db.name} value={db.name}>{db.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Host</label>
              <input className="input" value={userForm.host}
                onChange={e => setUserForm({ ...userForm, host: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Creating…' : 'Create user'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {tab === 'databases' && (
        <>
          <input ref={importRef} type="file" accept=".sql,.sql.gz,.gz" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importDb(f); e.target.value = ''; }} />
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className={theadCls}><tr>
                <th className="table-header-cell">Database</th>
                <th className="table-header-cell hidden md:table-cell">Size</th>
                <th className="table-header-cell hidden lg:table-cell">Encoding</th>
                <th className="px-4 py-3" />
              </tr></thead>
              <tbody>
                {databases.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-16 text-center">
                    <Database className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    <p className="text-slate-400 text-sm">No databases yet</p>
                  </td></tr>
                ) : databases.map(db => (
                  <tr key={db.name} className={rowCls}>
                    <td className="table-cell">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                          <Database size={13} className="text-blue-500 dark:text-blue-400" />
                        </div>
                        <span className="font-semibold font-mono text-slate-900 dark:text-slate-100">{db.name}</span>
                      </div>
                    </td>
                    <td className="table-cell text-slate-500 dark:text-slate-400 hidden md:table-cell">
                      {db.size_mb !== null ? `${db.size_mb} MB` : '—'}
                    </td>
                    <td className="table-cell hidden lg:table-cell"><span className="badge badge-gray">utf8mb4</span></td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        <button onClick={() => exportDb(db.name)} className="btn-icon text-blue-500" title="Export"><Download size={13} /></button>
                        <button onClick={() => { setImportTarget(db.name); importRef.current?.click(); }} className="btn-icon text-amber-500" title="Import" disabled={importing === db.name}><Upload size={13} /></button>
                        <button onClick={() => deleteDb(db.name)} className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'users' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className={theadCls}><tr>
              <th className="table-header-cell">Username</th>
              <th className="table-header-cell">Host</th>
              <th className="px-4 py-3 w-12" />
            </tr></thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-16 text-center">
                  <User className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                  <p className="text-slate-400 text-sm">No database users</p>
                </td></tr>
              ) : users.map(u => (
                <tr key={`${u.user}@${u.host}`} className={rowCls}>
                  <td className="table-cell">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                        <User size={13} className="text-violet-600 dark:text-violet-400" />
                      </div>
                      <span className="font-semibold font-mono text-slate-900 dark:text-slate-100">{u.user}</span>
                    </div>
                  </td>
                  <td className="table-cell font-mono text-slate-500 dark:text-slate-400">{u.host}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                      <button onClick={() => openPrivEditor(u)} className="btn-icon text-indigo-500" title="Manage Privileges"><Shield size={13} /></button>
                      <button onClick={() => deleteUser(u.user, u.host)} className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'slow-query' && (
        <div className="space-y-4">
          {slowLoading && <p className="text-slate-400 text-sm">Loading slow query log…</p>}
          {slowLog && (
            <>
              <div className="card p-4 flex items-center gap-6 flex-wrap">
                <div>
                  <p className="text-xs text-slate-500">Slow Query Log</p>
                  <span className={`badge-${slowLog.enabled ? 'success' : 'danger'} mt-1`}>{slowLog.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Long Query Time</p>
                  <p className="text-sm font-mono font-bold">{slowLog.long_query_time}s</p>
                </div>
                <div className="flex-1">
                  <p className="text-xs text-slate-500">Log File</p>
                  <p className="text-sm font-mono text-slate-600 dark:text-slate-400">{slowLog.log_file || 'not configured'}</p>
                </div>
                <div className="flex gap-2 items-end">
                  <button className={slowLog.enabled ? 'btn-danger' : 'btn-primary'} onClick={async () => {
                    await axios.put('/api/databases/slow-query-log', { enabled: !slowLog.enabled, long_query_time: slowLog.long_query_time });
                    toast.success(slowLog.enabled ? 'Slow query log disabled' : 'Slow query log enabled');
                    loadSlowLog();
                  }}>{slowLog.enabled ? 'Disable' : 'Enable'}</button>
                </div>
              </div>
              <div className="card bg-slate-950 p-4 max-h-[50vh] overflow-y-auto">
                {slowLog.lines.length === 0 ? (
                  <p className="text-slate-500 text-xs">No slow query entries found.</p>
                ) : slowLog.lines.map((line: string, i: number) => (
                  <div key={i} className="text-xs font-mono text-slate-300 py-0.5 border-b border-slate-800/50 last:border-0">{line}</div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Privilege editor modal */}
      {tab === 'remote-access' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-sm">Grant Remote Access</h3>
            <p className="text-xs text-slate-500">Creates a user@host grant so external hosts can connect. Use <code className="font-mono">%</code> as host wildcard.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Username</label>
                <select className="input" value={raForm.user} onChange={e => setRaForm(f => ({ ...f, user: e.target.value }))}>
                  <option value="">Select existing user…</option>
                  {users.map(u => <option key={u.user} value={u.user}>{u.user}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Remote Host</label>
                <input className="input font-mono" placeholder="% or 192.168.1.%" value={raForm.host} onChange={e => setRaForm(f => ({ ...f, host: e.target.value }))} />
              </div>
              <div>
                <label className="label">Database</label>
                <select className="input" value={raForm.database} onChange={e => setRaForm(f => ({ ...f, database: e.target.value }))}>
                  <option value="*">All databases (*.*)</option>
                  {databases.map(db => <option key={db.name} value={db.name}>{db.name}</option>)}
                </select>
              </div>
            </div>
            <button className="btn-primary" onClick={grantRemoteAccess} disabled={raLoading}>{raLoading ? 'Granting…' : 'Grant Access'}</button>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className={theadCls}><tr>
                <th className="table-header-cell">Username</th>
                <th className="table-header-cell">Remote Host</th>
                <th className="px-4 py-3 w-12" />
              </tr></thead>
              <tbody>
                {remoteAccess.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-12 text-center text-slate-400 text-sm">No remote access grants configured</td></tr>
                ) : remoteAccess.map(ra => (
                  <tr key={`${ra.user}@${ra.host}`} className={rowCls}>
                    <td className="table-cell font-mono font-medium">{ra.user}</td>
                    <td className="table-cell font-mono text-slate-500">{ra.host}</td>
                    <td className="px-3 py-3">
                      <button className="btn-icon hover:!text-rose-600 opacity-0 group-hover:opacity-100" onClick={() => revokeRemoteAccess(ra.user, ra.host)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {privTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPrivTarget(null)}>
          <div className="card p-5 w-[520px] space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-sm">Privileges — {privTarget.user}@{privTarget.host}</h3>

            {grants?.database?.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-2 font-medium">Current database grants</p>
                <div className="space-y-1">
                  {grants.database.map((g: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-800 rounded px-3 py-1.5">
                      <span className="font-mono">{g.db_name}</span>
                      <span className="text-slate-500">{g.PRIVILEGE_TYPE}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
              <p className="text-xs font-medium">Grant additional privileges</p>
              <div>
                <label className="label">Database (leave blank for global)</label>
                <select className="input" value={newPrivDb} onChange={e => setNewPrivDb(e.target.value)}>
                  <option value="">Global (*.*)</option>
                  {databases.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Privileges</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {ALL_PRIVS.map(p => (
                    <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={newPrivs.has(p)} onChange={e => setNewPrivs(s => { const n = new Set(s); e.target.checked ? n.add(p) : n.delete(p); return n; })} />
                      <span>{p}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button className="btn-primary" onClick={grantPrivs} disabled={!newPrivs.size}>Grant Selected</button>
              <button className="btn-secondary text-red-500" onClick={revokeAll}>Revoke All</button>
              <button className="btn-ghost ml-auto" onClick={() => setPrivTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
