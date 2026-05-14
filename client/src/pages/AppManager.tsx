import { useState, useEffect } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { Plus, Play, Square, RotateCcw, Trash2, ChevronDown, ChevronUp, Terminal, Cpu, MemoryStick, GitBranch, ArrowUpCircle } from 'lucide-react';

interface App { name: string; type: string; domain: string; port: number; start_script: string; working_dir: string; status: string; cpu?: number; memory?: number; uptime?: number; restarts?: number }

function token() { return localStorage.getItem('hp_token') || ''; }
const auth = () => ({ Authorization: 'Bearer ' + token() });
const api   = (p: string) => axios.get(p, { headers: auth() });
const apost = (p: string, d?: any) => axios.post(p, d || {}, { headers: auth() });
const adel  = (p: string) => axios.delete(p, { headers: auth() });

const STATUS_COLOR: Record<string, string> = {
  running: 'badge-success',
  stopped: 'badge-warning',
  errored: 'badge-danger',
  launching: 'badge-info',
};

export default function AppManager() {
  const { success, error } = useToast();
  const [apps, setApps] = useState<App[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: '', type: 'nodejs', domain: '', port: '3000', start_script: 'server.js', working_dir: '/var/www' });
  const [stagings, setStagings] = useState<Record<string, any>>({});
  const [stageForm, setStageForm] = useState<Record<string, { port: string; branch: string }>>({});
  const [showStageForm, setShowStageForm] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try { const r = await api('/api/apps/'); setApps(r.data); }
    catch (e: any) { error(e.response?.data?.error || 'Failed to load apps'); }
  }

  async function createApp() {
    if (!form.name || !form.domain || !form.port || !form.start_script || !form.working_dir) { error('All fields required'); return; }
    try {
      await apost('/api/apps/', { ...form, port: Number(form.port) });
      success('App created');
      setShowForm(false);
      setForm({ name: '', type: 'nodejs', domain: '', port: '3000', start_script: 'server.js', working_dir: '/var/www' });
      load();
    } catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function control(name: string, action: 'start' | 'stop' | 'restart') {
    try { await apost(`/api/apps/${name}/${action}`); success(`App ${action}ed`); load(); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function remove(name: string) {
    if (!confirm(`Delete app "${name}"?`)) return;
    try { await adel(`/api/apps/${name}`); success('App deleted'); load(); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function fetchLogs(name: string) {
    try { const r = await apost(`/api/apps/${name}/logs`); setLogs(p => ({ ...p, [name]: r.data.logs })); }
    catch (e: any) { setLogs(p => ({ ...p, [name]: 'Failed to fetch logs' })); }
  }

  async function loadStaging(name: string) {
    try { const r = await api(`/api/apps/${name}/staging`); setStagings(p => ({ ...p, [name]: Array.isArray(r.data) ? r.data[0] || null : null })); }
    catch {}
  }

  async function createStaging(name: string) {
    const sf = stageForm[name] || { port: '3001', branch: 'staging' };
    if (!sf.port) { error('Port required'); return; }
    try {
      await apost(`/api/apps/${name}/stage`, { port: Number(sf.port), branch: sf.branch || 'staging' });
      success('Staging environment created'); setShowStageForm(null); loadStaging(name);
    } catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function promoteStaging(name: string) {
    if (!confirm(`Promote staging to production for "${name}"? Production will be restarted.`)) return;
    try { await apost(`/api/apps/${name}/promote`); success('Staging promoted to production'); load(); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function deleteStaging(name: string) {
    if (!confirm(`Delete staging environment for "${name}"?`)) return;
    try { await adel(`/api/apps/${name}/staging`); success('Staging deleted'); setStagings(p => ({ ...p, [name]: null })); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">App Manager</h1>
          <p className="page-subtitle">Deploy and manage Node.js and Python applications via PM2</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Deploy App</button>
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-sm">New Application</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">App Name</label><input className="input" placeholder="my-app" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div>
              <label className="label">Runtime</label>
              <select className="input" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                <option value="nodejs">Node.js</option>
                <option value="python">Python</option>
              </select>
            </div>
            <div><label className="label">Domain</label><input className="input" placeholder="app.example.com" value={form.domain} onChange={e => setForm(p => ({ ...p, domain: e.target.value }))} /></div>
            <div><label className="label">Port</label><input type="number" className="input" value={form.port} onChange={e => setForm(p => ({ ...p, port: e.target.value }))} /></div>
            <div><label className="label">Start Script</label><input className="input" placeholder={form.type === 'python' ? 'app.py' : 'server.js'} value={form.start_script} onChange={e => setForm(p => ({ ...p, start_script: e.target.value }))} /></div>
            <div><label className="label">Working Directory</label><input className="input" placeholder="/var/www/my-app" value={form.working_dir} onChange={e => setForm(p => ({ ...p, working_dir: e.target.value }))} /></div>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={createApp}>Deploy</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {apps.length === 0 && (
          <div className="card p-12 text-center text-slate-400">
            <Cpu size={32} className="mx-auto mb-2 opacity-40" />
            <p>No applications deployed yet</p>
            <p className="text-xs mt-1">Requires PM2 to be installed on the server</p>
          </div>
        )}

        {apps.map(app => (
          <div key={app.name} className="card overflow-hidden">
            <div className="flex items-center gap-4 p-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{app.name}</span>
                  <span className={`badge-info`}>{app.type}</span>
                  <span className={STATUS_COLOR[app.status] || 'badge-warning'}>{app.status}</span>
                </div>
                <div className="flex gap-4 text-xs text-slate-500">
                  <span>{app.domain}</span>
                  <span>:{app.port}</span>
                  {app.cpu !== undefined && <span className="flex items-center gap-0.5"><Cpu size={10} /> {app.cpu}%</span>}
                  {app.memory !== undefined && <span className="flex items-center gap-0.5"><MemoryStick size={10} /> {(app.memory / 1024 / 1024).toFixed(0)} MB</span>}
                  {app.restarts !== undefined && <span>Restarts: {app.restarts}</span>}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {app.status !== 'running' && <button className="btn-ghost text-emerald-600" title="Start" onClick={() => control(app.name, 'start')}><Play size={14} /></button>}
                {app.status === 'running'  && <button className="btn-ghost text-orange-500" title="Stop"  onClick={() => control(app.name, 'stop')}><Square size={14} /></button>}
                <button className="btn-ghost text-blue-500" title="Restart" onClick={() => control(app.name, 'restart')}><RotateCcw size={14} /></button>
                <button className="btn-ghost" title="Logs" onClick={() => { setExpanded(expanded === app.name ? null : app.name); fetchLogs(app.name); }}>
                  <Terminal size={14} />
                </button>
                <button className="btn-icon text-red-500" title="Delete" onClick={() => remove(app.name)}><Trash2 size={14} /></button>
                <button className="btn-ghost" onClick={() => { const next = expanded === app.name ? null : app.name; setExpanded(next); if (next) loadStaging(app.name); }}>
                  {expanded === app.name ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
            </div>

            {expanded === app.name && (
              <div className="border-t border-slate-200 dark:border-slate-700">
                <div className="p-4 bg-slate-950">
                  <pre className="text-xs text-green-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {logs[app.name] || 'Click Logs to load…'}
                  </pre>
                </div>
                <div className="p-4 border-t border-slate-700 bg-slate-900/50">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-slate-400 flex items-center gap-1"><GitBranch size={12} /> Staging Environment</p>
                    {!stagings[app.name] && (
                      <button className="btn-secondary text-xs" onClick={() => setShowStageForm(showStageForm === app.name ? null : app.name)}>
                        <Plus size={11} /> Create Staging
                      </button>
                    )}
                  </div>

                  {showStageForm === app.name && (
                    <div className="flex gap-2 mb-3">
                      <input className="input text-xs w-28" placeholder="Port (e.g. 3001)" value={stageForm[app.name]?.port || ''} onChange={e => setStageForm(p => ({ ...p, [app.name]: { ...p[app.name], port: e.target.value, branch: p[app.name]?.branch || 'staging' } }))} />
                      <input className="input text-xs flex-1" placeholder="Branch (default: staging)" value={stageForm[app.name]?.branch || ''} onChange={e => setStageForm(p => ({ ...p, [app.name]: { ...p[app.name], branch: e.target.value, port: p[app.name]?.port || '' } }))} />
                      <button className="btn-primary text-xs" onClick={() => createStaging(app.name)}>Deploy</button>
                    </div>
                  )}

                  {stagings[app.name] ? (
                    <div className="flex items-center gap-4 text-xs text-slate-300">
                      <span><span className="text-slate-500">Name:</span> {stagings[app.name].staging_name}</span>
                      <span><span className="text-slate-500">Port:</span> {stagings[app.name].staging_port}</span>
                      <span><span className="text-slate-500">Branch:</span> {stagings[app.name].branch}</span>
                      <span className={`badge-${stagings[app.name].status === 'running' ? 'success' : 'warning'} text-xs`}>{stagings[app.name].status}</span>
                      <div className="flex gap-1 ml-auto">
                        <button className="btn-secondary text-xs flex items-center gap-1" onClick={() => promoteStaging(app.name)}><ArrowUpCircle size={11} /> Promote</button>
                        <button className="btn-icon text-red-500" onClick={() => deleteStaging(app.name)}><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ) : (
                    !showStageForm && <p className="text-xs text-slate-500">No staging environment — create one to test changes before promoting to production.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
