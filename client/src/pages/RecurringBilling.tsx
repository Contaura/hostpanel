import { useEffect, useState } from 'react';
import { Plus, Trash2, Play, Tag, CreditCard, X } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/billing${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

const blankSchedule = { client_id: '', amount: '', currency: 'USD', cycle: 'monthly', next_run: '', notes: '' };
const blankPromo = { code: '', type: 'percent', value: '', max_uses: '', expires_at: '' };
const blankCredit = { client_id: '', amount: '', currency: 'USD', reason: '' };

export default function RecurringBilling() {
  const toast = useToast();
  const [tab, setTab] = useState<'schedules' | 'credits' | 'promos'>('schedules');
  const [schedules, setSchedules] = useState<any[]>([]);
  const [credits, setCredits] = useState<any[]>([]);
  const [promos, setPromos] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<any>(blankSchedule);
  const [applyingCredit, setApplyingCredit] = useState<number | null>(null);
  const [applyInvoiceId, setApplyInvoiceId] = useState('');

  useEffect(() => {
    api('/recurring').then(r => r.json()).then(d => setSchedules(Array.isArray(d) ? d : []));
    api('/credit-notes').then(r => r.json()).then(d => setCredits(Array.isArray(d) ? d : []));
    api('/promo-codes').then(r => r.json()).then(d => setPromos(Array.isArray(d) ? d : []));
    api('/clients').then(r => r.json()).then(d => setClients(Array.isArray(d) ? d : []));
    api('/invoices').then(r => r.json()).then(d => setInvoices(Array.isArray(d) ? d : []));
  }, []);

  async function saveSchedule() {
    const r = await api('/recurring', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Schedule created');
    setAdding(false); setForm(blankSchedule);
    api('/recurring').then(r => r.json()).then(d => setSchedules(Array.isArray(d) ? d : []));
  }

  async function runNow(id: number) {
    const r = await api(`/recurring/${id}/run`, { method: 'POST' });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success('Invoice generated'); api('/recurring').then(r => r.json()).then(d => setSchedules(Array.isArray(d) ? d : [])); }
  }

  async function savePromo() {
    const r = await api('/promo-codes', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Promo code created');
    setAdding(false); setForm(blankPromo);
    api('/promo-codes').then(r => r.json()).then(d => setPromos(Array.isArray(d) ? d : []));
  }

  async function saveCredit() {
    const r = await api('/credit-notes', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Credit note created');
    setAdding(false); setForm(blankCredit);
    api('/credit-notes').then(r => r.json()).then(d => setCredits(Array.isArray(d) ? d : []));
  }

  async function togglePromo(id: number, active: boolean) {
    await api(`/promo-codes/${id}`, { method: 'PUT', body: JSON.stringify({ active: !active }) });
    api('/promo-codes').then(r => r.json()).then(d => setPromos(Array.isArray(d) ? d : []));
  }

  async function applyCredit(creditId: number) {
    if (!applyInvoiceId) { toast.error('Select an invoice'); return; }
    const r = await api(`/credit-notes/${creditId}/apply`, { method: 'PATCH', body: JSON.stringify({ invoice_id: Number(applyInvoiceId) }) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success(`Credit applied — invoice new amount: ${d.new_amount}`);
    setApplyingCredit(null); setApplyInvoiceId('');
    api('/credit-notes').then(r => r.json()).then(d => setCredits(Array.isArray(d) ? d : []));
    api('/invoices').then(r => r.json()).then(d => setInvoices(Array.isArray(d) ? d : []));
  }

  const clientName = (id: any) => clients.find(c => c.id === Number(id))?.name || id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Recurring Billing</h1>
        <button className="btn-primary" onClick={() => { setAdding(true); setForm(tab === 'schedules' ? blankSchedule : tab === 'promos' ? blankPromo : blankCredit); }}>
          <Plus size={14} className="mr-1" />New
        </button>
      </div>

      <div className="tab-bar">
        <button className={`tab-item ${tab === 'schedules' ? 'tab-item-active' : ''}`} onClick={() => setTab('schedules')}>Schedules</button>
        <button className={`tab-item ${tab === 'credits' ? 'tab-item-active' : ''}`} onClick={() => setTab('credits')}>Credit Notes</button>
        <button className={`tab-item ${tab === 'promos' ? 'tab-item-active' : ''}`} onClick={() => setTab('promos')}>Promo Codes</button>
      </div>

      {/* Add forms */}
      {adding && tab === 'schedules' && (
        <div className="card space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Client</label>
              <select className="input" value={form.client_id} onChange={e => setForm((f: any) => ({ ...f, client_id: e.target.value }))}>
                <option value="">Select client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="label">Amount</label><input className="input" type="number" step="0.01" value={form.amount} onChange={e => setForm((f: any) => ({ ...f, amount: e.target.value }))} /></div>
            <div>
              <label className="label">Cycle</label>
              <select className="input" value={form.cycle} onChange={e => setForm((f: any) => ({ ...f, cycle: e.target.value }))}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div><label className="label">First Run Date</label><input className="input" type="date" value={form.next_run} onChange={e => setForm((f: any) => ({ ...f, next_run: e.target.value }))} /></div>
            <div className="col-span-2"><label className="label">Notes</label><input className="input" value={form.notes} onChange={e => setForm((f: any) => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <div className="flex gap-2"><button className="btn-primary text-sm" onClick={saveSchedule}>Create</button><button className="btn-ghost text-sm" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}

      {adding && tab === 'promos' && (
        <div className="card space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Code</label><input className="input uppercase" value={form.code} onChange={e => setForm((f: any) => ({ ...f, code: e.target.value.toUpperCase() }))} /></div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type} onChange={e => setForm((f: any) => ({ ...f, type: e.target.value }))}>
                <option value="percent">Percent (%)</option>
                <option value="fixed">Fixed Amount</option>
              </select>
            </div>
            <div><label className="label">Value</label><input className="input" type="number" step="0.01" value={form.value} onChange={e => setForm((f: any) => ({ ...f, value: e.target.value }))} /></div>
            <div><label className="label">Max Uses</label><input className="input" type="number" placeholder="unlimited" value={form.max_uses} onChange={e => setForm((f: any) => ({ ...f, max_uses: e.target.value }))} /></div>
            <div><label className="label">Expires At</label><input className="input" type="date" value={form.expires_at} onChange={e => setForm((f: any) => ({ ...f, expires_at: e.target.value }))} /></div>
          </div>
          <div className="flex gap-2"><button className="btn-primary text-sm" onClick={savePromo}>Create</button><button className="btn-ghost text-sm" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}

      {adding && tab === 'credits' && (
        <div className="card space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">Client</label>
              <select className="input" value={form.client_id} onChange={e => setForm((f: any) => ({ ...f, client_id: e.target.value }))}>
                <option value="">Select client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="label">Amount</label><input className="input" type="number" step="0.01" value={form.amount} onChange={e => setForm((f: any) => ({ ...f, amount: e.target.value }))} /></div>
            <div><label className="label">Currency</label><input className="input" value={form.currency} onChange={e => setForm((f: any) => ({ ...f, currency: e.target.value }))} /></div>
            <div className="col-span-3"><label className="label">Reason</label><input className="input" value={form.reason} onChange={e => setForm((f: any) => ({ ...f, reason: e.target.value }))} /></div>
          </div>
          <div className="flex gap-2"><button className="btn-primary text-sm" onClick={saveCredit}>Create</button><button className="btn-ghost text-sm" onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}

      {/* Tables */}
      {tab === 'schedules' && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead><tr>{['Client', 'Amount', 'Cycle', 'Next Run', 'Last Run', 'Status', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
            <tbody>
              {schedules.length === 0 && <tr><td colSpan={7} className="table-cell text-center text-slate-500">No schedules</td></tr>}
              {schedules.map((s: any) => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="table-cell font-medium">{s.client_name}</td>
                  <td className="table-cell">{s.currency} {Number(s.amount).toFixed(2)}</td>
                  <td className="table-cell capitalize">{s.cycle}</td>
                  <td className="table-cell text-xs">{s.next_run}</td>
                  <td className="table-cell text-xs text-slate-500">{s.last_run || '—'}</td>
                  <td className="table-cell"><span className={`badge-${s.status === 'active' ? 'success' : 'warning'}`}>{s.status}</span></td>
                  <td className="table-cell">
                    <div className="flex gap-1">
                      <button className="btn-icon text-indigo-500" title="Generate invoice now" onClick={() => runNow(s.id)}><Play size={13} /></button>
                      <button className="btn-icon text-red-500" onClick={() => { api(`/recurring/${s.id}`, { method: 'DELETE' }); setSchedules(ss => ss.filter(x => x.id !== s.id)); }}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'credits' && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead><tr>{['#', 'Client', 'Amount', 'Reason', 'Status', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
            <tbody>
              {credits.length === 0 && <tr><td colSpan={6} className="table-cell text-center text-slate-500">No credit notes</td></tr>}
              {credits.map((c: any) => (
                <>
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="table-cell font-mono text-xs">{c.credit_number}</td>
                    <td className="table-cell">{c.client_name}</td>
                    <td className="table-cell">{c.currency} {Number(c.amount).toFixed(2)}</td>
                    <td className="table-cell text-slate-500 text-xs">{c.reason || '—'}</td>
                    <td className="table-cell"><span className={`badge-${c.status === 'active' ? 'success' : 'warning'}`}>{c.status}</span></td>
                    <td className="table-cell">
                      <div className="flex gap-1">
                        {c.status === 'active' && (
                          <button className="btn-icon text-indigo-500" title="Apply to invoice"
                            onClick={() => { setApplyingCredit(applyingCredit === c.id ? null : c.id); setApplyInvoiceId(''); }}>
                            <CreditCard size={13} />
                          </button>
                        )}
                        <button className="btn-icon text-red-500" onClick={() => { api(`/credit-notes/${c.id}`, { method: 'DELETE' }); setCredits(cc => cc.filter(x => x.id !== c.id)); }}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                  {applyingCredit === c.id && (
                    <tr key={`apply-${c.id}`} className="bg-indigo-50 dark:bg-indigo-900/20">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <CreditCard size={13} className="text-indigo-500 flex-shrink-0" />
                          <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Apply {c.currency} {Number(c.amount).toFixed(2)} to:</span>
                          <select className="input text-xs flex-1 max-w-xs" value={applyInvoiceId} onChange={e => setApplyInvoiceId(e.target.value)}>
                            <option value="">Select invoice…</option>
                            {invoices.filter((i: any) => ['unpaid', 'overdue'].includes(i.status)).map((i: any) => (
                              <option key={i.id} value={i.id}>{i.invoice_number} — {i.client_name} ({i.currency} {Number(i.amount).toFixed(2)})</option>
                            ))}
                          </select>
                          <button className="btn-primary text-xs" onClick={() => applyCredit(c.id)}>Apply</button>
                          <button className="btn-icon" onClick={() => { setApplyingCredit(null); setApplyInvoiceId(''); }}><X size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'promos' && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead><tr>{['Code', 'Type', 'Value', 'Uses', 'Expires', 'Active', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
            <tbody>
              {promos.length === 0 && <tr><td colSpan={7} className="table-cell text-center text-slate-500">No promo codes</td></tr>}
              {promos.map((p: any) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="table-cell"><span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1"><Tag size={11} />{p.code}</span></td>
                  <td className="table-cell capitalize text-xs">{p.type}</td>
                  <td className="table-cell">{p.type === 'percent' ? `${p.value}%` : `$${p.value}`}</td>
                  <td className="table-cell text-xs">{p.uses_count}/{p.max_uses || '∞'}</td>
                  <td className="table-cell text-xs text-slate-500">{p.expires_at || 'Never'}</td>
                  <td className="table-cell">
                    <button onClick={() => togglePromo(p.id, p.active)} className={`relative w-9 h-5 rounded-full transition-colors ${p.active ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${p.active ? 'left-4' : 'left-0.5'}`} />
                    </button>
                  </td>
                  <td className="table-cell"><button className="btn-icon text-red-500" onClick={() => { api(`/promo-codes/${p.id}`, { method: 'DELETE' }); setPromos(pp => pp.filter(x => x.id !== p.id)); }}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
