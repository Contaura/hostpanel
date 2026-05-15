import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { ShieldCheck, Plus, Trash2, Globe, Layers, Ban, RefreshCw, MapPin, Wifi, Play, Square, RotateCcw, Server, Search } from 'lucide-react';
import { useToast } from '../components/Toast';

interface FirewallStatus {
  active: boolean;
  services: string[];
  ports: string[];
  blockedIPs: string[];
}

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

const KNOWN_PORTS = [
  { port: 21,   proto: 'tcp', label: 'FTP' },
  { port: 22,   proto: 'tcp', label: 'SSH' },
  { port: 25,   proto: 'tcp', label: 'SMTP' },
  { port: 53,   proto: 'tcp', label: 'DNS' },
  { port: 80,   proto: 'tcp', label: 'HTTP' },
  { port: 110,  proto: 'tcp', label: 'POP3' },
  { port: 143,  proto: 'tcp', label: 'IMAP' },
  { port: 443,  proto: 'tcp', label: 'HTTPS' },
  { port: 3306, proto: 'tcp', label: 'MySQL' },
  { port: 8080, proto: 'tcp', label: 'Alt HTTP' },
];

export default function Firewall() {
  const toast = useToast();
  const [tab, setTab] = useState<'ports' | 'ips' | 'geo' | 'ipv6' | 'services'>('ports');
  const [status, setStatus] = useState<FirewallStatus | null>(null);
  const [portForm, setPortForm] = useState({ port: '', protocol: 'tcp' });
  const [ipForm, setIpForm] = useState({ ip: '' });
  const [loading, setLoading] = useState(false);
  const [geoBlocks, setGeoBlocks] = useState<string[]>([]);
  const [geoCode, setGeoCode] = useState('');
  const [ipv6Blocks, setIpv6Blocks] = useState<string[]>([]);
  const [ipv6Form, setIpv6Form] = useState('');
  const [svcStatuses, setSvcStatuses] = useState<{ name: string; status: string }[]>([]);
  const [svcLoading, setSvcLoading] = useState<string | null>(null);
  const [ipSearch, setIpSearch] = useState('');
  const [ipv6Search, setIpv6Search] = useState('');
  const [geoSearch, setGeoSearch] = useState('');

  async function load() {
    try {
      const { data } = await axios.get<FirewallStatus>('/api/firewall/status');
      setStatus(data);
    } catch (err: any) { toast.error('Failed to load firewall status'); }
  }

  async function loadGeo() {
    try {
      const { data } = await axios.get<string[]>('/api/firewall/geo-blocks');
      setGeoBlocks(data);
    } catch {}
  }

  async function loadIpv6() {
    try {
      const { data } = await axios.get<string[]>('/api/firewall/ipv6-blocks');
      setIpv6Blocks(Array.isArray(data) ? data : []);
    } catch {}
  }

  useEffect(() => { load(); loadGeo(); loadIpv6(); }, []);

  async function addPort(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/firewall/ports', portForm);
      toast.success(`Port ${portForm.port}/${portForm.protocol} opened`);
      setPortForm({ port: '', protocol: 'tcp' }); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function removePort(port: string) {
    const [num, proto] = port.split('/');
    if (!confirm(`Close port ${port}?`)) return;
    try {
      await axios.delete(`/api/firewall/ports/${num}/${proto}`);
      toast.success(`Port ${port} closed`); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function blockIP(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/firewall/block-ip', ipForm);
      toast.success(`IP ${ipForm.ip} blocked`);
      setIpForm({ ip: '' }); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function loadServices() {
    try {
      const { data } = await axios.get<{ name: string; status: string }[]>('/api/stats/services');
      setSvcStatuses(Array.isArray(data) ? data : []);
    } catch {}
  }

  async function controlService(service: string, action: 'start' | 'stop' | 'restart') {
    setSvcLoading(`${service}-${action}`);
    try {
      await axios.post('/api/firewall/service', { service, action });
      toast.success(`${service} ${action}ed`);
      await loadServices();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setSvcLoading(null);
  }

  async function unblockIP(ip: string) {
    try {
      await axios.delete(`/api/firewall/block-ip/${encodeURIComponent(ip)}`);
      toast.success(`IP ${ip} unblocked`); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Firewall</h1>
          <p className="page-subtitle">Manage ports and IP blocking via firewalld</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-full ${
            status?.active ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'
          }`}>
            <div className={`h-1.5 w-1.5 rounded-full ${status?.active ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            {status?.active ? 'Active' : 'Inactive'}
          </div>
          <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
        </div>
      </div>

      {/* Active Services badge row */}
      {(status?.services?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 self-center">Active services:</span>
          {status!.services.map(s => (
            <span key={s} className="badge-blue text-xs">{s}</span>
          ))}
        </div>
      )}

      <div className="tab-bar">
        {([['ports', 'Open Ports', Layers], ['ips', 'IP Blocker', Ban], ['geo', 'Geo Blocking', MapPin], ['ipv6', 'IPv6 Blocks', Wifi], ['services', 'Services', Server]] as const).map(([t, label, Icon]) => (
          <button key={t} onClick={() => { setTab(t as any); if (t === 'services') loadServices(); }}
            className={tab === t ? 'tab-item-active' : 'tab-item'}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'ports' && (
        <div className="space-y-4">
          {/* Quick add from common ports */}
          <div className="card p-4">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Common Ports</p>
            <div className="flex flex-wrap gap-2">
              {KNOWN_PORTS.map(({ port, proto, label }) => {
                const key = `${port}/${proto}`;
                const isOpen = status?.ports.includes(key);
                return (
                  <button key={key}
                    onClick={() => isOpen ? removePort(key) : axios.post('/api/firewall/ports', { port, protocol: proto }).then(load).catch(e => toast.error(e.response?.data?.error))}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-all ${
                      isOpen
                        ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-indigo-300 hover:text-indigo-600'
                    }`}>
                    {label} ({port})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom port form */}
          <form onSubmit={addPort} className="card p-5 max-w-sm space-y-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Open Custom Port</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Port</label>
                <input type="number" className="input" placeholder="8080" min={1} max={65535}
                  value={portForm.port} onChange={e => setPortForm({ ...portForm, port: e.target.value })} required />
              </div>
              <div>
                <label className="label">Protocol</label>
                <select className="input" value={portForm.protocol} onChange={e => setPortForm({ ...portForm, protocol: e.target.value })}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary">
              <Plus size={14} /> Open port
            </button>
          </form>

          {/* Open ports table */}
          {(status?.ports.length ?? 0) > 0 && (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className={theadCls}><tr>
                  <th className="table-header-cell">Port</th>
                  <th className="table-header-cell">Protocol</th>
                  <th className="px-4 py-3 w-12" />
                </tr></thead>
                <tbody>
                  {status!.ports.map(p => {
                    const [port, proto] = p.split('/');
                    const known = KNOWN_PORTS.find(k => k.port === +port && k.proto === proto);
                    return (
                      <tr key={p} className={rowCls}>
                        <td className="table-cell font-mono font-bold text-slate-900 dark:text-slate-100">
                          {port} {known && <span className="text-xs text-slate-400 font-sans ml-1">({known.label})</span>}
                        </td>
                        <td className="table-cell"><span className="badge-blue">{proto.toUpperCase()}</span></td>
                        <td className="px-3 py-3">
                          <button onClick={() => removePort(p)}
                            className="btn-icon opacity-0 group-hover:opacity-100 hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'ips' && (
        <div className="space-y-4">
          <form onSubmit={blockIP} className="card p-5 max-w-sm space-y-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Block IP Address</h2>
            <div>
              <label className="label">IP Address or CIDR</label>
              <input className="input font-mono" placeholder="192.168.1.100 or 10.0.0.0/24"
                value={ipForm.ip} onChange={e => setIpForm({ ip: e.target.value })} required />
            </div>
            <button type="submit" disabled={loading} className="btn-danger">
              <Ban size={14} /> Block IP
            </button>
          </form>

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search IPs…" value={ipSearch} onChange={e => setIpSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className={theadCls}><tr>
                  <th className="table-header-cell">Blocked IP / CIDR</th>
                  <th className="px-4 py-3 w-12" />
                </tr></thead>
                <tbody>
                  {(() => {
                    const blocked = status?.blockedIPs ?? [];
                    const q = ipSearch.trim().toLowerCase();
                    const visible = q ? blocked.filter(ip => ip.toLowerCase().includes(q)) : blocked;
                    if (blocked.length === 0) return (
                      <tr><td colSpan={2} className="px-4 py-16 text-center">
                        <ShieldCheck className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                        <p className="text-slate-400 text-sm">No IPs blocked</p>
                      </td></tr>
                    );
                    if (visible.length === 0) return <tr><td colSpan={2} className="px-4 py-6 text-center text-sm text-slate-400">No IPs match "{ipSearch}"</td></tr>;
                    return visible.map(ip => (
                      <tr key={ip} className={rowCls}>
                        <td className="table-cell">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 rounded-lg bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
                              <Ban size={13} className="text-rose-600 dark:text-rose-400" />
                            </div>
                            <span className="font-mono text-slate-900 dark:text-slate-100">{ip}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={() => unblockIP(ip)}
                            className="btn-icon opacity-0 group-hover:opacity-100 hover:!text-emerald-600 dark:hover:!text-emerald-400 hover:!bg-emerald-50 dark:hover:!bg-emerald-900/30"
                            title="Unblock">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {tab === 'ipv6' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-3 max-w-sm">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Block IPv6 Address</h2>
            <p className="text-xs text-slate-500">Block individual IPv6 addresses or CIDR ranges via firewalld rich rules.</p>
            <div>
              <label className="label">IPv6 Address or CIDR</label>
              <input className="input font-mono" placeholder="2001:db8::1 or 2001:db8::/32"
                value={ipv6Form} onChange={e => setIpv6Form(e.target.value)} />
            </div>
            <button
              disabled={loading || !ipv6Form.trim()}
              className="btn-danger"
              onClick={async () => {
                setLoading(true);
                try {
                  await axios.post('/api/firewall/ipv6-blocks', { address: ipv6Form.trim() });
                  toast.success(`IPv6 ${ipv6Form.trim()} blocked`);
                  setIpv6Form(''); loadIpv6();
                } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
                setLoading(false);
              }}
            ><Wifi size={14} /> Block IPv6</button>
          </div>

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search addresses…" value={ipv6Search} onChange={e => setIpv6Search(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className={theadCls}><tr>
                  <th className="table-header-cell">Blocked IPv6</th>
                  <th className="px-4 py-3 w-12" />
                </tr></thead>
                <tbody>
                  {(() => {
                    const q = ipv6Search.trim().toLowerCase();
                    const visible = q ? ipv6Blocks.filter(a => a.toLowerCase().includes(q)) : ipv6Blocks;
                    if (ipv6Blocks.length === 0) return <tr><td colSpan={2} className="px-4 py-16 text-center text-slate-400 text-sm">No IPv6 addresses blocked</td></tr>;
                    if (visible.length === 0) return <tr><td colSpan={2} className="px-4 py-6 text-center text-sm text-slate-400">No addresses match "{ipv6Search}"</td></tr>;
                    return visible.map(addr => (
                      <tr key={addr} className={rowCls}>
                        <td className="table-cell">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 rounded-lg bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
                              <Wifi size={13} className="text-rose-600 dark:text-rose-400" />
                            </div>
                            <span className="font-mono text-slate-900 dark:text-slate-100">{addr}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={async () => {
                            await axios.delete(`/api/firewall/ipv6-blocks/${encodeURIComponent(addr)}`);
                            toast.success(`${addr} unblocked`); loadIpv6();
                          }} className="btn-icon opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {tab === 'services' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">System Service Control</h2>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Start, stop, or restart core server services</p>
            </div>
            <button onClick={loadServices} className="btn-icon" title="Refresh status"><RefreshCw size={13} /></button>
          </div>
          <table className="w-full text-sm">
            <thead className={theadCls}><tr>
              <th className="table-header-cell">Service</th>
              <th className="table-header-cell">Status</th>
              <th className="px-4 py-3 text-right w-40" />
            </tr></thead>
            <tbody>
              {['httpd', 'mariadb', 'postfix', 'dovecot', 'named', 'vsftpd', 'sshd', 'firewalld'].map(svc => {
                const info = svcStatuses.find(s => s.name === svc || s.name === svc + '.service' || s.name.startsWith(svc));
                const isRunning = info?.status === 'running';
                const busy = svcLoading !== null;
                return (
                  <tr key={svc} className={rowCls}>
                    <td className="table-cell font-mono font-semibold text-slate-900 dark:text-slate-100">{svc}</td>
                    <td className="table-cell">
                      {info
                        ? <span className={`badge ${isRunning ? 'badge-green' : 'badge-red'}`}>{info.status}</span>
                        : <span className="badge-gray text-xs">unknown</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => controlService(svc, 'start')} disabled={busy || isRunning}
                          className="btn-icon hover:!text-emerald-600 hover:!bg-emerald-50 dark:hover:!bg-emerald-900/30 disabled:opacity-30" title="Start">
                          {svcLoading === `${svc}-start`
                            ? <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                            : <Play size={13} />}
                        </button>
                        <button onClick={() => controlService(svc, 'stop')} disabled={busy || !isRunning}
                          className="btn-icon hover:!text-amber-600 hover:!bg-amber-50 dark:hover:!bg-amber-900/30 disabled:opacity-30" title="Stop">
                          {svcLoading === `${svc}-stop`
                            ? <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                            : <Square size={13} />}
                        </button>
                        <button onClick={() => controlService(svc, 'restart')} disabled={busy}
                          className="btn-icon hover:!text-indigo-600 hover:!bg-indigo-50 dark:hover:!bg-indigo-900/30 disabled:opacity-30" title="Restart">
                          {svcLoading === `${svc}-restart`
                            ? <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                            : <RotateCcw size={13} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'geo' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-3 max-w-sm">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Block Country</h2>
            <p className="text-xs text-slate-500">Downloads country IP ranges from ipdeny.com and blocks them via firewalld ipset.</p>
            <div>
              <label className="label">Country Code (ISO 3166-1 alpha-2)</label>
              <input className="input font-mono uppercase" placeholder="CN, RU, KP…" maxLength={2}
                value={geoCode} onChange={e => setGeoCode(e.target.value.toUpperCase())} />
            </div>
            <button
              disabled={loading || geoCode.length !== 2}
              className="btn-danger"
              onClick={async () => {
                setLoading(true);
                try {
                  await axios.post('/api/firewall/geo-blocks', { country_code: geoCode });
                  toast.success(`Country ${geoCode} blocked`); setGeoCode(''); loadGeo();
                } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
                setLoading(false);
              }}
            ><MapPin size={14} /> Block Country</button>
          </div>

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-40 text-sm" placeholder="Filter codes…" value={geoSearch} onChange={e => setGeoSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className={theadCls}><tr>
                  <th className="table-header-cell">Country Code</th>
                  <th className="px-4 py-3 w-12" />
                </tr></thead>
                <tbody>
                  {(() => {
                    const q = geoSearch.trim().toLowerCase();
                    const visible = q ? geoBlocks.filter(c => c.toLowerCase().includes(q)) : geoBlocks;
                    if (geoBlocks.length === 0) return <tr><td colSpan={2} className="px-4 py-16 text-center text-slate-400 text-sm">No countries blocked</td></tr>;
                    if (visible.length === 0) return <tr><td colSpan={2} className="px-4 py-6 text-center text-sm text-slate-400">No codes match "{geoSearch}"</td></tr>;
                    return visible.map(code => (
                      <tr key={code} className={rowCls}>
                        <td className="table-cell">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 rounded-lg bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
                              <MapPin size={13} className="text-rose-600 dark:text-rose-400" />
                            </div>
                            <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{code}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <button onClick={async () => {
                            await axios.delete(`/api/firewall/geo-blocks/${code}`);
                            toast.success(`${code} unblocked`); loadGeo();
                          }} className="btn-icon opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
