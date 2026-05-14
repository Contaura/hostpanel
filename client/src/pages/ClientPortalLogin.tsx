import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Zap, Eye, EyeOff, Shield } from 'lucide-react';

export default function ClientPortalLogin() {
  const navigate = useNavigate();
  const [form, setForm]     = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode]   = useState('');

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const r = await axios.post('/api/portal/login', form);
      if (r.data.requires_2fa) {
        setTempToken(r.data.temp_token);
      } else {
        localStorage.setItem('hp_portal_token', r.data.token);
        localStorage.setItem('hp_portal_name', r.data.name);
        navigate('/portal');
      }
    } catch (e: any) {
      setErr(e.response?.data?.error || 'Login failed');
    }
    setLoading(false);
  }

  async function verifyTotp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr('');
    try {
      const r = await axios.post('/api/portal/login/totp', { temp_token: tempToken, code: totpCode });
      localStorage.setItem('hp_portal_token', r.data.token);
      localStorage.setItem('hp_portal_name', r.data.name);
      navigate('/portal');
    } catch (e: any) {
      setErr(e.response?.data?.error || 'Invalid code');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
      <div className="w-full max-w-sm px-4">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-900/50 mb-4">
            <Zap size={22} className="text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold text-white">Client Portal</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in to view your invoices</p>
        </div>

        {!tempToken ? (
          <form onSubmit={login} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
            {err && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">{err}</div>}

            <div>
              <label className="label">Email Address</label>
              <input type="email" className="input" autoComplete="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required />
            </div>

            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} className="input pr-10" autoComplete="current-password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setShowPw(!showPw)}>{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
            </div>

            <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <p className="text-xs text-center text-slate-400">
              Don't have access? Contact your hosting provider.
            </p>
          </form>
        ) : (
          <form onSubmit={verifyTotp} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
            {err && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">{err}</div>}

            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-2">
              <Shield size={18} /> <span className="font-semibold text-sm">Two-Factor Authentication</span>
            </div>
            <p className="text-sm text-slate-500">Enter the 6-digit code from your authenticator app.</p>

            <div>
              <label className="label">Authentication Code</label>
              <input className="input text-center font-mono text-lg tracking-widest" maxLength={6} placeholder="000000"
                value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </div>

            <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading || totpCode.length !== 6}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>

            <button type="button" className="text-xs text-slate-400 hover:text-slate-600 w-full text-center" onClick={() => { setTempToken(''); setTotpCode(''); setErr(''); }}>
              Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
