import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, adel, DnsRecord } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Dns() {
  return (
    <RequireAccount>
      {(account) => <DnsInner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function DnsInner({ domain }: { domain: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [form, setForm]       = useState({ name: '', type: 'A', value: '', ttl: '3600' });
  const [busy, setBusy]       = useState(false);

  useEffect(() => { load(); }, [domain]);
  async function load() {
    try { const r = await api(`/api/portal/domains/${domain}/dns`); setRecords(r.data.records || []); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load DNS records'); }
  }
  async function add() {
    if (!form.name || !form.value) return toast.error('Name and value are required');
    setBusy(true);
    try { await apost(`/api/portal/domains/${domain}/dns`, form); toast.success('DNS record added'); setForm({ name: '', type: 'A', value: '', ttl: '3600' }); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(index: number) {
    if (!await confirm('Delete this DNS record?')) return;
    setBusy(true);
    try { await adel(`/api/portal/domains/${domain}/dns/${index}`); toast.success('DNS record removed'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  return (
    <div>
      <PageTitle title="DNS Records" subtitle="A, AAAA, CNAME, MX, and TXT records. NS / SRV are managed by your hosting provider." />
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <input className="input col-span-3" placeholder="name (e.g. @ or www)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <select className="input col-span-2" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {['A','AAAA','CNAME','MX','TXT'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="input col-span-4" placeholder="value" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
          <input className="input col-span-1" placeholder="ttl" value={form.ttl} onChange={e => setForm(f => ({ ...f, ttl: e.target.value.replace(/\D/g, '') }))} />
          <button className="btn-primary col-span-2 text-xs" onClick={add} disabled={busy}><Plus size={12} /> Add</button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
            <th className="text-left py-2 px-1">Name</th><th className="text-left">Type</th><th className="text-left">Value</th><th className="text-left">TTL</th><th></th>
          </tr></thead>
          <tbody>
            {records.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400 text-xs">No records</td></tr>}
            {records.map((r, i) => (
              <tr key={i} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs">{r.name}</td>
                <td className="text-xs">{r.type}</td>
                <td className="font-mono text-xs truncate max-w-[280px]">{r.value}</td>
                <td className="text-xs text-slate-500">{r.ttl}</td>
                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => del(i)} disabled={busy}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
