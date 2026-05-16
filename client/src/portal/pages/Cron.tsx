import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, adel, CronGroup } from '../api';
import { usePortalAuth } from '../PortalAuthContext';
import { PageTitle } from '../components';

export default function Cron() {
  const toast = useToast();
  const confirm = useConfirm();
  const { selectedAccount } = usePortalAuth();
  const [groups, setGroups] = useState<CronGroup[]>([]);
  const [form, setForm]     = useState({ user: '', schedule: '0 * * * *', command: '' });
  const [busy, setBusy]     = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    try { const r = await api<CronGroup[]>('/api/portal/cron'); setGroups(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function add() {
    if (!form.user || !form.schedule || !form.command) return;
    setBusy(true);
    try { await apost('/api/portal/cron', form); toast.success('Cron job added'); setForm({ user: '', schedule: '0 * * * *', command: '' }); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(user: string, id: number) {
    if (!await confirm('Delete this cron job?')) return;
    try { await adel(`/api/portal/cron/${user}/${id}`); toast.success('Deleted'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  const placeholderUser = selectedAccount ? `${selectedAccount.username}_web` : 'username';

  return (
    <div>
      <PageTitle title="Cron Jobs" subtitle="Scheduled tasks. The OS user must be one of your account's FTP users." />
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3"><label className="label text-xs">OS user</label><input className="input font-mono text-xs" placeholder={placeholderUser} value={form.user} onChange={e => setForm(f => ({ ...f, user: e.target.value }))} /></div>
          <div className="col-span-3"><label className="label text-xs">Schedule</label><input className="input font-mono text-xs" placeholder="0 * * * *" value={form.schedule} onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))} /></div>
          <div className="col-span-4"><label className="label text-xs">Command</label><input className="input font-mono text-xs" placeholder="curl https://example.com/cron" value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} /></div>
          <button className="btn-primary col-span-2 text-xs" onClick={add} disabled={busy}><Plus size={12} /> Add</button>
        </div>
        {groups.length === 0 && <p className="text-center text-slate-400 text-xs py-2">No scheduled tasks</p>}
        {groups.map(g => (
          <div key={g.user} className="space-y-1">
            <p className="text-xs font-mono text-slate-500">{g.user}</p>
            <table className="w-full text-sm">
              <tbody>
                {g.jobs.map(j => (
                  <tr key={j.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td className="py-2 px-1 font-mono text-xs">{j.line}</td>
                    <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => del(g.user, j.id)}><Trash2 size={12} /></button></td>
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
