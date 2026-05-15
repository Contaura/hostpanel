import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Package, Plus, Trash2, Edit3, Check, X, HardDrive, Wifi, Mail, Database, Globe, FolderUp, Shield } from 'lucide-react';
import { useToast } from '../components/Toast';

interface Plan {
  id: number;
  name: string;
  description: string;
  price: number;
  billing_cycle: string;
  disk_quota: number;
  bandwidth: number;
  email_accts: number;
  databases: number;
  subdomains: number;
  ftp_accts: number;
  ssl: number;
}

const EMPTY_PLAN: Omit<Plan, 'id'> = {
  name: '', description: '', price: 0, billing_cycle: 'monthly',
  disk_quota: 10240, bandwidth: 102400, email_accts: 10,
  databases: 5, subdomains: 10, ftp_accts: 5, ssl: 1,
};

function mbLabel(mb: number) {
  if (mb < 0) return 'Unlimited';
  if (mb >= 1024) return `${(mb / 1024).toFixed(0)} GB`;
  return `${mb} MB`;
}

const CYCLE_COLORS: Record<string, string> = {
  monthly: 'badge-blue', annual: 'badge-green',
};

export default function Plans() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState({ ...EMPTY_PLAN });
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function load() {
    try { const { data } = await axios.get<Plan[]>('/api/billing/plans'); setPlans(data); }
    catch { toast.error('Failed to load plans'); }
  }
  useEffect(() => { load(); }, []);

  function startEdit(plan: Plan) {
    setEditing(plan);
    setForm({ name: plan.name, description: plan.description, price: plan.price, billing_cycle: plan.billing_cycle,
      disk_quota: plan.disk_quota, bandwidth: plan.bandwidth, email_accts: plan.email_accts,
      databases: plan.databases, subdomains: plan.subdomains, ftp_accts: plan.ftp_accts, ssl: plan.ssl });
    setShowForm(true);
  }

  function cancelForm() { setShowForm(false); setEditing(null); setForm({ ...EMPTY_PLAN }); }

  async function save(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      if (editing) {
        await axios.put(`/api/billing/plans/${editing.id}`, form);
        toast.success('Plan updated');
      } else {
        await axios.post('/api/billing/plans', form);
        toast.success('Plan created');
      }
      cancelForm(); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function deletePlan(id: number) {
    if (!confirm('Delete this plan? Existing accounts using it will be unaffected.')) return;
    setDeleting(id);
    try { await axios.delete(`/api/billing/plans/${id}`); toast.success('Plan deleted'); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setDeleting(null); }
  }

  const field = (key: keyof typeof form, label: string, type: string = 'text', placeholder = '') => (
    <div>
      <label className="label">{label}</label>
      <input type={type} className={`input ${type === 'number' ? 'font-mono' : ''}`} placeholder={placeholder}
        value={form[key] as string | number}
        onChange={e => setForm({ ...form, [key]: type === 'number' ? +e.target.value : e.target.value })} />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Hosting Plans</h1>
          <p className="page-subtitle">Define plans with resource limits and pricing</p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <Plus size={14} /> New Plan
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={save} className="card p-6 max-w-2xl space-y-5">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {editing ? `Edit plan: ${editing.name}` : 'Create New Plan'}
          </h2>

          <div className="grid grid-cols-2 gap-4">
            {field('name', 'Plan Name', 'text', 'e.g. Business')}
            <div>
              <label className="label">Billing Cycle</label>
              <select className="input" value={form.billing_cycle} onChange={e => setForm({ ...form, billing_cycle: e.target.value })}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
                <option value="one-time">One-time</option>
              </select>
            </div>
          </div>

          <div className="col-span-2">
            <label className="label">Description</label>
            <input className="input" placeholder="Short description shown to clients"
              value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>

          <div>
            <label className="label">Price (USD)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
              <input type="number" step="0.01" min="0" className="input pl-7 font-mono"
                value={form.price} onChange={e => setForm({ ...form, price: +e.target.value })} />
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Resource Limits (-1 = Unlimited)</p>
            <div className="grid grid-cols-3 gap-3">
              {field('disk_quota', 'Disk (MB)', 'number')}
              {field('bandwidth', 'Bandwidth (MB)', 'number')}
              {field('email_accts', 'Email Accounts', 'number')}
              {field('databases', 'Databases', 'number')}
              {field('subdomains', 'Subdomains', 'number')}
              {field('ftp_accts', 'FTP Accounts', 'number')}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input type="checkbox" id="ssl-check" className="rounded"
                checked={form.ssl === 1} onChange={e => setForm({ ...form, ssl: e.target.checked ? 1 : 0 })} />
              <label htmlFor="ssl-check" className="text-sm text-slate-700 dark:text-slate-300">Include free SSL certificate</label>
            </div>
          </div>

          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Saving…' : (editing ? 'Save changes' : 'Create plan')}
            </button>
            <button type="button" onClick={cancelForm} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {plans.map(plan => (
          <div key={plan.id} className="card p-6 space-y-4 relative group">
            {/* Actions */}
            <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(plan)}
                className="btn-icon hover:!text-indigo-600 dark:hover:!text-indigo-400 hover:!bg-indigo-50 dark:hover:!bg-indigo-900/30">
                <Edit3 size={13} />
              </button>
              <button onClick={() => deletePlan(plan.id)} disabled={deleting === plan.id}
                className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                <Trash2 size={13} />
              </button>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">{plan.name}</h3>
                <span className={CYCLE_COLORS[plan.billing_cycle] || 'badge-gray'}>{plan.billing_cycle}</span>
              </div>
              {plan.description && <p className="text-sm text-slate-500 dark:text-slate-400">{plan.description}</p>}
              <div className="mt-2 text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                ${plan.price.toFixed(2)}
                <span className="text-base font-normal text-slate-400 dark:text-slate-500 ml-1">/ {plan.billing_cycle}</span>
              </div>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-700 pt-3 space-y-2">
              {[
                { icon: HardDrive, label: mbLabel(plan.disk_quota),   text: 'Disk space' },
                { icon: Wifi,      label: mbLabel(plan.bandwidth),    text: 'Bandwidth' },
                { icon: Mail,      label: plan.email_accts < 0 ? 'Unlimited' : String(plan.email_accts), text: 'Email accounts' },
                { icon: Database,  label: plan.databases  < 0 ? 'Unlimited' : String(plan.databases),   text: 'Databases' },
                { icon: Globe,     label: plan.subdomains < 0 ? 'Unlimited' : String(plan.subdomains),  text: 'Subdomains' },
                { icon: FolderUp,  label: plan.ftp_accts  < 0 ? 'Unlimited' : String(plan.ftp_accts),  text: 'FTP accounts' },
              ].map(({ icon: Icon, label, text }) => (
                <div key={text} className="flex items-center gap-2 text-sm">
                  <Icon size={13} className="text-slate-400 dark:text-slate-500 flex-shrink-0" />
                  <span className="text-slate-900 dark:text-slate-100 font-medium w-20">{label}</span>
                  <span className="text-slate-400 dark:text-slate-500">{text}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-sm">
                {plan.ssl ? <Check size={13} className="text-emerald-500 flex-shrink-0" /> : <X size={13} className="text-slate-400 flex-shrink-0" />}
                <span className={plan.ssl ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-400'}>Free SSL</span>
              </div>
            </div>
          </div>
        ))}

        {plans.length === 0 && !showForm && (
          <div className="col-span-full card p-16 text-center">
            <Package className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
            <p className="text-slate-400 text-sm">No plans yet. Create one to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
