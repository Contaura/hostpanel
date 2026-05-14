import { useEffect, useState } from 'react';
import { Plus, Trash2, Download } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/php-domains${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

export default function PhpVersions() {
  const toast = useToast();
  const [tab, setTab] = useState<'php' | 'node' | 'python'>('php');
  const [versions, setVersions] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [domain, setDomain] = useState('');
  const [phpVer, setPhpVer] = useState('');
  const [nodeInfo, setNodeInfo] = useState<any>(null);
  const [pyInfo, setPyInfo] = useState<any>(null);
  const [installing, setInstalling] = useState(false);
  const [installOutput, setInstallOutput] = useState('');

  useEffect(() => { loadPhp(); }, []);

  async function loadPhp() {
    const [v, a] = await Promise.all([api('/versions').then(r => r.json()), api('/').then(r => r.json())]);
    setVersions(Array.isArray(v) ? v : []);
    setAssignments(Array.isArray(a) ? a : []);
    if (Array.isArray(v) && v.length) setPhpVer(v[0]);
  }

  async function assign() {
    if (!domain || !phpVer) return;
    const r = await api('/', { method: 'POST', body: JSON.stringify({ domain, php_version: phpVer }) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success(`${domain} → PHP ${phpVer}`); setDomain(''); loadPhp(); }
  }

  async function removeAssign(d: string) {
    await api(`/${d}`, { method: 'DELETE' });
    setAssignments(a => a.filter(x => x.domain !== d));
  }

  async function loadNode() {
    const r = await api('/node-versions');
    setNodeInfo(await r.json());
  }

  async function loadPython() {
    const r = await api('/python-versions');
    setPyInfo(await r.json());
  }

  async function installNode(version: string) {
    setInstalling(true); setInstallOutput('Installing…');
    const r = await api('/node-install', { method: 'POST', body: JSON.stringify({ version }) });
    const d = await r.json();
    setInstallOutput(d.output || d.error || 'Done');
    setInstalling(false);
    loadNode();
  }

  async function installPython(version: string) {
    setInstalling(true); setInstallOutput('Installing…');
    const r = await api('/python-install', { method: 'POST', body: JSON.stringify({ version }) });
    const d = await r.json();
    setInstallOutput(d.output || d.error || 'Done');
    setInstalling(false);
    loadPython();
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Runtime Versions</h1>

      <div className="tab-bar">
        <button className={`tab-item ${tab === 'php' ? 'tab-item-active' : ''}`} onClick={() => setTab('php')}>PHP (per domain)</button>
        <button className={`tab-item ${tab === 'node' ? 'tab-item-active' : ''}`} onClick={() => { setTab('node'); loadNode(); }}>Node.js (nvm)</button>
        <button className={`tab-item ${tab === 'python' ? 'tab-item-active' : ''}`} onClick={() => { setTab('python'); loadPython(); }}>Python (pyenv)</button>
      </div>

      {tab === 'php' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <p className="text-sm font-medium">Assign PHP version to domain</p>
            <div className="flex gap-3">
              <input className="input flex-1" placeholder="example.com" value={domain} onChange={e => setDomain(e.target.value)} />
              <select className="input w-36" value={phpVer} onChange={e => setPhpVer(e.target.value)}>
                {versions.map(v => <option key={v} value={v}>PHP {v}</option>)}
              </select>
              <button className="btn-primary" onClick={assign}><Plus size={14} className="mr-1" />Assign</button>
            </div>
          </div>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead><tr>{['Domain', 'PHP Version', 'Updated', ''].map(h => <th key={h} className="table-header-cell">{h}</th>)}</tr></thead>
              <tbody>
                {assignments.length === 0 && <tr><td colSpan={4} className="table-cell text-center text-slate-500">No assignments yet</td></tr>}
                {assignments.map((a: any) => (
                  <tr key={a.domain} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="table-cell font-mono text-xs">{a.domain}</td>
                    <td className="table-cell"><span className="badge-info">PHP {a.php_version}</span></td>
                    <td className="table-cell text-xs text-slate-500">{a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—'}</td>
                    <td className="table-cell"><button className="btn-icon text-red-500" onClick={() => removeAssign(a.domain)}><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'node' && nodeInfo && (
        <div className="space-y-4">
          <div className="card">
            <p className="text-sm text-slate-500">Current: <span className="font-mono font-medium text-slate-800 dark:text-slate-200">{nodeInfo.current || 'none'}</span></p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(nodeInfo.installed || []).map((v: string) => <span key={v} className="badge-success text-xs">{v}</span>)}
            </div>
          </div>
          <div className="card space-y-2">
            <p className="text-sm font-medium">Available LTS Versions</p>
            <div className="flex flex-wrap gap-2">
              {(nodeInfo.available || []).map((v: string) => (
                <button key={v} className="btn-secondary text-xs" onClick={() => installNode(v)} disabled={installing}>
                  <Download size={11} className="mr-1" />{v}
                </button>
              ))}
            </div>
          </div>
          {installOutput && <pre className="bg-slate-900 text-emerald-400 text-xs p-3 rounded-lg max-h-48 overflow-y-auto whitespace-pre-wrap">{installOutput}</pre>}
        </div>
      )}

      {tab === 'python' && pyInfo && (
        <div className="space-y-4">
          <div className="card">
            <p className="text-sm text-slate-500">Current: <span className="font-mono font-medium text-slate-800 dark:text-slate-200">{pyInfo.current || 'none'}</span></p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(pyInfo.installed || []).map((v: string) => <span key={v} className="badge-success text-xs">{v}</span>)}
            </div>
          </div>
          <div className="card space-y-2">
            <p className="text-sm font-medium">Available Python 3.x Versions</p>
            <div className="flex flex-wrap gap-2">
              {(pyInfo.available || []).map((v: string) => (
                <button key={v} className="btn-secondary text-xs" onClick={() => installPython(v)} disabled={installing}>
                  <Download size={11} className="mr-1" />{v}
                </button>
              ))}
            </div>
          </div>
          {installOutput && <pre className="bg-slate-900 text-emerald-400 text-xs p-3 rounded-lg max-h-48 overflow-y-auto whitespace-pre-wrap">{installOutput}</pre>}
        </div>
      )}
    </div>
  );
}
