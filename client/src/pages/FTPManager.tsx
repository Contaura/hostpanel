import { useEffect, useState, FormEvent, Fragment } from 'react';
import axios from 'axios';
import { FolderUp, Plus, Trash2, Key, Gauge, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';

interface FTPUser { username: string; directory: string }
interface FTPLimits { max_rate: string }

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

export default function FTPManager() {
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<FTPUser[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [passTarget, setPassTarget] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', password: '', directory: '', max_rate: '' });
  const [newPass, setNewPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [limitsTarget, setLimitsTarget] = useState<string | null>(null);
  const [limitsForm, setLimitsForm] = useState<FTPLimits>({ max_rate: '' });
  const [search, setSearch] = useState('');

  async function load() {
    try {
      const { data } = await axios.get<FTPUser[]>('/api/ftp/users');
      setUsers(data);
    } catch { /* ignore */ } finally { setPageLoading(false); }
  }
  useEffect(() => {
    document.title = 'FTP Accounts — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => { load(); }, []);

  async function saveLimits(username: string) {
    try {
      await axios.put(`/api/ftp/users/${username}/limits`, { max_rate: Number(limitsForm.max_rate) || 0 });
      toast.success('Limits updated'); setLimitsTarget(null);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function createUser(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/ftp/users', { ...form, max_rate: Number(form.max_rate) || 0 });
      toast.success(`FTP user "${form.username}" created`);
      setForm({ username: '', password: '', directory: '', max_rate: '' }); setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function deleteUser(username: string) {
    if (!await confirm(`Delete FTP user "${username}"?`)) return;
    setDeleting(username);
    try { await axios.delete(`/api/ftp/users/${username}`); toast.success(`"${username}" deleted`); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setDeleting(null); }
  }

  async function changePassword(username: string) {
    if (!newPass || newPass.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    try {
      await axios.put(`/api/ftp/users/${username}/password`, { password: newPass });
      toast.success('Password updated'); setNewPass(''); setPassTarget(null);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  if (pageLoading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">FTP Accounts</h1>
          <p className="page-subtitle">Manage vsftpd user accounts and home directories</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <Plus size={14} /> New FTP user
        </button>
      </div>

      {showForm && (
        <form onSubmit={createUser} className="card p-5 space-y-4 max-w-md">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Create FTP User</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Username</label>
              <input className="input" placeholder="ftpuser" value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                pattern="[a-zA-Z0-9_]+" required />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" placeholder="••••••••" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })} required />
            </div>
            <div className="col-span-2">
              <label className="label">Home Directory (blank = /var/www/username)</label>
              <input className="input" placeholder="/var/www/example.com/public_html" value={form.directory}
                onChange={e => setForm({ ...form, directory: e.target.value })} />
            </div>
            <div>
              <label className="label">Bandwidth Limit (bytes/sec, 0 = unlimited)</label>
              <input className="input" type="number" placeholder="0" value={form.max_rate}
                onChange={e => setForm({ ...form, max_rate: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Creating…' : 'Create user'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-48 text-sm" placeholder="Search FTP users…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className={theadCls}><tr>
              <th className="table-header-cell">Username</th>
              <th className="table-header-cell hidden md:table-cell">Home Directory</th>
              <th className="px-4 py-3 w-24" />
            </tr></thead>
            <tbody>
              {(() => {
                const q = search.trim().toLowerCase();
                const visible = q ? users.filter(u => [u.username, u.directory].some(v => v?.toLowerCase().includes(q))) : users;
                if (users.length === 0) return (
                  <tr><td colSpan={3} className="px-4 py-16 text-center">
                    <FolderUp className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    <p className="text-slate-400 text-sm">No FTP accounts yet</p>
                  </td></tr>
                );
                if (visible.length === 0) return (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">No FTP users match "{search}"</td></tr>
                );
                return visible.map(u => (
                  <Fragment key={u.username}>
                    <tr className={rowCls}>
                      <td className="table-cell">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 rounded-lg bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
                            <FolderUp size={13} className="text-orange-500 dark:text-orange-400" />
                          </div>
                          <span className="font-semibold font-mono text-slate-900 dark:text-slate-100">{u.username}</span>
                        </div>
                      </td>
                      <td className="table-cell font-mono text-slate-400 dark:text-slate-500 text-xs hidden md:table-cell">{u.directory}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setPassTarget(passTarget === u.username ? null : u.username)}
                            className="btn-icon hover:!text-indigo-600 dark:hover:!text-indigo-400 hover:!bg-indigo-50 dark:hover:!bg-indigo-900/30"
                            title="Change password"
                          >
                            <Key size={13} />
                          </button>
                          <button
                            onClick={() => { setLimitsTarget(limitsTarget === u.username ? null : u.username); setLimitsForm({ max_rate: '' }); }}
                            className="btn-icon hover:!text-amber-600 hover:!bg-amber-50 dark:hover:!bg-amber-900/30"
                            title="Bandwidth limits"
                          >
                            <Gauge size={13} />
                          </button>
                          <button onClick={() => deleteUser(u.username)} disabled={deleting === u.username}
                            className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {passTarget === u.username && (
                      <tr className="bg-indigo-50/50 dark:bg-indigo-900/20 border-b border-slate-50 dark:border-slate-700/40">
                        <td colSpan={3} className="px-4 py-3">
                          <div className="flex items-center gap-2 max-w-sm">
                            <Key size={14} className="text-indigo-400 flex-shrink-0" />
                            <input type="password" className="input flex-1" placeholder="New password (min 6 chars)"
                              value={newPass} onChange={e => setNewPass(e.target.value)} autoFocus />
                            <button onClick={() => changePassword(u.username)} className="btn-primary flex-shrink-0">Update</button>
                            <button onClick={() => setPassTarget(null)} className="btn-ghost flex-shrink-0">Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {limitsTarget === u.username && (
                      <tr className="bg-amber-50/50 dark:bg-amber-900/20 border-b border-slate-50 dark:border-slate-700/40">
                        <td colSpan={3} className="px-4 py-3">
                          <div className="flex items-center gap-2 max-w-sm">
                            <Gauge size={14} className="text-amber-500 flex-shrink-0" />
                            <input type="number" className="input flex-1" placeholder="Max bandwidth (bytes/sec, 0=unlimited)"
                              value={limitsForm.max_rate} onChange={e => setLimitsForm({ max_rate: e.target.value })} autoFocus />
                            <button onClick={() => saveLimits(u.username)} className="btn-primary flex-shrink-0">Save</button>
                            <button onClick={() => setLimitsTarget(null)} className="btn-ghost flex-shrink-0">Cancel</button>
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
