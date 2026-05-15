import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Play, Square, RotateCcw, Trash2, FileText, Terminal, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { fetchApi } from '../lib/api';

type AppType = 'node' | 'python';

function fmtMem(b: number) {
  if (!b) return '—';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function statusBadge(s: string) {
  if (s === 'online')  return 'badge-success';
  if (s === 'stopped') return 'badge-gray';
  return 'badge-warning';
}

export default function NodeApps() {
  const toast = useToast();
  const [type, setType] = useState<AppType>('node');
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [logs, setLogs] = useState<{ id: string; lines: string[] } | null>(null);
  const [nodeForm, setNodeForm] = useState({ name: '', script: '', cwd: '', interpreter: 'node', env: '' });
  const [pyForm, setPyForm] = useState({ name: '', script: '', cwd: '', venv: '' });
  const [venvPath, setVenvPath] = useState('');
  const [creatingVenv, setCreatingVenv] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [appSearch, setAppSearch] = useState('');

  useEffect(() => { load(); }, [type]);

  async function load() {
    setLoading(true);
    const r = await fetchApi(`/api/node-apps/${type}`);
    setApps(Array.isArray(await r.json()) ? await r.clone().json() : []);
    setLoading(false);
  }

  async function action(id: string, act: string) {
    setActioning(id);
    try {
      await fetchApi(`/api/node-apps/node/${id}/action`, { method: 'POST', body: JSON.stringify({ action: act }) });
      toast.success(`${act} sent`);
      load();
    } finally { setActioning(null); }
  }

  async function addApp() {
    const body = type === 'node' ? nodeForm : pyForm;
    const r = await fetchApi(`/api/node-apps/${type}`, { method: 'POST', body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('App started');
    setAdding(false);
    setNodeForm({ name: '', script: '', cwd: '', interpreter: 'node', env: '' });
    setPyForm({ name: '', script: '', cwd: '', venv: '' });
    load();
  }

  async function loadLogs(id: string) {
    const r = await fetchApi(`/api/node-apps/node/${id}/logs`);
    const d = await r.json();
    setLogs({ id, lines: d.lines || [] });
  }

  async function createVenv() {
    if (!venvPath) return;
    setCreatingVenv(true);
    const r = await fetchApi('/api/node-apps/python/create-venv', { method: 'POST', body: JSON.stringify({ path: venvPath }) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success(`venv created at ${venvPath}`); setPyForm(f => ({ ...f, venv: venvPath })); }
    setCreatingVenv(false);
  }

  async function pm2Startup() {
    const r = await fetchApi('/api/node-apps/pm2-startup', { method: 'POST' });
    const d = await r.json();
    toast.success('PM2 startup configured');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Node.js / Python Apps</h1>
        <p className="page-subtitle">Manage applications with PM2 process manager</p>
      </div>

      <div className="tab-bar">
        <button className={type === 'node' ? 'tab-item-active' : 'tab-item'} onClick={() => setType('node')}>Node.js Apps</button>
        <button className={type === 'python' ? 'tab-item-active' : 'tab-item'} onClick={() => setType('python')}>Python Apps</button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{apps.length} app{apps.length !== 1 ? 's' : ''} running</p>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={pm2Startup}><Terminal size={13} /> Configure PM2 Startup</button>
          <button className="btn-secondary" onClick={load}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
          <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} /> Deploy App</button>
        </div>
      </div>

      {adding && (
        <div className="card space-y-4">
          <h3 className="font-semibold text-sm">Deploy {type === 'node' ? 'Node.js' : 'Python'} App</h3>
          {type === 'node' ? (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">App Name</label><input className="input" placeholder="my-api" value={nodeForm.name} onChange={e => setNodeForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div>
                <label className="label">Interpreter</label>
                <select className="input" value={nodeForm.interpreter} onChange={e => setNodeForm(f => ({ ...f, interpreter: e.target.value }))}>
                  <option value="node">Node.js</option>
                  <option value="bun">Bun</option>
                  <option value="deno">Deno</option>
                </select>
              </div>
              <div className="col-span-2"><label className="label">Script / Entry Point</label><input className="input font-mono" placeholder="/var/www/myapp/index.js" value={nodeForm.script} onChange={e => setNodeForm(f => ({ ...f, script: e.target.value }))} /></div>
              <div><label className="label">Working Directory</label><input className="input font-mono" placeholder="/var/www/myapp" value={nodeForm.cwd} onChange={e => setNodeForm(f => ({ ...f, cwd: e.target.value }))} /></div>
              <div><label className="label">.env File (optional)</label><input className="input font-mono" placeholder="/var/www/myapp/.env" value={nodeForm.env} onChange={e => setNodeForm(f => ({ ...f, env: e.target.value }))} /></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">App Name</label><input className="input" placeholder="my-flask-app" value={pyForm.name} onChange={e => setPyForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div className="col-span-2"><label className="label">Script / Entry Point</label><input className="input font-mono" placeholder="/var/www/myapp/app.py" value={pyForm.script} onChange={e => setPyForm(f => ({ ...f, script: e.target.value }))} /></div>
              <div><label className="label">Working Directory</label><input className="input font-mono" value={pyForm.cwd} onChange={e => setPyForm(f => ({ ...f, cwd: e.target.value }))} /></div>
              <div>
                <label className="label">Virtualenv Path (optional)</label>
                <div className="flex gap-2">
                  <input className="input font-mono flex-1" placeholder="/var/www/myapp/venv" value={pyForm.venv} onChange={e => setPyForm(f => ({ ...f, venv: e.target.value }))} />
                </div>
              </div>
              <div className="col-span-2 flex items-center gap-3">
                <input className="input flex-1 font-mono" placeholder="Create new venv at path…" value={venvPath} onChange={e => setVenvPath(e.target.value)} />
                <button className="btn-secondary text-sm" onClick={createVenv} disabled={creatingVenv}>{creatingVenv ? 'Creating…' : 'Create venv'}</button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-primary" onClick={addApp}><Play size={14} /> Start App</button>
            <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-48 text-sm" placeholder="Search apps…" value={appSearch} onChange={e => setAppSearch(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>{['Name', 'Status', 'PID', 'CPU', 'Memory', 'Restarts', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="table-cell text-center py-8 text-slate-400">Loading…</td></tr>}
              {!loading && (() => {
                const q = appSearch.trim().toLowerCase();
                const visible = q ? apps.filter((app: any) => [app.name, app.script, app.status].some((v: any) => String(v ?? '').toLowerCase().includes(q))) : apps;
                if (apps.length === 0) return <tr><td colSpan={7} className="table-cell text-center py-8 text-slate-400">No apps running. Deploy one above.</td></tr>;
                if (visible.length === 0) return <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">No apps match "{appSearch}"</td></tr>;
                return visible.map((app: any) => (
                  <tr key={app.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="table-cell">
                      <div>
                        <p className="font-medium">{app.name}</p>
                        <p className="text-xs text-slate-400 font-mono truncate max-w-[180px]">{app.script}</p>
                      </div>
                    </td>
                    <td className="table-cell"><span className={`badge text-xs ${statusBadge(app.status)}`}>{app.status}</span></td>
                    <td className="table-cell text-xs text-slate-500">{app.pid || '—'}</td>
                    <td className="table-cell text-xs">{app.cpu != null ? `${app.cpu}%` : '—'}</td>
                    <td className="table-cell text-xs">{fmtMem(app.memory)}</td>
                    <td className="table-cell text-xs text-slate-500">{app.restarts ?? '—'}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1">
                        {app.status === 'online'
                          ? <button className="btn-icon text-amber-500" disabled={actioning === String(app.id)} onClick={() => action(app.id, 'stop')} title="Stop"><Square size={12} /></button>
                          : <button className="btn-icon text-emerald-500" disabled={actioning === String(app.id)} onClick={() => action(app.id, 'start')} title="Start"><Play size={12} /></button>
                        }
                        <button className="btn-icon text-blue-500" disabled={actioning === String(app.id)} onClick={() => action(app.id, 'restart')} title="Restart"><RotateCcw size={12} /></button>
                        <button className="btn-icon text-slate-500" onClick={() => loadLogs(String(app.id))} title="Logs"><FileText size={12} /></button>
                        <button className="btn-icon text-red-500" disabled={actioning === String(app.id)} onClick={() => action(app.id, 'delete')} title="Delete"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {logs && (
        <div className="card bg-slate-950 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400 font-mono">Process {logs.id} logs (last 200 lines)</p>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => setLogs(null)}>✕ close</button>
          </div>
          <pre className="text-xs text-green-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
            {logs.lines.length ? logs.lines.join('\n') : 'No log output yet.'}
          </pre>
        </div>
      )}
    </div>
  );
}
