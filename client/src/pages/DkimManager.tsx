import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { fetchApi } from '../lib/api';

export default function DkimManager() {
  const toast = useToast();
  const [domain, setDomain] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [spf, setSpf] = useState({ policy: 'softfail', extra_ips: '' });
  const [dmarc, setDmarc] = useState({ policy: 'none', rua: '', pct: '100' });

  useEffect(() => {
    document.title = 'DKIM / SPF — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  async function load() {
    if (!domain.trim()) return;
    setLoading(true);
    try {
      const r = await fetchApi(`/api/dkim/${domain}`);
      setData(await r.json());
    } finally { setLoading(false); }
  }

  async function generateDkim() {
    const r = await fetchApi(`/api/dkim/${domain}/generate-dkim`, { method: 'POST' });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('DKIM key generated — add the TXT record below to your DNS');
    setData((prev: any) => ({ ...prev, dkim: d }));
  }

  async function saveSpf() {
    const r = await fetchApi(`/api/dkim/${domain}/spf`, { method: 'POST', body: JSON.stringify(spf) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('SPF record generated');
    setData((prev: any) => ({ ...prev, spf: d.record }));
  }

  async function saveDmarc() {
    const r = await fetchApi(`/api/dkim/${domain}/dmarc`, { method: 'POST', body: JSON.stringify(dmarc) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('DMARC record generated');
    setData((prev: any) => ({ ...prev, dmarc: d.record }));
  }

  async function verify() {
    const r = await fetchApi(`/api/dkim/${domain}/verify`);
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    const msg = `DKIM: ${d.dkim ? '✓ propagated' : '✗ not found'} | SPF: ${d.spf ? '✓' : '✗'} | DMARC: ${d.dmarc ? '✓' : '✗'}`;
    if (d.dkim && d.spf) toast.success(msg); else toast.info(msg);
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">DKIM / SPF / DMARC</h1>

      <div className="card">
        <div className="flex gap-3">
          <input className="input flex-1" placeholder="example.com" value={domain} onChange={e => setDomain(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} />
          <button className="btn-primary" onClick={load} disabled={loading}>Load</button>
        </div>
      </div>

      {data && (
        <div className="space-y-4">
          {/* DKIM */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">DKIM</h2>
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" onClick={generateDkim}>Generate Key</button>
                <button className="btn-ghost text-xs" onClick={verify}>Check DNS</button>
              </div>
            </div>
            {data.dkim?.dns_record && (
              <div>
                <p className="label">DNS TXT record — add to <code>mail._domainkey.{domain}</code></p>
                <pre className="bg-slate-800 text-emerald-400 p-3 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap break-all">{data.dkim.dns_record}</pre>
              </div>
            )}
            {!data.dkim?.dns_record && <p className="text-slate-500 text-sm">No DKIM key found. Click Generate Key to create one.</p>}
          </div>

          {/* SPF */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-sm">SPF</h2>
            {data.spf && <p className="text-xs text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded">{data.spf}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Policy</label>
                <select className="input" value={spf.policy} onChange={e => setSpf(s => ({ ...s, policy: e.target.value }))}>
                  <option value="softfail">~all (softfail)</option>
                  <option value="fail">-all (fail)</option>
                  <option value="neutral">?all (neutral)</option>
                </select>
              </div>
              <div>
                <label className="label">Extra IPs (space-separated)</label>
                <input className="input" placeholder="1.2.3.4" value={spf.extra_ips} onChange={e => setSpf(s => ({ ...s, extra_ips: e.target.value }))} />
              </div>
            </div>
            <button className="btn-primary text-sm" onClick={saveSpf}>Generate SPF</button>
          </div>

          {/* DMARC */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-sm">DMARC</h2>
            {data.dmarc && <p className="text-xs text-slate-400 font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded">{data.dmarc}</p>}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Policy</label>
                <select className="input" value={dmarc.policy} onChange={e => setDmarc(d => ({ ...d, policy: e.target.value }))}>
                  <option value="none">none (monitor)</option>
                  <option value="quarantine">quarantine</option>
                  <option value="reject">reject</option>
                </select>
              </div>
              <div>
                <label className="label">Report Email (rua)</label>
                <input className="input" placeholder="dmarc@example.com" value={dmarc.rua} onChange={e => setDmarc(d => ({ ...d, rua: e.target.value }))} />
              </div>
              <div>
                <label className="label">% to apply</label>
                <input className="input" type="number" min="1" max="100" value={dmarc.pct} onChange={e => setDmarc(d => ({ ...d, pct: e.target.value }))} />
              </div>
            </div>
            <button className="btn-primary text-sm" onClick={saveDmarc}>Generate DMARC</button>
          </div>
        </div>
      )}
    </div>
  );
}
