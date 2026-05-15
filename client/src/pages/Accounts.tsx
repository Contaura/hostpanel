import { useEffect, useState, FormEvent, Fragment } from 'react';
import axios from 'axios';
import { Server, Plus, Trash2, Power, UserCheck, AlertOctagon, Ban, RefreshCw, ChevronDown, ChevronUp, PackageOpen, Pencil, CalendarClock, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';

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
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [plans, setPlans]       = useState<Plan[]>([]);
  const [clients, setClients]   = useState<Client[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [usageData, setUsageData] = useState<Record<number, any>>({});
  const [loading, setLoading]   = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editAccountForm, setEditAccountForm] = useState({ plan_id: '', client_id: '', notes: '', expires_at: '' });
  const [expiryChecking, setExpiryChecking] = useState(false);
  const [actioning, setActioning] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    username: '', domain: '', password: '',
    plan_id: '', client_id: '', notes: '', expires_at: '',
    new_client_name: '', new_client_email: '', new_client_portal_pass: '',
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
    } catch { toast.error('Failed to load accounts'); } finally { setPageLoading(false); }
  }
  useEffect(() => {
    document.title = 'Hosting Accounts — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      let client_id = form.client_id;
      // Auto-create a new client if email is provided and no existing client is selected
      if (!client_id && form.new_client_email) {
        const { data } = await axios.post('/api/billing/clients', {
          name: form.new_client_name || form.username,
          email: form.new_client_email,
        });
        client_id = String(data.id);
        if (form.new_client_portal_pass) {
          await axios.post(`/api/billing/clients/${client_id}/portal-password`, { password: form.new_client_portal_pass });
        }
      }
      await axios.post('/api/accounts', { ...form, client_id });
      toast.success(`Account ${form.username} created`);
      setForm({ username: '', domain: '', password: '', plan_id: '', client_id: '', notes: '', expires_at: '', new_client_name: '', new_client_email: '', new_client_portal_pass: '' });
      setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to create account'); }
    finally { setLoading(false); }
  }

  async function setStatus(id: number, status: string) {
    setActioning(id);
    try {
      await axios.patch(`/api/accounts/${id}/status`, { status });
      toast.success(`Account ${status}`); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActioning(null); }
  }

  async function suspendAccount(id: number) {
    setActioning(id);
    try { await axios.post(`/api/accounts/${id}/suspend`); toast.success('Account suspended'); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActioning(null); }
  }

  async function unsuspendAccount(id: number) {
    setActioning(id);
    try { await axios.post(`/api/accounts/${id}/unsuspend`); toast.success('Account unsuspended'); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActioning(null); }
  }

  function expiryBadge(expires_at: string | null) {
    if (!expires_at) return null;
    const daysLeft = Math.ceil((new Date(expires_at).getTime() - Date.now()) / 86400000);
    if (daysLeft < 0) return <span className="badge-red text-xs">Expired</span>;
    if (daysLeft <= 7) return <span className="badge-yellow text-xs">{daysLeft}d left</span>;
    return null;
  }

  async function loadUsage(id: number) {
    try {
      const { data } = await axios.get(`/api/accounts/${id}/usage`);
      setUsageData(p => ({ ...p, [id]: data }));
    } catch {}
  }

  async function deleteAccount(id: number, username: string) {
    if (!await confirm(`Delete account "${username}"? The vhost config will be removed (web files preserved).`)) return;
    setActioning(id);
    try { await axios.delete(`/api/accounts/${id}`); toast.success('Account deleted'); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setActioning(null); }
  }

  async function updateAccount(id: number) {
    try {
      await axios.patch(`/api/accounts/${id}`, editAccountForm);
      toast.success('Account updated');
      setEditingAccountId(null);
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function runExpiryCheck() {
    setExpiryChecking(true);
    try {
      const { data } = await axios.get('/api/accounts/check-expiry');
      toast.success(`Expiry check complete — ${data.suspended ?? 0} account(s) suspended`);
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Expiry check failed'); }
    setExpiryChecking(false);
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

  if (pageLoading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Hosting Accounts</h1>
          <p className="page-subtitle">Create and manage client hosting accounts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
          <button onClick={runExpiryCheck} disabled={expiryChecking} className="btn-secondary" title="Suspend all accounts past their expiry date">
            {expiryChecking
              ? <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              : <CalendarClock size={14} />}
            Expiry Check
          </button>
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus size={14} /> New Account
          </button>
        </div>
      </div>

      {/* Status summary + search */}
      <div className="flex flex-wrap items-center gap-3">
        {[
          { label: 'Active',     n: counts.active,     cls: 'badge-green' },
          { label: 'Suspended',  n: counts.suspended,  cls: 'badge-yellow' },
          { label: 'Terminated', n: counts.terminated, cls: 'badge-red' },
        ].map(({ label, n, cls }) => (
          <div key={label} className={`${cls} text-sm font-semibold px-3 py-1`}>{n} {label}</div>
        ))}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="input pl-8 w-56 text-sm"
            placeholder="Search accounts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
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
              <label className="label">Existing Client</label>
              <select className="input" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value, new_client_name: '', new_client_email: '' })}>
                <option value="">New client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
              </select>
            </div>
          </div>

          {!form.client_id && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <p className="col-span-2 text-xs text-slate-500 font-medium">New client — will be created automatically</p>
              <div>
                <label className="label">Client Name</label>
                <input className="input" placeholder={form.username || 'Full name'}
                  value={form.new_client_name} onChange={e => setForm({ ...form, new_client_name: e.target.value })} />
              </div>
              <div>
                <label className="label">Client Email <span className="text-red-400">*</span></label>
                <input type="email" className="input" placeholder="client@example.com"
                  value={form.new_client_email} onChange={e => setForm({ ...form, new_client_email: e.target.value })}
                  required />
              </div>
              <div className="col-span-2">
                <label className="label">Portal Password <span className="text-slate-400 font-normal">(optional — enables client portal login)</span></label>
                <input type="password" className="input" placeholder="min 8 chars"
                  value={form.new_client_portal_pass} onChange={e => setForm({ ...form, new_client_portal_pass: e.target.value })}
                  minLength={8} />
              </div>
            </div>
          )}

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
            {(() => {
              const q = search.trim().toLowerCase();
              const visible = q ? accounts.filter(a =>
                [a.username, a.domain, a.status, a.plan_name, a.client_name, a.client_email]
                  .some(v => v?.toLowerCase().includes(q))
              ) : accounts;
              if (accounts.length === 0) return (
                <tr><td colSpan={6} className="px-4 py-16 text-center">
                  <Server className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                  <p className="text-slate-400 text-sm">No hosting accounts yet</p>
                </td></tr>
              );
              if (visible.length === 0) return (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">No accounts match "{search}"</td></tr>
              );
              return visible.map(acc => (
              <Fragment key={acc.id}>
                <tr className={rowCls}>
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
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className={STATUS_STYLE[acc.status] || 'badge-gray'}>{acc.status}</span>
                      {expiryBadge(acc.expires_at)}
                    </div>
                  </td>
                  <td className="table-cell text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                    {new Date(acc.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      {acc.status === 'active' && (
                        <button onClick={() => suspendAccount(acc.id)} disabled={actioning === acc.id} className="btn-icon hover:!text-amber-600 hover:!bg-amber-50 dark:hover:!bg-amber-900/30" title="Suspend (disables vhost)">
                          <Ban size={13} />
                        </button>
                      )}
                      {acc.status === 'suspended' && (
                        <button onClick={() => unsuspendAccount(acc.id)} disabled={actioning === acc.id} className="btn-icon hover:!text-emerald-600 hover:!bg-emerald-50 dark:hover:!bg-emerald-900/30" title="Unsuspend (re-enables vhost)">
                          <Power size={13} />
                        </button>
                      )}
                      {(statusActions[acc.status] ?? []).filter(a => a.target === 'terminated').map(a => (
                        <button key={a.target} onClick={() => setStatus(acc.id, a.target)} disabled={actioning === acc.id}
                          className={`btn-icon ${a.cls}`} title={a.label}>
                          <a.icon size={13} />
                        </button>
                      ))}
                      <button onClick={() => {
                        setEditingAccountId(editingAccountId === acc.id ? null : acc.id);
                        setEditAccountForm({ plan_id: String(acc.plan_name ? (plans.find(p => p.name === acc.plan_name)?.id ?? '') : ''), client_id: String(acc.client_name ? (clients.find(c => c.name === acc.client_name)?.id ?? '') : ''), notes: acc.notes || '', expires_at: acc.expires_at || '' });
                      }} className="btn-icon hover:!text-sky-600 hover:!bg-sky-50 dark:hover:!bg-sky-900/30" title="Edit metadata">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => {
                        const next = expanded === acc.id ? null : acc.id;
                        setExpanded(next);
                        if (next) loadUsage(acc.id);
                      }} className="btn-icon" title="Details">
                        {expanded === acc.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                      <button
                        title="Export account (files + DBs)"
                        className="btn-icon"
                        onClick={() => {
                          const token = localStorage.getItem('hp_token') || '';
                          fetch(`/api/accounts/${acc.id}/export`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
                            .then(r => r.blob())
                            .then(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `account_${acc.username}.tar.gz`; a.click(); })
                            .catch(() => toast.error('Export failed'));
                        }}>
                        <PackageOpen size={13} />
                      </button>
                      <button onClick={() => deleteAccount(acc.id, acc.username)} disabled={actioning === acc.id}
                        className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30"
                        title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
                {editingAccountId === acc.id && (
                  <tr className="bg-slate-50/80 dark:bg-slate-700/30 border-b border-slate-100 dark:border-slate-700/40">
                    <td colSpan={6} className="px-5 py-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl">
                        <div>
                          <label className="label">Plan</label>
                          <select className="input text-sm" value={editAccountForm.plan_id} onChange={e => setEditAccountForm(f => ({ ...f, plan_id: e.target.value }))}>
                            <option value="">No plan</option>
                            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label">Client</label>
                          <select className="input text-sm" value={editAccountForm.client_id} onChange={e => setEditAccountForm(f => ({ ...f, client_id: e.target.value }))}>
                            <option value="">No client</option>
                            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label">Expiry Date</label>
                          <input type="date" className="input text-sm" value={editAccountForm.expires_at} onChange={e => setEditAccountForm(f => ({ ...f, expires_at: e.target.value }))} />
                        </div>
                        <div>
                          <label className="label">Notes</label>
                          <input className="input text-sm" value={editAccountForm.notes} onChange={e => setEditAccountForm(f => ({ ...f, notes: e.target.value }))} />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button className="btn-primary text-sm" onClick={() => updateAccount(acc.id)}>Save</button>
                        <button className="btn-secondary text-sm" onClick={() => setEditingAccountId(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
                {expanded === acc.id && (
                  <tr className="bg-slate-50/60 dark:bg-slate-700/20 border-b border-slate-100 dark:border-slate-700/40">
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
                        {usageData[acc.id] && (
                          <div>
                            <div className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Disk Usage</div>
                            <div className="text-slate-600 dark:text-slate-400 font-mono">
                              {(usageData[acc.id].disk_bytes / 1024 / 1024).toFixed(1)} MB
                              {acc.disk_quota ? ` / ${acc.disk_quota} MB` : ''}
                            </div>
                            <div className="text-xs text-slate-400">{usageData[acc.id].file_count} files</div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ));
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
