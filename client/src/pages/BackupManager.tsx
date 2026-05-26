import { useEffect, useState } from 'react';
import axios from 'axios';
import { Archive, Plus, Trash2, Download, Database, FolderOpen, RefreshCw, RotateCcw, Clock, Upload, Cloud, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';
import { openAuthenticatedDownload } from '../lib/api';

interface Backup {
  name: string;
  size: number;
  created: string;
}

interface RestorePlan {
  type: 'files' | 'database';
  name: string;
  database?: string;
  entries?: string[];
  count?: number;
  selectable: boolean;
}

interface JobStatus {
  id: number;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  result?: Backup;
  error?: string;
  logs?: { at: string; message: string }[];
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
  const confirm = useConfirm();
  const [tab, setTab] = useState<'backups' | 'schedules' | 'remote'>('backups');
  const [backups, setBackups] = useState<Backup[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'files', target: '' });
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [domains, setDomains] = useState<string[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [scheduleForm, setScheduleForm] = useState({ type: 'files', target: '', schedule: '0 2 * * *' });
  const [remoteConfig, setRemoteConfig] = useState<Record<string, string>>({});
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [pushingRemote, setPushingRemote] = useState<string | null>(null);
  const [backupSearch, setBackupSearch] = useState('');
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [deletingBackup, setDeletingBackup] = useState<string | null>(null);
  const [restoringBackup, setRestoringBackup] = useState<string | null>(null);
  const [restorePlan, setRestorePlan] = useState<RestorePlan | null>(null);
  const [restoreEntries, setRestoreEntries] = useState<string[]>([]);
  const [restoreTarget, setRestoreTarget] = useState('');
  const [restoreDryRun, setRestoreDryRun] = useState<any | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [deletingSchedule, setDeletingSchedule] = useState<number | null>(null);
  const [activeJob, setActiveJob] = useState<JobStatus | null>(null);

  async function load() {
    try {
      const [bRes, dRes, dbRes] = await Promise.all([
        axios.get<Backup[]>('/api/backup/list'),
        axios.get<string[]>('/api/domains/domains').catch(() => ({ data: [] })),
        axios.get<{ name: string }[]>('/api/databases/databases').catch(() => ({ data: [] })),
      ]);
      setBackups(bRes.data);
      setDomains(dRes.data);
      setDatabases(dbRes.data.map((d: any) => d.name));
    } catch { setBackups([]); } finally { setPageLoading(false); }
  }

  async function loadSchedules() {
    try {
      const { data } = await axios.get('/api/backup/schedules');
      setSchedules(Array.isArray(data) ? data : []);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load schedules'); }
  }

  async function createSchedule() {
    try {
      await axios.post('/api/backup/schedules', scheduleForm);
      toast.success('Schedule created');
      loadSchedules();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  async function deleteSchedule(id: number) {
    setDeletingSchedule(id);
    try {
      await axios.delete(`/api/backup/schedules/${id}`);
      toast.success('Schedule removed'); loadSchedules();
    } finally { setDeletingSchedule(null); }
  }

  async function loadRemoteConfig() {
    if (remoteLoaded) return;
    try {
      const { data } = await axios.get('/api/backup/remote-config');
      setRemoteConfig(data || {});
      setRemoteLoaded(true);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load remote backup config'); }
  }

  async function saveRemoteConfig() {
    try {
      await axios.put('/api/backup/remote-config', remoteConfig);
      toast.success('Remote backup config saved');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  useEffect(() => {
    document.title = 'Backups — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => { load(); }, []);

  async function waitForJob(jobId: number) {
    for (;;) {
      const { data } = await axios.get<JobStatus>(`/api/jobs/${jobId}`);
      setActiveJob(data);
      if (data.status === 'completed') return data;
      if (data.status === 'failed') throw new Error(data.error || 'Background job failed');
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  async function createBackup() {
    setLoading(true);
    try {
      const { data } = await axios.post<{ jobId: number; statusUrl: string }>('/api/backup/create', { ...form, async: true });
      toast.success(`Backup job #${data.jobId} started`);
      const job = await waitForJob(data.jobId);
      toast.success(`Backup created: ${job.result?.name || 'completed'}`);
      setShowForm(false);
      setForm({ type: 'files', target: '' });
      setActiveJob(null);
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || err.message || 'Backup failed'); }
    finally { setLoading(false); }
  }

  async function deleteBackup(name: string) {
    if (!await confirm(`Delete backup "${name}"?`)) return;
    setDeletingBackup(name);
    try {
      await axios.delete(`/api/backup/${encodeURIComponent(name)}`);
      toast.success('Backup deleted');
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setDeletingBackup(null); }
  }

  async function pushToRemote(name: string) {
    setPushingRemote(name);
    try {
      await axios.post(`/api/backup/push-remote/${encodeURIComponent(name)}`);
      toast.success(`"${name}" pushed to remote storage`);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Push failed — check remote config'); }
    setPushingRemote(null);
  }

  async function restoreBackup(name: string) {
    setRestoreLoading(true);
    setRestoringBackup(name);
    setRestoreDryRun(null);
    try {
      const { data } = await axios.get<RestorePlan>(`/api/backup/restore/${encodeURIComponent(name)}/plan`);
      setRestorePlan(data);
      setRestoreEntries([]);
      setRestoreTarget('');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to load restore plan'); }
    finally { setRestoreLoading(false); setRestoringBackup(null); }
  }

  async function runRestore(dryRun: boolean) {
    if (!restorePlan) return;
    const body = restorePlan.type === 'files'
      ? { dryRun, entries: restoreEntries.length ? restoreEntries : undefined, target: restoreTarget || undefined }
      : { dryRun };
    if (!dryRun && !await confirm(`Restore "${restorePlan.name}" now?\n\nThis can overwrite existing ${restorePlan.type === 'database' ? 'database contents' : 'files'}. Run a dry-run first if you have not already reviewed the plan.`)) return;
    setRestoreLoading(true);
    setRestoringBackup(restorePlan.name);
    try {
      const { data } = await axios.post(`/api/backup/restore/${encodeURIComponent(restorePlan.name)}`, body);
      if (dryRun) {
        setRestoreDryRun(data);
        toast.success('Restore dry-run completed');
      } else {
        toast.success(data.message || `"${restorePlan.name}" restored successfully`);
        setRestorePlan(null);
        setRestoreDryRun(null);
      }
    } catch (err: any) { toast.error(err.response?.data?.error || 'Restore failed'); }
    finally { setRestoreLoading(false); setRestoringBackup(null); }
  }

  function toggleRestoreEntry(entry: string) {
    setRestoreEntries(prev => prev.includes(entry) ? prev.filter(e => e !== entry) : [...prev, entry]);
  }

  const isDB = form.type === 'database';
  const targets = isDB ? databases : domains;

  if (pageLoading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
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
          <button onClick={() => { setTab('backups'); setShowForm(v => !v); }} className="btn-primary">
            <Plus size={14} /> New Backup
          </button>
        </div>
      </div>

      <div className="tab-bar">
        <button className={tab === 'backups' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('backups')}>
          <Archive size={13} /> Backups
        </button>
        <button className={tab === 'schedules' ? 'tab-item-active' : 'tab-item'} onClick={() => { setTab('schedules'); loadSchedules(); }}>
          <Clock size={13} /> Schedules
        </button>
        <button className={tab === 'remote' ? 'tab-item-active' : 'tab-item'} onClick={() => { setTab('remote'); loadRemoteConfig(); }}>
          <Upload size={13} /> Remote Storage
        </button>
      </div>

      {tab === 'backups' && showForm && (
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
          {activeJob && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm dark:border-indigo-800 dark:bg-indigo-950/30">
              <div className="flex items-center justify-between text-indigo-900 dark:text-indigo-100">
                <span className="font-semibold">Background job #{activeJob.id}: {activeJob.status}</span>
                <span>{activeJob.progress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded bg-indigo-100 dark:bg-indigo-900">
                <div className="h-full bg-indigo-600 transition-all" style={{ width: `${activeJob.progress}%` }} />
              </div>
              {activeJob.logs?.length ? <p className="mt-2 text-xs text-indigo-700 dark:text-indigo-300">{activeJob.logs[activeJob.logs.length - 1].message}</p> : null}
            </div>
          )}
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

      {tab === 'schedules' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4 max-w-xl">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add Backup Schedule</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Type</label>
                <select className="input" value={scheduleForm.type} onChange={e => setScheduleForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="files">Files</option>
                  <option value="database">Database</option>
                </select>
              </div>
              <div>
                <label className="label">Target (optional)</label>
                <input className="input" placeholder="domain or db name" value={scheduleForm.target} onChange={e => setScheduleForm(f => ({ ...f, target: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="label">Cron Schedule</label>
                <input className="input font-mono" placeholder="0 2 * * *" value={scheduleForm.schedule} onChange={e => setScheduleForm(f => ({ ...f, schedule: e.target.value }))} />
                <p className="text-xs text-slate-400 mt-1">e.g. <code>0 2 * * *</code> = daily at 2 AM</p>
              </div>
            </div>
            <button className="btn-primary" onClick={createSchedule}>
              <Plus size={14} /> Add Schedule
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search schedules…" value={scheduleSearch} onChange={e => setScheduleSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className={theadCls}><tr>
                  {['Type', 'Target', 'Schedule', 'Last Run', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}
                </tr></thead>
                <tbody>
                  {(() => {
                    const q = scheduleSearch.trim().toLowerCase();
                    const visible = q ? schedules.filter((s: any) => [s.type, s.target, s.schedule].some((v: any) => String(v ?? '').toLowerCase().includes(q))) : schedules;
                    if (schedules.length === 0) return (
                      <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">No schedules configured</td></tr>
                    );
                    if (visible.length === 0) return (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No schedules match "{scheduleSearch}"</td></tr>
                    );
                    return visible.map((s: any) => (
                      <tr key={s.id} className={rowCls}>
                        <td className="table-cell">
                          <span className={`badge-${s.type === 'database' ? 'purple' : 'blue'} text-xs`}>{s.type}</span>
                        </td>
                        <td className="table-cell font-mono text-xs">{s.target || 'All'}</td>
                        <td className="table-cell font-mono text-xs">{s.schedule}</td>
                        <td className="table-cell text-xs text-slate-400">{s.last_run ? new Date(s.last_run).toLocaleString() : 'Never'}</td>
                        <td className="px-3 py-3">
                          <button onClick={() => deleteSchedule(s.id)} disabled={deletingSchedule === s.id} className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'remote' && (
        <div className="card p-5 space-y-4 max-w-xl">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Remote Storage Configuration</h2>
          <p className="text-xs text-slate-500">Store backups in S3, Backblaze B2, or any rclone-compatible provider.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Provider</label>
              <select className="input" value={remoteConfig.provider || 's3'} onChange={e => setRemoteConfig(c => ({ ...c, provider: e.target.value }))}>
                <option value="s3">Amazon S3</option>
                <option value="b2">Backblaze B2</option>
                <option value="rclone">rclone (custom)</option>
              </select>
            </div>
            <div>
              <label className="label">Bucket</label>
              <input className="input font-mono" placeholder="my-backups" value={remoteConfig.bucket || ''} onChange={e => setRemoteConfig(c => ({ ...c, bucket: e.target.value }))} />
            </div>
            <div>
              <label className="label">Region</label>
              <input className="input font-mono" placeholder="us-east-1" value={remoteConfig.region || ''} onChange={e => setRemoteConfig(c => ({ ...c, region: e.target.value }))} />
            </div>
            <div>
              <label className="label">Path Prefix</label>
              <input className="input font-mono" placeholder="hostpanel-backups" value={remoteConfig.path_prefix || ''} onChange={e => setRemoteConfig(c => ({ ...c, path_prefix: e.target.value }))} />
            </div>
            <div>
              <label className="label">Access Key</label>
              <input className="input font-mono" placeholder="AKIA…" value={remoteConfig.access_key || ''} onChange={e => setRemoteConfig(c => ({ ...c, access_key: e.target.value }))} />
            </div>
            <div>
              <label className="label">Secret Key</label>
              <input type="password" className="input" placeholder="(stored securely)" value={remoteConfig.secret_key || ''} onChange={e => setRemoteConfig(c => ({ ...c, secret_key: e.target.value }))} />
            </div>
          </div>
          <button className="btn-primary" onClick={saveRemoteConfig}>Save Remote Config</button>
        </div>
      )}

      {tab === 'backups' && restorePlan && (
        <div className="card p-5 space-y-4 border-amber-200 dark:border-amber-900/60">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Restore Wizard</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">{restorePlan.name}</p>
            </div>
            <button className="btn-secondary" onClick={() => { setRestorePlan(null); setRestoreDryRun(null); }}>Close</button>
          </div>
          {restorePlan.type === 'database' ? (
            <div className="rounded-xl bg-purple-50 dark:bg-purple-900/20 p-4 text-sm text-purple-800 dark:text-purple-200">
              Database restore target: <strong>{restorePlan.database}</strong>. Use Dry Run to verify the database inferred from the backup filename before restoring.
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="label">Restore target under webroot (optional)</label>
                <input className="input font-mono" placeholder="blank = webroot" value={restoreTarget} onChange={e => setRestoreTarget(e.target.value)} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Selective restore entries</label>
                  <div className="flex gap-2">
                    <button className="btn-secondary text-xs" onClick={() => setRestoreEntries(restorePlan.entries || [])}>Select all</button>
                    <button className="btn-secondary text-xs" onClick={() => setRestoreEntries([])}>Restore all</button>
                  </div>
                </div>
                <div className="max-h-52 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-900">
                  {(restorePlan.entries || []).slice(0, 500).map(entry => (
                    <label key={entry} className="flex items-center gap-2 px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={restoreEntries.includes(entry)} onChange={() => toggleRestoreEntry(entry)} />
                      <span className="truncate">{entry}</span>
                    </label>
                  ))}
                  {(!restorePlan.entries || restorePlan.entries.length === 0) && <div className="px-3 py-6 text-center text-xs text-slate-400">No listable entries were returned.</div>}
                </div>
                <p className="text-xs text-slate-500 mt-1">Leave every checkbox clear to restore the full backup. Select entries to perform a partial restore.</p>
              </div>
            </div>
          )}
          {restoreDryRun && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">Dry-run result ({restoreDryRun.count || restoreDryRun.actions?.length || 1} action(s))</div>
              <pre className="text-xs whitespace-pre-wrap max-h-40 overflow-auto text-slate-700 dark:text-slate-200">{(restoreDryRun.actions || []).join('\n') || JSON.stringify(restoreDryRun, null, 2)}</pre>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={restoreLoading} onClick={() => runRestore(true)}><Search size={14} /> Dry Run</button>
            <button className="btn-primary bg-amber-600 hover:bg-amber-700" disabled={restoreLoading} onClick={() => runRestore(false)}><RotateCcw size={14} /> Restore Selected</button>
          </div>
        </div>
      )}

      {tab === 'backups' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-8 w-48 text-sm" placeholder="Search backups…" value={backupSearch} onChange={e => setBackupSearch(e.target.value)} />
            </div>
          </div>
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
                {(() => {
                  const q = backupSearch.trim().toLowerCase();
                  const visible = q ? backups.filter(b => b.name.toLowerCase().includes(q)) : backups;
                  if (backups.length === 0) return (
                    <tr><td colSpan={4} className="px-4 py-16 text-center">
                      <Archive className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                      <p className="text-slate-400 text-sm">No backups yet</p>
                    </td></tr>
                  );
                  if (visible.length === 0) return (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">No backups match "{backupSearch}"</td></tr>
                  );
                  return visible.map(b => (
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
                          <button
                            onClick={() => openAuthenticatedDownload(`/api/backup/download/${encodeURIComponent(b.name)}`, { filename: b.name }).catch(e => toast.error(e.message || 'Download failed'))}
                            className="btn-icon hover:!text-indigo-600 dark:hover:!text-indigo-400 hover:!bg-indigo-50 dark:hover:!bg-indigo-900/30"
                            title="Download">
                            <Download size={13} />
                          </button>
                          <button onClick={() => pushToRemote(b.name)} disabled={pushingRemote === b.name}
                            className="btn-icon hover:!text-sky-600 dark:hover:!text-sky-400 hover:!bg-sky-50 dark:hover:!bg-sky-900/30"
                            title="Push to remote storage">
                            {pushingRemote === b.name
                              ? <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"/></svg>
                              : <Cloud size={13} />}
                          </button>
                          <button onClick={() => restoreBackup(b.name)} disabled={restoringBackup === b.name}
                            className="btn-icon hover:!text-amber-600 dark:hover:!text-amber-400 hover:!bg-amber-50 dark:hover:!bg-amber-900/30"
                            title="Restore">
                            <RotateCcw size={13} />
                          </button>
                          <button onClick={() => deleteBackup(b.name)} disabled={deletingBackup === b.name}
                            className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
