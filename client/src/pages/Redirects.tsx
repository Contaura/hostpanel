import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { ArrowRight, Plus, Trash2, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';

interface Redirect {
  id: number;
  domain: string;
  from: string;
  to: string;
  type: '301' | '302';
}

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

export default function Redirects() {
  const toast = useToast();
  const confirm = useConfirm();
  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ domain: '', from: '/', to: '', type: '301' as '301' | '302' });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);

  async function load() {
    try {
      const [rRes, dRes] = await Promise.all([
        axios.get<Redirect[]>('/api/redirects/list'),
        axios.get<string[]>('/api/domains/domains').catch(() => ({ data: [] })),
      ]);
      setRedirects(rRes.data);
      setDomains(dRes.data);
    } catch { setRedirects([]); }
  }
  useEffect(() => { load(); }, []);

  async function add(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/redirects/add', form);
      toast.success('Redirect added');
      setForm({ domain: '', from: '/', to: '', type: '301' });
      setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function remove(id: number) {
    if (!await confirm('Remove this redirect?')) return;
    setDeleting(id);
    try { await axios.delete(`/api/redirects/${id}`); toast.success('Redirect removed'); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setDeleting(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Redirects</h1>
          <p className="page-subtitle">Manage 301/302 URL redirects via Apache</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <Plus size={14} /> Add Redirect
        </button>
      </div>

      {showForm && (
        <form onSubmit={add} className="card p-5 max-w-lg space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add Redirect</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Domain</label>
              <select className="input" value={form.domain}
                onChange={e => setForm({ ...form, domain: e.target.value })} required>
                <option value="">Select domain…</option>
                {domains.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as '301' | '302' })}>
                <option value="301">301 Permanent</option>
                <option value="302">302 Temporary</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">From Path</label>
            <input className="input font-mono" placeholder="/old-page" value={form.from}
              onChange={e => setForm({ ...form, from: e.target.value })} required />
          </div>
          <div>
            <label className="label">To URL</label>
            <input className="input font-mono" placeholder="https://example.com/new-page" value={form.to}
              onChange={e => setForm({ ...form, to: e.target.value })} required />
          </div>
          {form.domain && form.from && form.to && (
            <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 px-3 py-2 rounded-lg">
              <span>{form.domain}{form.from}</span>
              <ArrowRight size={12} className="text-indigo-500 flex-shrink-0" />
              <span className="text-indigo-600 dark:text-indigo-400">{form.to}</span>
              <span className="ml-auto badge-blue">{form.type}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Adding…' : 'Add redirect'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-48 text-sm" placeholder="Search redirects…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className={theadCls}><tr>
              <th className="table-header-cell">From</th>
              <th className="table-header-cell">To</th>
              <th className="table-header-cell w-20">Type</th>
              <th className="px-4 py-3 w-12" />
            </tr></thead>
            <tbody>
              {(() => {
                const q = search.trim().toLowerCase();
                const visible = q ? redirects.filter(r => [r.domain, r.from, r.to].some(v => v?.toLowerCase().includes(q))) : redirects;
                if (redirects.length === 0) return (
                  <tr><td colSpan={4} className="px-4 py-16 text-center">
                    <ArrowRight className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    <p className="text-slate-400 text-sm">No redirects configured</p>
                  </td></tr>
                );
                if (visible.length === 0) return <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No redirects match "{search}"</td></tr>;
                return visible.map(r => (
                  <tr key={r.id} className={rowCls}>
                    <td className="table-cell font-mono text-xs">
                      <span className="text-slate-400 dark:text-slate-500">{r.domain}</span>
                      <span className="text-slate-900 dark:text-slate-100">{r.from}</span>
                    </td>
                    <td className="table-cell font-mono text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate">{r.to}</td>
                    <td className="table-cell">
                      <span className={r.type === '301' ? 'badge-blue' : 'badge-yellow'}>{r.type}</span>
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={() => remove(r.id)} disabled={deleting === r.id}
                        className="btn-icon opacity-0 group-hover:opacity-100 hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
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
    </div>
  );
}
