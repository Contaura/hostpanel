import { useEffect, useState } from 'react';
import { Plus, Trash2, ExternalLink, Users, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/mail-routing${p}`, {
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o,
});

export default function MailRouting() {
  const toast = useToast();
  const [tab, setTab] = useState<'transport' | 'lists' | 'webmail'>('transport');
  const [rules, setRules] = useState<any[]>([]);
  const [lists, setLists] = useState<any[]>([]);
  const [webmail, setWebmail] = useState<any>(null);
  const [newRule, setNewRule] = useState({ domain: '', transport: '' });
  const [newList, setNewList] = useState({ name: '', domain: '', admin_email: '', description: '' });
  const [expandedList, setExpandedList] = useState<number | null>(null);
  const [listMembers, setListMembers] = useState<Record<number, any[]>>({});
  const [memberForm, setMemberForm] = useState({ address: '', name: '' });

  useEffect(() => { loadRules(); loadLists(); loadWebmail(); }, []);

  async function loadRules() {
    const r = await api('/'); setRules(Array.isArray(await r.json()) ? await r.clone().json() : []);
  }
  async function loadLists() {
    const r = await api('/lists'); setLists(Array.isArray(await r.json()) ? await r.clone().json() : []);
  }
  async function loadWebmail() {
    const r = await api('/webmail'); setWebmail(await r.json());
  }

  async function addRule() {
    if (!newRule.domain || !newRule.transport) return;
    const r = await api('/', { method: 'POST', body: JSON.stringify(newRule) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Transport rule added');
    setNewRule({ domain: '', transport: '' });
    loadRules();
  }

  async function deleteRule(domain: string) {
    await api(`/${domain}`, { method: 'DELETE' });
    loadRules();
  }

  async function addList() {
    if (!newList.name || !newList.domain) return;
    const r = await api('/lists', { method: 'POST', body: JSON.stringify(newList) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Mailing list created');
    setNewList({ name: '', domain: '', admin_email: '', description: '' });
    loadLists();
  }

  async function deleteList(id: number) {
    if (!confirm('Delete this mailing list?')) return;
    await api(`/lists/${id}`, { method: 'DELETE' });
    loadLists();
  }

  async function loadMembers(id: number) {
    if (expandedList === id) { setExpandedList(null); return; }
    const r = await api(`/lists/${id}/members`);
    const d = await r.json();
    setListMembers(p => ({ ...p, [id]: Array.isArray(d) ? d : [] }));
    setExpandedList(id);
    setMemberForm({ address: '', name: '' });
  }

  async function addMember(listId: number) {
    if (!memberForm.address) return;
    const r = await api(`/lists/${listId}/members`, { method: 'POST', body: JSON.stringify(memberForm) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Member added');
    setMemberForm({ address: '', name: '' });
    const r2 = await api(`/lists/${listId}/members`);
    const d2 = await r2.json();
    setListMembers(p => ({ ...p, [listId]: Array.isArray(d2) ? d2 : [] }));
  }

  async function removeMember(listId: number, memberId: number) {
    await api(`/lists/${listId}/members/${memberId}`, { method: 'DELETE' });
    setListMembers(p => ({ ...p, [listId]: (p[listId] || []).filter(m => m.id !== memberId) }));
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Mail Routing & Lists</h1>

      <div className="tab-bar">
        <button className={`tab-item ${tab === 'transport' ? 'tab-item-active' : ''}`} onClick={() => setTab('transport')}>Transport Rules</button>
        <button className={`tab-item ${tab === 'lists' ? 'tab-item-active' : ''}`} onClick={() => setTab('lists')}>Mailing Lists</button>
        <button className={`tab-item ${tab === 'webmail' ? 'tab-item-active' : ''}`} onClick={() => setTab('webmail')}>Webmail</button>
      </div>

      {tab === 'transport' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <p className="text-sm font-medium">Add Transport Rule</p>
            <p className="text-xs text-slate-500">Route mail for a domain to a specific transport (e.g. <code>smtp:[mail.example.com]:25</code> or <code>local:</code>)</p>
            <div className="flex gap-3">
              <input className="input flex-1" placeholder="example.com" value={newRule.domain} onChange={e => setNewRule(r => ({ ...r, domain: e.target.value }))} />
              <input className="input flex-1" placeholder="smtp:[mail.example.com]:25" value={newRule.transport} onChange={e => setNewRule(r => ({ ...r, transport: e.target.value }))} />
              <button className="btn-primary" onClick={addRule}><Plus size={14} className="mr-1" />Add</button>
            </div>
          </div>

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead><tr>{['Domain', 'Transport', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
              <tbody>
                {rules.length === 0 && <tr><td colSpan={3} className="table-cell text-center text-slate-500">No rules — all mail uses default routing</td></tr>}
                {rules.map((r: any) => (
                  <tr key={r.domain} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="table-cell font-mono text-sm">{r.domain}</td>
                    <td className="table-cell text-slate-500 font-mono text-xs">{r.transport}</td>
                    <td className="table-cell"><button className="btn-icon text-red-500" onClick={() => deleteRule(r.domain)}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'lists' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <p className="text-sm font-medium">Create Mailing List</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">List name</label><input className="input" placeholder="announcements" value={newList.name} onChange={e => setNewList(l => ({ ...l, name: e.target.value }))} /></div>
              <div><label className="label">Domain</label><input className="input" placeholder="example.com" value={newList.domain} onChange={e => setNewList(l => ({ ...l, domain: e.target.value }))} /></div>
              <div><label className="label">Admin email</label><input className="input" type="email" value={newList.admin_email} onChange={e => setNewList(l => ({ ...l, admin_email: e.target.value }))} /></div>
              <div><label className="label">Description</label><input className="input" value={newList.description} onChange={e => setNewList(l => ({ ...l, description: e.target.value }))} /></div>
            </div>
            <button className="btn-primary text-sm" onClick={addList}><Plus size={14} className="mr-1" />Create</button>
          </div>

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead><tr>{['Address', 'Description', 'Created', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
              <tbody>
                {lists.length === 0 && <tr><td colSpan={4} className="table-cell text-center text-slate-500">No mailing lists</td></tr>}
                {lists.map((l: any) => (
                  <>
                    <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="table-cell font-mono text-sm">{l.name}@{l.domain}</td>
                      <td className="table-cell text-xs text-slate-500">{l.description || '—'}</td>
                      <td className="table-cell text-xs text-slate-500">{l.created_at ? new Date(l.created_at).toLocaleDateString() : '—'}</td>
                      <td className="table-cell">
                        <div className="flex gap-1">
                          <button className="btn-icon text-indigo-500 flex items-center gap-0.5" title="Members" onClick={() => loadMembers(l.id)}>
                            <Users size={13} />{expandedList === l.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                          </button>
                          <button className="btn-icon text-red-500" onClick={() => deleteList(l.id)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                    {expandedList === l.id && (
                      <tr key={`${l.id}-members`} className="bg-slate-50 dark:bg-slate-800/30">
                        <td colSpan={4} className="px-4 py-3 space-y-3">
                          <p className="text-xs font-semibold text-slate-500">Members of {l.name}@{l.domain}</p>
                          <div className="flex gap-2">
                            <input className="input text-xs flex-1" placeholder="email@example.com" value={memberForm.address} onChange={e => setMemberForm(f => ({ ...f, address: e.target.value }))} />
                            <input className="input text-xs w-36" placeholder="Name (optional)" value={memberForm.name} onChange={e => setMemberForm(f => ({ ...f, name: e.target.value }))} />
                            <button className="btn-primary text-xs" onClick={() => addMember(l.id)}><Plus size={12} /> Add</button>
                          </div>
                          <div className="space-y-1">
                            {(listMembers[l.id] || []).length === 0 && <p className="text-xs text-slate-400">No members yet</p>}
                            {(listMembers[l.id] || []).map((m: any) => (
                              <div key={m.id} className="flex items-center justify-between text-xs bg-white dark:bg-slate-800 rounded px-3 py-1.5">
                                <span className="font-mono">{m.address}</span>
                                {m.name && <span className="text-slate-400">{m.name}</span>}
                                <button className="btn-icon text-red-500" onClick={() => removeMember(l.id, m.id)}><Trash2 size={11} /></button>
                              </div>
                            ))}
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
      )}

      {tab === 'webmail' && (
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${webmail?.installed ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span className="font-medium text-sm">
              Roundcube {webmail?.installed ? 'detected' : 'not found'}
            </span>
          </div>
          {webmail?.installed && (
            <>
              <p className="text-xs text-slate-500">Path: <code className="font-mono">{webmail.path}</code></p>
              <a href={webmail.url || '/webmail'} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex">
                <ExternalLink size={14} className="mr-1" />Open Roundcube
              </a>
            </>
          )}
          {!webmail?.installed && (
            <div className="text-sm text-slate-500 space-y-2">
              <p>Roundcube was not found. Install it via the Script Installer or manually:</p>
              <pre className="bg-slate-100 dark:bg-slate-800 p-3 rounded text-xs">dnf install roundcubemail</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
