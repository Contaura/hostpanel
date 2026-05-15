import { useEffect, useState, FormEvent, Fragment } from 'react';
import axios from 'axios';
import { Lock, Plus, Trash2, UserPlus, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';

interface Protected {
  directory: string;
  users: string[];
}

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

export default function HtpasswdManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const [dirs, setDirs] = useState<Protected[]>([]);
  const [showProtect, setShowProtect] = useState(false);
  const [showAddUser, setShowAddUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unprotecting, setUnprotecting] = useState<string | null>(null);
  const [protectForm, setProtectForm] = useState({ directory: '', username: '', password: '', realm: 'Protected Area' });
  const [search, setSearch] = useState('');
  const [userForm, setUserForm] = useState({ username: '', password: '' });

  async function load() {
    try { const { data } = await axios.get<Protected[]>('/api/htpasswd/list'); setDirs(data); }
    catch { setDirs([]); }
  }
  useEffect(() => {
    document.title = 'Password Protection — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => { load(); }, []);

  async function protect(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/htpasswd/protect', protectForm);
      toast.success(`${protectForm.directory} is now password protected`);
      setProtectForm({ directory: '', username: '', password: '', realm: 'Protected Area' });
      setShowProtect(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function addUser(directory: string) {
    setLoading(true);
    try {
      await axios.post('/api/htpasswd/add-user', { directory, ...userForm });
      toast.success(`User ${userForm.username} added`);
      setUserForm({ username: '', password: '' }); setShowAddUser(null); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function unprotect(directory: string) {
    if (!await confirm(`Remove password protection from ${directory}?`)) return;
    setUnprotecting(directory);
    try {
      await axios.delete('/api/htpasswd/unprotect', { data: { directory } });
      toast.success('Protection removed'); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setUnprotecting(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Password Protected Directories</h1>
          <p className="page-subtitle">Restrict access to directories with HTTP Basic Auth</p>
        </div>
        <button onClick={() => setShowProtect(v => !v)} className="btn-primary">
          <Plus size={14} /> Protect Directory
        </button>
      </div>

      {showProtect && (
        <form onSubmit={protect} className="card p-5 max-w-md space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Protect a Directory</h2>
          <div>
            <label className="label">Directory Path</label>
            <input className="input font-mono" placeholder="/var/www/example.com/public_html/admin"
              value={protectForm.directory} onChange={e => setProtectForm({ ...protectForm, directory: e.target.value })} required />
          </div>
          <div>
            <label className="label">Auth Realm (shown in browser dialog)</label>
            <input className="input" placeholder="Protected Area"
              value={protectForm.realm} onChange={e => setProtectForm({ ...protectForm, realm: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Initial Username</label>
              <input className="input" placeholder="admin" value={protectForm.username}
                onChange={e => setProtectForm({ ...protectForm, username: e.target.value })}
                pattern="[a-zA-Z0-9_]+" required />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" placeholder="••••••••" value={protectForm.password}
                onChange={e => setProtectForm({ ...protectForm, password: e.target.value })} required />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">
              <Lock size={14} /> {loading ? 'Protecting…' : 'Protect directory'}
            </button>
            <button type="button" onClick={() => setShowProtect(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-56 text-sm" placeholder="Search directories…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className={theadCls}><tr>
              <th className="table-header-cell">Directory</th>
              <th className="table-header-cell hidden md:table-cell">Users</th>
              <th className="px-4 py-3 w-24" />
            </tr></thead>
            <tbody>
              {(() => {
                const q = search.trim().toLowerCase();
                const visible = q ? dirs.filter(d => [d.directory, ...d.users].some(v => v?.toLowerCase().includes(q))) : dirs;
                if (dirs.length === 0) return (
                  <tr><td colSpan={3} className="px-4 py-16 text-center">
                    <Lock className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    <p className="text-slate-400 text-sm">No protected directories</p>
                  </td></tr>
                );
                if (visible.length === 0) return <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-400">No directories match "{search}"</td></tr>;
                return visible.map(d => (
                  <Fragment key={d.directory}>
                    <tr className={rowCls}>
                      <td className="table-cell">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                            <Lock size={13} className="text-amber-600 dark:text-amber-400" />
                          </div>
                          <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{d.directory}</span>
                        </div>
                      </td>
                      <td className="table-cell text-slate-500 dark:text-slate-400 hidden md:table-cell">
                        {d.users.join(', ') || '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setShowAddUser(showAddUser === d.directory ? null : d.directory)}
                            className="btn-icon hover:!text-indigo-600 dark:hover:!text-indigo-400 hover:!bg-indigo-50 dark:hover:!bg-indigo-900/30"
                            title="Add user">
                            <UserPlus size={13} />
                          </button>
                          <button onClick={() => unprotect(d.directory)} disabled={unprotecting === d.directory}
                            className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30"
                            title="Remove protection">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {showAddUser === d.directory && (
                      <tr className="bg-indigo-50/40 dark:bg-indigo-900/10 border-b border-slate-50 dark:border-slate-700/40">
                        <td colSpan={3} className="px-4 py-3">
                          <div className="flex items-center gap-2 max-w-sm">
                            <input className="input flex-1" placeholder="Username" value={userForm.username}
                              onChange={e => setUserForm({ ...userForm, username: e.target.value })} autoFocus />
                            <input type="password" className="input flex-1" placeholder="Password" value={userForm.password}
                              onChange={e => setUserForm({ ...userForm, password: e.target.value })} />
                            <button onClick={() => addUser(d.directory)} disabled={loading} className="btn-primary flex-shrink-0">Add</button>
                            <button onClick={() => setShowAddUser(null)} className="btn-ghost flex-shrink-0">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
