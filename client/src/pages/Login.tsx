import { useState, FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { Zap, Server, Shield, Cpu, ShieldCheck } from 'lucide-react';

// Reusable animation style helper
function anim(name: string, duration: string, delay = '0s', easing = 'ease-out') {
  return {
    animation: `${name} ${duration} ${easing} ${delay} both`,
  } as React.CSSProperties;
}

const features = [
  { icon: Server, text: 'Full server management' },
  { icon: Shield, text: 'SSL & domain control' },
  { icon: Cpu,    text: 'Real-time monitoring' },
];

// Individual floating orbs for the left panel background
const orbs = [
  { cls: 'w-[480px] h-[480px] -top-32 -right-32',    color: 'bg-indigo-600/25', anim: 'orb-1 22s ease-in-out infinite' },
  { cls: 'w-[420px] h-[420px] -bottom-28 -left-28',  color: 'bg-violet-600/20', anim: 'orb-2 18s ease-in-out infinite' },
  { cls: 'w-[300px] h-[300px] top-1/3 left-1/4',     color: 'bg-blue-500/15',   anim: 'orb-3 25s ease-in-out infinite' },
  { cls: 'w-[200px] h-[200px] top-20 left-20',       color: 'bg-indigo-400/20', anim: 'orb-4 15s ease-in-out infinite' },
  { cls: 'w-[260px] h-[260px] bottom-20 right-10',   color: 'bg-purple-500/18', anim: 'orb-5 20s ease-in-out infinite' },
];

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totpCode, setTotpCode]   = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password, needsTotp ? totpCode : undefined);
    } catch (err: any) {
      if (err.requires2FA) {
        setNeedsTotp(true);
      } else {
        setError(err.response?.data?.error || 'Login failed — check your credentials');
      }
    } finally {
      setLoading(false);
    }
  }

  function backToCredentials() {
    setNeedsTotp(false);
    setTotpCode('');
    setError('');
  }

  return (
    <div className="min-h-screen flex bg-slate-950 overflow-hidden">

      {/* ── Left decorative panel ─────────────────────────── */}
      <div className="hidden lg:flex w-1/2 flex-col justify-between p-12 bg-gradient-to-br from-indigo-950 via-indigo-900 to-slate-900 relative overflow-hidden">

        {/* Animated floating orbs */}
        {orbs.map((orb, i) => (
          <div
            key={i}
            className={`absolute rounded-full blur-3xl pointer-events-none ${orb.cls} ${orb.color}`}
            style={{ animation: orb.anim }}
          />
        ))}

        {/* Slowly drifting dot grid */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)',
            backgroundSize: '40px 40px',
            animation: 'grid-drift 8s linear infinite',
          }}
        />

        {/* Subtle diagonal gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 via-transparent to-transparent pointer-events-none" />

        {/* Logo — fades up first */}
        <div className="relative" style={anim('fade-up', '0.6s', '0.1s')}>
          <div className="flex items-center gap-3 mb-2">
            {/* Spinning ring around icon */}
            <div className="relative">
              <div
                className="absolute -inset-[2px] rounded-[14px]"
                style={{
                  background: 'conic-gradient(from 0deg, #4f46e5, #818cf8, #a78bfa, #6366f1, #4f46e5)',
                  animation: 'spin-slow 4s linear infinite',
                }}
              />
              {/* Breathing glow behind icon */}
              <div
                className="absolute inset-0 rounded-xl bg-indigo-400 blur-md"
                style={{ animation: 'breathe 3s ease-in-out infinite' }}
              />
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-700 shadow-lg shadow-indigo-950">
                <Zap size={20} className="text-white" strokeWidth={2.5} />
              </div>
            </div>
            <span className="text-xl font-bold text-white tracking-tight">HostPanel</span>
          </div>
          <p className="text-indigo-300/80 text-sm ml-0.5">Professional Web Hosting Control Panel</p>
        </div>

        {/* Main copy */}
        <div className="relative space-y-8">
          <div style={anim('fade-up', '0.7s', '0.25s')}>
            {/* Shimmer headline */}
            <h2
              className="text-4xl font-bold leading-tight"
              style={{
                background: 'linear-gradient(90deg, #fff 0%, #a5b4fc 40%, #fff 60%, #c4b5fd 80%, #fff 100%)',
                backgroundSize: '200% auto',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                animation: 'shimmer 5s linear infinite',
              }}
            >
              Manage your servers<br />with confidence
            </h2>
            <p className="mt-3 text-indigo-300/75 text-sm leading-relaxed max-w-xs" style={anim('fade-up', '0.6s', '0.45s')}>
              A modern, fast alternative to cPanel — built for RHEL, Rocky Linux, and AlmaLinux.
            </p>
          </div>

          <div className="space-y-3">
            {features.map(({ icon: Icon, text }, i) => (
              <div
                key={text}
                className="flex items-center gap-3"
                style={anim('fade-up', '0.5s', `${0.55 + i * 0.1}s`)}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/10">
                  <Icon size={13} className="text-indigo-200" />
                </div>
                <span className="text-sm text-indigo-200/80">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-indigo-600" style={anim('fade-up', '0.5s', '0.9s')}>
          HostPanel v1.0.0 — Open Source
        </p>
      </div>

      {/* ── Right login panel ─────────────────────────────── */}
      <div
        className="flex flex-1 items-center justify-center p-8 bg-slate-950 relative"
        style={anim('slide-from-right', '0.7s', '0.05s', 'cubic-bezier(0.22,1,0.36,1)')}
      >
        {/* Subtle radial glow behind the form */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-[500px] w-[500px] rounded-full bg-indigo-950/60 blur-3xl" />
        </div>

        <div className="relative w-full max-w-sm">

          {/* Mobile logo */}
          <div
            className="flex lg:hidden items-center gap-2.5 mb-8 justify-center"
            style={anim('fade-up', '0.5s', '0.2s')}
          >
            <div className="relative">
              <div
                className="absolute -inset-[2px] rounded-[14px]"
                style={{
                  background: 'conic-gradient(from 0deg, #4f46e5, #818cf8, #a78bfa, #4f46e5)',
                  animation: 'spin-slow 4s linear infinite',
                }}
              />
              <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-700">
                <Zap size={18} className="text-white" strokeWidth={2.5} />
              </div>
            </div>
            <span className="text-xl font-bold text-white">HostPanel</span>
          </div>

          {/* Heading */}
          <div className="mb-8" style={anim('fade-up', '0.55s', '0.35s')}>
            {needsTotp ? (
              <>
                <div className="flex items-center gap-2.5 mb-2">
                  <ShieldCheck size={22} className="text-indigo-400" />
                  <h1 className="text-2xl font-bold text-white">Two-factor auth</h1>
                </div>
                <p className="text-slate-400 mt-1 text-sm">Enter the 6-digit code from your authenticator app</p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-white">Welcome back</h1>
                <p className="text-slate-400 mt-1 text-sm">Sign in to your control panel</p>
              </>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!needsTotp && (
              <>
                {/* Username */}
                <div style={anim('fade-up', '0.5s', '0.45s')}>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">
                    Username
                  </label>
                  <input
                    type="text"
                    className="block w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm
                               text-white placeholder-slate-500 shadow-sm
                               focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30
                               hover:border-slate-600 transition-all duration-200"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="admin"
                    required
                    autoFocus
                  />
                </div>

                {/* Password */}
                <div style={anim('fade-up', '0.5s', '0.55s')}>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">
                    Password
                  </label>
                  <input
                    type="password"
                    className="block w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm
                               text-white placeholder-slate-500 shadow-sm
                               focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30
                               hover:border-slate-600 transition-all duration-200"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
              </>
            )}

            {needsTotp && (
              <div style={anim('fade-up', '0.4s', '0s')}>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">
                  Authentication Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  className="block w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm
                             text-white placeholder-slate-500 shadow-sm text-center tracking-[0.5em] font-mono text-lg
                             focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30
                             hover:border-slate-600 transition-all duration-200"
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  required
                  autoFocus
                />
              </div>
            )}

            {error && (
              <div
                className="rounded-lg bg-rose-950/60 border border-rose-800/60 text-rose-300 px-4 py-3 text-sm"
                style={anim('fade-up', '0.3s')}
              >
                {error}
              </div>
            )}

            {/* Submit button */}
            <div style={anim('fade-up', '0.5s', '0.65s')}>
              <button
                type="submit"
                disabled={loading || (needsTotp && totpCode.length !== 6)}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 mt-2
                           text-sm font-semibold text-white
                           shadow-lg shadow-indigo-950/60
                           hover:bg-indigo-500 hover:shadow-indigo-900/60 hover:-translate-y-px
                           active:bg-indigo-700 active:translate-y-0
                           focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-950
                           disabled:opacity-50 disabled:pointer-events-none
                           transition-all duration-150"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    {needsTotp ? 'Verifying…' : 'Signing in…'}
                  </>
                ) : needsTotp ? 'Verify' : 'Sign in'}
              </button>
              {needsTotp && (
                <button
                  type="button"
                  className="w-full mt-2 text-sm text-slate-500 hover:text-slate-300 transition-colors"
                  onClick={backToCredentials}
                >
                  ← Back
                </button>
              )}
            </div>
          </form>

          {/* Bottom hint */}
          <p
            className="text-center text-xs text-slate-600 mt-8"
            style={anim('fade-up', '0.5s', '0.75s')}
          >
            Default credentials: <span className="text-slate-500">admin / admin</span>
          </p>
        </div>
      </div>
    </div>
  );
}
