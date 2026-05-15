import { useState, useEffect, Fragment } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { Plus, Trash2, Mail, ToggleLeft, ToggleRight, Forward, Shield, Pencil, Search } from 'lucide-react';

type Tab = 'forwarders' | 'autoresponders' | 'spam' | 'quotas' | 'domain-spam' | 'catch-all';

interface Forwarder { source: string; dest: string }
interface Autoresponder { id: number; email: string; subject: string; body: string; start_date: string; end_date: string; enabled: number }
interface SpamConfig { required_score: string; rewrite_header: string; report_safe: string; use_bayes: string; bayes_auto_learn: string }

function token() { return localStorage.getItem('hp_token') || ''; }
const api = (path: string) => axios.get(path, { headers: { Authorization: 'Bearer ' + token() } });
const del = (path: string) => axios.delete(path, { headers: { Authorization: 'Bearer ' + token() } });
const post = (path: string, data: any) => axios.post(path, data, { headers: { Authorization: 'Bearer ' + token() } });
const put  = (path: string, data: any) => axios.put(path, data, { headers: { Authorization: 'Bearer ' + token() } });

export default function EmailExtras() {
  const { success, error } = useToast();
  const [tab, setTab]   = useState<Tab>('forwarders');

  // Forwarders
  const [forwarders, setForwarders] = useState<Forwarder[]>([]);
  const [fwSource, setFwSource] = useState('');
  const [fwDest, setFwDest]     = useState('');

  // Autoresponders
  const [autoresponders, setAutoresponders] = useState<Autoresponder[]>([]);
  const [arForm, setArForm] = useState({ email: '', subject: 'Auto Reply', body: '', start_date: '', end_date: '' });
  const [showArForm, setShowArForm] = useState(false);
  const [editingArId, setEditingArId] = useState<number | null>(null);
  const [editArForm, setEditArForm] = useState({ email: '', subject: '', body: '', start_date: '', end_date: '' });

  // Spam
  const [spam, setSpam] = useState<SpamConfig>({ required_score: '5.0', rewrite_header: 'Subject ***SPAM***', report_safe: '0', use_bayes: '1', bayes_auto_learn: '1' });

  // Quotas
  const [quotas, setQuotas] = useState<any[]>([]);

  // Per-domain spam
  const [dsDomain, setDsDomain] = useState('');
  const [dsRules, setDsRules] = useState<any[]>([]);
  const [dsForm, setDsForm] = useState({ type: 'whitelist', address: '' });

  // Catch-all
  const [catchAlls, setCatchAlls] = useState<{ domain: string; destination: string }[]>([]);
  const [caForm, setCaForm] = useState({ domain: '', destination: '' });

  // Search
  const [fwSearch, setFwSearch] = useState('');
  const [arSearch, setArSearch] = useState('');
  const [caSearch, setCaSearch] = useState('');

  // Delete tracking
  const [deleting, setDeleting] = useState<string | number | null>(null);

  useEffect(() => { loadTab(tab); }, [tab]);

  function loadTab(t: Tab) {
    if (t === 'forwarders') api('/api/email-extras/forwarders').then(r => setForwarders(r.data)).catch(() => {});
    if (t === 'autoresponders') api('/api/email-extras/autoresponders').then(r => setAutoresponders(r.data)).catch(() => {});
    if (t === 'spam') api('/api/email-extras/spam').then(r => setSpam(r.data)).catch(() => {});
    if (t === 'quotas') api('/api/email-extras/quotas').then(r => setQuotas(r.data)).catch(() => {});
    if (t === 'catch-all') api('/api/email-extras/catch-all').then(r => setCatchAlls(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }

  async function addCatchAll() {
    if (!caForm.domain || !caForm.destination) return;
    try { await post('/api/email-extras/catch-all', caForm); success('Catch-all set'); setCaForm({ domain: '', destination: '' }); loadTab('catch-all'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function deleteCatchAll(domain: string) {
    setDeleting(domain);
    try { await del(`/api/email-extras/catch-all/${encodeURIComponent(domain)}`); success('Removed'); loadTab('catch-all'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
    finally { setDeleting(null); }
  }

  async function addForwarder() {
    if (!fwSource || !fwDest) return;
    try { await post('/api/email-extras/forwarders', { source: fwSource, dest: fwDest }); success('Forwarder added'); setFwSource(''); setFwDest(''); loadTab('forwarders'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function deleteForwarder(source: string) {
    setDeleting(source);
    try { await del(`/api/email-extras/forwarders/${encodeURIComponent(source)}`); success('Deleted'); loadTab('forwarders'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
    finally { setDeleting(null); }
  }

  async function saveAutoresponder() {
    try { await post('/api/email-extras/autoresponders', arForm); success('Autoresponder created'); setShowArForm(false); setArForm({ email: '', subject: 'Auto Reply', body: '', start_date: '', end_date: '' }); loadTab('autoresponders'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function toggleAutoresponder(ar: Autoresponder) {
    try { await put(`/api/email-extras/autoresponders/${ar.id}`, { ...ar, enabled: ar.enabled ? 0 : 1 }); loadTab('autoresponders'); }
    catch (e: any) { error('Failed'); }
  }

  async function deleteAutoresponder(id: number) {
    setDeleting(id);
    try { await del(`/api/email-extras/autoresponders/${id}`); success('Deleted'); loadTab('autoresponders'); }
    catch (e: any) { error('Failed'); }
    finally { setDeleting(null); }
  }

  async function updateAutoresponder(id: number) {
    try {
      await put(`/api/email-extras/autoresponders/${id}`, { ...editArForm, enabled: autoresponders.find(a => a.id === id)?.enabled ?? 1 });
      success('Autoresponder updated');
      setEditingArId(null);
      loadTab('autoresponders');
    } catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function saveSpam() {
    try { await put('/api/email-extras/spam', spam); success('SpamAssassin config saved'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function loadDomainSpam() {
    if (!dsDomain.trim()) return;
    try { const r = await api(`/api/email-extras/spam-rules/${dsDomain.trim()}`); setDsRules(r.data); }
    catch { setDsRules([]); }
  }

  async function deleteSpamRule(id: number) {
    setDeleting(id);
    try { await del(`/api/email-extras/spam-rules/${dsDomain}/${id}`); success('Rule removed'); loadDomainSpam(); }
    catch (e: any) { error('Failed'); }
    finally { setDeleting(null); }
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'forwarders', label: 'Forwarders', icon: Forward },
    { id: 'autoresponders', label: 'Autoresponders', icon: Mail },
    { id: 'spam', label: 'Spam Filter', icon: Shield },
    { id: 'quotas', label: 'Disk Quotas', icon: Mail },
    { id: 'domain-spam', label: 'Per-Domain Rules', icon: Shield },
    { id: 'catch-all', label: 'Catch-All', icon: Mail },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="page-title">Email Extras</h1>
        <p className="page-subtitle">Manage forwarders, autoresponders, spam filtering, and disk quotas</p>
      </div>

      <div className="tab-bar">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? 'tab-item-active' : 'tab-item'}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Forwarders */}
      {tab === 'forwarders' && (
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 mb-3">Add Forwarder</h3>
            <div className="flex gap-3">
              <input className="input flex-1" placeholder="from@domain.com" value={fwSource} onChange={e => setFwSource(e.target.value)} />
              <span className="flex items-center text-slate-400 text-sm">→</span>
              <input className="input flex-1" placeholder="to@destination.com" value={fwDest} onChange={e => setFwDest(e.target.value)} />
              <button className="btn-primary" onClick={addForwarder}><Plus size={14} /> Add</button>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search forwarders…" value={fwSearch} onChange={e => setFwSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell">Source</th><th className="table-header-cell">Destination</th><th className="table-header-cell w-16"></th></tr></thead>
                <tbody>
                  {(() => {
                    const q = fwSearch.trim().toLowerCase();
                    const visible = q ? forwarders.filter(f => [f.source, f.dest].some(v => v.toLowerCase().includes(q))) : forwarders;
                    if (forwarders.length === 0) return <tr><td colSpan={3} className="table-cell text-slate-400 text-center py-8">No forwarders configured</td></tr>;
                    if (visible.length === 0) return <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-400">No forwarders match "{fwSearch}"</td></tr>;
                    return visible.map(f => (
                      <tr key={f.source} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="table-cell font-medium">{f.source}</td>
                        <td className="table-cell text-slate-600 dark:text-slate-400">{f.dest}</td>
                        <td className="table-cell"><button className="btn-icon text-red-500" disabled={deleting === f.source} onClick={() => deleteForwarder(f.source)}><Trash2 size={14} /></button></td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Autoresponders */}
      {tab === 'autoresponders' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setShowArForm(true)}><Plus size={14} /> New Autoresponder</button>
          </div>

          {showArForm && (
            <div className="card p-5 space-y-3">
              <h3 className="font-semibold text-sm mb-2">New Autoresponder</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Email Address</label><input className="input" placeholder="user@domain.com" value={arForm.email} onChange={e => setArForm(p => ({ ...p, email: e.target.value }))} /></div>
                <div><label className="label">Subject</label><input className="input" value={arForm.subject} onChange={e => setArForm(p => ({ ...p, subject: e.target.value }))} /></div>
                <div><label className="label">Start Date (optional)</label><input type="date" className="input" value={arForm.start_date} onChange={e => setArForm(p => ({ ...p, start_date: e.target.value }))} /></div>
                <div><label className="label">End Date (optional)</label><input type="date" className="input" value={arForm.end_date} onChange={e => setArForm(p => ({ ...p, end_date: e.target.value }))} /></div>
              </div>
              <div><label className="label">Message Body</label><textarea className="input min-h-[100px]" value={arForm.body} onChange={e => setArForm(p => ({ ...p, body: e.target.value }))} /></div>
              <div className="flex gap-2 justify-end"><button className="btn-secondary" onClick={() => setShowArForm(false)}>Cancel</button><button className="btn-primary" onClick={saveAutoresponder}>Save</button></div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search autoresponders…" value={arSearch} onChange={e => setArSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell">Email</th><th className="table-header-cell">Subject</th><th className="table-header-cell">Active</th><th className="table-header-cell w-20"></th></tr></thead>
                <tbody>
                  {(() => {
                    const q = arSearch.trim().toLowerCase();
                    const visible = q ? autoresponders.filter(ar => [ar.email, ar.subject].some(v => v.toLowerCase().includes(q))) : autoresponders;
                    if (autoresponders.length === 0) return <tr><td colSpan={4} className="table-cell text-slate-400 text-center py-8">No autoresponders configured</td></tr>;
                    if (visible.length === 0) return <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No autoresponders match "{arSearch}"</td></tr>;
                    return visible.map(ar => (
                      <Fragment key={ar.id}>
                        <tr className="border-b border-slate-100 dark:border-slate-800">
                          <td className="table-cell font-medium">{ar.email}</td>
                          <td className="table-cell text-slate-600 dark:text-slate-400">{ar.subject}</td>
                          <td className="table-cell">
                            <button onClick={() => toggleAutoresponder(ar)}>{ar.enabled ? <ToggleRight size={20} className="text-emerald-500" /> : <ToggleLeft size={20} className="text-slate-400" />}</button>
                          </td>
                          <td className="table-cell">
                            <div className="flex gap-1">
                              <button className="btn-icon hover:!text-sky-600 hover:!bg-sky-50 dark:hover:!bg-sky-900/30" title="Edit" onClick={() => {
                                if (editingArId === ar.id) { setEditingArId(null); return; }
                                setEditingArId(ar.id);
                                setEditArForm({ email: ar.email, subject: ar.subject, body: ar.body, start_date: ar.start_date || '', end_date: ar.end_date || '' });
                              }}><Pencil size={13} /></button>
                              <button className="btn-icon text-red-500" disabled={deleting === ar.id} onClick={() => deleteAutoresponder(ar.id)}><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                        {editingArId === ar.id && (
                          <tr className="bg-slate-50 dark:bg-slate-800/30">
                            <td colSpan={4} className="px-4 py-3 space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div><label className="label">Email Address</label><input className="input" value={editArForm.email} onChange={e => setEditArForm(f => ({ ...f, email: e.target.value }))} /></div>
                                <div><label className="label">Subject</label><input className="input" value={editArForm.subject} onChange={e => setEditArForm(f => ({ ...f, subject: e.target.value }))} /></div>
                                <div><label className="label">Start Date</label><input type="date" className="input" value={editArForm.start_date} onChange={e => setEditArForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                                <div><label className="label">End Date</label><input type="date" className="input" value={editArForm.end_date} onChange={e => setEditArForm(f => ({ ...f, end_date: e.target.value }))} /></div>
                                <div className="col-span-2"><label className="label">Message Body</label><textarea className="input min-h-[80px]" value={editArForm.body} onChange={e => setEditArForm(f => ({ ...f, body: e.target.value }))} /></div>
                              </div>
                              <div className="flex gap-2">
                                <button className="btn-primary text-sm" onClick={() => updateAutoresponder(ar.id)}>Save</button>
                                <button className="btn-ghost text-sm" onClick={() => setEditingArId(null)}>Cancel</button>
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
        </div>
      )}

      {/* Spam */}
      {tab === 'spam' && (
        <div className="card p-5 space-y-4 max-w-xl">
          <h3 className="font-semibold text-sm">SpamAssassin Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Required Score (default 5.0)</label><input type="number" step="0.1" className="input" value={spam.required_score} onChange={e => setSpam(p => ({ ...p, required_score: e.target.value }))} /></div>
            <div><label className="label">Rewrite Header</label><input className="input" value={spam.rewrite_header} onChange={e => setSpam(p => ({ ...p, rewrite_header: e.target.value }))} /></div>
          </div>
          <div className="flex gap-6">
            {(['report_safe', 'use_bayes', 'bayes_auto_learn'] as const).map(k => (
              <label key={k} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded" checked={spam[k] === '1'} onChange={e => setSpam(p => ({ ...p, [k]: e.target.checked ? '1' : '0' }))} />
                <span className="text-sm text-slate-700 dark:text-slate-300">{k.replace(/_/g, ' ')}</span>
              </label>
            ))}
          </div>
          <button className="btn-primary" onClick={saveSpam}>Save SpamAssassin Config</button>
        </div>
      )}

      {/* Quotas */}
      {tab === 'quotas' && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell">User</th><th className="table-header-cell">Used</th><th className="table-header-cell">Limit</th><th className="table-header-cell">Grace</th></tr></thead>
            <tbody>
              {quotas.length === 0 && <tr><td colSpan={4} className="table-cell text-slate-400 text-center py-8">No quota data available — ensure the quota package is installed</td></tr>}
              {quotas.map((q, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="table-cell font-medium">{q.user}</td>
                  <td className="table-cell">{q.used}</td>
                  <td className="table-cell">{q.limit}</td>
                  <td className="table-cell">{q.grace}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'domain-spam' && (
        <div className="space-y-4">
          <div className="card p-4 flex gap-2">
            <input className="input flex-1" placeholder="Domain (e.g. example.com)" value={dsDomain} onChange={e => { setDsDomain(e.target.value); setDsRules([]); }} />
            <button className="btn-secondary" onClick={loadDomainSpam}>Load Rules</button>
          </div>

          {dsDomain && (
            <div className="card p-4 space-y-4">
              <div className="flex gap-2">
                <select className="input w-36" value={dsForm.type} onChange={e => setDsForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="whitelist">Whitelist</option>
                  <option value="blacklist">Blacklist</option>
                </select>
                <input className="input flex-1" placeholder="email@example.com or *@domain.com" value={dsForm.address} onChange={e => setDsForm(f => ({ ...f, address: e.target.value }))} />
                <button className="btn-primary" onClick={async () => {
                  await post(`/api/email-extras/spam-rules/${dsDomain}`, dsForm);
                  setDsForm({ type: 'whitelist', address: '' });
                  success('Rule added'); loadDomainSpam();
                }}><Plus size={14} /> Add</button>
              </div>

              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="table-header-cell">Type</th>
                  <th className="table-header-cell">Address</th>
                  <th className="px-4 py-3 w-12" />
                </tr></thead>
                <tbody>
                  {dsRules.length === 0 && <tr><td colSpan={3} className="table-cell text-center text-slate-400 py-6">No rules — all emails are treated by global spam settings</td></tr>}
                  {dsRules.map((r: any) => (
                    <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800">
                      <td className="table-cell"><span className={`badge-${r.type === 'whitelist' ? 'success' : 'danger'} text-xs`}>{r.type}</span></td>
                      <td className="table-cell font-mono text-xs">{r.address}</td>
                      <td className="table-cell">
                        <button className="btn-icon text-red-500" disabled={deleting === r.id} onClick={() => deleteSpamRule(r.id)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {tab === 'catch-all' && (
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100 mb-3">Set Catch-All Address</h3>
            <p className="text-xs text-slate-500 mb-3">Any mail sent to an unknown address at the domain will be forwarded here.</p>
            <div className="flex gap-3">
              <div>
                <label className="label">Domain</label>
                <input className="input" placeholder="example.com" value={caForm.domain} onChange={e => setCaForm(f => ({ ...f, domain: e.target.value }))} />
              </div>
              <div className="flex-1">
                <label className="label">Destination Address</label>
                <input className="input" placeholder="catchall@example.com" value={caForm.destination} onChange={e => setCaForm(f => ({ ...f, destination: e.target.value }))} />
              </div>
              <button className="btn-primary self-end" onClick={addCatchAll}><Plus size={14} /> Set</button>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search catch-alls…" value={caSearch} onChange={e => setCaSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell">Domain</th><th className="table-header-cell">Destination</th><th className="table-header-cell w-16"></th></tr></thead>
                <tbody>
                  {(() => {
                    const q = caSearch.trim().toLowerCase();
                    const visible = q ? catchAlls.filter(ca => [ca.domain, ca.destination].some(v => v.toLowerCase().includes(q))) : catchAlls;
                    if (catchAlls.length === 0) return <tr><td colSpan={3} className="table-cell text-slate-400 text-center py-8">No catch-all addresses configured</td></tr>;
                    if (visible.length === 0) return <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-400">No catch-alls match "{caSearch}"</td></tr>;
                    return visible.map(ca => (
                      <tr key={ca.domain} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="table-cell font-mono">@{ca.domain}</td>
                        <td className="table-cell text-slate-600 dark:text-slate-400">{ca.destination}</td>
                        <td className="table-cell"><button className="btn-icon text-red-500" disabled={deleting === ca.domain} onClick={() => deleteCatchAll(ca.domain)}><Trash2 size={14} /></button></td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
