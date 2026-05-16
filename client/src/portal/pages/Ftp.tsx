import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, adel, FtpUser } from '../api';
import { usePortalAuth } from '../PortalAuthContext';
import { PageTitle } from '../components';

export default function Ftp() {
  const toast = useToast();
  const confirm = useConfirm();
  const { selectedAccount } = usePortalAuth();
  const [users, setUsers] = useState<FtpUser[]>([]);
  const [form, setForm]   = useState({ username: '', password: '' });
  const [busy, setBusy]   = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    try { const r = await api<FtpUser[]>('/api/portal/ftp/users'); setUsers(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function add() {
    if (!selectedAccount) return toast.error('Select a hosting account first');
    if (!form.username || !form.password) return;
    if (form.password.length < 8) return toast.error('Password must be ≥ 8 chars');
    setBusy(true);
    try { await apost('/api/portal/ftp/users', { username: form.username, password: form.password, domain: selectedAccount.domain }); toast.success('FTP user created'); setForm({ username: '', password: '' }); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(username: string) {
    if (!await confirm(`Delete FTP user ${username}?`)) return;
    setBusy(true);
    try { await adel(`/api/portal/ftp/users/${encodeURIComponent(username)}`); toast.success('FTP user deleted'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  const prefix = selectedAccount?.username ? selectedAccount.username + '_' : '';

  return (
    <div>
      <PageTitle title="FTP Accounts" subtitle={selectedAccount ? `FTP users are chrooted to /var/www/${selectedAccount.domain}/public_html.` : 'Pick an account in the sidebar to add a new FTP user.'} />
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-4">
            <label className="label text-xs">Username</label>
            <div className="flex items-center">
              <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-r-0 border-slate-300 dark:border-slate-700 rounded-l text-xs text-slate-500 font-mono">{prefix}</span>
              <input className="input rounded-l-none font-mono" placeholder="suffix" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value.replace(/[^a-z0-9_]/g, '') }))} />
            </div>
          </div>
          <div className="col-span-5">
            <label className="label text-xs">Password</label>
            <input className="input" type="password" placeholder="min 8 characters" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <button className="btn-primary col-span-3 text-xs" onClick={add} disabled={busy || !selectedAccount}><Plus size={12} /> Create</button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
            <th className="text-left py-2 px-1">Username</th><th className="text-left">Home</th><th></th>
          </tr></thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400 text-xs">No FTP users</td></tr>}
            {users.map(u => (
              <tr key={u.username} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs">{u.username}</td>
                <td className="text-xs text-slate-500 font-mono truncate max-w-[260px]">{u.directory || '—'}</td>
                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => del(u.username)} disabled={busy}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
