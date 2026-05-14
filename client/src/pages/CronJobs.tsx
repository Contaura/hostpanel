import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Clock, Plus, Trash2, ChevronDown, Play, FileText, RefreshCw, Bell } from 'lucide-react';
import { useToast } from '../components/Toast';

interface CronJob {
  id: number;
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
  command: string;
}

const PRESETS = [
  { label: 'Every minute',     minute: '*',  hour: '*',  day: '*', month: '*', weekday: '*' },
  { label: 'Every 5 minutes',  minute: '*/5',hour: '*',  day: '*', month: '*', weekday: '*' },
  { label: 'Every hour',       minute: '0',  hour: '*',  day: '*', month: '*', weekday: '*' },
  { label: 'Every day at midnight', minute: '0', hour: '0', day: '*', month: '*', weekday: '*' },
  { label: 'Every Sunday',     minute: '0',  hour: '0',  day: '*', month: '*', weekday: '0' },
  { label: 'Every month',      minute: '0',  hour: '0',  day: '1', month: '*', weekday: '*' },
];

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

type Tab = 'jobs' | 'logs' | 'alerts';

export default function CronJobs() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('jobs');
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ minute: '*', hour: '*', day: '*', month: '*', weekday: '*', command: '' });
  const [logs, setLogs] = useState<any[]>([]);
  const [running, setRunning] = useState<number | null>(null);
  const [runOutput, setRunOutput] = useState<{ id: number; output: string; exit_code: number } | null>(null);
  const [failureEmail, setFailureEmail] = useState('');
  const [failureEmailSaved, setFailureEmailSaved] = useState(false);

  async function load() {
    try {
      const { data } = await axios.get<CronJob[]>('/api/cron/list');
      setJobs(data);
    } catch { setJobs([]); }
  }

  async function loadLogs() {
    try { const { data } = await axios.get('/api/cron/logs'); setLogs(data); }
    catch { setLogs([]); }
  }

  async function runJob(job: CronJob) {
    setRunning(job.id);
    try {
      const { data } = await axios.post('/api/cron/run', { command: job.command });
      setRunOutput({ id: job.id, output: data.output || '(no output)', exit_code: data.exit_code });
      if (data.exit_code === 0) toast.success('Job ran successfully'); else toast.error(`Job exited with code ${data.exit_code}`);
      if (tab === 'logs') loadLogs();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Run failed'); }
    setRunning(null);
  }

  async function loadFailureEmail() {
    try { const { data } = await axios.get('/api/cron/failure-email'); setFailureEmail(data.email || ''); }
    catch {}
  }

  async function saveFailureEmail() {
    try {
      await axios.post('/api/cron/failure-email', { email: failureEmail });
      toast.success('Alert email saved'); setFailureEmailSaved(true); setTimeout(() => setFailureEmailSaved(false), 2000);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  useEffect(() => { load(); loadFailureEmail(); }, []);
  useEffect(() => { if (tab === 'logs') loadLogs(); }, [tab]);

  function applyPreset(p: typeof PRESETS[0]) {
    setForm(f => ({ ...f, minute: p.minute, hour: p.hour, day: p.day, month: p.month, weekday: p.weekday }));
  }

  async function addJob(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/cron/add', form);
      toast.success('Cron job added');
      setForm({ minute: '*', hour: '*', day: '*', month: '*', weekday: '*', command: '' });
      setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to add job'); }
    finally { setLoading(false); }
  }

  async function deleteJob(id: number) {
    if (!confirm('Remove this cron job?')) return;
    try {
      await axios.delete(`/api/cron/${id}`);
      toast.success('Cron job removed');
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  const field = (name: keyof typeof form, label: string, placeholder: string) => (
    <div>
      <label className="label">{label}</label>
      <input className="input text-center font-mono" placeholder={placeholder}
        value={form[name]} onChange={e => setForm({ ...form, [name]: e.target.value })} required />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Cron Jobs</h1>
          <p className="page-subtitle">Schedule automated tasks on your server</p>
        </div>
        {tab === 'jobs' && <button onClick={() => setShowForm(v => !v)} className="btn-primary"><Plus size={14} /> Add Cron Job</button>}
        {tab === 'logs' && <button onClick={loadLogs} className="btn-secondary"><RefreshCw size={14} /> Refresh</button>}
      </div>

      <div className="tab-bar">
        <button className={tab === 'jobs' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('jobs')}><Clock size={14} /> Scheduled Jobs</button>
        <button className={tab === 'logs' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('logs')}><FileText size={14} /> Run Log</button>
        <button className={tab === 'alerts' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('alerts')}><Bell size={14} /> Failure Alerts</button>
      </div>

      {showForm && (
        <div className="card p-5 max-w-2xl space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">New Cron Job</h2>

          {/* Presets */}
          <div>
            <label className="label">Quick presets</label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <button key={p.label} type="button" onClick={() => applyPreset(p)}
                  className="btn-secondary text-xs py-1 px-2.5">
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={addJob} className="space-y-4">
            <div className="grid grid-cols-5 gap-3">
              {field('minute',  'Minute',  '*')}
              {field('hour',    'Hour',    '*')}
              {field('day',     'Day',     '*')}
              {field('month',   'Month',   '*')}
              {field('weekday', 'Weekday', '*')}
            </div>
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
              {form.minute} {form.hour} {form.day} {form.month} {form.weekday} {form.command || '<command>'}
            </div>
            <div>
              <label className="label">Command</label>
              <input className="input font-mono" placeholder="/usr/bin/php /var/www/site/cron.php"
                value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} required />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Adding…' : 'Add job'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {tab === 'jobs' && (
        <>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className={theadCls}>
                <tr>
                  <th className="table-header-cell w-48">Schedule</th>
                  <th className="table-header-cell">Command</th>
                  <th className="px-4 py-3 w-20" />
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-16 text-center">
                    <Clock className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    <p className="text-slate-400 text-sm">No cron jobs scheduled</p>
                  </td></tr>
                ) : jobs.map(job => (
                  <tr key={job.id} className={rowCls}>
                    <td className="table-cell">
                      <span className="font-mono text-xs bg-slate-100 dark:bg-slate-700 rounded px-2 py-1 text-slate-700 dark:text-slate-300">
                        {job.minute} {job.hour} {job.day} {job.month} {job.weekday}
                      </span>
                    </td>
                    <td className="table-cell font-mono text-xs text-slate-600 dark:text-slate-400 max-w-xs truncate">
                      {job.command}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        <button onClick={() => runJob(job)} disabled={running === job.id}
                          className="btn-icon text-emerald-500" title="Run now">
                          {running === job.id ? <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75"/></svg> : <Play size={13} />}
                        </button>
                        <button onClick={() => deleteJob(job.id)}
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

          {runOutput && (
            <div className={`card p-4 border ${runOutput.exit_code === 0 ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium">Run output (exit {runOutput.exit_code})</p>
                <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => setRunOutput(null)}>✕</button>
              </div>
              <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto">{runOutput.output}</pre>
            </div>
          )}
        </>
      )}

      {tab === 'alerts' && (
        <div className="card p-5 max-w-md space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><Bell size={14} /> Cron Failure Alerts</h2>
          <p className="text-sm text-slate-500">When a cron job exits with a non-zero code, an email is sent to this address. Requires SMTP to be configured in Settings.</p>
          <div>
            <label className="label">Alert Email</label>
            <input className="input" type="email" placeholder="admin@example.com" value={failureEmail} onChange={e => setFailureEmail(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={saveFailureEmail}>
            {failureEmailSaved ? '✓ Saved' : 'Save Alert Email'}
          </button>
          {failureEmail && <p className="text-xs text-slate-400">Alerts will be sent to <code className="font-mono">{failureEmail}</code> on job failure.</p>}
          {!failureEmail && <p className="text-xs text-slate-400">Leave blank to disable failure alerts.</p>}
        </div>
      )}

      {tab === 'logs' && (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="table-header-cell w-36">Ran At</th>
                <th className="table-header-cell">Command</th>
                <th className="table-header-cell w-20">Exit</th>
                <th className="table-header-cell">Output</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={4} className="table-cell text-center py-8 text-slate-400">No logs yet — run a job manually or wait for scheduled runs.</td></tr>}
              {logs.map((l: any) => (
                <tr key={l.id} className={rowCls}>
                  <td className="table-cell text-xs text-slate-500">{new Date(l.ran_at).toLocaleString()}</td>
                  <td className="table-cell font-mono text-xs truncate max-w-[200px]">{l.command}</td>
                  <td className="table-cell"><span className={`badge text-xs ${l.exit_code === 0 ? 'badge-success' : 'badge-error'}`}>{l.exit_code}</span></td>
                  <td className="table-cell text-xs text-slate-500 truncate max-w-[240px] font-mono">{l.output || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
