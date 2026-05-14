import { useState } from 'react';
import { Search, AlertCircle, CheckCircle, XCircle, FileText } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string) =>
  fetch(`/api/mail-tools${p}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('hp_token')}` },
  });

export default function MailTools() {
  const toast = useToast();
  const [tab, setTab] = useState<'mx' | 'dnsbl' | 'authlog'>('mx');

  // MX Check
  const [mxDomain, setMxDomain] = useState('');
  const [mxResult, setMxResult] = useState<any>(null);
  const [mxLoading, setMxLoading] = useState(false);

  // DNSBL
  const [dnsblIp, setDnsblIp] = useState('');
  const [dnsblResult, setDnsblResult] = useState<any[]>([]);
  const [dnsblLoading, setDnsblLoading] = useState(false);

  // SMTP Auth Log
  const [authSearch, setAuthSearch] = useState('');
  const [authLog, setAuthLog] = useState<string[]>([]);
  const [authLoading, setAuthLoading] = useState(false);

  async function checkMx() {
    if (!mxDomain.trim()) return;
    setMxLoading(true); setMxResult(null);
    const r = await api(`/mx-check/${encodeURIComponent(mxDomain.trim())}`);
    const d = await r.json();
    if (d.error) toast.error(d.error); else setMxResult(d);
    setMxLoading(false);
  }

  async function checkDnsbl() {
    if (!dnsblIp.trim()) return;
    setDnsblLoading(true); setDnsblResult([]);
    const r = await api(`/dnsbl/${encodeURIComponent(dnsblIp.trim())}`);
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else setDnsblResult(Array.isArray(d) ? d : []);
    setDnsblLoading(false);
  }

  async function loadAuthLog() {
    setAuthLoading(true);
    const q = authSearch.trim() ? `?search=${encodeURIComponent(authSearch.trim())}` : '';
    const r = await api(`/smtp-auth-log${q}`);
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else setAuthLog(Array.isArray(d) ? d : []);
    setAuthLoading(false);
  }

  const listedCount = dnsblResult.filter(r => r.listed).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Mail Tools</h1>
        <p className="page-subtitle">MX lookup, DNSBL blacklist check, and SMTP authentication logs</p>
      </div>

      <div className="tab-bar">
        <button className={tab === 'mx' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('mx')}>
          <Search size={13} /> MX Check
        </button>
        <button className={tab === 'dnsbl' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('dnsbl')}>
          <AlertCircle size={13} /> DNSBL Lookup
        </button>
        <button className={tab === 'authlog' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('authlog')}>
          <FileText size={13} /> SMTP Auth Log
        </button>
      </div>

      {tab === 'mx' && (
        <div className="space-y-4">
          <div className="card p-5 max-w-xl space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Look up MX, A, SPF and DMARC records for a domain and probe SMTP connectivity on port 25.
            </p>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono" placeholder="example.com" value={mxDomain}
                onChange={e => setMxDomain(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && checkMx()} />
              <button className="btn-primary" onClick={checkMx} disabled={mxLoading}>
                <Search size={14} /> {mxLoading ? 'Checking…' : 'Check'}
              </button>
            </div>
          </div>

          {mxResult && (
            <div className="card p-5 space-y-4 max-w-2xl">
              <h2 className="font-bold text-slate-900 dark:text-slate-100">{mxResult.domain}</h2>

              {[
                { label: 'MX Records', records: mxResult.mx },
                { label: 'A Records', records: mxResult.a },
              ].map(({ label, records }) => (
                <div key={label}>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
                  {records?.length > 0
                    ? records.map((r: string, i: number) => (
                        <div key={i} className="font-mono text-xs text-slate-700 dark:text-slate-300 py-0.5">{r}</div>
                      ))
                    : <p className="text-xs text-slate-400">None found</p>}
                </div>
              ))}

              {[
                { label: 'SPF', value: mxResult.spf },
                { label: 'DMARC', value: mxResult.dmarc },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">{label}</p>
                  <div className={`text-xs font-mono px-3 py-2 rounded-lg ${value ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'}`}>
                    {value || 'Not configured'}
                  </div>
                </div>
              ))}

              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">SMTP Port 25</p>
                <div className="flex items-center gap-2">
                  {mxResult.smtp_reachable
                    ? <CheckCircle size={15} className="text-emerald-500" />
                    : <XCircle size={15} className="text-rose-500" />}
                  <span className="text-sm">{mxResult.smtp_reachable ? 'Reachable' : 'Not reachable'}</span>
                  {mxResult.smtp_banner && (
                    <span className="text-xs text-slate-400 font-mono ml-2 truncate max-w-xs">{mxResult.smtp_banner}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'dnsbl' && (
        <div className="space-y-4">
          <div className="card p-5 max-w-xl space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Check if an IP is blacklisted on major DNS-based blocklists (Spamhaus, SpamCop, Barracuda, SORBS, Manitu, PSBL).
            </p>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono" placeholder="1.2.3.4" value={dnsblIp}
                onChange={e => setDnsblIp(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && checkDnsbl()} />
              <button className="btn-primary" onClick={checkDnsbl} disabled={dnsblLoading}>
                <Search size={14} /> {dnsblLoading ? 'Checking…' : 'Check'}
              </button>
            </div>
          </div>

          {dnsblResult.length > 0 && (
            <div className="card overflow-hidden max-w-2xl">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{dnsblIp}</span>
                {listedCount > 0
                  ? <span className="badge-danger text-xs">{listedCount} blacklist{listedCount !== 1 ? 's' : ''}</span>
                  : <span className="badge-success text-xs">Clean</span>}
              </div>
              <table className="w-full text-sm">
                <thead><tr>
                  <th className="table-header-cell">Blacklist</th>
                  <th className="table-header-cell w-28">Status</th>
                  <th className="table-header-cell">Response</th>
                </tr></thead>
                <tbody>
                  {dnsblResult.map((r: any) => (
                    <tr key={r.list} className="border-b border-slate-50 dark:border-slate-700/40 last:border-0">
                      <td className="table-cell font-mono text-xs">{r.list}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1.5">
                          {r.listed
                            ? <XCircle size={13} className="text-rose-500" />
                            : <CheckCircle size={13} className="text-emerald-500" />}
                          <span className={`text-xs font-medium ${r.listed ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {r.listed ? 'Listed' : 'Clean'}
                          </span>
                        </div>
                      </td>
                      <td className="table-cell text-xs font-mono text-slate-400">{r.response || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'authlog' && (
        <div className="space-y-4">
          <div className="card p-5 max-w-xl space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Search Postfix SASL authentication events from <code className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">/var/log/maillog</code>.
            </p>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono" placeholder="Filter by username or IP…"
                value={authSearch} onChange={e => setAuthSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadAuthLog()} />
              <button className="btn-primary" onClick={loadAuthLog} disabled={authLoading}>
                <FileText size={14} /> {authLoading ? 'Loading…' : 'Load Log'}
              </button>
            </div>
          </div>

          {authLog.length > 0 && (
            <div className="card p-4 space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">{authLog.length} entries</p>
              <pre className="bg-slate-900 text-emerald-400 text-xs p-3 rounded-lg max-h-[500px] overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                {authLog.join('\n')}
              </pre>
            </div>
          )}

          {authLog.length === 0 && authLoading === false && authSearch !== '' && (
            <div className="card p-6 text-center text-slate-400 text-sm">No log entries found</div>
          )}
        </div>
      )}
    </div>
  );
}
