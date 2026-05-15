import { useEffect, useState } from 'react';
import { RefreshCw, Shield, Ban, FileText, Power, Search } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/waf${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

export default function WafManager() {
  const toast = useToast();
  const [waf, setWaf] = useState<any>(null);
  const [f2b, setF2b] = useState<any>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [jailDetail, setJailDetail] = useState<Record<string, any>>({});
  const [togglingJail, setTogglingJail] = useState<string | null>(null);
  const [tab, setTab] = useState<'modsec' | 'fail2ban' | 'rules'>('modsec');
  const [unbanIp, setUnbanIp] = useState('');
  const [banJail, setBanJail] = useState('');
  const [banIp, setBanIp] = useState('');
  const [ruleSearch, setRuleSearch] = useState('');

  async function load() {
    const [w, f] = await Promise.all([api('/modsec').then(r => r.json()), api('/fail2ban').then(r => r.json())]);
    setWaf(w); setF2b(f);
  }

  async function loadRules() {
    if (rulesLoaded) return;
    const r = await api('/modsec/rules');
    setRules(await r.json());
    setRulesLoaded(true);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (tab === 'rules') loadRules(); }, [tab]);

  async function setWafMode(mode: string) {
    const r = await api('/modsec', { method: 'PUT', body: JSON.stringify({ mode }) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success(`ModSecurity set to ${mode}`); load(); }
  }

  async function loadJail(name: string) {
    if (jailDetail[name]) return;
    const r = await api(`/fail2ban/${name}`);
    const data = await r.json();
    setJailDetail(j => ({ ...j, [name]: data }));
  }

  async function toggleJail(name: string, currentlyRunning: boolean) {
    setTogglingJail(name);
    const r = await api(`/fail2ban/${name}/toggle`, { method: 'POST', body: JSON.stringify({ action: currentlyRunning ? 'stop' : 'start' }) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success(`Jail ${name} ${currentlyRunning ? 'stopped' : 'started'}`); load(); }
    setTogglingJail(null);
  }

  async function ban() {
    const r = await api('/fail2ban/ban', { method: 'POST', body: JSON.stringify({ jail: banJail, ip: banIp }) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success(`Banned ${banIp}`); setBanIp(''); load(); }
  }

  async function unban() {
    const r = await api('/fail2ban/unban', { method: 'POST', body: JSON.stringify({ jail: f2b?.jails?.[0] || 'sshd', ip: unbanIp }) });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else { toast.success(`Unbanned ${unbanIp}`); setUnbanIp(''); load(); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">WAF & Intrusion Prevention</h1>
        <button className="btn-ghost" onClick={load}><RefreshCw size={14} /></button>
      </div>

      <div className="tab-bar">
        <button className={`tab-item ${tab === 'modsec' ? 'tab-item-active' : ''}`} onClick={() => setTab('modsec')}><Shield size={13} /> ModSecurity WAF</button>
        <button className={`tab-item ${tab === 'fail2ban' ? 'tab-item-active' : ''}`} onClick={() => setTab('fail2ban')}><Ban size={13} /> Fail2Ban</button>
        <button className={`tab-item ${tab === 'rules' ? 'tab-item-active' : ''}`} onClick={() => setTab('rules')}><FileText size={13} /> Rule Files</button>
      </div>

      {tab === 'modsec' && waf && (
        <div className="space-y-4">
          <div className="card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield size={16} className={waf.installed ? 'text-emerald-500' : 'text-slate-400'} />
              <span className="font-medium text-sm">ModSecurity {waf.installed ? 'Installed' : 'Not Installed'}</span>
              {waf.mode && <span className={`badge-${waf.mode === 'On' ? 'success' : waf.mode === 'DetectionOnly' ? 'warning' : 'danger'}`}>{waf.mode}</span>}
            </div>
          </div>

          {waf.installed && (
            <div className="card space-y-3">
              <p className="text-sm font-medium">Engine Mode</p>
              <div className="flex gap-2">
                {['On', 'DetectionOnly', 'Off'].map(mode => (
                  <button
                    key={mode}
                    className={waf.mode === mode ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
                    onClick={() => setWafMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                <strong>On</strong> — block malicious requests &nbsp;|&nbsp;
                <strong>DetectionOnly</strong> — log only, no blocking &nbsp;|&nbsp;
                <strong>Off</strong> — disabled
              </p>
            </div>
          )}
          {!waf.installed && <p className="text-sm text-slate-500">Install ModSecurity via: <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">dnf install mod_security</code></p>}
        </div>
      )}

      {tab === 'rules' && (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">ModSecurity Rule Files</p>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input className="input pl-8 w-48 text-sm" placeholder="Search rules…" value={ruleSearch} onChange={e => setRuleSearch(e.target.value)} />
                </div>
                <button className="btn-secondary text-xs" onClick={() => { setRulesLoaded(false); loadRules(); }}><RefreshCw size={12} /> Reload</button>
              </div>
            </div>
            {(() => {
              if (rules.length === 0) return (
                <div className="p-8 text-center text-slate-400 text-sm">
                  <FileText size={28} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                  No rule files found
                </div>
              );
              const q = ruleSearch.trim().toLowerCase();
              const visible = q ? rules.filter((r: any) => r.name.toLowerCase().includes(q) || r.file.toLowerCase().includes(q)) : rules;
              if (visible.length === 0) return (
                <div className="p-8 text-center text-slate-400 text-sm">No rules match "{ruleSearch}"</div>
              );
              return (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700">
                    <tr>
                      <th className="table-header-cell">Rule File</th>
                      <th className="table-header-cell">Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r: any, i: number) => (
                      <tr key={i} className="border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                        <td className="table-cell font-mono text-xs font-medium">{r.name}</td>
                        <td className="table-cell font-mono text-xs text-slate-500 truncate max-w-xs">{r.file}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
          <p className="text-xs text-slate-400">Rule files are loaded from the ModSecurity rules directory. {rules.length > 0 && `${rules.length} file${rules.length !== 1 ? 's' : ''} found.`}</p>
        </div>
      )}

      {tab === 'fail2ban' && f2b && (
        <div className="space-y-4">
          <div className="card flex items-center gap-2">
            <Ban size={16} className={f2b.running ? 'text-emerald-500' : 'text-red-500'} />
            <span className="font-medium text-sm">Fail2Ban {f2b.running ? 'Running' : 'Stopped'}</span>
          </div>

          {/* Quick ban/unban */}
          <div className="card grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Ban IP</p>
              <div className="flex gap-2">
                <select className="input text-sm" value={banJail} onChange={e => setBanJail(e.target.value)}>
                  <option value="">Select jail</option>
                  {(f2b.jails || []).map((j: string) => <option key={j} value={j}>{j}</option>)}
                </select>
                <input className="input flex-1" placeholder="1.2.3.4" value={banIp} onChange={e => setBanIp(e.target.value)} />
                <button className="btn-danger text-sm" onClick={ban}>Ban</button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Unban IP</p>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="1.2.3.4" value={unbanIp} onChange={e => setUnbanIp(e.target.value)} />
                <button className="btn-secondary text-sm" onClick={unban}>Unban</button>
              </div>
            </div>
          </div>

          {/* Jails */}
          <div className="space-y-2">
            {(f2b.jails || []).map((jail: string) => {
              const detail = jailDetail[jail];
              const isRunning = f2b.running;
              return (
                <div key={jail} className="card">
                  <div className="flex items-center justify-between">
                    <button
                      className="flex items-center gap-2 text-sm font-medium flex-1 text-left"
                      onClick={() => { loadJail(jail); setJailDetail(j => ({ ...j, [jail]: j[jail] === undefined ? null : j[jail] })); }}
                    >
                      <span>{jail}</span>
                      <span className="text-slate-400 text-xs">Click to expand</span>
                    </button>
                    <button
                      onClick={() => toggleJail(jail, isRunning)}
                      disabled={togglingJail === jail}
                      className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-colors ${isRunning ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100'}`}
                      title={isRunning ? 'Stop jail' : 'Start jail'}
                    >
                      <Power size={11} />
                      {togglingJail === jail ? '…' : isRunning ? 'Stop' : 'Start'}
                    </button>
                  </div>
                  {detail && (
                    <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                      <div className="bg-slate-50 dark:bg-slate-800 rounded p-2"><p className="text-slate-500">Currently Banned</p><p className="font-bold text-lg">{detail.currently_banned ?? '—'}</p></div>
                      <div className="bg-slate-50 dark:bg-slate-800 rounded p-2"><p className="text-slate-500">Total Banned</p><p className="font-bold text-lg">{detail.total_banned ?? '—'}</p></div>
                      <div className="bg-slate-50 dark:bg-slate-800 rounded p-2"><p className="text-slate-500">Failed Attempts</p><p className="font-bold text-lg">{detail.currently_failed ?? '—'}</p></div>
                      {detail.banned_ips?.length > 0 && (
                        <div className="col-span-3">
                          <p className="text-slate-500 mb-1">Banned IPs</p>
                          <div className="flex flex-wrap gap-1">
                            {detail.banned_ips.map((ip: string) => (
                              <span key={ip} className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded text-xs font-mono">{ip}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
