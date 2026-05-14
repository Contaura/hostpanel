import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Server, Plus, Trash2, Power, UserCheck, AlertOctagon, Ban, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '../components/Toast';

interface Account {
  id: number;
  username: string;
  domain: string;
  status: string;
  plan_name: string | null;
  plan_price: number | null;
  disk_quota: number | null;
  client_name: string | null;
  client_email: string | null;
  notes: string;
  created_at: string;
  expires_at: string | null;
}

interface Plan   { id: number; name: string; price: number; billing_cycle: string }
interface Client { id: number; name: string; email: string }

const STATUS_STYLE: Record<string, string> = {
  active:     'badge-green',
  suspended:  'badge-yellow',
  terminated: 'badge-red',
};

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

export default function Accounts() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [plans, setPlans]       = useState<Plan[]>([]);
  const [clients, setClients]   = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading]   = useState(false);
  const [form, setForm] = useState({
    username: '', domain: '', password: '',
    plan_id: '', client_id: '', notes: '', expires_at: '',
  });

  async function load() {
    try {
      const [aRes, pRes, cRes] = await Promise.all([
        axios.get<Account[]>('/api/accounts'),
        axios.get<Plan[]>('/api/billing/plans'),
        axios.get<Client[]>('/api/billing/clients'),
      ]);
      setAccounts(aRes.data);
      setPlans(pRes.data);
      setClients(cRes.data);
    } catch { toast.error('Failed to load accounts'); }
  }
  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/accounts', form);
      toast.success(`Account ${form.username} created`);
      setForm({ username: '', domain: '', password: '', plan_id: '', client_id: '', notes: '', expires_at: '' });
      setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to create account'); }
    finally { setLoading(false); }
  }

  async function setStatus(id: number, status: string) {
    try {
      await axios.patch(`/api/accounts/${id}/status`, { status });
      toast.success(`Account ${status}`); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function deleteAccount(id: number, username: string) {
    if (!confirm(`Delete account "${username}"? The vhost config will be removed (web files preserved).`)) return;
    try { await axios.delete(`/api/accounts/${id}`); toast.success('Account deleted'); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  const statusActions: Record<string, { label: string; target: string; icon: any; cls: string }[]> = {
    active:     [{ label: 'Suspend',   target: 'suspended',  icon: Ban,          cls: 'hover:!text-amber-600 hover:!bg-amber-50 dark:hover:!bg-amber-900/30' }],
    suspended:  [{ label: 'Reactivate', target: 'active',   icon: Power,        cls: 'hover:!text-emerald-600 hover:!bg-emerald-50 dark:hover:!bg-emerald-900/30' },
                 { label: 'Terminate', target: 'terminated', icon: AlertOctagon, cls: 'hover:!text-rose-600 hover:!bg-rose-50 dark:hover:!bg-rose-900/30' }],
    terminated: [{ label: 'Reactivate', target: 'active',   icon: Power,        cls: 'hover:!text-emerald-600 hover:!bg-emerald-50 dark:hover:!bg-emerald-900/30' }],
  };

  const counts = {
    active:     accounts.filter(a => a.status === 'active').length,
    suspended:  accounts.filter(a => a.status === 'suspended').length,
    terminated: accounts.filter(a => a.status === 'terminated').length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Hosting Accounts</h1>
          <p className="page-subtitle">Create and manage client hosting accounts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus size={14} /> New Account
          </button>
        </div>
      </div>

      {/* Status summary */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: 'Active',     n: counts.active,     cls: 'badge-green' },
          { label: 'Suspended',  n: counts.suspended,  cls: 'badge-yellow' },
          { label: 'Terminated', n: counts.terminated, cls: 'badge-red' },
        ].map(({ label, n, cls }) => (
          <div key={label} className={`${cls} text-sm font-semibold px-3 py-1`}>{n} {label}</div>
        ))}
      </div>

      {showForm && (
        <form onSubmit={create} className="card p-6 max-w-lg space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Create Hosting Account</h2>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Username</label>
              <input className="input font-mono" placeholder="johndoe"
                value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                pattern="[a-zA-Z][a-zA-Z0-9_]{1,31}" required />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" placeholder="min 8 chars"
                value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                minLength={8} required />
            </div>
          </div>

          <div>
            <label className="label">Primary Domain</label>
            <input className="input" placeholder="example.com"
              value={form.domain} onChange={e => setForm({ ...form, domain: e.target.value })} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Plan</label>
              <select className="input" value={form.plan_id} onChange={e => setForm({ ...form, plan_id: e.target.value })}>
                <option value="">No plan</option>
                {plans.map(p => <option key={p.id} value={p.id}>${p.price}/{p.billing_cycle} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Client</label>
              <select className="input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                <option value="">No client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Expiry Date (optional)</label>
            <input type="date" className="input"
              value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} />
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input resize-none h-16 text-sm" value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>

          {form.plan_id && form.client_id && (
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/40 px-4 py-3 text-sm text-indigo-700 dark:text-indigo-300">
              An invoice will be automatically generated for the selected plan.
            </div>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? (
                <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Creating…</>
              ) : <><Server size={14} /> Create account</>}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className={theadCls}><tr>
            <th className="table-header-cell">Account</th>
            <th className="table-header-cell hidden md:table-cell">Client</th>
            <th className="table-header-cell hidden lg:table-cell">Plan</th>
            <th className="table-header-cell">Status</th>
            <th className="table-header-cell hidden lg:table-cell">Created</th>
            <th className="px-4 py-3 w-32" />
          </tr></thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center">
                <Server className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                <p className="text-slate-400 text-sm">No hosting accounts yet</p>
              </td></tr>
            ) : accounts.map(acc => (
              <>
                <tr key={acc.id} className={rowCls}>
                  <td className="table-cell">
                    <div className="flex items-center gap-2.5">
                      <div className={`h-2 w-2 rounded-full flex-shrink-0 ${acc.status === 'active' ? 'bg-emerald-400 animate-pulse' : acc.status === 'suspended' ? 'bg-amber-400' : 'bg-slate-400'}`} />
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100 font-mono">{acc.username}</div>
                        <div className="text-xs text-slate-400 dark:text-slate-500">{acc.domain}</div>
                      </div>
                    </div>
                  </td>
                  <td className="table-cell text-slate-600 dark:text-slate-400 hidden md:table-cell">
                    {acc.client_name || <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="table-cell hidden lg:table-cell">
                    {acc.plan_name
                      ? <span className="text-slate-700 dark:text-slate-300">{acc.plan_name} <span className="text-slate-400">(${acc.plan_price}/mo)</span></span>
                      : <span className="text-slate-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="table-cell">
                    <span className={STATUS_STYLE[acc.status] || 'badge-gray'}>{acc.status}</span>
                  </td>
                  <td className="table-cell text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                    {new Date(acc.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      {(statusActions[acc.status] ?? []).map(a => (
                        <button key={a.target} onClick={() => setStatus(acc.id, a.target)}
                          className={`btn-icon ${a.cls}`} title={a.label}>
                          <a.icon size={13} />
                        </button>
                      ))}
                      <button onClick={() => setExpanded(expanded === acc.id ? null : acc.id)}
                        className="btn-icon" title="Details">
                        {expanded === acc.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                      <button onClick={() => deleteAccount(acc.id, acc.username)}
                        className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30"
                        title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded === acc.id && (
                  <tr key={`${acc.id}-detail`} className="bg-slate-50/60 dark:bg-slate-700/20 border-b border-slate-100 dark:border-slate-700/40">
                    <td colSpan={6} className="px-6 py-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Domain</div>
                          <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{acc.domain}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Client Email</div>
                          <div className="text-slate-600 dark:text-slate-400">{acc.client_email || '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Expires</div>
                          <div className="text-slate-600 dark:text-slate-400">{acc.expires_at || 'Never'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Notes</div>
                          <div className="text-slate-600 dark:text-slate-400">{acc.notes || '—'}</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
