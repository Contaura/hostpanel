import { useState } from 'react';
import { Lock, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/ssl-advanced${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, ...o });

export default function SslAdvanced() {
  const toast = useToast();
  const [tab, setTab] = useState<'ciphers' | 'wildcard' | 'test'>('ciphers');
  const [ciphers, setCiphers] = useState<any>(null);
  const [ciphersLoaded, setCiphersLoaded] = useState(false);
  const [preset, setPreset] = useState('intermediate');
  const [wildcard, setWildcard] = useState({ domain: '', dns_plugin: 'cloudflare', credentials_file: '' });
  const [wildcardOutput, setWildcardOutput] = useState('');
  const [testDomain, setTestDomain] = useState('');
  const [testResult, setTestResult] = useState<any>(null);

  async function loadCiphers() {
    if (ciphersLoaded) return;
    const r = await api('/ciphers');
    const d = await r.json();
    setCiphers(d);
    setCiphersLoaded(true);
  }

  async function saveCiphers() {
    const r = await api('/ciphers', { method: 'PUT', body: JSON.stringify({ preset }) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else toast.success('SSL configuration saved');
  }

  async function issueWildcard() {
    setWildcardOutput('Requesting certificate…');
    const r = await api('/wildcard', { method: 'POST', body: JSON.stringify(wildcard) });
    const d = await r.json();
    setWildcardOutput(d.output || d.error || 'Done');
  }

  async function testSsl() {
    if (!testDomain.trim()) return;
    setTestResult(null);
    const r = await api(`/test/${testDomain.trim()}`);
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    setTestResult(d);
  }

  if (tab === 'ciphers' && !ciphersLoaded) loadCiphers();

  return (
    <div className="space-y-6">
      <h1 className="page-title">SSL / TLS Advanced</h1>

      <div className="tab-bar">
        <button className={`tab-item ${tab === 'ciphers' ? 'tab-item-active' : ''}`} onClick={() => setTab('ciphers')}>Cipher Config</button>
        <button className={`tab-item ${tab === 'wildcard' ? 'tab-item-active' : ''}`} onClick={() => setTab('wildcard')}>Wildcard SSL</button>
        <button className={`tab-item ${tab === 'test' ? 'tab-item-active' : ''}`} onClick={() => setTab('test')}>Test Certificate</button>
      </div>

      {tab === 'ciphers' && (
        <div className="card space-y-4">
          <div>
            <label className="label">Security Preset</label>
            <div className="grid grid-cols-3 gap-3 mt-2">
              {['modern', 'intermediate', 'old'].map(p => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`p-3 rounded-lg border-2 text-left transition-all ${preset === p ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-700'}`}
                >
                  <p className="font-medium text-sm capitalize">{p}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {p === 'modern' && 'TLS 1.3 only — most secure'}
                    {p === 'intermediate' && 'TLS 1.2 + 1.3 — recommended'}
                    {p === 'old' && 'TLS 1.0+ — legacy compatibility'}
                  </p>
                </button>
              ))}
            </div>
          </div>
          {ciphers?.current && (
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-xs space-y-1">
              <p><span className="text-slate-500">Protocols:</span> <code>{ciphers.current.protocols}</code></p>
              <p><span className="text-slate-500">Ciphers:</span> <code className="break-all">{ciphers.current.ciphers}</code></p>
              <p><span className="text-slate-500">HSTS:</span> {ciphers.current.hsts ? 'Enabled' : 'Disabled'}</p>
            </div>
          )}
          <button className="btn-primary" onClick={saveCiphers}>Apply Configuration</button>
        </div>
      )}

      {tab === 'wildcard' && (
        <div className="card space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">Issues a wildcard certificate using Certbot DNS challenge. Requires a supported DNS plugin (cloudflare, route53, digitalocean, etc.).</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Domain</label><input className="input" placeholder="example.com" value={wildcard.domain} onChange={e => setWildcard(w => ({ ...w, domain: e.target.value }))} /></div>
            <div>
              <label className="label">DNS Plugin</label>
              <select className="input" value={wildcard.dns_plugin} onChange={e => setWildcard(w => ({ ...w, dns_plugin: e.target.value }))}>
                {['cloudflare', 'route53', 'digitalocean', 'google', 'ovh', 'namecheap'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="col-span-2"><label className="label">Credentials File Path (optional)</label><input className="input font-mono" placeholder="/etc/letsencrypt/cloudflare.ini" value={wildcard.credentials_file} onChange={e => setWildcard(w => ({ ...w, credentials_file: e.target.value }))} /></div>
          </div>
          <button className="btn-primary" onClick={issueWildcard}>Request Wildcard Certificate</button>
          {wildcardOutput && <pre className="bg-slate-900 text-emerald-400 text-xs p-3 rounded-lg max-h-48 overflow-y-auto whitespace-pre-wrap">{wildcardOutput}</pre>}
        </div>
      )}

      {tab === 'test' && (
        <div className="space-y-4">
          <div className="card flex gap-3">
            <input className="input flex-1" placeholder="example.com" value={testDomain} onChange={e => setTestDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && testSsl()} />
            <button className="btn-primary" onClick={testSsl}><Lock size={14} className="mr-1" />Test</button>
          </div>

          {testResult && (
            <div className="card space-y-3">
              <div className="flex items-center gap-2">
                {testResult.valid
                  ? <CheckCircle size={16} className="text-emerald-500" />
                  : <XCircle size={16} className="text-red-500" />}
                <span className="font-medium">{testResult.domain}</span>
                {testResult.daysLeft !== null && (
                  <span className={`badge-${testResult.daysLeft > 30 ? 'success' : testResult.daysLeft > 7 ? 'warning' : 'danger'}`}>
                    {testResult.daysLeft}d remaining
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[['Subject', testResult.subject], ['Issuer', testResult.issuer], ['Valid From', testResult.notBefore], ['Expires', testResult.notAfter]].map(([label, val]) => (
                  <div key={label as string} className="bg-slate-50 dark:bg-slate-800 rounded p-2">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="font-mono text-xs mt-0.5 break-all">{val || '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
