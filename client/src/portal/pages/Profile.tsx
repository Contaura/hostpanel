import { useEffect, useState } from 'react';
import { KeyRound, Lock, Shield, CheckCircle } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, adel } from '../api';
import { usePortalAuth } from '../PortalAuthContext';
import { PageTitle } from '../components';

export default function Profile() {
  const toast = useToast();
  const confirm = useConfirm();
  const { client } = usePortalAuth();

  const [pwForm, setPwForm]   = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwBusy, setPwBusy]   = useState(false);

  const [totpStatus, setTotpStatus]   = useState<{ enabled: boolean } | null>(null);
  const [totpSetup, setTotpSetup]     = useState<{ qr: string; secret: string } | null>(null);
  const [totpCode, setTotpCode]       = useState('');
  const [totpLoading, setTotpLoading] = useState(false);

  useEffect(() => { loadTotp(); }, []);
  async function loadTotp() {
    try { const r = await api<{ enabled: boolean }>('/api/portal/totp'); setTotpStatus(r.data); }
    catch { setTotpStatus({ enabled: false }); }
  }

  async function changePassword() {
    if (!pwForm.currentPassword || !pwForm.newPassword) return toast.error('Both fields are required');
    if (pwForm.newPassword.length < 8) return toast.error('New password must be at least 8 characters');
    if (pwForm.newPassword !== pwForm.confirmPassword) return toast.error('Passwords do not match');
    setPwBusy(true);
    try {
      await apost('/api/portal/change-password', { currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      toast.success('Password updated');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setPwBusy(false);
  }

  async function startTotpSetup() {
    setTotpLoading(true);
    try { const r = await apost<{ qr: string; secret: string }>('/api/portal/totp/setup'); setTotpSetup(r.data); setTotpCode(''); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Setup failed'); }
    setTotpLoading(false);
  }

  async function verifyTotp() {
    if (totpCode.length !== 6) return;
    setTotpLoading(true);
    try {
      await apost('/api/portal/totp/verify', { token: totpCode });
      toast.success('2FA enabled successfully');
      setTotpSetup(null); setTotpCode(''); loadTotp();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Invalid code'); }
    setTotpLoading(false);
  }

  async function disableTotp() {
    if (!await confirm('Disable two-factor authentication? This will reduce your account security.')) return;
    setTotpLoading(true);
    try { await adel('/api/portal/totp'); toast.success('2FA disabled'); loadTotp(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setTotpLoading(false);
  }

  return (
    <div className="max-w-2xl">
      <PageTitle title="Profile & Security" subtitle="Account details, password, and two-factor authentication." />

      {client && (
        <div className="card p-5 mb-4 text-sm">
          <p className="font-semibold mb-2">Account details</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-xs text-slate-500">Name</div><div className="font-medium">{client.name}</div></div>
            <div><div className="text-xs text-slate-500">Email</div><div className="font-medium">{client.email}</div></div>
            {client.company && <div><div className="text-xs text-slate-500">Company</div><div className="font-medium">{client.company}</div></div>}
            {client.phone   && <div><div className="text-xs text-slate-500">Phone</div><div className="font-medium">{client.phone}</div></div>}
          </div>
        </div>
      )}

      <div className="card p-5 mb-4 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound size={15} className="text-slate-500" />
          <h2 className="font-semibold text-sm">Change password</h2>
        </div>
        <p className="text-xs text-slate-500">Rotate your portal password. Requires your current password.</p>
        <input type="password" className="input" placeholder="Current password" value={pwForm.currentPassword} onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))} />
        <input type="password" className="input" placeholder="New password (min 8 chars)" value={pwForm.newPassword} onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))} />
        <input type="password" className="input" placeholder="Confirm new password" value={pwForm.confirmPassword} onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))} />
        <button className="btn-primary text-sm" onClick={changePassword} disabled={pwBusy || !pwForm.currentPassword || !pwForm.newPassword}>
          {pwBusy ? 'Updating…' : 'Update password'}
        </button>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Lock size={15} className="text-slate-500" />
          <h2 className="font-semibold text-sm">Two-factor authentication</h2>
          {totpStatus?.enabled && <span className="badge-success text-xs ml-auto">Enabled</span>}
        </div>

        {totpStatus === null && <p className="text-sm text-slate-400">Loading…</p>}

        {totpStatus && !totpStatus.enabled && !totpSetup && (
          <>
            <p className="text-sm text-slate-500">Add an extra layer of security using an authenticator app.</p>
            <button className="btn-primary text-sm" onClick={startTotpSetup} disabled={totpLoading}>
              <Shield size={13} /> {totpLoading ? 'Setting up…' : 'Enable 2FA'}
            </button>
          </>
        )}

        {totpSetup && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">Scan the QR code with your authenticator app, then enter the 6-digit code to confirm.</p>
            {totpSetup.qr && (
              <div className="flex justify-center">
                <img src={totpSetup.qr} alt="2FA QR Code" className="w-40 h-40 rounded-lg border border-slate-200 dark:border-slate-700" />
              </div>
            )}
            <div>
              <label className="label">Manual entry key</label>
              <code className="block text-xs font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded break-all">{totpSetup.secret}</code>
            </div>
            <div>
              <label className="label">Verification code</label>
              <input
                className="input font-mono text-center text-lg tracking-widest w-40"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && verifyTotp()}
              />
            </div>
            <div className="flex gap-2">
              <button className="btn-primary text-sm" onClick={verifyTotp} disabled={totpLoading || totpCode.length !== 6}>
                {totpLoading ? 'Verifying…' : 'Verify & enable'}
              </button>
              <button className="btn-secondary text-sm" onClick={() => { setTotpSetup(null); setTotpCode(''); }}>Cancel</button>
            </div>
          </div>
        )}

        {totpStatus?.enabled && !totpSetup && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm">
              <CheckCircle size={14} />
              <span>Two-factor authentication is active on your account.</span>
            </div>
            <button className="btn-secondary text-sm text-rose-600 hover:!text-rose-700" onClick={disableTotp} disabled={totpLoading}>
              {totpLoading ? 'Disabling…' : 'Disable 2FA'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
