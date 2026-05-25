import { useEffect, useState } from 'react';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, adel, DbRow, DbUserRow } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Databases() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} username={account.username} />}
    </RequireAccount>
  );
}

function Inner({ username }: { username: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [dbs, setDbs]                 = useState<DbRow[]>([]);
  const [users, setUsers]             = useState<DbUserRow[]>([]);
  const [pma, setPma]                 = useState<{ installed: boolean; url: string; selectedDatabase: string | null; databases: string[]; users: DbUserRow[] } | null>(null);
  const [dbForm, setDbForm]           = useState({ name: '' });
  const [userForm, setUserForm]       = useState({ username: '', password: '', database: '' });
  const [busy, setBusy]               = useState(false);

  useEffect(() => { loadDbs(); loadUsers(); loadPma(); }, [username]);
  async function loadDbs()    { try { const r = await api<DbRow[]>('/api/portal/databases');        setDbs(r.data); } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); } }
  async function loadUsers()  { try { const r = await api<DbUserRow[]>('/api/portal/databases/users'); setUsers(r.data); } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); } }
  async function loadPma(database?: string) { try { const r = await api<any>(`/api/portal/phpmyadmin${database ? `?database=${encodeURIComponent(database)}` : ''}`); setPma(r.data); return r.data; } catch { setPma(null); return null; } }
  async function openPmaForDb(database: string) {
    const scoped = await loadPma(database);
    if (!scoped?.installed) return toast.error('phpMyAdmin is not installed yet');
    window.open(scoped.url, '_blank', 'noopener,noreferrer');
  }

  async function addDb() {
    if (!dbForm.name) return;
    setBusy(true);
    try { await apost('/api/portal/databases', { name: dbForm.name }); toast.success('Database created'); setDbForm({ name: '' }); await loadDbs(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function delDb(name: string) {
    if (!await confirm(`Drop database ${name}? All data will be lost.`)) return;
    setBusy(true);
    try { await adel(`/api/portal/databases/${encodeURIComponent(name)}`); toast.success('Dropped'); await loadDbs(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function addUser() {
    if (!userForm.username || !userForm.password) return;
    if (userForm.password.length < 8) return toast.error('Password must be ≥ 8 chars');
    setBusy(true);
    try { await apost('/api/portal/databases/users', userForm); toast.success('DB user created'); setUserForm({ username: '', password: '', database: '' }); await loadUsers(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function delUser(name: string) {
    if (!await confirm(`Delete DB user ${name}?`)) return;
    setBusy(true);
    try { await adel(`/api/portal/databases/users/${encodeURIComponent(name)}`); toast.success('DB user deleted'); await loadUsers(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  const prefix = username + '_';
  const stripPrefix = (s: string) => s.startsWith(prefix) ? s.slice(prefix.length) : s;

  return (
    <div>
      <PageTitle title="MySQL Databases" subtitle={`Databases and users must start with your account prefix (${prefix}).`} />

      <div className="card p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">phpMyAdmin</p>
          <p className="text-xs text-slate-500">
            {pma?.installed ? `Available${pma.selectedDatabase ? ` · selected DB ${pma.selectedDatabase}` : ''}` : 'Not installed by your hosting provider yet.'}
          </p>
        </div>
        {pma?.installed && <a className="btn-secondary text-xs" href={pma.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Open phpMyAdmin</a>}
      </div>

      <div className="card p-5 mb-4">
        <p className="text-sm font-semibold mb-3">Databases</p>
        <div className="grid grid-cols-12 gap-2 items-end mb-3">
          <div className="col-span-9">
            <label className="label text-xs">Database name</label>
            <div className="flex items-center">
              <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-r-0 border-slate-300 dark:border-slate-700 rounded-l text-xs text-slate-500 font-mono">{prefix}</span>
              <input className="input rounded-l-none font-mono" placeholder="suffix" value={stripPrefix(dbForm.name)} onChange={e => setDbForm({ name: prefix + e.target.value.replace(/[^a-z0-9_]/g, '') })} />
            </div>
          </div>
          <button className="btn-primary col-span-3 text-xs" onClick={addDb} disabled={busy || !dbForm.name}><Plus size={12} /> Create</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {dbs.length === 0 && <tr><td colSpan={2} className="py-3 text-center text-slate-400 text-xs">No databases</td></tr>}
            {dbs.map(d => (
              <tr key={d.name} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs">{d.name}</td>
                <td className="text-right flex justify-end gap-1">
                  {pma?.installed && <button className="btn-icon text-indigo-500" title="Open in phpMyAdmin" onClick={() => openPmaForDb(d.name)}><ExternalLink size={12} /></button>}
                  <button className="btn-icon text-rose-500" onClick={() => delDb(d.name)} disabled={busy}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <p className="text-sm font-semibold mb-3">Database users</p>
        <div className="grid grid-cols-12 gap-2 items-end mb-3">
          <div className="col-span-3">
            <label className="label text-xs">Username</label>
            <div className="flex items-center">
              <span className="px-1.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-r-0 border-slate-300 dark:border-slate-700 rounded-l text-xs text-slate-500 font-mono">{prefix}</span>
              <input className="input rounded-l-none font-mono text-xs" placeholder="suffix" value={stripPrefix(userForm.username)} onChange={e => setUserForm(f => ({ ...f, username: prefix + e.target.value.replace(/[^a-z0-9_]/g, '') }))} />
            </div>
          </div>
          <div className="col-span-3"><label className="label text-xs">Password</label><input className="input" type="password" placeholder="min 8" value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))} /></div>
          <div className="col-span-4">
            <label className="label text-xs">Grant on (optional)</label>
            <select className="input text-xs" value={userForm.database} onChange={e => setUserForm(f => ({ ...f, database: e.target.value }))}>
              <option value="">— no grant —</option>
              {dbs.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <button className="btn-primary col-span-2 text-xs" onClick={addUser} disabled={busy || !userForm.username || !userForm.password}><Plus size={12} /> Create</button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {users.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-slate-400 text-xs">No DB users</td></tr>}
            {users.map(u => {
              const name = u.User ?? u.user ?? '';
              const host = u.Host ?? u.host ?? '';
              return (
                <tr key={`${name}@${host}`} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="py-2 px-1 font-mono text-xs">{name}</td>
                  <td className="text-xs text-slate-500">@{host}</td>
                  <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => delUser(name)} disabled={busy}><Trash2 size={12} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
