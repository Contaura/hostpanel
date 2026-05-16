import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, adel, PortalRedirect } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Redirects() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<PortalRedirect[]>([]);
  const [form, setForm]   = useState({ source: '', target: '', type: '301' });
  const [busy, setBusy]   = useState(false);

  useEffect(() => { load(); }, [domain]);
  async function load() {
    try { const r = await api<PortalRedirect[]>('/api/portal/redirects'); setItems(r.data.filter(rr => rr.domain === domain)); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function add() {
    if (!form.source || !form.target) return;
    setBusy(true);
    try { await apost('/api/portal/redirects', { domain, source: form.source, target: form.target, type: form.type }); toast.success('Redirect created'); setForm({ source: '', target: '', type: '301' }); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(id: number) {
    if (!await confirm('Delete this redirect?')) return;
    setBusy(true);
    try { await adel(`/api/portal/redirects/${id}`); toast.success('Redirect removed'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  return (
    <div>
      <PageTitle title="Redirects" subtitle="Send visitors of one URL to another. Writes a Redirect directive into .htaccess." />
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-4"><label className="label text-xs">Source path</label>
            <input className="input font-mono" placeholder="/old" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} />
          </div>
          <div className="col-span-5"><label className="label text-xs">Target URL</label>
            <input className="input font-mono" placeholder="https://example.com/new" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} />
          </div>
          <select className="input col-span-1 text-xs" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            <option value="301">301</option><option value="302">302</option>
          </select>
          <button className="btn-primary col-span-2 text-xs" onClick={add} disabled={busy}><Plus size={12} /> Add</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {items.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-400 text-xs">No redirects</td></tr>}
            {items.map(r => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs">{r.source}</td>
                <td className="text-xs">→ <span className="font-mono">{r.target}</span></td>
                <td className="text-xs text-slate-500">{r.type}</td>
                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => del(r.id)} disabled={busy}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
