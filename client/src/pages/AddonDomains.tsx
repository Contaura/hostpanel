import { useEffect, useState } from 'react';
import { Plus, Trash2, Globe, Search } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/addon-domains${p}`, {
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o,
});

export default function AddonDomains() {
  const toast = useToast();
  const [addons, setAddons] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [form, setForm] = useState({ account_id: '', domain: '', subdomain: '', document_root: '' });
  const [adding, setAdding] = useState(false);
  const [addonSearch, setAddonSearch] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      await Promise.all([
        api('/').then(r => r.json()).then(d => setAddons(Array.isArray(d) ? d : [])),
        fetch('/api/accounts', { headers: { Authorization: `Bearer ${localStorage.getItem('hp_token')}` } })
          .then(r => r.json()).then(d => setAccounts(Array.isArray(d) ? d : [])),
      ]);
    } finally { setPageLoading(false); }
  }

  async function add() {
    if (!form.account_id || !form.domain || !form.subdomain) return;
    const r = await api('/', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success(`${form.domain} created`);
    setAdding(false);
    setForm({ account_id: '', domain: '', subdomain: '', document_root: '' });
    api('/').then(r => r.json()).then(d => setAddons(Array.isArray(d) ? d : []));
  }

  async function del(id: number, domain: string) {
    if (!confirm(`Remove addon domain ${domain}?`)) return;
    setDeleting(id);
    try {
      await api(`/${id}`, { method: 'DELETE' });
      setAddons(a => a.filter(x => x.id !== id));
    } finally { setDeleting(null); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Addon Domains</h1>
          <p className="page-subtitle">Point additional domains to a subdirectory of an existing account</p>
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />Add Domain</button>
      </div>

      {pageLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
      <>

      {adding && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-sm">New Addon Domain</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Hosting Account</label>
              <select className="input" value={form.account_id} onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
                <option value="">Select account</option>
                {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.username} ({a.domain})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Addon Domain</label>
              <input className="input" placeholder="other-domain.com" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} />
            </div>
            <div>
              <label className="label">Subdirectory name</label>
              <input className="input" placeholder="other-domain" value={form.subdomain} onChange={e => setForm(f => ({ ...f, subdomain: e.target.value }))} />
            </div>
            <div>
              <label className="label">Document Root (optional)</label>
              <input className="input font-mono" placeholder="auto-generated if blank" value={form.document_root} onChange={e => setForm(f => ({ ...f, document_root: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={add}>Create</button>
            <button className="btn-ghost text-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-48 text-sm" placeholder="Search domains…" value={addonSearch} onChange={e => setAddonSearch(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>{['Addon Domain', 'Account', 'Document Root', 'Created', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr>
            </thead>
            <tbody>
              {(() => {
                const q = addonSearch.trim().toLowerCase();
                const visible = q ? addons.filter((a: any) => [a.domain, a.username, a.account_id].some((v: any) => String(v ?? '').toLowerCase().includes(q))) : addons;
                if (addons.length === 0) return <tr><td colSpan={5} className="table-cell text-center text-slate-500">No addon domains configured</td></tr>;
                if (visible.length === 0) return <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">No domains match "{addonSearch}"</td></tr>;
                return visible.map((a: any) => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <Globe size={13} className="text-indigo-500 flex-shrink-0" />
                        <span className="font-medium">{a.domain}</span>
                      </div>
                    </td>
                    <td className="table-cell text-xs text-slate-500">{a.username || a.account_id}</td>
                    <td className="table-cell font-mono text-xs text-slate-500 truncate max-w-[200px]">{a.document_root}</td>
                    <td className="table-cell text-xs text-slate-500">{a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}</td>
                    <td className="table-cell">
                      <button className="btn-icon text-red-500" disabled={deleting === a.id} onClick={() => del(a.id, a.domain)}><Trash2 size={13} /></button>
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
