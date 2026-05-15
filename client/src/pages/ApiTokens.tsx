import { useState, useEffect, Fragment } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';
import { Key, Plus, Trash2, Copy, Eye, EyeOff, AlertTriangle, Clock, Webhook, Send, History, Pencil, Search } from 'lucide-react';

interface Token { id: number; name: string; token_prefix: string; permissions: string; last_used: string; expires_at: string; created_at: string }
interface Webhook { id: number; name: string; url: string; events: string; active: number; created_at: string }
interface WebhookDelivery { id: number; event: string; status_code: number; success: number; response_body: string; delivered_at: string }

function token() { return localStorage.getItem('hp_token') || ''; }
const auth = () => ({ Authorization: 'Bearer ' + token() });
const api   = (p: string) => axios.get(p, { headers: auth() });
const apost = (p: string, d: any) => axios.post(p, d, { headers: auth() });
const adel  = (p: string) => axios.delete(p, { headers: auth() });
const aput  = (p: string, d: any) => axios.put(p, d, { headers: auth() });

const PERM_BADGE: Record<string, string> = { read: 'badge-info', write: 'badge-warning', admin: 'badge-danger' };

const WEBHOOK_EVENTS = ['account.created', 'account.suspended', 'account.deleted', 'domain.created', 'domain.deleted', 'backup.completed', 'alert.triggered'];

export default function ApiTokens() {
  const { success, error } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'tokens' | 'webhooks'>('tokens');
  const [tokens, setTokens] = useState<Token[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', permissions: 'read', expires_at: '' });
  const [newToken, setNewToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [whForm, setWhForm] = useState({ name: '', url: '', events: [] as string[], secret: '' });
  const [whDeliveries, setWhDeliveries] = useState<Record<number, WebhookDelivery[]>>({});
  const [showDeliveries, setShowDeliveries] = useState<number | null>(null);
  const [editingWhId, setEditingWhId] = useState<number | null>(null);
  const [editWhForm, setEditWhForm] = useState({ name: '', url: '', secret: '', events: [] as string[], enabled: true });
  const [tokenSearch, setTokenSearch] = useState('');
  const [webhookSearch, setWebhookSearch] = useState('');
  const [revoking, setRevoking] = useState<number | null>(null);
  const [deletingWh, setDeletingWh] = useState<number | null>(null);
  const [testingWh, setTestingWh] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    document.title = 'API Tokens — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (tab === 'webhooks') loadWebhooks(); }, [tab]);

  async function load() { try { const r = await api('/api/api-tokens/'); setTokens(r.data); } catch {} finally { setPageLoading(false); } }

  async function loadWebhooks() { try { const r = await api('/api/api-tokens/webhooks'); setWebhooks(r.data); } catch {} }

  async function createWebhook() {
    if (!whForm.name || !whForm.url || !whForm.events.length) { error('Name, URL, and at least one event required'); return; }
    try {
      await apost('/api/api-tokens/webhooks', { ...whForm, events: whForm.events.join(',') });
      success('Webhook created'); setShowWebhookForm(false); setWhForm({ name: '', url: '', events: [], secret: '' }); loadWebhooks();
    } catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function deleteWebhook(id: number) {
    if (!await confirm('Delete this webhook?')) return;
    setDeletingWh(id);
    try { await adel(`/api/api-tokens/webhooks/${id}`); success('Webhook deleted'); loadWebhooks(); }
    catch { error('Failed'); }
    finally { setDeletingWh(null); }
  }

  async function testWebhook(id: number) {
    setTestingWh(id);
    try { await apost(`/api/api-tokens/webhooks/${id}/test`, {}); success('Test delivery sent'); }
    catch { error('Failed'); }
    finally { setTestingWh(null); }
  }

  async function loadDeliveries(id: number) {
    if (showDeliveries === id) { setShowDeliveries(null); return; }
    try { const r = await api(`/api/api-tokens/webhooks/${id}/deliveries`); setWhDeliveries(p => ({ ...p, [id]: r.data })); setShowDeliveries(id); }
    catch { error('Failed to load deliveries'); }
  }

  async function updateWebhook(id: number) {
    if (!editWhForm.name || !editWhForm.url) { error('Name and URL required'); return; }
    try {
      await aput(`/api/api-tokens/webhooks/${id}`, { ...editWhForm, events: editWhForm.events.join(','), enabled: editWhForm.enabled ? 1 : 0 });
      success('Webhook updated');
      setEditingWhId(null);
      loadWebhooks();
    } catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function create() {
    if (!form.name) { error('Name required'); return; }
    try {
      const r = await apost('/api/api-tokens/', form);
      setNewToken(r.data.token);
      setShowForm(false);
      setForm({ name: '', permissions: 'read', expires_at: '' });
      load();
    } catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function revoke(id: number, name: string) {
    if (!await confirm(`Revoke token "${name}"? This cannot be undone.`)) return;
    setRevoking(id);
    try { await adel(`/api/api-tokens/${id}`); success('Token revoked'); load(); }
    catch { error('Failed'); }
    finally { setRevoking(null); }
  }

  function copy(text: string) { navigator.clipboard.writeText(text); success('Copied to clipboard'); }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">API Tokens & Webhooks</h1>
          <p className="page-subtitle">Generate tokens for API access and configure webhook integrations</p>
        </div>
        {tab === 'tokens' && <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> New Token</button>}
        {tab === 'webhooks' && <button className="btn-primary" onClick={() => setShowWebhookForm(true)}><Plus size={14} /> New Webhook</button>}
      </div>

      <div className="tab-bar">
        <button className={tab === 'tokens' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('tokens')}><Key size={14} /> API Tokens</button>
        <button className={tab === 'webhooks' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('webhooks')}><Webhook size={14} /> Webhooks</button>
      </div>

      {tab === 'tokens' && <>
      {pageLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
      <>
      {/* Newly created token — shown once */}
      {newToken && (
        <div className="card border-2 border-emerald-400 p-5 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Copy this token now — it will never be shown again.</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-slate-100 dark:bg-slate-800 p-3 rounded font-mono text-xs break-all">
              {showToken ? newToken : newToken.slice(0, 12) + '••••••••••••••••••••••••••••••••'}
            </code>
            <button className="btn-icon" onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            <button className="btn-secondary" onClick={() => copy(newToken)}><Copy size={14} /> Copy</button>
          </div>
          <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setNewToken(null)}>Dismiss</button>
        </div>
      )}

      {showForm && (
        <div className="card p-5 space-y-4 max-w-lg">
          <h3 className="font-semibold text-sm">New API Token</h3>
          <div><label className="label">Token Name</label><input className="input" placeholder="CI/CD deploy, Monitoring, etc." value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div>
            <label className="label">Permissions</label>
            <select className="input" value={form.permissions} onChange={e => setForm(p => ({ ...p, permissions: e.target.value }))}>
              <option value="read">Read — GET endpoints only</option>
              <option value="write">Write — GET + POST/PUT/DELETE (no admin)</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>
          <div><label className="label">Expires At (optional)</label><input type="date" className="input" value={form.expires_at} onChange={e => setForm(p => ({ ...p, expires_at: e.target.value }))} /></div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={create}><Key size={14} /> Generate Token</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-48 text-sm" placeholder="Search tokens…" value={tokenSearch} onChange={e => setTokenSearch(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="table-header-cell">Name</th>
                <th className="table-header-cell">Token Prefix</th>
                <th className="table-header-cell">Permissions</th>
                <th className="table-header-cell">Last Used</th>
                <th className="table-header-cell">Expires</th>
                <th className="table-header-cell w-16"></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const q = tokenSearch.trim().toLowerCase();
                const visible = q ? tokens.filter(t => [t.name, t.permissions, t.token_prefix].some(v => v?.toLowerCase().includes(q))) : tokens;
                if (tokens.length === 0) return <tr><td colSpan={6} className="table-cell text-slate-400 text-center py-8">No API tokens yet</td></tr>;
                if (visible.length === 0) return <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">No tokens match "{tokenSearch}"</td></tr>;
                return visible.map(t => (
                  <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="table-cell font-medium">{t.name}</td>
                    <td className="table-cell font-mono text-xs text-slate-600 dark:text-slate-400">{t.token_prefix}…</td>
                    <td className="table-cell"><span className={PERM_BADGE[t.permissions] || 'badge-info'}>{t.permissions}</span></td>
                    <td className="table-cell text-slate-400 text-xs"><div className="flex items-center gap-1"><Clock size={11} /> {t.last_used?.slice(0, 16) || 'Never'}</div></td>
                    <td className="table-cell text-slate-400 text-xs">{t.expires_at || '—'}</td>
                    <td className="table-cell"><button className="btn-icon text-red-500" disabled={revoking === t.id} onClick={() => revoke(t.id, t.name)}><Trash2 size={13} /></button></td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4 bg-slate-50 dark:bg-slate-800/50">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Usage</h4>
        <pre className="text-xs font-mono text-slate-600 dark:text-slate-400">{`curl -H "Authorization: Bearer hp_your_token" https://panel.example.com/api/billing/summary`}</pre>
      </div>
      </>
      )}
      </>}

      {tab === 'webhooks' && (
        <div className="space-y-4">
          {showWebhookForm && (
            <div className="card p-5 space-y-4 max-w-lg">
              <h3 className="font-semibold text-sm">New Webhook</h3>
              <div><label className="label">Name</label><input className="input" placeholder="Slack notifications" value={whForm.name} onChange={e => setWhForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="label">Payload URL</label><input className="input font-mono" placeholder="https://hooks.slack.com/..." value={whForm.url} onChange={e => setWhForm(p => ({ ...p, url: e.target.value }))} /></div>
              <div><label className="label">Secret (optional, for HMAC signature)</label><input className="input font-mono" placeholder="my-secret-key" value={whForm.secret} onChange={e => setWhForm(p => ({ ...p, secret: e.target.value }))} /></div>
              <div>
                <label className="label">Events</label>
                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  {WEBHOOK_EVENTS.map(ev => (
                    <label key={ev} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={whForm.events.includes(ev)} onChange={e => setWhForm(p => ({ ...p, events: e.target.checked ? [...p.events, ev] : p.events.filter(x => x !== ev) }))} />
                      <span className="font-mono">{ev}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button className="btn-secondary" onClick={() => setShowWebhookForm(false)}>Cancel</button>
                <button className="btn-primary" onClick={createWebhook}><Webhook size={14} /> Create Webhook</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search webhooks…" value={webhookSearch} onChange={e => setWebhookSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="table-header-cell">Name</th>
                <th className="table-header-cell">URL</th>
                <th className="table-header-cell">Events</th>
                <th className="table-header-cell w-32"></th>
              </tr></thead>
              <tbody>
                {(() => {
                  const q = webhookSearch.trim().toLowerCase();
                  const visible = q ? webhooks.filter(wh => [wh.name, wh.url, wh.events].some(v => v?.toLowerCase().includes(q))) : webhooks;
                  if (webhooks.length === 0) return <tr><td colSpan={4} className="table-cell text-slate-400 text-center py-8">No webhooks configured</td></tr>;
                  if (visible.length === 0) return <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No webhooks match "{webhookSearch}"</td></tr>;
                  return visible.map(wh => (
                  <Fragment key={wh.id}>
                    <tr className="border-b border-slate-100 dark:border-slate-800">
                      <td className="table-cell font-medium">{wh.name}</td>
                      <td className="table-cell font-mono text-xs text-slate-600 dark:text-slate-400 truncate max-w-[200px]">{wh.url}</td>
                      <td className="table-cell text-xs text-slate-500">{wh.events}</td>
                      <td className="table-cell">
                        <div className="flex gap-1">
                          <button className="btn-icon hover:!text-sky-600 hover:!bg-sky-50 dark:hover:!bg-sky-900/30" title="Edit" onClick={() => {
                            if (editingWhId === wh.id) { setEditingWhId(null); return; }
                            setEditingWhId(wh.id);
                            setEditWhForm({ name: wh.name, url: wh.url, secret: '', events: wh.events ? wh.events.split(',') : [], enabled: !!wh.active });
                          }}><Pencil size={13} /></button>
                          <button className="btn-icon text-indigo-500" title="Test" disabled={testingWh === wh.id} onClick={() => testWebhook(wh.id)}><Send size={13} /></button>
                          <button className="btn-icon text-slate-500" title="Delivery history" onClick={() => loadDeliveries(wh.id)}><History size={13} /></button>
                          <button className="btn-icon text-red-500" title="Delete" disabled={deletingWh === wh.id} onClick={() => deleteWebhook(wh.id)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                    {editingWhId === wh.id && (
                      <tr className="bg-slate-50 dark:bg-slate-800/30">
                        <td colSpan={4} className="px-4 py-3 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div><label className="label">Name</label><input className="input" value={editWhForm.name} onChange={e => setEditWhForm(f => ({ ...f, name: e.target.value }))} /></div>
                            <div><label className="label">Payload URL</label><input className="input font-mono" value={editWhForm.url} onChange={e => setEditWhForm(f => ({ ...f, url: e.target.value }))} /></div>
                            <div><label className="label">Secret (leave blank to keep existing)</label><input className="input font-mono" placeholder="••••••••" value={editWhForm.secret} onChange={e => setEditWhForm(f => ({ ...f, secret: e.target.value }))} /></div>
                            <div className="flex items-center gap-2 pt-5">
                              <input type="checkbox" id={`wh-enabled-${wh.id}`} checked={editWhForm.enabled} onChange={e => setEditWhForm(f => ({ ...f, enabled: e.target.checked }))} />
                              <label htmlFor={`wh-enabled-${wh.id}`} className="text-sm">Enabled</label>
                            </div>
                          </div>
                          <div>
                            <label className="label">Events</label>
                            <div className="grid grid-cols-2 gap-1.5 mt-1">
                              {WEBHOOK_EVENTS.map(ev => (
                                <label key={ev} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                  <input type="checkbox" checked={editWhForm.events.includes(ev)} onChange={e => setEditWhForm(f => ({ ...f, events: e.target.checked ? [...f.events, ev] : f.events.filter(x => x !== ev) }))} />
                                  <span className="font-mono">{ev}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button className="btn-primary text-sm" onClick={() => updateWebhook(wh.id)}>Save</button>
                            <button className="btn-ghost text-sm" onClick={() => setEditingWhId(null)}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {showDeliveries === wh.id && (
                      <tr className="bg-slate-50 dark:bg-slate-800/30">
                        <td colSpan={4} className="px-4 py-3">
                          <p className="text-xs font-semibold text-slate-500 mb-2">Recent Deliveries</p>
                          {(whDeliveries[wh.id] || []).length === 0 && <p className="text-xs text-slate-400">No deliveries yet</p>}
                          <div className="space-y-1">
                            {(whDeliveries[wh.id] || []).map(d => (
                              <div key={d.id} className="flex items-center gap-3 text-xs">
                                <span className={`badge-${d.success ? 'success' : 'danger'}`}>{d.status_code}</span>
                                <span className="font-mono text-slate-500">{d.event}</span>
                                <span className="text-slate-400">{d.delivered_at?.slice(0, 19)}</span>
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
    </div>
  );
}
