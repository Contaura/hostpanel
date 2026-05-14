import { useEffect, useState } from 'react';
import axios from 'axios';
import { Archive, Plus, Trash2, Download, Database, FolderOpen, RefreshCw } from 'lucide-react';
import { useToast } from '../components/Toast';

interface Backup {
  name: string;
  size: number;
  created: string;
}

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function BackupManager() {
  const toast = useToast();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'files', target: '' });
  const [loading, setLoading] = useState(false);
  const [domains, setDomains] = useState<string[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);

  async function load() {
    try {
      const [bRes, dRes, dbRes] = await Promise.all([
        axios.get<Backup[]>('/api/backup/list'),
        axios.get<string[]>('/api/domains/domains').catch(() => ({ data: [] })),
        axios.get<{ name: string }[]>('/api/databases/list').catch(() => ({ data: [] })),
      ]);
      setBackups(bRes.data);
      setDomains(dRes.data);
      setDatabases(dbRes.data.map((d: any) => d.name));
    } catch { setBackups([]); }
  }
  useEffect(() => { load(); }, []);

  async function createBackup() {
    setLoading(true);
    try {
      const { data } = await axios.post<Backup>('/api/backup/create', form);
      toast.success(`Backup created: ${data.name}`);
      setShowForm(false);
      setForm({ type: 'files', target: '' });
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Backup failed'); }
    finally { setLoading(false); }
  }

  async function deleteBackup(name: string) {
    if (!confirm(`Delete backup "${name}"?`)) return;
    try {
      await axios.delete(`/api/backup/${encodeURIComponent(name)}`);
      toast.success('Backup deleted');
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  const isDB = form.type === 'database';
  const targets = isDB ? databases : domains;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Backup Manager</h1>
          <p className="page-subtitle">Create and manage backups of files and databases</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus size={14} /> New Backup
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card p-5 max-w-md space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Create Backup</h2>
          <div>
            <label className="label">Backup Type</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'files', label: 'Files', icon: FolderOpen, desc: 'Web files (tar.gz)' },
                { value: 'database', label: 'Database', icon: Database, desc: 'MySQL dump (.sql.gz)' },
              ].map(({ value, label, icon: Icon, desc }) => (
                <button key={value} type="button"
                  onClick={() => setForm({ type: value, target: '' })}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                    form.type === value
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}>
                  <Icon size={18} className={form.type === value ? 'text-indigo-600 dark:text-indigo-400 mt-0.5' : 'text-slate-400 mt-0.5'} />
                  <div>
                    <div className={`text-sm font-semibold ${form.type === value ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-900 dark:text-slate-100'}`}>{label}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">{isDB ? 'Database' : 'Domain'} (optional — blank = all)</label>
            <select className="input" value={form.target} onChange={e => setForm({ ...form, target: e.target.value })}>
              <option value="">All {isDB ? 'databases' : 'domains'}</option>
              {targets.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={createBackup} disabled={loading} className="btn-primary">
              {loading ? (
                <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Creating…</>
              ) : <><Archive size={14} /> Create backup</>}
            </button>
            <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="table-header-cell">Filename</th>
              <th className="table-header-cell hidden md:table-cell">Size</th>
              <th className="table-header-cell hidden lg:table-cell">Created</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {backups.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-16 text-center">
                <Archive className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                <p className="text-slate-400 text-sm">No backups yet</p>
              </td></tr>
            ) : backups.map(b => (
              <tr key={b.name} className={rowCls}>
                <td className="table-cell">
                  <div className="flex items-center gap-2.5">
                    <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${b.name.includes('db_') ? 'bg-purple-50 dark:bg-purple-900/30' : 'bg-emerald-50 dark:bg-emerald-900/30'}`}>
                      {b.name.includes('db_')
                        ? <Database size={13} className="text-purple-600 dark:text-purple-400" />
                        : <FolderOpen size={13} className="text-emerald-600 dark:text-emerald-400" />}
                    </div>
                    <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{b.name}</span>
                  </div>
                </td>
                <td className="table-cell text-slate-500 dark:text-slate-400 hidden md:table-cell">{fmt(b.size)}</td>
                <td className="table-cell text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                  {new Date(b.created).toLocaleString()}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <a href={`/api/backup/download/${encodeURIComponent(b.name)}`}
                      className="btn-icon hover:!text-indigo-600 dark:hover:!text-indigo-400 hover:!bg-indigo-50 dark:hover:!bg-indigo-900/30"
                      title="Download">
                      <Download size={13} />
                    </a>
                    <button onClick={() => deleteBackup(b.name)}
                      className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                      <Trash2 size={13} />
                    </button>
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
