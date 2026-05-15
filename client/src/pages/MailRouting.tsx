import { useEffect, useState, Fragment } from 'react';
import { Plus, Trash2, ExternalLink, Users, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';
import { fetchApi } from '../lib/api';

export default function MailRouting() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'transport' | 'lists' | 'webmail'>('transport');
  const [rules, setRules] = useState<any[]>([]);
  const [lists, setLists] = useState<any[]>([]);
  const [webmail, setWebmail] = useState<any>(null);
  const [newRule, setNewRule] = useState({ domain: '', transport: '' });
  const [newList, setNewList] = useState({ name: '', domain: '', admin_email: '', description: '' });
  const [expandedList, setExpandedList] = useState<number | null>(null);
  const [listMembers, setListMembers] = useState<Record<number, any[]>>({});
  const [memberForm, setMemberForm] = useState({ address: '', name: '' });
  const [ruleSubmitting, setRuleSubmitting] = useState(false);
  const [listSubmitting, setListSubmitting] = useState(false);
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [ruleSearch, setRuleSearch] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [deletingRule, setDeletingRule] = useState<string | null>(null);
  const [deletingList, setDeletingList] = useState<number | null>(null);
  const [removingMember, setRemovingMember] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    document.title = 'Mail Routing — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => { loadRules(); loadLists(); loadWebmail(); }, []);

  async function loadRules() {
    try {
      const r = await fetchApi('/api/mail-routing/'); setRules(Array.isArray(await r.json()) ? await r.clone().json() : []);
    } finally { setPageLoading(false); }
  }
  async function loadLists() {
    const r = await fetchApi('/api/mail-routing/lists'); setLists(Array.isArray(await r.json()) ? await r.clone().json() : []);
  }
  async function loadWebmail() {
    const r = await fetchApi('/api/mail-routing/webmail'); setWebmail(await r.json());
  }

  async function addRule() {
    if (!newRule.domain || !newRule.transport) return;
    setRuleSubmitting(true);
    try {
      const r = await fetchApi('/api/mail-routing/', { method: 'POST', body: JSON.stringify(newRule) });
      const d = await r.json();
      if (d.error) { toast.error(d.error); return; }
      toast.success('Transport rule added');
      setNewRule({ domain: '', transport: '' });
      loadRules();
    } finally { setRuleSubmitting(false); }
  }

  async function deleteRule(domain: string) {
    setDeletingRule(domain);
    try {
      await fetchApi(`/api/mail-routing/${domain}`, { method: 'DELETE' });
      loadRules();
    } finally { setDeletingRule(null); }
  }

  async function addList() {
    if (!newList.name || !newList.domain) return;
    setListSubmitting(true);
    try {
      const r = await fetchApi('/api/mail-routing/lists', { method: 'POST', body: JSON.stringify(newList) });
      const d = await r.json();
      if (d.error) { toast.error(d.error); return; }
      toast.success('Mailing list created');
      setNewList({ name: '', domain: '', admin_email: '', description: '' });
      loadLists();
    } finally { setListSubmitting(false); }
  }

  async function deleteList(id: number) {
    if (!await confirm('Delete this mailing list?')) return;
    setDeletingList(id);
    try {
      await fetchApi(`/api/mail-routing/lists/${id}`, { method: 'DELETE' });
      loadLists();
    } finally { setDeletingList(null); }
  }

  async function loadMembers(id: number) {
    if (expandedList === id) { setExpandedList(null); return; }
    const r = await fetchApi(`/api/mail-routing/lists/${id}/members`);
    const d = await r.json();
    setListMembers(p => ({ ...p, [id]: Array.isArray(d) ? d : [] }));
    setExpandedList(id);
    setMemberForm({ address: '', name: '' });
  }

  async function addMember(listId: number) {
    if (!memberForm.address) return;
    setMemberSubmitting(true);
    try {
      const r = await fetchApi(`/api/mail-routing/lists/${listId}/members`, { method: 'POST', body: JSON.stringify(memberForm) });
      const d = await r.json();
      if (d.error) { toast.error(d.error); return; }
      toast.success('Member added');
      setMemberForm({ address: '', name: '' });
      const r2 = await fetchApi(`/api/mail-routing/lists/${listId}/members`);
      const d2 = await r2.json();
      setListMembers(p => ({ ...p, [listId]: Array.isArray(d2) ? d2 : [] }));
    } finally { setMemberSubmitting(false); }
  }

  async function removeMember(listId: number, memberId: number) {
    setRemovingMember(memberId);
    try {
      await fetchApi(`/api/mail-routing/lists/${listId}/members/${memberId}`, { method: 'DELETE' });
      setListMembers(p => ({ ...p, [listId]: (p[listId] || []).filter(m => m.id !== memberId) }));
    } finally { setRemovingMember(null); }
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Mail Routing & Lists</h1>

      {pageLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
      <>

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
              <button className="btn-primary" onClick={addRule} disabled={ruleSubmitting}>{ruleSubmitting ? '…' : <><Plus size={14} className="mr-1" />Add</>}</button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search rules…" value={ruleSearch} onChange={e => setRuleSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead><tr>{['Domain', 'Transport', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
                <tbody>
                  {(() => {
                    const q = ruleSearch.trim().toLowerCase();
                    const visible = q ? rules.filter((r: any) => [r.domain, r.transport].some((v: string) => v?.toLowerCase().includes(q))) : rules;
                    if (rules.length === 0) return (
                      <tr><td colSpan={3} className="table-cell text-center text-slate-500">No rules — all mail uses default routing</td></tr>
                    );
                    if (visible.length === 0) return (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-400">No rules match "{ruleSearch}"</td></tr>
                    );
                    return visible.map((r: any) => (
                      <tr key={r.domain} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="table-cell font-mono text-sm">{r.domain}</td>
                        <td className="table-cell text-slate-500 font-mono text-xs">{r.transport}</td>
                        <td className="table-cell"><button className="btn-icon text-red-500" disabled={deletingRule === r.domain} onClick={() => deleteRule(r.domain)}><Trash2 size={13} /></button></td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
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
            <button className="btn-primary text-sm" onClick={addList} disabled={listSubmitting}>{listSubmitting ? 'Creating…' : <><Plus size={14} className="mr-1" />Create</>}</button>
          </div>

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search lists…" value={listSearch} onChange={e => setListSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead><tr>{['Address', 'Description', 'Created', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
                <tbody>
                  {(() => {
                    const q = listSearch.trim().toLowerCase();
                    const visible = q ? lists.filter((l: any) => [`${l.name}@${l.domain}`, l.description].some((v: any) => String(v ?? '').toLowerCase().includes(q))) : lists;
                    if (lists.length === 0) return (
                      <tr><td colSpan={4} className="table-cell text-center text-slate-500">No mailing lists</td></tr>
                    );
                    if (visible.length === 0) return (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No lists match "{listSearch}"</td></tr>
                    );
                    return visible.map((l: any) => (
                      <Fragment key={l.id}>
                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="table-cell font-mono text-sm">{l.name}@{l.domain}</td>
                          <td className="table-cell text-xs text-slate-500">{l.description || '—'}</td>
                          <td className="table-cell text-xs text-slate-500">{l.created_at ? new Date(l.created_at).toLocaleDateString() : '—'}</td>
                          <td className="table-cell">
                            <div className="flex gap-1">
                              <button className="btn-icon text-indigo-500 flex items-center gap-0.5" title="Members" onClick={() => loadMembers(l.id)}>
                                <Users size={13} />{expandedList === l.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                              </button>
                              <button className="btn-icon text-red-500" disabled={deletingList === l.id} onClick={() => deleteList(l.id)}><Trash2 size={13} /></button>
                            </div>
                          </td>
                        </tr>
                        {expandedList === l.id && (
                          <tr className="bg-slate-50 dark:bg-slate-800/30">
                            <td colSpan={4} className="px-4 py-3 space-y-3">
                              <p className="text-xs font-semibold text-slate-500">Members of {l.name}@{l.domain}</p>
                              <div className="flex gap-2">
                                <input className="input text-xs flex-1" placeholder="email@example.com" value={memberForm.address} onChange={e => setMemberForm(f => ({ ...f, address: e.target.value }))} />
                                <input className="input text-xs w-36" placeholder="Name (optional)" value={memberForm.name} onChange={e => setMemberForm(f => ({ ...f, name: e.target.value }))} />
                                <button className="btn-primary text-xs" onClick={() => addMember(l.id)} disabled={memberSubmitting}>{memberSubmitting ? '…' : <><Plus size={12} /> Add</>}</button>
                              </div>
                              <div className="space-y-1">
                                {(listMembers[l.id] || []).length === 0 && <p className="text-xs text-slate-400">No members yet</p>}
                                {(listMembers[l.id] || []).map((m: any) => (
                                  <div key={m.id} className="flex items-center justify-between text-xs bg-white dark:bg-slate-800 rounded px-3 py-1.5">
                                    <span className="font-mono">{m.address}</span>
                                    {m.name && <span className="text-slate-400">{m.name}</span>}
                                    <button className="btn-icon text-red-500" disabled={removingMember === m.id} onClick={() => removeMember(l.id, m.id)}><Trash2 size={11} /></button>
                                  </div>
                                ))}
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
      </>
      )}
    </div>
  );
}
