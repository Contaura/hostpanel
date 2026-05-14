import { useState, useEffect } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { Bell, Package, AlertTriangle, CheckCircle, Plus, Trash2, RefreshCw, Download } from 'lucide-react';

type Tab = 'alerts' | 'packages';

interface AlertRule { id: number; metric: string; threshold: number; notify_email: string; enabled: number }
interface Alert { id: number; severity: string; metric: string; value: number; threshold: number; message: string }
interface PkgUpdate { package: string; version: string; repo: string }

function token() { return localStorage.getItem('hp_token') || ''; }
const auth = () => ({ Authorization: 'Bearer ' + token() });
const api   = (p: string) => axios.get(p, { headers: auth() });
const apost = (p: string, d?: any) => axios.post(p, d || {}, { headers: auth() });
const aput  = (p: string, d: any) => axios.put(p, d, { headers: auth() });
const adel  = (p: string) => axios.delete(p, { headers: auth() });

export default function SystemMonitor() {
  const { success, error } = useToast();
  const [tab, setTab] = useState<Tab>('alerts');

  // Alerts
  const [rules, setRules]       = useState<AlertRule[]>([]);
  const [liveAlerts, setLiveAlerts] = useState<Alert[]>([]);
  const [stats, setStats]       = useState<any>(null);
  const [newRule, setNewRule]   = useState({ metric: 'cpu', threshold: 80, notify_email: '' });

  // Packages
  const [updates, setUpdates]   = useState<PkgUpdate[]>([]);
  const [pkgLoading, setPkgLoading] = useState(false);
  const [updateLog, setUpdateLog]   = useState('');
  const [updating, setUpdating]     = useState(false);
  const [selected, setSelected]     = useState<Set<string>>(new Set());

  useEffect(() => { loadTab(tab); }, [tab]);

  function loadTab(t: Tab) {
    if (t === 'alerts') { loadRules(); loadLive(); }
    if (t === 'packages') loadPackages();
  }

  async function loadRules() { try { const r = await api('/api/alerts/rules'); setRules(r.data); } catch {} }
  async function loadLive() {
    try { const r = await api('/api/alerts/current'); setLiveAlerts(r.data.alerts || []); setStats(r.data.stats); }
    catch {}
  }

  async function loadPackages() {
    setPkgLoading(true);
    try { const r = await api('/api/alerts/packages'); setUpdates(r.data.updates || []); }
    catch {}
    setPkgLoading(false);
  }

  async function addRule() {
    try { await apost('/api/alerts/rules', newRule); success('Alert rule added'); setNewRule({ metric: 'cpu', threshold: 80, notify_email: '' }); loadRules(); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function toggleRule(rule: AlertRule) {
    try { await aput(`/api/alerts/rules/${rule.id}`, { ...rule, enabled: rule.enabled ? 0 : 1 }); loadRules(); }
    catch {}
  }

  async function deleteRule(id: number) {
    try { await adel(`/api/alerts/rules/${id}`); success('Deleted'); loadRules(); }
    catch {}
  }

  async function runUpdate() {
    const pkgs = selected.size > 0 ? Array.from(selected) : [];
    setUpdating(true); setUpdateLog('');
    try {
      const r = await apost('/api/alerts/packages/update', { packages: pkgs });
      setUpdateLog(r.data.output || 'Done');
      success('Update complete');
      loadPackages();
    } catch (e: any) { setUpdateLog(e.response?.data?.error || 'Update failed'); error('Update failed'); }
    setUpdating(false);
  }

  const METRIC_LABELS: Record<string, string> = { cpu: 'CPU', memory: 'Memory', disk: 'Disk', load: 'Load' };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="page-title">System Monitor</h1>
        <p className="page-subtitle">Alert rules for resource thresholds and system package updates</p>
      </div>

      <div className="tab-bar">
        <button onClick={() => setTab('alerts')}   className={tab === 'alerts'   ? 'tab-item-active' : 'tab-item'}><Bell size={14} /> Alerts & Thresholds</button>
        <button onClick={() => setTab('packages')} className={tab === 'packages' ? 'tab-item-active' : 'tab-item'}><Package size={14} /> Package Updates</button>
      </div>

      {/* Alerts */}
      {tab === 'alerts' && (
        <div className="space-y-4">
          {/* Live status */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'CPU', value: `${stats.cpu}%`, warn: stats.cpu > 80 },
                { label: 'Memory', value: `${stats.memory}%`, warn: stats.memory > 80 },
              ].map(s => (
                <div key={s.label} className="card p-4 text-center">
                  <div className={`text-2xl font-bold ${s.warn ? 'text-red-500' : 'text-emerald-500'}`}>{s.value}</div>
                  <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                </div>
              ))}
              {(stats.disks || []).slice(0, 2).map((d: any) => (
                <div key={d.mount} className="card p-4 text-center">
                  <div className={`text-2xl font-bold ${d.use > 80 ? 'text-red-500' : 'text-emerald-500'}`}>{d.use}%</div>
                  <div className="text-xs text-slate-500 mt-1">Disk {d.mount}</div>
                </div>
              ))}
            </div>
          )}

          {/* Live alerts */}
          {liveAlerts.length > 0 && (
            <div className="space-y-2">
              {liveAlerts.map((a, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${a.severity === 'critical' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'}`}>
                  <AlertTriangle size={16} className={a.severity === 'critical' ? 'text-red-500 mt-0.5' : 'text-orange-500 mt-0.5'} />
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{a.message}</p>
                    <p className="text-xs text-slate-500">Threshold: {a.threshold}% · Current: {a.value}%</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {liveAlerts.length === 0 && stats && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-emerald-700 dark:text-emerald-400 text-sm">
              <CheckCircle size={16} /> All systems within normal thresholds
            </div>
          )}

          {/* Rules */}
          <div className="card p-4 space-y-3">
            <h3 className="font-semibold text-sm">Alert Rules</h3>
            <div className="flex gap-3">
              <select className="input w-32" value={newRule.metric} onChange={e => setNewRule(p => ({ ...p, metric: e.target.value }))}>
                {Object.entries(METRIC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input type="number" min={1} max={100} className="input w-24" placeholder="Threshold %" value={newRule.threshold} onChange={e => setNewRule(p => ({ ...p, threshold: Number(e.target.value) }))} />
              <input className="input flex-1" placeholder="Alert email (optional)" value={newRule.notify_email} onChange={e => setNewRule(p => ({ ...p, notify_email: e.target.value }))} />
              <button className="btn-primary" onClick={addRule}><Plus size={14} /> Add</button>
            </div>

            {rules.map(rule => (
              <div key={rule.id} className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                <span className="badge-info w-20 text-center">{METRIC_LABELS[rule.metric]}</span>
                <span className="text-sm">≥ {rule.threshold}%</span>
                {rule.notify_email && <span className="text-xs text-slate-500">{rule.notify_email}</span>}
                <div className="ml-auto flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input type="checkbox" checked={!!rule.enabled} onChange={() => toggleRule(rule)} />
                    <span>{rule.enabled ? 'On' : 'Off'}</span>
                  </label>
                  <button className="btn-icon text-red-500" onClick={() => deleteRule(rule.id)}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
            {rules.length === 0 && <p className="text-sm text-slate-400">No alert rules configured</p>}
          </div>
        </div>
      )}

      {/* Packages */}
      {tab === 'packages' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">{updates.length} package{updates.length !== 1 ? 's' : ''} available</p>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={loadPackages} disabled={pkgLoading}><RefreshCw size={14} className={pkgLoading ? 'animate-spin' : ''} /> Check</button>
              {updates.length > 0 && (
                <button className="btn-primary" onClick={runUpdate} disabled={updating}>
                  <Download size={14} /> {updating ? 'Updating…' : selected.size > 0 ? `Update ${selected.size} selected` : 'Update All'}
                </button>
              )}
            </div>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell w-8"><input type="checkbox" onChange={e => setSelected(e.target.checked ? new Set(updates.map(u => u.package)) : new Set())} /></th><th className="table-header-cell">Package</th><th className="table-header-cell">Version</th><th className="table-header-cell">Repository</th></tr></thead>
              <tbody>
                {pkgLoading && <tr><td colSpan={4} className="table-cell text-center py-8 text-slate-400">Checking for updates…</td></tr>}
                {!pkgLoading && updates.length === 0 && <tr><td colSpan={4} className="table-cell text-slate-400 text-center py-8">System is up to date</td></tr>}
                {updates.map(u => (
                  <tr key={u.package} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="table-cell"><input type="checkbox" checked={selected.has(u.package)} onChange={e => setSelected(s => { const n = new Set(s); e.target.checked ? n.add(u.package) : n.delete(u.package); return n; })} /></td>
                    <td className="table-cell font-mono text-xs">{u.package}</td>
                    <td className="table-cell text-slate-600 dark:text-slate-400">{u.version}</td>
                    <td className="table-cell text-slate-500">{u.repo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {updateLog && (
            <div className="card bg-slate-950 p-4">
              <pre className="text-xs text-green-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">{updateLog}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
