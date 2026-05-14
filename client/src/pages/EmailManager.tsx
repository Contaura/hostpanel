import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Mail, Plus, Trash2, ArrowRight, InboxIcon, Search } from 'lucide-react';
import { useToast } from '../components/Toast';

interface Account { email: string; domain: string; quota: string }
interface Forwarder { from: string; to: string }

export default function EmailManager() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [forwarders, setForwarders] = useState<Forwarder[]>([]);
  const [tab, setTab] = useState<'accounts' | 'forwarders'>('accounts');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', quota: '' });
  const [fwdForm, setFwdForm] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  const [forwarderSearch, setForwarderSearch] = useState('');

  async function load() {
    const [acc, fwd] = await Promise.all([
      axios.get<Account[]>('/api/email/accounts'),
      axios.get<Forwarder[]>('/api/email/forwarders'),
    ]);
    setAccounts(acc.data);
    setForwarders(fwd.data);
  }

  useEffect(() => { load(); }, []);

  async function createAccount(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/email/accounts', form);
      toast.success(`Mailbox ${form.email} created`);
      setForm({ email: '', password: '', quota: '' }); setShowForm(false); load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create mailbox');
    } finally { setLoading(false); }
  }

  async function deleteAccount(email: string) {
    if (!confirm(`Delete mailbox ${email}?`)) return;
    try {
      await axios.delete(`/api/email/accounts/${encodeURIComponent(email)}`);
      toast.success(`Mailbox ${email} deleted`); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Delete failed'); }
  }

  async function createForwarder(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/email/forwarders', fwdForm);
      toast.success('Forwarder created');
      setFwdForm({ from: '', to: '' }); setShowForm(false); load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create forwarder');
    } finally { setLoading(false); }
  }

  async function deleteForwarder(from: string) {
    if (!confirm(`Delete forwarder ${from}?`)) return;
    try {
      await axios.delete(`/api/email/forwarders/${encodeURIComponent(from)}`);
      toast.success('Forwarder deleted'); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Delete failed'); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Email Management</h1>
          <p className="page-subtitle">Manage mailboxes and forwarders via Postfix + Dovecot</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <Plus size={14} /> New {tab === 'accounts' ? 'Mailbox' : 'Forwarder'}
        </button>
      </div>

      <div className="tab-bar">
        {(['accounts', 'forwarders'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
            className={tab === t ? 'tab-item-active' : 'tab-item'}>
            {t === 'accounts' ? `Mailboxes (${accounts.length})` : `Forwarders (${forwarders.length})`}
          </button>
        ))}
      </div>

      {showForm && tab === 'accounts' && (
        <form onSubmit={createAccount} className="card p-5 space-y-4 max-w-lg">
          <h2 className="text-sm font-bold text-slate-900">Create Mailbox</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Email Address</label>
              <input className="input" placeholder="user@example.com" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" placeholder="••••••••" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })} required />
            </div>
            <div>
              <label className="label">Quota (bytes, blank = unlimited)</label>
              <input className="input" placeholder="1073741824" value={form.quota}
                onChange={e => setForm({ ...form, quota: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Creating…' : 'Create mailbox'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {showForm && tab === 'forwarders' && (
        <form onSubmit={createForwarder} className="card p-5 space-y-4 max-w-md">
          <h2 className="text-sm font-bold text-slate-900">Create Forwarder</h2>
          <div>
            <label className="label">From</label>
            <input className="input" placeholder="alias@example.com" value={fwdForm.from}
              onChange={e => setFwdForm({ ...fwdForm, from: e.target.value })} required />
          </div>
          <div>
            <label className="label">To</label>
            <input className="input" placeholder="real@example.com" value={fwdForm.to}
              onChange={e => setFwdForm({ ...fwdForm, to: e.target.value })} required />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Creating…' : 'Create forwarder'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {tab === 'accounts' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-8 w-48 text-sm" placeholder="Search mailboxes…" value={accountSearch} onChange={e => setAccountSearch(e.target.value)} />
            </div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-header-cell">Email</th>
                  <th className="table-header-cell hidden md:table-cell">Domain</th>
                  <th className="table-header-cell hidden md:table-cell">Quota</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const q = accountSearch.trim().toLowerCase();
                  const visible = q ? accounts.filter(a => [a.email, a.domain].some(v => v?.toLowerCase().includes(q))) : accounts;
                  if (accounts.length === 0) return (
                    <tr><td colSpan={4} className="px-4 py-16 text-center">
                      <InboxIcon className="mx-auto mb-2 text-slate-300" size={32} />
                      <p className="text-slate-400 text-sm">No mailboxes yet</p>
                    </td></tr>
                  );
                  if (visible.length === 0) return (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">No mailboxes match "{accountSearch}"</td></tr>
                  );
                  return visible.map(acc => (
                    <tr key={acc.email} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 group">
                      <td className="table-cell">
                        <div className="flex items-center gap-2.5">
                          <div className="h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                            <Mail size={13} className="text-indigo-600" />
                          </div>
                          <span className="font-medium text-slate-900">{acc.email}</span>
                        </div>
                      </td>
                      <td className="table-cell text-slate-500 hidden md:table-cell">{acc.domain}</td>
                      <td className="table-cell hidden md:table-cell">
                        <span className="badge badge-gray">{acc.quota}</span>
                      </td>
                      <td className="px-3 py-3">
                        <button onClick={() => deleteAccount(acc.email)}
                          className="btn-icon opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-rose-50">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'forwarders' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-8 w-48 text-sm" placeholder="Search forwarders…" value={forwarderSearch} onChange={e => setForwarderSearch(e.target.value)} />
            </div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-header-cell">From</th>
                  <th className="px-2 py-3 w-8" />
                  <th className="table-header-cell">To</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const q = forwarderSearch.trim().toLowerCase();
                  const visible = q ? forwarders.filter(f => [f.from, f.to].some(v => v?.toLowerCase().includes(q))) : forwarders;
                  if (forwarders.length === 0) return (
                    <tr><td colSpan={4} className="px-4 py-16 text-center text-slate-400 text-sm">No forwarders configured</td></tr>
                  );
                  if (visible.length === 0) return (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">No forwarders match "{forwarderSearch}"</td></tr>
                  );
                  return visible.map(fwd => (
                    <tr key={fwd.from} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 group">
                      <td className="table-cell font-medium text-slate-900">{fwd.from}</td>
                      <td className="px-1 py-3 text-slate-300"><ArrowRight size={14} /></td>
                      <td className="table-cell text-slate-600">{fwd.to}</td>
                      <td className="px-3 py-3">
                        <button onClick={() => deleteForwarder(fwd.from)}
                          className="btn-icon opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-rose-50">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
