import { useState, useEffect } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { Key, Plus, Trash2, Copy, Eye, EyeOff, AlertTriangle, Clock } from 'lucide-react';

interface Token { id: number; name: string; token_prefix: string; permissions: string; last_used: string; expires_at: string; created_at: string }

function token() { return localStorage.getItem('hp_token') || ''; }
const auth = () => ({ Authorization: 'Bearer ' + token() });
const api   = (p: string) => axios.get(p, { headers: auth() });
const apost = (p: string, d: any) => axios.post(p, d, { headers: auth() });
const adel  = (p: string) => axios.delete(p, { headers: auth() });

const PERM_BADGE: Record<string, string> = { read: 'badge-info', write: 'badge-warning', admin: 'badge-danger' };

export default function ApiTokens() {
  const { success, error } = useToast();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', permissions: 'read', expires_at: '' });
  const [newToken, setNewToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() { try { const r = await api('/api/api-tokens/'); setTokens(r.data); } catch {} }

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
    if (!confirm(`Revoke token "${name}"? This cannot be undone.`)) return;
    try { await adel(`/api/api-tokens/${id}`); success('Token revoked'); load(); }
    catch { error('Failed'); }
  }

  function copy(text: string) { navigator.clipboard.writeText(text); success('Copied to clipboard'); }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">API Tokens</h1>
          <p className="page-subtitle">Generate tokens for API access and automation integrations</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> New Token</button>
      </div>

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
            {tokens.length === 0 && <tr><td colSpan={6} className="table-cell text-slate-400 text-center py-8">No API tokens yet</td></tr>}
            {tokens.map(t => (
              <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="table-cell font-medium">{t.name}</td>
                <td className="table-cell font-mono text-xs text-slate-600 dark:text-slate-400">{t.token_prefix}…</td>
                <td className="table-cell"><span className={PERM_BADGE[t.permissions] || 'badge-info'}>{t.permissions}</span></td>
                <td className="table-cell text-slate-400 text-xs"><div className="flex items-center gap-1"><Clock size={11} /> {t.last_used?.slice(0, 16) || 'Never'}</div></td>
                <td className="table-cell text-slate-400 text-xs">{t.expires_at || '—'}</td>
                <td className="table-cell"><button className="btn-icon text-red-500" onClick={() => revoke(t.id, t.name)}><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-4 bg-slate-50 dark:bg-slate-800/50">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Usage</h4>
        <pre className="text-xs font-mono text-slate-600 dark:text-slate-400">{`curl -H "Authorization: Bearer hp_your_token" https://panel.example.com/api/billing/summary`}</pre>
      </div>
    </div>
  );
}
