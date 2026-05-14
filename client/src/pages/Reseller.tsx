import { useEffect, useState } from 'react';
import { Plus, Trash2, Edit2, Building2 } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/resellers${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, ...o });

const blank = { username: '', email: '', password: '', company: '', alloc_disk: 102400, alloc_bandwidth: 1024000, alloc_accounts: 10, alloc_emails: 50, alloc_dbs: 20 };

export default function Reseller() {
  const toast = useToast();
  const [resellers, setResellers] = useState<any[]>([]);
  const [form, setForm] = useState<any>(blank);
  const [editing, setEditing] = useState<any>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const r = await api('/');
    setResellers(Array.isArray(await r.json()) ? await r.clone().json() : []);
  }

  async function create() {
    const r = await api('/', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Reseller created');
    setAdding(false); setForm(blank);
    load();
  }

  async function update() {
    const r = await api(`/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Updated');
    setEditing(null);
    load();
  }

  async function del(id: number) {
    if (!confirm('Delete reseller? This removes the login account.')) return;
    await api(`/${id}`, { method: 'DELETE' });
    load();
  }

  const AllocField = ({ label, field, obj, setObj }: any) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" value={obj[field]} onChange={e => setObj((o: any) => ({ ...o, [field]: Number(e.target.value) }))} />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Resellers (WHM)</h1>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />New Reseller</button>
      </div>

      {adding && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-sm">Create Reseller Account</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Username</label><input className="input" value={form.username} onChange={e => setForm((f: any) => ({ ...f, username: e.target.value }))} /></div>
            <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e => setForm((f: any) => ({ ...f, email: e.target.value }))} /></div>
            <div><label className="label">Password</label><input className="input" type="password" value={form.password} onChange={e => setForm((f: any) => ({ ...f, password: e.target.value }))} /></div>
            <div><label className="label">Company</label><input className="input" value={form.company} onChange={e => setForm((f: any) => ({ ...f, company: e.target.value }))} /></div>
          </div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Allocations</p>
          <div className="grid grid-cols-5 gap-3">
            <AllocField label="Disk (MB)" field="alloc_disk" obj={form} setObj={setForm} />
            <AllocField label="Bandwidth (MB)" field="alloc_bandwidth" obj={form} setObj={setForm} />
            <AllocField label="Accounts" field="alloc_accounts" obj={form} setObj={setForm} />
            <AllocField label="Email Accts" field="alloc_emails" obj={form} setObj={setForm} />
            <AllocField label="Databases" field="alloc_dbs" obj={form} setObj={setForm} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={create}>Create</button>
            <button className="btn-ghost text-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-sm">Edit Reseller — {editing.username}</h2>
          <div className="grid grid-cols-5 gap-3">
            <AllocField label="Disk (MB)" field="alloc_disk" obj={editing} setObj={setEditing} />
            <AllocField label="Bandwidth (MB)" field="alloc_bandwidth" obj={editing} setObj={setEditing} />
            <AllocField label="Accounts" field="alloc_accounts" obj={editing} setObj={setEditing} />
            <AllocField label="Email Accts" field="alloc_emails" obj={editing} setObj={setEditing} />
            <AllocField label="Databases" field="alloc_dbs" obj={editing} setObj={setEditing} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={update}>Save</button>
            <button className="btn-ghost text-sm" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {resellers.length === 0 && <p className="text-sm text-slate-500">No reseller accounts.</p>}
        {resellers.map((r: any) => (
          <div key={r.id} className="card">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                  <Building2 size={16} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="font-medium text-sm">{r.username}</p>
                  <p className="text-xs text-slate-500">{r.email} {r.company ? `· ${r.company}` : ''}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-icon" onClick={() => setEditing({ ...r })}><Edit2 size={13} /></button>
                <button className="btn-icon text-red-500" onClick={() => del(r.id)}><Trash2 size={13} /></button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-5 gap-3 text-xs">
              {[['Disk', r.alloc_disk, 'MB'], ['Bandwidth', r.alloc_bandwidth, 'MB'], ['Accounts', r.alloc_accounts, ''], ['Emails', r.alloc_emails, ''], ['Databases', r.alloc_dbs, '']].map(([label, val, unit]) => (
                <div key={label as string} className="bg-slate-50 dark:bg-slate-800 rounded p-2">
                  <p className="text-slate-500">{label}</p>
                  <p className="font-semibold">{val}{unit && ` ${unit}`}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
