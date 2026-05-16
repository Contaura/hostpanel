import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, adel, SshKeyGroup } from '../api';
import { usePortalAuth } from '../PortalAuthContext';
import { PageTitle } from '../components';

export default function SshKeys() {
  const toast = useToast();
  const confirm = useConfirm();
  const { selectedAccount } = usePortalAuth();
  const [groups, setGroups] = useState<SshKeyGroup[]>([]);
  const [form, setForm]     = useState({ user: '', key: '' });
  const [busy, setBusy]     = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    try { const r = await api<SshKeyGroup[]>('/api/portal/sshkeys'); setGroups(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function add() {
    if (!form.user || !form.key) return;
    setBusy(true);
    try { await apost('/api/portal/sshkeys', form); toast.success('SSH key added'); setForm({ user: '', key: '' }); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(user: string, id: number) {
    if (!await confirm('Delete this SSH key?')) return;
    try { await adel(`/api/portal/sshkeys/${user}/${id}`); toast.success('Deleted'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  const placeholder = selectedAccount ? `${selectedAccount.username}_web` : 'username';

  return (
    <div>
      <PageTitle title="SSH Keys" subtitle="SSH public keys for an OS user. The user must be prefixed with your account name (create them in the FTP page)." />
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3"><label className="label text-xs">OS user</label><input className="input font-mono text-xs" placeholder={placeholder} value={form.user} onChange={e => setForm(f => ({ ...f, user: e.target.value }))} /></div>
          <div className="col-span-7"><label className="label text-xs">Public key</label><input className="input font-mono text-xs" placeholder="ssh-ed25519 AAAA…" value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} /></div>
          <button className="btn-primary col-span-2 text-xs" onClick={add} disabled={busy}><Plus size={12} /> Add</button>
        </div>
        {groups.length === 0 && <p className="text-center text-slate-400 text-xs py-2">No SSH keys</p>}
        {groups.map(g => (
          <div key={g.user} className="space-y-1">
            <p className="text-xs font-mono text-slate-500">{g.user}</p>
            <table className="w-full text-sm">
              <tbody>
                {g.keys.length === 0 && <tr><td className="py-2 text-center text-slate-400 text-xs">No keys</td></tr>}
                {g.keys.map(k => (
                  <tr key={k.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td className="py-2 px-1 font-mono text-xs truncate max-w-[420px]">{k.raw}</td>
                    <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => del(g.user, k.id)}><Trash2 size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
