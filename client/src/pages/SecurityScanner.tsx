import { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCw, Trash2, CheckCircle, XCircle, FileSearch } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';
import { fetchApi } from '../lib/api';

export default function SecurityScanner() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'scan' | 'integrity'>('scan');

  useEffect(() => {
    document.title = 'Security Scanner — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  // Malware scan
  const [scanPath, setScanPath] = useState('/var/www');
  const [scanOutput, setScanOutput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [updating, setUpdating] = useState(false);

  // File integrity
  const [integrityPath, setIntegrityPath] = useState('/var/www');
  const [baselineRunning, setBaselineRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResults, setCheckResults] = useState<any[]>([]);
  const [checkDone, setCheckDone] = useState(false);

  async function runScan() {
    setScanning(true); setScanOutput('Running ClamAV scan…');
    const r = await fetchApi('/api/security-scanner/scan', { method: 'POST', body: JSON.stringify({ path: scanPath }) });
    const d = await r.json();
    setScanOutput(d.output || d.error || 'Done');
    if (d.error) toast.error(d.error); else toast.success('Scan complete');
    setScanning(false);
  }

  async function updateDefs() {
    setUpdating(true);
    const r = await fetchApi('/api/security-scanner/update-definitions', { method: 'POST' });
    const d = await r.json();
    if (d.error) toast.error(d.error); else toast.success('Definitions updated');
    setUpdating(false);
  }

  async function createBaseline() {
    if (!await confirm(`Create integrity baseline from "${integrityPath}"? This will hash all files in that path.`)) return;
    setBaselineRunning(true);
    const r = await fetchApi('/api/security-scanner/integrity/baseline', { method: 'POST', body: JSON.stringify({ path: integrityPath }) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else toast.success(`Baseline created — ${d.count ?? ''} files hashed`);
    setBaselineRunning(false);
    setCheckDone(false); setCheckResults([]);
  }

  async function checkIntegrity() {
    setChecking(true); setCheckDone(false); setCheckResults([]);
    const r = await fetchApi('/api/security-scanner/integrity/check');
    const d = await r.json();
    if (d.error) { toast.error(d.error); setChecking(false); return; }
    setCheckResults(Array.isArray(d) ? d : []);
    setCheckDone(true);
    setChecking(false);
    const changed = (Array.isArray(d) ? d : []).filter((f: any) => f.status !== 'ok');
    if (changed.length === 0) toast.success('All files match baseline');
    else toast.error(`${changed.length} file(s) changed or missing`);
  }

  async function clearBaseline() {
    if (!await confirm('Delete all baseline hashes?')) return;
    await fetchApi('/api/security-scanner/integrity/baseline', { method: 'DELETE' });
    toast.success('Baseline cleared');
    setCheckDone(false); setCheckResults([]);
  }

  const changed = checkResults.filter(f => f.status !== 'ok');
  const ok = checkResults.filter(f => f.status === 'ok');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Security Scanner</h1>
        <p className="page-subtitle">Malware scanning via ClamAV and file integrity monitoring</p>
      </div>

      <div className="tab-bar">
        <button className={tab === 'scan' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('scan')}>
          <ShieldAlert size={13} /> Malware Scan
        </button>
        <button className={tab === 'integrity' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('integrity')}>
          <FileSearch size={13} /> File Integrity
        </button>
      </div>

      {tab === 'scan' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4 max-w-xl">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="label">Scan Path</label>
                <input className="input font-mono" value={scanPath} onChange={e => setScanPath(e.target.value)} placeholder="/var/www" />
              </div>
              <button className="btn-danger" onClick={runScan} disabled={scanning}>
                <ShieldAlert size={14} /> {scanning ? 'Scanning…' : 'Run Scan'}
              </button>
            </div>
            <button className="btn-secondary text-sm" onClick={updateDefs} disabled={updating}>
              <RefreshCw size={13} className={updating ? 'animate-spin' : ''} />
              {updating ? 'Updating…' : 'Update Virus Definitions'}
            </button>
            <p className="text-xs text-slate-400">Uses <code>clamscan</code> with <code>--infected</code> flag. Only infected files are reported in output. Freshclam is used for definition updates.</p>
          </div>

          {scanOutput && (
            <div className="card p-4 space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Scan Output</p>
              <pre className="bg-slate-900 text-emerald-400 text-xs p-3 rounded-lg max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">{scanOutput}</pre>
            </div>
          )}
        </div>
      )}

      {tab === 'integrity' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4 max-w-xl">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Create a SHA-256 baseline of your files, then check for changes. Useful for detecting unauthorized modifications.
            </p>
            <div>
              <label className="label">Base Path</label>
              <input className="input font-mono" value={integrityPath} onChange={e => setIntegrityPath(e.target.value)} placeholder="/var/www" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={createBaseline} disabled={baselineRunning}>
                {baselineRunning ? 'Creating baseline…' : 'Create Baseline'}
              </button>
              <button className="btn-secondary" onClick={checkIntegrity} disabled={checking}>
                <FileSearch size={14} /> {checking ? 'Checking…' : 'Check Integrity'}
              </button>
              <button className="btn-secondary text-rose-600 dark:text-rose-400" onClick={clearBaseline}>
                <Trash2 size={14} /> Clear Baseline
              </button>
            </div>
          </div>

          {checkDone && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 max-w-xs">
                <div className="card p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{ok.length}</p>
                  <p className="text-xs text-slate-500 mt-1">Files OK</p>
                </div>
                <div className="card p-3 text-center">
                  <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{changed.length}</p>
                  <p className="text-xs text-slate-500 mt-1">Changed / Missing</p>
                </div>
              </div>

              {changed.length > 0 && (
                <div className="card overflow-hidden">
                  <p className="px-4 py-2 text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wide border-b border-slate-100 dark:border-slate-700">
                    Changed or Missing Files
                  </p>
                  <table className="w-full text-sm">
                    <thead><tr>
                      <th className="table-header-cell">File</th>
                      <th className="table-header-cell w-28">Status</th>
                    </tr></thead>
                    <tbody>
                      {changed.map((f: any) => (
                        <tr key={f.file_path} className="border-b border-slate-50 dark:border-slate-700/40 last:border-0">
                          <td className="table-cell font-mono text-xs text-slate-700 dark:text-slate-300 break-all">{f.file_path}</td>
                          <td className="table-cell">
                            <div className="flex items-center gap-1">
                              {f.status === 'missing'
                                ? <XCircle size={13} className="text-rose-500" />
                                : <XCircle size={13} className="text-amber-500" />}
                              <span className={`text-xs font-medium ${f.status === 'missing' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                {f.status}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {changed.length === 0 && (
                <div className="card p-6 flex items-center gap-3 max-w-md">
                  <CheckCircle size={24} className="text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">All files match baseline</p>
                    <p className="text-xs text-slate-500 mt-0.5">No unauthorized changes detected</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
