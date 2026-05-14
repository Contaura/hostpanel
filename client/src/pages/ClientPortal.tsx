import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Zap, LogOut, FileText, Download, CreditCard, ExternalLink, CheckCircle, Clock, AlertCircle, Shield, QrCode, Lock } from 'lucide-react';

interface Invoice { id: number; invoice_number: string; amount: number; currency: string; status: string; due_date: string; paid_date: string; created_at: string; account_domain: string; notes: string }

function portalAuth() { return { Authorization: 'Bearer ' + (localStorage.getItem('hp_portal_token') || '') }; }
const api   = (p: string) => axios.get(p, { headers: portalAuth() });
const apost = (p: string, d?: any) => axios.post(p, d || {}, { headers: portalAuth() });
const adel  = (p: string) => axios.delete(p, { headers: portalAuth() });

const STATUS_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  paid:      { icon: CheckCircle, color: 'text-emerald-500', label: 'Paid' },
  unpaid:    { icon: Clock,       color: 'text-amber-500',   label: 'Unpaid' },
  overdue:   { icon: AlertCircle, color: 'text-red-500',     label: 'Overdue' },
  cancelled: { icon: AlertCircle, color: 'text-slate-400',   label: 'Cancelled' },
};

export default function ClientPortal() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'invoices' | 'security'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [client, setClient]     = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [payingId, setPayingId] = useState<number | null>(null);

  // 2FA state
  const [totpStatus, setTotpStatus]     = useState<{ enabled: boolean } | null>(null);
  const [totpSetup, setTotpSetup]       = useState<{ qr: string; secret: string } | null>(null);
  const [totpCode, setTotpCode]         = useState('');
  const [totpLoading, setTotpLoading]   = useState(false);

  const portalName = localStorage.getItem('hp_portal_name') || 'Client';

  useEffect(() => {
    const tk = localStorage.getItem('hp_portal_token');
    if (!tk) { navigate('/portal/login'); return; }
    load();

    const payment = params.get('payment');
    if (payment === 'success') setToast({ type: 'success', msg: 'Payment successful! Your invoice has been marked as paid.' });
    if (payment === 'cancelled') setToast({ type: 'error', msg: 'Payment was cancelled.' });
  }, []);

  useEffect(() => { if (tab === 'security') loadTotpStatus(); }, [tab]);

  async function load() {
    setLoading(true);
    try {
      const [iRes, cRes] = await Promise.all([api('/api/portal/invoices'), api('/api/portal/me')]);
      setInvoices(iRes.data); setClient(cRes.data);
    } catch { navigate('/portal/login'); }
    setLoading(false);
  }

  async function loadTotpStatus() {
    try { const r = await api('/api/portal/totp'); setTotpStatus(r.data); }
    catch { setTotpStatus(null); }
  }

  async function startTotpSetup() {
    setTotpLoading(true);
    try { const r = await apost('/api/portal/totp/setup'); setTotpSetup(r.data); setTotpCode(''); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Setup failed' }); }
    setTotpLoading(false);
  }

  async function verifyTotp() {
    if (totpCode.length !== 6) return;
    setTotpLoading(true);
    try {
      await apost('/api/portal/totp/verify', { token: totpCode });
      setToast({ type: 'success', msg: '2FA enabled successfully' });
      setTotpSetup(null); setTotpCode(''); loadTotpStatus();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Invalid code' }); }
    setTotpLoading(false);
  }

  async function disableTotp() {
    if (!confirm('Disable two-factor authentication? This will reduce your account security.')) return;
    setTotpLoading(true);
    try {
      await adel('/api/portal/totp');
      setToast({ type: 'success', msg: '2FA disabled' });
      loadTotpStatus();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setTotpLoading(false);
  }

  async function payStripe(invoice: Invoice) {
    setPayingId(invoice.id);
    try {
      const r = await axios.post('/api/stripe/checkout', { invoice_id: invoice.id });
      window.location.href = r.data.url;
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Payment failed' }); }
    setPayingId(null);
  }

  async function payPayPal(invoice: Invoice) {
    setPayingId(invoice.id);
    try {
      const r = await axios.post('/api/paypal/checkout', { invoice_id: invoice.id });
      window.location.href = r.data.url;
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'PayPal not configured' }); }
    setPayingId(null);
  }

  function logout() { localStorage.removeItem('hp_portal_token'); localStorage.removeItem('hp_portal_name'); navigate('/portal/login'); }

  const totalDue = invoices.filter(i => ['unpaid', 'overdue'].includes(i.status)).reduce((s, i) => s + i.amount, 0);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-indigo-600">
            <Zap size={15} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-slate-900 dark:text-white">Client Portal</span>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-1">
            <button onClick={() => setTab('invoices')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'invoices' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              <FileText size={13} className="inline mr-1" />Invoices
            </button>
            <button onClick={() => setTab('security')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'security' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              <Shield size={13} className="inline mr-1" />Security
            </button>
          </nav>
          <span className="text-sm text-slate-600 dark:text-slate-400">{portalName}</span>
          <button className="btn-ghost text-slate-500" onClick={logout}><LogOut size={15} /> Logout</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Toast */}
        {toast && (
          <div className={`p-4 rounded-xl border flex items-start gap-3 ${toast.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'}`}>
            {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span className="text-sm">{toast.msg}</span>
            <button className="ml-auto text-xs opacity-60 hover:opacity-100" onClick={() => setToast(null)}>✕</button>
          </div>
        )}

        {tab === 'invoices' && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="card p-4 text-center">
                <div className="text-2xl font-bold text-slate-900 dark:text-white">{invoices.length}</div>
                <div className="text-xs text-slate-500 mt-1">Total Invoices</div>
              </div>
              <div className="card p-4 text-center">
                <div className="text-2xl font-bold text-emerald-600">{invoices.filter(i => i.status === 'paid').length}</div>
                <div className="text-xs text-slate-500 mt-1">Paid</div>
              </div>
              <div className="card p-4 text-center">
                <div className={`text-2xl font-bold ${totalDue > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                  {invoices[0]?.currency || 'USD'} {totalDue.toFixed(2)}
                </div>
                <div className="text-xs text-slate-500 mt-1">Balance Due</div>
              </div>
            </div>

            {/* Invoice list */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                <FileText size={15} className="text-slate-500" />
                <h2 className="font-semibold text-sm text-slate-900 dark:text-white">Your Invoices</h2>
              </div>

              {loading && <div className="p-8 text-center text-slate-400">Loading…</div>}

              {!loading && invoices.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">No invoices found</div>
              )}

              {!loading && invoices.map(inv => {
                const sc = STATUS_CONFIG[inv.status] || STATUS_CONFIG.unpaid;
                const Icon = sc.icon;
                const canPay = ['unpaid', 'overdue'].includes(inv.status);
                return (
                  <div key={inv.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0 p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-slate-900 dark:text-white text-sm">{inv.invoice_number}</span>
                        <Icon size={13} className={sc.color} />
                        <span className={`text-xs font-medium ${sc.color}`}>{sc.label}</span>
                      </div>
                      <div className="text-xs text-slate-500 flex gap-3">
                        {inv.account_domain && <span>{inv.account_domain}</span>}
                        <span>Due: {inv.due_date}</span>
                        {inv.paid_date && <span>Paid: {inv.paid_date}</span>}
                      </div>
                    </div>

                    <div className="font-bold text-slate-900 dark:text-white">{inv.currency} {Number(inv.amount).toFixed(2)}</div>

                    <div className="flex items-center gap-2">
                      <a href={`/api/billing/invoices/${inv.id}/pdf`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-slate-500" title="Download PDF">
                        <Download size={14} />
                      </a>
                      {canPay && (
                        <>
                          <button className="btn-primary text-xs px-3 py-1.5" onClick={() => payStripe(inv)} disabled={payingId === inv.id}>
                            {payingId === inv.id ? '…' : <><CreditCard size={12} /> Pay by Card</>}
                          </button>
                          <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => payPayPal(inv)} disabled={payingId === inv.id}>
                            <ExternalLink size={12} /> PayPal
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {client && (
              <div className="card p-4 text-xs text-slate-500 space-y-1">
                <p className="font-medium text-slate-700 dark:text-slate-300 mb-2">Account Details</p>
                <p>Name: {client.name}</p>
                <p>Email: {client.email}</p>
                {client.company && <p>Company: {client.company}</p>}
                {client.phone && <p>Phone: {client.phone}</p>}
              </div>
            )}
          </>
        )}

        {tab === 'security' && (
          <div className="space-y-4 max-w-md">
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Lock size={15} className="text-slate-500" />
                <h2 className="font-semibold text-sm text-slate-900 dark:text-white">Two-Factor Authentication</h2>
                {totpStatus?.enabled && <span className="badge-success text-xs ml-auto">Enabled</span>}
              </div>

              {totpStatus === null && <p className="text-sm text-slate-400">Loading…</p>}

              {totpStatus && !totpStatus.enabled && !totpSetup && (
                <>
                  <p className="text-sm text-slate-500">Add an extra layer of security using an authenticator app (Google Authenticator, Authy, etc.).</p>
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
                      {totpLoading ? 'Verifying…' : 'Verify & Enable'}
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
        )}
      </main>
    </div>
  );
}
