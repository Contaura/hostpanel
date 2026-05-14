import { useState, useEffect } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { Users, Plus, Trash2, Edit2, Save, X, Shield, Eye, Clock, Lock } from 'lucide-react';

interface AdminUser { id: number; username: string; email: string; role: string; totp_enabled: number; last_login: string; created_at: string }

function token() { return localStorage.getItem('hp_token') || ''; }
const auth = () => ({ Authorization: 'Bearer ' + token() });
const api   = (p: string) => axios.get(p, { headers: auth() });
const apost = (p: string, d: any) => axios.post(p, d, { headers: auth() });
const aput  = (p: string, d: any) => axios.put(p, d, { headers: auth() });
const adel  = (p: string) => axios.delete(p, { headers: auth() });

const ROLE_BADGE: Record<string, string> = { superadmin: 'badge-danger', admin: 'badge-info', readonly: 'badge-warning' };

interface PasswordPolicy { min_length: number; require_upper: boolean; require_number: boolean; require_special: boolean; }

export default function AdminUsers() {
  const { success, error } = useToast();
  const [users, setUsers]   = useState<AdminUser[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'admin' });
  const [policy, setPolicy] = useState<PasswordPolicy>({ min_length: 8, require_upper: false, require_number: false, require_special: false });
  const [policySaving, setPolicySaving] = useState(false);

  useEffect(() => { load(); loadPolicy(); }, []);

  async function load() { try { const r = await api('/api/admin-users/'); setUsers(r.data); } catch {} }
  async function loadPolicy() { try { const r = await api('/api/admin-users/password-policy'); setPolicy(r.data); } catch {} }
  async function savePolicy() {
    setPolicySaving(true);
    try { await aput('/api/admin-users/password-policy', policy); success('Password policy saved'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
    setPolicySaving(false);
  }

  async function save() {
    if (!form.username && !editing) { error('Username required'); return; }
    if (!form.email) { error('Email required'); return; }
    if (!editing && !form.password) { error('Password required for new users'); return; }
    try {
      if (editing) { await aput(`/api/admin-users/${editing.id}`, { email: form.email, password: form.password || undefined, role: form.role }); }
      else          { await apost('/api/admin-users/', form); }
      success(editing ? 'User updated' : 'User created');
      setShowForm(false); setEditing(null); setForm({ username: '', email: '', password: '', role: 'admin' });
      load();
    } catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function remove(id: number, username: string) {
    if (!confirm(`Delete admin user "${username}"?`)) return;
    try { await adel(`/api/admin-users/${id}`); success('User deleted'); load(); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  function startEdit(u: AdminUser) {
    setEditing(u); setForm({ username: u.username, email: u.email, password: '', role: u.role }); setShowForm(true);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Admin Users</h1>
          <p className="page-subtitle">Manage administrator accounts and their access levels</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setForm({ username: '', email: '', password: '', role: 'admin' }); setShowForm(true); }}>
          <Plus size={14} /> New Admin
        </button>
      </div>

      {showForm && (
        <div className="card p-5 space-y-4 max-w-lg">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{editing ? `Edit ${editing.username}` : 'New Admin User'}</h3>
            <button className="btn-icon" onClick={() => { setShowForm(false); setEditing(null); }}><X size={14} /></button>
          </div>
          {!editing && <div><label className="label">Username</label><input className="input" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} /></div>}
          <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
          <div><label className="label">{editing ? 'New Password (leave blank to keep)' : 'Password'}</label><input type="password" className="input" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} /></div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
              <option value="readonly">Read Only — view only, no changes</option>
              <option value="admin">Admin — full access except user management</option>
              <option value="superadmin">Super Admin — full access including user management</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button>
            <button className="btn-primary" onClick={save}><Save size={14} /> {editing ? 'Update' : 'Create'}</button>
          </div>
        </div>
      )}

      {/* Password Policy */}
      <div className="card p-5 space-y-4 max-w-lg">
        <div className="flex items-center gap-2">
          <Lock size={15} className="text-slate-500" />
          <h3 className="font-semibold text-sm">Password Policy</h3>
        </div>
        <div className="flex items-center gap-3">
          <label className="label mb-0 w-40">Minimum length</label>
          <input type="number" min={6} max={64} className="input w-24" value={policy.min_length}
            onChange={e => setPolicy(p => ({ ...p, min_length: Math.max(6, parseInt(e.target.value) || 8) }))} />
        </div>
        {([['require_upper', 'Require uppercase letter'], ['require_number', 'Require number'], ['require_special', 'Require special character']] as const).map(([field, label]) => (
          <label key={field} className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600"
              checked={policy[field]} onChange={e => setPolicy(p => ({ ...p, [field]: e.target.checked }))} />
            <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
          </label>
        ))}
        <button className="btn-primary text-sm w-fit" onClick={savePolicy} disabled={policySaving}>
          <Save size={13} /> {policySaving ? 'Saving…' : 'Save Policy'}
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className="table-header-cell">Username</th>
              <th className="table-header-cell">Email</th>
              <th className="table-header-cell">Role</th>
              <th className="table-header-cell">2FA</th>
              <th className="table-header-cell">Last Login</th>
              <th className="table-header-cell w-20"></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={6} className="table-cell text-slate-400 text-center py-8">
                No admin users in database — using .env credentials
              </td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="table-cell font-medium flex items-center gap-2"><Users size={13} className="text-slate-400" /> {u.username}</td>
                <td className="table-cell text-slate-600 dark:text-slate-400">{u.email}</td>
                <td className="table-cell"><span className={ROLE_BADGE[u.role] || 'badge-info'}>{u.role}</span></td>
                <td className="table-cell">
                  {u.totp_enabled ? <span className="badge-success flex items-center gap-1 w-fit"><Shield size={11} /> On</span> : <span className="text-slate-400 text-xs">Off</span>}
                </td>
                <td className="table-cell text-slate-400 text-xs">
                  <div className="flex items-center gap-1"><Clock size={11} /> {u.last_login?.slice(0, 16) || 'Never'}</div>
                </td>
                <td className="table-cell">
                  <div className="flex gap-1">
                    <button className="btn-icon" onClick={() => startEdit(u)}><Edit2 size={13} /></button>
                    <button className="btn-icon text-red-500" onClick={() => remove(u.id, u.username)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
