import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, adel, PortalSub } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Subdomains() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<PortalSub[]>([]);
  const [form, setForm]   = useState({ subdomain: '' });
  const [busy, setBusy]   = useState(false);

  useEffect(() => { load(); }, [domain]);
  async function load() {
    try { const r = await api<PortalSub[]>('/api/portal/subdomains'); setItems(r.data.filter(s => s.parent === domain)); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function add() {
    if (!form.subdomain) return;
    setBusy(true);
    try { await apost('/api/portal/subdomains', { subdomain: form.subdomain, domain }); toast.success('Subdomain created'); setForm({ subdomain: '' }); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(fqdn: string) {
    if (!await confirm(`Delete subdomain ${fqdn}?`)) return;
    setBusy(true);
    try { await adel(`/api/portal/subdomains/${encodeURIComponent(fqdn)}`); toast.success('Subdomain deleted'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  return (
    <div>
      <PageTitle title="Subdomains" subtitle={`Sub-zones under ${domain} get their own webroot under /var/www/${domain}/.`} />
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-9">
            <label className="label text-xs">Subdomain</label>
            <div className="flex items-center">
              <input className="input rounded-r-none font-mono" placeholder="blog" value={form.subdomain} onChange={e => setForm({ subdomain: e.target.value.replace(/[^a-z0-9-]/g, '') })} />
              <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-l-0 border-slate-300 dark:border-slate-700 rounded-r text-xs text-slate-500">.{domain}</span>
            </div>
          </div>
          <button className="btn-primary col-span-3 text-xs" onClick={add} disabled={busy || !form.subdomain}><Plus size={12} /> Create</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {items.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400 text-xs">No subdomains</td></tr>}
            {items.map(s => (
              <tr key={s.fqdn} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs">{s.fqdn}</td>
                <td className="text-xs text-slate-500 truncate max-w-[260px]">{s.docroot}</td>
                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => del(s.fqdn)} disabled={busy}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
