import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { api, apost, adel, SpamRule } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function SpamRules() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const [rules, setRules] = useState<SpamRule[]>([]);
  const [form, setForm]   = useState({ type: 'blacklist', address: '' });
  const [busy, setBusy]   = useState(false);

  useEffect(() => { load(); }, [domain]);
  async function load() {
    try { const r = await api<SpamRule[]>(`/api/portal/spam-rules/${domain}`); setRules(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function add() {
    if (!form.address) return;
    setBusy(true);
    try { await apost(`/api/portal/spam-rules/${domain}`, form); toast.success('Rule added'); setForm({ type: 'blacklist', address: '' }); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(id: number) {
    try { await adel(`/api/portal/spam-rules/${domain}/${id}`); toast.success('Removed'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  return (
    <div>
      <PageTitle title="Spam Rules" subtitle="Per-domain SpamAssassin allowlist / blocklist. Use full addresses or wildcards (*@bad.com)." />
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <select className="input col-span-3 text-xs" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            <option value="blacklist">Blocklist</option><option value="whitelist">Allowlist</option>
          </select>
          <input className="input col-span-7 font-mono text-xs" placeholder="*@bad.com" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          <button className="btn-primary col-span-2 text-xs" onClick={add} disabled={busy}><Plus size={12} /> Add</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rules.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400 text-xs">No rules</td></tr>}
            {rules.map(r => (
              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 text-xs"><span className={r.type === 'blacklist' ? 'text-rose-600' : 'text-emerald-600'}>{r.type}</span></td>
                <td className="font-mono text-xs">{r.address}</td>
                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => del(r.id)}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
