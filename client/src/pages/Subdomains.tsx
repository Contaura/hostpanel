import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Globe, Plus, Trash2, Search } from 'lucide-react';
import { useToast } from '../components/Toast';

interface Subdomain {
  subdomain: string;
  domain: string;
  fqdn: string;
}

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

export default function Subdomains() {
  const toast = useToast();
  const [subs, setSubs] = useState<Subdomain[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subdomain: '', domain: '', docRoot: '' });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  async function load() {
    try {
      const [subsRes, domsRes] = await Promise.all([
        axios.get<Subdomain[]>('/api/subdomains/list'),
        axios.get<string[]>('/api/domains/domains').catch(() => ({ data: [] })),
      ]);
      setSubs(subsRes.data);
      setDomains(domsRes.data);
    } catch { setSubs([]); }
  }
  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/subdomains/create', form);
      toast.success(`Subdomain ${form.subdomain}.${form.domain} created`);
      setForm({ subdomain: '', domain: '', docRoot: '' });
      setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function remove(fqdn: string) {
    if (!confirm(`Remove subdomain ${fqdn}?`)) return;
    try {
      await axios.delete(`/api/subdomains/${fqdn}`);
      toast.success(`${fqdn} removed`); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Subdomains</h1>
          <p className="page-subtitle">Create and manage subdomain virtual hosts</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <Plus size={14} /> Add Subdomain
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className="card p-5 max-w-md space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Create Subdomain</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Subdomain</label>
              <input className="input" placeholder="blog" value={form.subdomain}
                onChange={e => setForm({ ...form, subdomain: e.target.value })}
                pattern="[a-zA-Z0-9][a-zA-Z0-9\-]*" required />
            </div>
            <div>
              <label className="label">Domain</label>
              <select className="input" value={form.domain}
                onChange={e => setForm({ ...form, domain: e.target.value })} required>
                <option value="">Select domain…</option>
                {domains.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          {form.subdomain && form.domain && (
            <div className="text-sm text-indigo-600 dark:text-indigo-400 font-mono bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 rounded-lg">
              → {form.subdomain}.{form.domain}
            </div>
          )}
          <div>
            <label className="label">Document Root (optional)</label>
            <input className="input font-mono" placeholder={`/var/www/${form.domain || 'domain'}/${form.subdomain || 'subdomain'}/public_html`}
              value={form.docRoot} onChange={e => setForm({ ...form, docRoot: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Creating…' : 'Create subdomain'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-48 text-sm" placeholder="Search subdomains…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className={theadCls}><tr>
              <th className="table-header-cell">Subdomain</th>
              <th className="table-header-cell hidden md:table-cell">Parent Domain</th>
              <th className="px-4 py-3 w-12" />
            </tr></thead>
            <tbody>
              {(() => {
                const q = search.trim().toLowerCase();
                const visible = q ? subs.filter(s => [s.fqdn, s.domain].some(v => v?.toLowerCase().includes(q))) : subs;
                if (subs.length === 0) return (
                  <tr><td colSpan={3} className="px-4 py-16 text-center">
                    <Globe className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    <p className="text-slate-400 text-sm">No subdomains configured</p>
                  </td></tr>
                );
                if (visible.length === 0) return <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-400">No subdomains match "{search}"</td></tr>;
                return visible.map(s => (
                  <tr key={s.fqdn} className={rowCls}>
                    <td className="table-cell">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                          <Globe size={13} className="text-violet-600 dark:text-violet-400" />
                        </div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{s.fqdn}</span>
                      </div>
                    </td>
                    <td className="table-cell text-slate-500 dark:text-slate-400 hidden md:table-cell">{s.domain}</td>
                    <td className="px-3 py-3">
                      <button onClick={() => remove(s.fqdn)}
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
