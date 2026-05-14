import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Database, User, Plus, Trash2 } from 'lucide-react';
import { useToast } from '../components/Toast';

interface DB { name: string; size_mb: number | null }
interface DBUser { user: string; host: string }

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

export default function DatabaseManager() {
  const toast = useToast();
  const [databases, setDatabases] = useState<DB[]>([]);
  const [users, setUsers] = useState<DBUser[]>([]);
  const [tab, setTab] = useState<'databases' | 'users'>('databases');
  const [showForm, setShowForm] = useState(false);
  const [dbForm, setDbForm] = useState({ name: '' });
  const [userForm, setUserForm] = useState({ username: '', password: '', database: '', host: 'localhost' });
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Database Management</h1>
          <p className="page-subtitle">Manage MariaDB databases and users</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <Plus size={14} /> New {tab === 'databases' ? 'Database' : 'User'}
        </button>
      </div>

      <div className="tab-bar">
        {(['databases', 'users'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
            className={tab === t ? 'tab-item-active' : 'tab-item'}>
            {t === 'databases' ? `Databases (${databases.length})` : `Users (${users.length})`}
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
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className={theadCls}><tr>
              <th className="table-header-cell">Database</th>
              <th className="table-header-cell hidden md:table-cell">Size</th>
              <th className="table-header-cell hidden lg:table-cell">Encoding</th>
              <th className="px-4 py-3 w-12" />
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
                    <button onClick={() => deleteDb(db.name)}
                      className="btn-icon opacity-0 group-hover:opacity-100 hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                    <button onClick={() => deleteUser(u.user, u.host)}
                      className="btn-icon opacity-0 group-hover:opacity-100 hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
