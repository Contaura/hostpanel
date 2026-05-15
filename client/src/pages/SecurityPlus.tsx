import { useState, useEffect } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { Shield, Key, Lock, Plus, Trash2, Eye, EyeOff, QrCode, CheckCircle, Search } from 'lucide-react';

type Tab = 'password' | '2fa' | 'whitelist';

function token() { return localStorage.getItem('hp_token') || ''; }
const auth = () => ({ Authorization: 'Bearer ' + token() });
const api   = (p: string) => axios.get(p, { headers: auth() });
const apost = (p: string, d: any) => axios.post(p, d, { headers: auth() });
const adel  = (p: string) => axios.delete(p, { headers: auth() });

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

export default function SecurityPlus() {
  const { success, error } = useToast();
  const [tab, setTab] = useState<Tab>('password');

  // Password
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  // 2FA
  const [tfaStatus, setTfaStatus] = useState<{ enabled: boolean; configured: boolean } | null>(null);
  const [tfaSetup, setTfaSetup]   = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [tfaCode, setTfaCode]     = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [backupCodesInfo, setBackupCodesInfo] = useState<{ count: number; has_codes: boolean } | null>(null);

  // IP Whitelist
  const [whitelist, setWhitelist] = useState<{ id: number; ip: string; label: string; created_at: string }[]>([]);
  const [newIp, setNewIp]         = useState('');
  const [newLabel, setNewLabel]   = useState('');
  const [wlSearch, setWlSearch]   = useState('');
  const [removingIp, setRemovingIp] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => { loadTab(tab); setPageLoading(false); }, [tab]);

  function loadTab(t: Tab) {
    if (t === '2fa') {
      api('/api/security-extra/2fa').then(r => setTfaStatus(r.data)).catch(() => {});
      api('/api/security-extra/2fa/backup-codes').then(r => setBackupCodesInfo(r.data)).catch(() => {});
    }
    if (t === 'whitelist') api('/api/security-extra/ip-whitelist').then(r => setWhitelist(r.data)).catch(() => {});
  }

  async function changePassword() {
    if (!pwForm.currentPassword || !pwForm.newPassword) { error('All fields required'); return; }
    if (pwForm.newPassword !== pwForm.confirm) { error('Passwords do not match'); return; }
    if (pwForm.newPassword.length < 8) { error('Password must be at least 8 characters'); return; }
    setPwLoading(true);
    try {
      await apost('/api/security-extra/change-password', { currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      success('Password updated successfully');
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (e: any) { error(e.response?.data?.error || 'Failed to change password'); }
    setPwLoading(false);
  }

  async function setup2FA() {
    try { const r = await apost('/api/security-extra/2fa/setup', {}); setTfaSetup(r.data); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function verify2FA() {
    if (!tfaCode || tfaCode.length !== 6) { error('Enter the 6-digit code'); return; }
    try { await apost('/api/security-extra/2fa/verify', { token: tfaCode }); success('2FA enabled!'); setTfaSetup(null); setTfaCode(''); loadTab('2fa'); }
    catch (e: any) { error(e.response?.data?.error || 'Invalid code'); }
  }

  async function disable2FA() {
    try { await adel('/api/security-extra/2fa'); success('2FA disabled'); loadTab('2fa'); }
    catch (e: any) { error('Failed'); }
  }

  async function generateBackupCodes() {
    try { const r = await apost('/api/security-extra/2fa/backup-codes', {}); setBackupCodes(r.data.codes); loadTab('2fa'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function addToWhitelist() {
    if (!newIp || !IP_RE.test(newIp)) { error('Enter a valid IP address or CIDR'); return; }
    try { await apost('/api/security-extra/ip-whitelist', { ip: newIp, label: newLabel }); success('IP added'); setNewIp(''); setNewLabel(''); loadTab('whitelist'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function removeIp(id: number) {
    setRemovingIp(id);
    try { await adel(`/api/security-extra/ip-whitelist/${id}`); success('Removed'); loadTab('whitelist'); }
    catch (e: any) { error('Failed'); }
    finally { setRemovingIp(null); }
  }

  const tabs = [
    { id: 'password' as Tab, label: 'Change Password', icon: Lock },
    { id: '2fa'      as Tab, label: 'Two-Factor Auth',  icon: Shield },
    { id: 'whitelist' as Tab, label: 'IP Whitelist',    icon: Key },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="page-title">Security</h1>
        <p className="page-subtitle">Manage admin password, two-factor authentication, and IP access restrictions</p>
      </div>

      {pageLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-5 w-5 rounded-full border-2 border-indigo-500 border-t-transparent" />
        </div>
      ) : (
      <>

      <div className="tab-bar">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? 'tab-item-active' : 'tab-item'}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Change Password */}
      {tab === 'password' && (
        <div className="card p-5 max-w-md space-y-4">
          <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Change Admin Password</h3>
          <div>
            <label className="label">Current Password</label>
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} className="input pr-10" value={pwForm.currentPassword} onChange={e => setPwForm(p => ({ ...p, currentPassword: e.target.value }))} />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowPw(!showPw)}>{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </div>
          <div>
            <label className="label">New Password</label>
            <input type={showPw ? 'text' : 'password'} className="input" value={pwForm.newPassword} onChange={e => setPwForm(p => ({ ...p, newPassword: e.target.value }))} />
          </div>
          <div>
            <label className="label">Confirm New Password</label>
            <input type={showPw ? 'text' : 'password'} className="input" value={pwForm.confirm} onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} />
          </div>
          <button className="btn-primary w-full" onClick={changePassword} disabled={pwLoading}>
            {pwLoading ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      )}

      {/* 2FA */}
      {tab === '2fa' && (
        <div className="card p-5 max-w-md space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={18} className="text-indigo-500" />
            <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Two-Factor Authentication (TOTP)</h3>
          </div>

          {tfaStatus?.enabled && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-emerald-700 dark:text-emerald-400 text-sm">
              <CheckCircle size={16} /> 2FA is currently enabled
            </div>
          )}
          {!tfaStatus?.enabled && (
            <p className="text-sm text-slate-500">2FA is currently disabled. Enable it to require a one-time code at login.</p>
          )}

          {!tfaSetup && !tfaStatus?.enabled && (
            <button className="btn-primary" onClick={setup2FA}><QrCode size={14} /> Set Up 2FA</button>
          )}

          {tfaSetup && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">Scan this QR code with Google Authenticator or Authy:</p>
              <img src={tfaSetup.qrDataUrl} alt="QR Code" className="w-48 h-48 rounded border border-slate-200" />
              <p className="text-xs text-slate-500">Manual code: <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">{tfaSetup.secret}</code></p>
              <div className="flex gap-2">
                <input className="input flex-1" maxLength={6} placeholder="Enter 6-digit code" value={tfaCode} onChange={e => setTfaCode(e.target.value.replace(/\D/g, ''))} onKeyDown={e => e.key === 'Enter' && verify2FA()} />
                <button className="btn-primary" onClick={verify2FA}>Verify & Enable</button>
              </div>
            </div>
          )}

          {tfaStatus?.enabled && (
            <div className="space-y-3">
              <button className="btn-danger" onClick={disable2FA}>Disable 2FA</button>
              <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium">Backup Codes</p>
                    <p className="text-xs text-slate-500">{backupCodesInfo?.has_codes ? `${backupCodesInfo.count} codes stored` : 'No backup codes generated'}</p>
                  </div>
                  <button className="btn-secondary text-xs" onClick={generateBackupCodes}>Regenerate</button>
                </div>
                {backupCodes && (
                  <div className="bg-slate-900 rounded-lg p-3 space-y-1">
                    <p className="text-xs text-amber-400 mb-2">Save these codes — they won't be shown again.</p>
                    <div className="grid grid-cols-2 gap-1">
                      {backupCodes.map(c => <code key={c} className="text-xs font-mono text-emerald-400 bg-slate-800 px-2 py-1 rounded">{c}</code>)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* IP Whitelist */}
      {tab === 'whitelist' && (
        <div className="space-y-4">
          <div className="card p-4">
            <p className="text-xs text-slate-500 mb-3">When IPs are added here, only these addresses can access the admin panel. Leave empty to allow all.</p>
            <div className="flex gap-3">
              <input className="input flex-1" placeholder="192.168.1.0/24" value={newIp} onChange={e => setNewIp(e.target.value)} />
              <input className="input w-48" placeholder="Label (optional)" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
              <button className="btn-primary" onClick={addToWhitelist}><Plus size={14} /> Add</button>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search IPs…" value={wlSearch} onChange={e => setWlSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th className="table-header-cell">IP / CIDR</th><th className="table-header-cell">Label</th><th className="table-header-cell">Added</th><th className="table-header-cell w-16"></th></tr></thead>
                <tbody>
                  {(() => {
                    const q = wlSearch.trim().toLowerCase();
                    const visible = q ? whitelist.filter(ip => [ip.ip, ip.label].some(v => String(v ?? '').toLowerCase().includes(q))) : whitelist;
                    if (whitelist.length === 0) return <tr><td colSpan={4} className="table-cell text-slate-400 text-center py-8">No IP restrictions — all IPs are allowed</td></tr>;
                    if (visible.length === 0) return <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No IPs match "{wlSearch}"</td></tr>;
                    return visible.map(ip => (
                      <tr key={ip.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="table-cell font-mono text-xs">{ip.ip}</td>
                        <td className="table-cell text-slate-600 dark:text-slate-400">{ip.label || '—'}</td>
                        <td className="table-cell text-slate-400">{ip.created_at?.slice(0, 10)}</td>
                        <td className="table-cell"><button className="btn-icon text-red-500" disabled={removingIp === ip.id} onClick={() => removeIp(ip.id)}><Trash2 size={14} /></button></td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
