import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { ShieldCheck, Plus, Trash2, Globe, Layers, Ban, RefreshCw } from 'lucide-react';
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
  const [tab, setTab] = useState<'ports' | 'ips'>('ports');
  const [status, setStatus] = useState<FirewallStatus | null>(null);
  const [portForm, setPortForm] = useState({ port: '', protocol: 'tcp' });
  const [ipForm, setIpForm] = useState({ ip: '' });
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const { data } = await axios.get<FirewallStatus>('/api/firewall/status');
      setStatus(data);
    } catch (err: any) { toast.error('Failed to load firewall status'); }
  }
  useEffect(() => { load(); }, []);

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
        {([['ports', 'Open Ports', Layers], ['ips', 'IP Blocker', Ban]] as const).map(([t, label, Icon]) => (
          <button key={t} onClick={() => setTab(t)}
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

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className={theadCls}><tr>
                <th className="table-header-cell">Blocked IP / CIDR</th>
                <th className="px-4 py-3 w-12" />
              </tr></thead>
              <tbody>
                {(status?.blockedIPs.length ?? 0) === 0 ? (
                  <tr><td colSpan={2} className="px-4 py-16 text-center">
                    <ShieldCheck className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                    <p className="text-slate-400 text-sm">No IPs blocked</p>
                  </td></tr>
                ) : status!.blockedIPs.map(ip => (
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
