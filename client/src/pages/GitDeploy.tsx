import { useEffect, useState } from 'react';
import { Plus, Trash2, Play, Copy, GitBranch, Pencil } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/git-deploy${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

const blank = { name: '', repo_url: '', branch: 'main', deploy_path: '', command: 'git pull && npm install && npm run build', auto_deploy: true };

export default function GitDeploy() {
  const toast = useToast();
  const [deps, setDeps] = useState<any[]>([]);
  const [form, setForm] = useState(blank);
  const [adding, setAdding] = useState(false);
  const [logs, setLogs] = useState<Record<number, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ repo_url: '', branch: '', deploy_path: '', command: '', auto_deploy: true });
  const [deploying, setDeploying] = useState<number | null>(null);
  const [deletingDep, setDeletingDep] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await api('/');
      setDeps(await r.json());
    } finally { setPageLoading(false); }
  }

  async function save() {
    const r = await api('/', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Deployment created');
    setAdding(false); setForm(blank);
    load();
  }

  async function deploy(id: number) {
    setDeploying(id);
    setLogs(l => ({ ...l, [id]: 'Deploying…' }));
    try {
      const r = await api(`/${id}/deploy`, { method: 'POST' });
      const d = await r.json();
      setLogs(l => ({ ...l, [id]: d.output || d.error || 'Done' }));
      if (d.error) toast.error(d.error);
      else toast.success('Deployment complete');
    } finally { setDeploying(null); }
  }

  async function del(id: number) {
    if (!confirm('Delete deployment?')) return;
    setDeletingDep(id);
    try {
      await api(`/${id}`, { method: 'DELETE' });
      load();
    } finally { setDeletingDep(null); }
  }

  async function update(id: number) {
    const r = await api(`/${id}`, { method: 'PUT', body: JSON.stringify(editForm) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Deployment updated');
    setEditingId(null);
    load();
  }

  function webhookUrl(dep: any) {
    return `${window.location.protocol}//${window.location.hostname}:3001/api/git-deploy/webhook/${dep.name}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Git Deployments</h1>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />New Deployment</button>
      </div>

      {pageLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
      <>

      {adding && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-sm">New Deployment</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="label">Repository URL</label><input className="input" value={form.repo_url} onChange={e => setForm(f => ({ ...f, repo_url: e.target.value }))} /></div>
            <div><label className="label">Branch</label><input className="input" value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} /></div>
            <div><label className="label">Deploy Path</label><input className="input" value={form.deploy_path} onChange={e => setForm(f => ({ ...f, deploy_path: e.target.value }))} /></div>
            <div className="col-span-2"><label className="label">Deploy Command</label><input className="input font-mono" value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} /></div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="auto" checked={form.auto_deploy} onChange={e => setForm(f => ({ ...f, auto_deploy: e.target.checked }))} />
            <label htmlFor="auto" className="text-sm">Auto-deploy on webhook push</label>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save}>Create</button>
            <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {deps.length === 0 && <p className="text-sm text-slate-500">No deployments configured.</p>}
        {deps.map((d: any) => (
          <div key={d.id} className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranch size={15} className="text-indigo-500" />
                <span className="font-medium text-sm">{d.name}</span>
                <span className="badge-info text-xs">{editingId === d.id ? editForm.branch : d.branch}</span>
              </div>
              <div className="flex gap-2">
                {editingId !== d.id && (
                  <button className="btn-secondary text-xs" disabled={deploying === d.id} onClick={() => deploy(d.id)}><Play size={12} className="mr-1" />{deploying === d.id ? 'Deploying…' : 'Deploy Now'}</button>
                )}
                <button className="btn-icon hover:!text-sky-600 hover:!bg-sky-50 dark:hover:!bg-sky-900/30" title="Edit" onClick={() => {
                  if (editingId === d.id) { setEditingId(null); return; }
                  setEditingId(d.id);
                  setEditForm({ repo_url: d.repo_url, branch: d.branch, deploy_path: d.deploy_path, command: d.command, auto_deploy: !!d.auto_deploy });
                }}><Pencil size={13} /></button>
                <button className="btn-icon hover:!text-red-600 hover:!bg-red-50 dark:hover:!bg-red-900/30" disabled={deletingDep === d.id} onClick={() => del(d.id)}><Trash2 size={13} /></button>
              </div>
            </div>

            {editingId === d.id ? (
              <div className="space-y-3 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Repository URL</label><input className="input" value={editForm.repo_url} onChange={e => setEditForm(f => ({ ...f, repo_url: e.target.value }))} /></div>
                  <div><label className="label">Branch</label><input className="input" value={editForm.branch} onChange={e => setEditForm(f => ({ ...f, branch: e.target.value }))} /></div>
                  <div><label className="label">Deploy Path</label><input className="input" value={editForm.deploy_path} onChange={e => setEditForm(f => ({ ...f, deploy_path: e.target.value }))} /></div>
                  <div className="flex items-center gap-2 pt-5">
                    <input type="checkbox" id={`auto-${d.id}`} checked={editForm.auto_deploy} onChange={e => setEditForm(f => ({ ...f, auto_deploy: e.target.checked }))} />
                    <label htmlFor={`auto-${d.id}`} className="text-sm">Auto-deploy on webhook</label>
                  </div>
                  <div className="col-span-2"><label className="label">Deploy Command</label><input className="input font-mono" value={editForm.command} onChange={e => setEditForm(f => ({ ...f, command: e.target.value }))} /></div>
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary text-sm" onClick={() => update(d.id)}>Save</button>
                  <button className="btn-ghost text-sm" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-xs text-slate-500 space-y-1">
                  <p>Repo: <span className="font-mono">{d.repo_url}</span></p>
                  <p>Path: <span className="font-mono">{d.deploy_path}</span></p>
                  <p>Last deploy: {d.last_deploy ? new Date(d.last_deploy).toLocaleString() : 'Never'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-slate-400 font-mono truncate flex-1">{webhookUrl(d)}</p>
                  <button className="btn-icon" onClick={() => { navigator.clipboard.writeText(webhookUrl(d)); toast.success('Copied'); }}>
                    <Copy size={12} />
                  </button>
                </div>
                {logs[d.id] && (
                  <pre className="bg-slate-900 text-emerald-400 text-xs p-3 rounded-lg max-h-40 overflow-y-auto whitespace-pre-wrap">{logs[d.id]}</pre>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  );
}
