import { useEffect, useState } from 'react';
import axios from 'axios';
import { FileText, Search, RefreshCw, Globe } from 'lucide-react';
import { useToast } from '../components/Toast';

interface LogEntry {
  key: string;
  label: string;
  path: string;
  exists: boolean;
}

const LINE_OPTS = [50, 100, 200, 500, 1000];

export default function LogViewer() {
  const toast = useToast();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selected, setSelected] = useState('apache_access');
  const [content, setContent] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState(200);
  const [loading, setLoading] = useState(false);
  const [path, setPath] = useState('');
  const [mode, setMode] = useState<'system' | 'domain'>('system');
  const [domainList, setDomainList] = useState<string[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [domainLogType, setDomainLogType] = useState<'access' | 'error'>('access');
  const [domainContent, setDomainContent] = useState('');
  const [domainLoading, setDomainLoading] = useState(false);

  async function loadLogs() {
    try {
      const { data } = await axios.get<LogEntry[]>('/api/logs/list');
      setLogs(data);
    } catch {}
  }

  async function fetchLog(key = selected, numLines = lines) {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/logs/read/${key}`, { params: { lines: numLines } });
      setContent(data.content);
      setPath(data.path);
      setSearch('');
    } catch (err: any) {
      setContent('');
      toast.error(err.response?.data?.error || 'Failed to read log');
    } finally { setLoading(false); }
  }

  async function searchLog() {
    if (!search.trim()) return fetchLog();
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/logs/search/${selected}`, { params: { q: search } });
      setContent(data.content || '(no matches)');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Search failed'); }
    finally { setLoading(false); }
  }

  async function loadDomainList() {
    try { const { data } = await axios.get('/api/logs/domain-list'); setDomainList(Array.isArray(data) ? data : []); }
    catch {}
  }

  async function fetchDomainLog() {
    if (!selectedDomain) return;
    setDomainLoading(true);
    try {
      const { data } = await axios.get(`/api/logs/domain/${selectedDomain}/${domainLogType}`);
      setDomainContent(data.content || '');
    } catch { setDomainContent(''); }
    finally { setDomainLoading(false); }
  }

  useEffect(() => { loadLogs(); loadDomainList(); }, []);
  useEffect(() => { fetchLog(); }, [selected, lines]);
  useEffect(() => { if (mode === 'domain' && selectedDomain) fetchDomainLog(); }, [selectedDomain, domainLogType]);

  const currentLog = logs.find(l => l.key === selected);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Log Viewer</h1>
          <p className="page-subtitle">Browse and search server log files</p>
        </div>
      </div>

      <div className="tab-bar">
        <button className={mode === 'system' ? 'tab-item-active' : 'tab-item'} onClick={() => setMode('system')}><FileText size={14} /> System Logs</button>
        <button className={mode === 'domain' ? 'tab-item-active' : 'tab-item'} onClick={() => setMode('domain')}><Globe size={14} /> Domain Logs</button>
      </div>

      {mode === 'domain' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="label">Domain</label>
              <select className="input w-52" value={selectedDomain} onChange={e => setSelectedDomain(e.target.value)}>
                <option value="">Select domain…</option>
                {domainList.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Log Type</label>
              <select className="input w-32" value={domainLogType} onChange={e => setDomainLogType(e.target.value as 'access' | 'error')}>
                <option value="access">Access</option>
                <option value="error">Error</option>
              </select>
            </div>
            <button className="btn-secondary self-end" onClick={fetchDomainLog}><RefreshCw size={14} className={domainLoading ? 'animate-spin' : ''} /></button>
          </div>
          <div className="card overflow-hidden">
            {domainLoading ? (
              <div className="flex items-center justify-center py-24">
                <svg className="animate-spin h-6 w-6 text-indigo-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              </div>
            ) : domainContent ? (
              <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap p-4 overflow-auto max-h-[70vh] leading-relaxed">{domainContent}</pre>
            ) : (
              <div className="py-16 text-center">
                <Globe className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                <p className="text-slate-400 text-sm">{selectedDomain ? 'No log content found' : 'Select a domain to view its logs'}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'system' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="label">Log File</label>
              <select className="input w-52" value={selected} onChange={e => { setSelected(e.target.value); }}>
                {logs.map(l => (
                  <option key={l.key} value={l.key} disabled={!l.exists}>
                    {l.label}{!l.exists ? ' (not found)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Last N lines</label>
              <select className="input w-28" value={lines} onChange={e => setLines(+e.target.value)}>
                {LINE_OPTS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-48">
              <label className="label">Search</label>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="Filter by keyword…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchLog()} />
                <button onClick={searchLog} className="btn-secondary px-3"><Search size={14} /></button>
              </div>
            </div>
            <button onClick={() => fetchLog()} className="btn-secondary self-end">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          {currentLog && <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{path}</p>}
          <div className="card overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <svg className="animate-spin h-6 w-6 text-indigo-500" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </div>
            ) : content ? (
              <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap p-4 overflow-auto max-h-[70vh] leading-relaxed">{content}</pre>
            ) : (
              <div className="py-16 text-center">
                <FileText className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                <p className="text-slate-400 text-sm">Select a log file to view its contents</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
