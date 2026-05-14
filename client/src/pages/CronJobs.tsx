import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Clock, Plus, Trash2, ChevronDown } from 'lucide-react';
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

export default function CronJobs() {
  const toast = useToast();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ minute: '*', hour: '*', day: '*', month: '*', weekday: '*', command: '' });

  async function load() {
    try {
      const { data } = await axios.get<CronJob[]>('/api/cron/list');
      setJobs(data);
    } catch { setJobs([]); }
  }
  useEffect(() => { load(); }, []);

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
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <Plus size={14} /> Add Cron Job
        </button>
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

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className={theadCls}>
            <tr>
              <th className="table-header-cell w-48">Schedule</th>
              <th className="table-header-cell">Command</th>
              <th className="px-4 py-3 w-12" />
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
                  <button onClick={() => deleteJob(job.id)}
                    className="btn-icon opacity-0 group-hover:opacity-100 hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
