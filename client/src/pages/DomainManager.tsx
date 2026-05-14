import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Globe, Shield, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { useToast } from '../components/Toast';

interface DNSRecord { name: string; type: string; value: string; ttl: string }

const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'];
const TYPE_COLORS: Record<string, string> = {
  A: 'badge-blue', AAAA: 'badge-blue', CNAME: 'badge-yellow',
  MX: 'badge-green', TXT: 'badge-gray', NS: 'badge-gray', SRV: 'badge-gray',
};

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

export default function DomainManager() {
  const toast = useToast();
  const [domains, setDomains] = useState<string[]>([]);
  const [tab, setTab] = useState<'domains' | 'dns' | 'ssl'>('domains');
  const [showForm, setShowForm] = useState(false);
  const [domainForm, setDomainForm] = useState({ domain: '' });
  const [sslForm, setSslForm] = useState({ domain: '', email: '' });
  const [dnsForm, setDnsForm] = useState({ domain: '', name: '', type: 'A', value: '', ttl: '3600' });
  const [dnsRecords, setDnsRecords] = useState<DNSRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [sslOutput, setSslOutput] = useState('');

  async function loadDomains() {
    const { data } = await axios.get<string[]>('/api/domains/domains');
    setDomains(data);
  }
  useEffect(() => { loadDomains(); }, []);

  async function loadDNS(domain: string) {
    const { data } = await axios.get<{ records: DNSRecord[] }>(`/api/domains/dns/${domain}`);
    setDnsRecords(data.records);
  }

  async function createDomain(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/domains/domains', domainForm);
      toast.success(`Domain ${domainForm.domain} added`);
      setDomainForm({ domain: '' }); setShowForm(false); loadDomains();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function deleteDomain(domain: string) {
    if (!confirm(`Remove domain ${domain}?`)) return;
    try { await axios.delete(`/api/domains/domains/${domain}`); toast.success(`${domain} removed`); loadDomains(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function issueSSL(e: FormEvent) {
    e.preventDefault(); setLoading(true); setSslOutput('');
    try {
      const { data } = await axios.post(`/api/domains/ssl/${sslForm.domain}`, { email: sslForm.email });
      toast.success('SSL certificate issued'); setSslOutput(data.output || '');
    } catch (err: any) { toast.error(err.response?.data?.error || 'SSL issuance failed'); }
    finally { setLoading(false); }
  }

  async function addDNSRecord(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post(`/api/domains/dns/${dnsForm.domain}`, {
        name: dnsForm.name, type: dnsForm.type, value: dnsForm.value, ttl: dnsForm.ttl,
      });
      toast.success('DNS record added'); loadDNS(dnsForm.domain);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Domains & DNS</h1>
          <p className="page-subtitle">Virtual hosts, DNS records, and SSL certificates</p>
        </div>
        {tab === 'domains' && (
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus size={14} /> Add domain
          </button>
        )}
      </div>

      <div className="tab-bar">
        {([['domains', 'Domains'], ['dns', 'DNS Records'], ['ssl', 'SSL / TLS']] as const).map(([t, label]) => (
          <button key={t} onClick={() => { setTab(t); setShowForm(false); }}
            className={tab === t ? 'tab-item-active' : 'tab-item'}>{label}</button>
        ))}
      </div>

      {/* DOMAINS */}
      {tab === 'domains' && (
        <div className="space-y-4">
          {showForm && (
            <form onSubmit={createDomain} className="card p-5 space-y-4 max-w-sm">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add Domain</h2>
              <div>
                <label className="label">Domain Name</label>
                <input className="input" placeholder="example.com" value={domainForm.domain}
                  onChange={e => setDomainForm({ domain: e.target.value })} required />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Adding…' : 'Add domain'}</button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          )}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className={theadCls}><tr>
                <th className="table-header-cell">Domain</th>
                <th className="table-header-cell hidden md:table-cell">Document Root</th>
                <th className="px-4 py-3 w-12" />
              </tr></thead>
              <tbody>
                {domains.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-16 text-center">
                    <Globe className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    <p className="text-slate-400 text-sm">No domains configured</p>
                  </td></tr>
                ) : domains.map(d => (
                  <tr key={d} className={rowCls}>
                    <td className="table-cell">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
                          <Globe size={13} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{d}</span>
                      </div>
                    </td>
                    <td className="table-cell font-mono text-slate-400 dark:text-slate-500 text-xs hidden md:table-cell">
                      /var/www/{d}/public_html
                    </td>
                    <td className="px-3 py-3">
                      <button onClick={() => deleteDomain(d)}
                        className="btn-icon opacity-0 group-hover:opacity-100 hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SSL */}
      {tab === 'ssl' && (
        <div className="max-w-lg space-y-4">
          <div className="card p-6">
            <div className="flex items-start gap-4 mb-5">
              <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                <ShieldCheck size={20} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h2 className="font-bold text-slate-900 dark:text-slate-100">Let's Encrypt SSL</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Free 90-day certificates via Certbot. Domain must point to this server.
                </p>
              </div>
            </div>
            <form onSubmit={issueSSL} className="space-y-4">
              <div>
                <label className="label">Domain</label>
                <select className="input" value={sslForm.domain}
                  onChange={e => setSslForm({ ...sslForm, domain: e.target.value })} required>
                  <option value="">Select domain…</option>
                  {domains.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Email (for renewal reminders)</label>
                <input type="email" className="input" placeholder="admin@example.com" value={sslForm.email}
                  onChange={e => setSslForm({ ...sslForm, email: e.target.value })} />
              </div>
              <button type="submit" disabled={loading || !sslForm.domain} className="btn-primary w-full justify-center">
                {loading
                  ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Issuing…</>
                  : <><Shield size={14} /> Issue certificate</>
                }
              </button>
            </form>
          </div>
          {sslOutput && (
            <div className="card p-4">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Certbot output</p>
              <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/60 rounded-lg p-3 overflow-auto max-h-48">
                {sslOutput}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* DNS */}
      {tab === 'dns' && (
        <div className="space-y-5">
          <div className="card p-5 max-w-2xl">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Add DNS Record</h2>
            <form onSubmit={addDNSRecord} className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Domain</label>
                <select className="input" value={dnsForm.domain}
                  onChange={e => { setDnsForm({ ...dnsForm, domain: e.target.value }); if (e.target.value) loadDNS(e.target.value); }} required>
                  <option value="">Select…</option>
                  {domains.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input" value={dnsForm.type}
                  onChange={e => setDnsForm({ ...dnsForm, type: e.target.value })}>
                  {DNS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Name</label>
                <input className="input" placeholder="@ or subdomain" value={dnsForm.name}
                  onChange={e => setDnsForm({ ...dnsForm, name: e.target.value })} required />
              </div>
              <div>
                <label className="label">TTL</label>
                <input className="input" value={dnsForm.ttl}
                  onChange={e => setDnsForm({ ...dnsForm, ttl: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="label">Value</label>
                <input className="input" placeholder="IP address, hostname, or text" value={dnsForm.value}
                  onChange={e => setDnsForm({ ...dnsForm, value: e.target.value })} required />
              </div>
              <div className="col-span-2">
                <button type="submit" disabled={loading} className="btn-primary">
                  {loading ? 'Adding…' : 'Add record'}
                </button>
              </div>
            </form>
          </div>

          {dnsRecords.length > 0 && (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className={theadCls}><tr>
                  <th className="table-header-cell">Name</th>
                  <th className="table-header-cell">Type</th>
                  <th className="table-header-cell">TTL</th>
                  <th className="table-header-cell">Value</th>
                </tr></thead>
                <tbody>
                  {dnsRecords.map((r, i) => (
                    <tr key={i} className={rowCls}>
                      <td className="table-cell font-mono font-medium text-slate-900 dark:text-slate-100">{r.name}</td>
                      <td className="table-cell"><span className={`badge ${TYPE_COLORS[r.type] || 'badge-gray'}`}>{r.type}</span></td>
                      <td className="table-cell text-slate-500 dark:text-slate-400">{r.ttl}</td>
                      <td className="table-cell font-mono text-slate-600 dark:text-slate-400 text-xs truncate max-w-xs">{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
