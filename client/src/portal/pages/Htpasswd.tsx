import { useEffect, useState } from 'react';
import axios from 'axios';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, portalAuthHeader, HtpasswdEntry } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Htpasswd() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<HtpasswdEntry[]>([]);
  const [form, setForm] = useState({ subpath: '', username: '', password: '', realm: 'Protected Area' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, [domain]);
  async function load() {
    try { const r = await api<HtpasswdEntry[]>(`/api/portal/htpasswd/${domain}`); setList(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function add() {
    if (!form.subpath || !form.username || !form.password) return;
    setBusy(true);
    try { await apost(`/api/portal/htpasswd/${domain}`, form); toast.success('Directory protected'); setForm({ subpath: '', username: '', password: '', realm: 'Protected Area' }); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function unprotect(subpath: string) {
    if (!await confirm(`Remove password protection for ${subpath}?`)) return;
    try {
      await axios.delete(`/api/portal/htpasswd/${domain}`, { headers: portalAuthHeader(), data: { subpath } });
      toast.success('Unprotected'); await load();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  return (
    <div>
      <PageTitle title="Protected Directories" subtitle="Password-protect a folder under public_html/. Visitors get an HTTP Basic Auth prompt." />
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3"><label className="label text-xs">Subfolder</label><input className="input font-mono text-xs" placeholder="admin" value={form.subpath} onChange={e => setForm(f => ({ ...f, subpath: e.target.value.replace(/^\/+|\/$/g, '') }))} /></div>
          <div className="col-span-2"><label className="label text-xs">Username</label><input className="input font-mono text-xs" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') }))} /></div>
          <div className="col-span-3"><label className="label text-xs">Password</label><input className="input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></div>
          <div className="col-span-2"><label className="label text-xs">Realm</label><input className="input text-xs" value={form.realm} onChange={e => setForm(f => ({ ...f, realm: e.target.value }))} /></div>
          <button className="btn-primary col-span-2 text-xs" onClick={add} disabled={busy}><Plus size={12} /> Protect</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {list.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400 text-xs">No protected folders</td></tr>}
            {list.map(h => {
              const sub = h.directory.replace(`/var/www/${domain}/public_html/`, '');
              return (
                <tr key={h.directory} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="py-2 px-1 font-mono text-xs">{sub || '(root)'}</td>
                  <td className="text-xs text-slate-500">{h.users.length} user{h.users.length !== 1 ? 's' : ''}: {h.users.join(', ')}</td>
                  <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => unprotect(sub)}><Trash2 size={12} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
