import { useEffect, useState } from 'react';
import { Plus, Trash2, ArrowRight, Search } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/parked-domains${p}`, {
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o,
});

export default function ParkedDomains() {
  const toast = useToast();
  const [parked, setParked] = useState<any[]>([]);
  const [domains, setDomains] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ domain: '', primary_domain: '' });
  const [parkedSearch, setParkedSearch] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      await Promise.all([
        api('/').then(r => r.json()).then(d => setParked(Array.isArray(d) ? d : [])),
        fetch('/api/domains/domains', { headers: { Authorization: `Bearer ${localStorage.getItem('hp_token')}` } })
          .then(r => r.json()).then(d => setDomains(Array.isArray(d) ? d : [])),
      ]);
    } finally { setPageLoading(false); }
  }

  async function add() {
    if (!form.domain || !form.primary_domain) return;
    const r = await api('/', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success(`${form.domain} parked`);
    setAdding(false);
    setForm({ domain: '', primary_domain: '' });
    api('/').then(r => r.json()).then(d => setParked(Array.isArray(d) ? d : []));
  }

  async function del(id: number, domain: string) {
    if (!confirm(`Remove parked domain ${domain}?`)) return;
    setDeleting(id);
    try {
      await api(`/${id}`, { method: 'DELETE' });
      setParked(p => p.filter(x => x.id !== id));
      toast.success('Removed');
    } finally { setDeleting(null); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Parked Domains</h1>
          <p className="page-subtitle">Redirect additional domains to an existing site</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />Park Domain</button>
      </div>

      {pageLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
      <>

      {adding && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-sm">Park a Domain</h2>
          <p className="text-xs text-slate-500">All traffic to the parked domain will be redirected (301) to the primary domain.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Parked Domain</label>
              <input className="input" placeholder="alias.com" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} />
            </div>
            <div>
              <label className="label">Redirect to (Primary Domain)</label>
              <select className="input" value={form.primary_domain} onChange={e => setForm(f => ({ ...f, primary_domain: e.target.value }))}>
                <option value="">Select primary domain</option>
                {domains.map((d: any) => <option key={d} value={d}>{d}</option>)}
                <option value="_custom_">Enter manually…</option>
              </select>
              {form.primary_domain === '_custom_' && (
                <input className="input mt-2" placeholder="example.com" onChange={e => setForm(f => ({ ...f, primary_domain: e.target.value }))} />
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={add}>Park Domain</button>
            <button className="btn-ghost text-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-48 text-sm" placeholder="Search domains…" value={parkedSearch} onChange={e => setParkedSearch(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>{['Parked Domain', 'Redirects To', 'Created', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(() => {
                const q = parkedSearch.trim().toLowerCase();
                const visible = q ? parked.filter((p: any) => [p.domain, p.primary_domain].some((v: any) => String(v ?? '').toLowerCase().includes(q))) : parked;
                if (parked.length === 0) return <tr><td colSpan={4} className="table-cell text-center text-slate-500 py-8">No parked domains configured</td></tr>;
                if (visible.length === 0) return <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No domains match "{parkedSearch}"</td></tr>;
                return visible.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="table-cell font-medium">{p.domain}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2 text-slate-500">
                        <ArrowRight size={12} className="text-indigo-500" />
                        <span className="font-mono text-xs">{p.primary_domain}</span>
                      </div>
                    </td>
                    <td className="table-cell text-xs text-slate-500">{p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}</td>
                    <td className="table-cell">
                      <button className="btn-icon text-red-500" disabled={deleting === p.id} onClick={() => del(p.id, p.domain)}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
