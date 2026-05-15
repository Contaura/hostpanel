import { useEffect, useState, useRef, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { DollarSign, Users, Server, AlertTriangle, Plus, CheckCircle, Clock, XCircle, RefreshCw, CreditCard, ExternalLink, Download, Mail, Lock, Pencil, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';
import { safeHttpUrl } from '../lib/safeUrl';

function token() { return localStorage.getItem('hp_token') || ''; }
const authHeaders = () => ({ Authorization: 'Bearer ' + token() });

interface Summary {
  totalAccounts: number;
  activeAccounts: number;
  totalClients: number;
  totalRevenue: number;
  outstanding: number;
  overdueCount: number;
  recentInvoices: Invoice[];
}

interface Invoice {
  id: number;
  invoice_number: string;
  client_name: string;
  amount: number;
  currency: string;
  status: string;
  due_date: string;
  created_at: string;
  account_domain?: string;
}

interface Client {
  id: number;
  name: string;
  email: string;
  company: string;
  account_count: number;
  balance_due: number;
}

const STATUS_STYLE: Record<string, string> = {
  paid:      'badge-green',
  unpaid:    'badge-yellow',
  overdue:   'badge-red',
  cancelled: 'badge-gray',
};

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

function fmt(n: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}

export default function Billing() {
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<'overview' | 'invoices' | 'clients' | 'settings'>('overview');
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [paypalConfigured, setPaypalConfigured] = useState(false);
  const [payingId, setPayingId] = useState<number | null>(null);
  const [emailingId, setEmailingId] = useState<number | null>(null);
  const [portalPw, setPortalPw] = useState<Record<number, string>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [showClientForm, setShowClientForm] = useState(false);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', company: '', address: '', city: '', country: '', notes: '' });
  const [invoiceForm, setInvoiceForm] = useState({ client_id: '', subtotal: '', tax_rate: '', discount: '', due_date: '', notes: '', currency: 'USD' });
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoResult, setPromoResult] = useState<{ discount: number; promo: any } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [editingClientId, setEditingClientId] = useState<number | null>(null);
  const [editClientForm, setEditClientForm] = useState({ name: '', email: '', company: '', phone: '', address: '', notes: '' });
  const [recordingPaymentId, setRecordingPaymentId] = useState<number | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'manual' });
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [clientSearch, setClientSearch] = useState('');

  async function load() {
    try {
      const [sRes, iRes, cRes, stripeRes, ppRes] = await Promise.all([
        axios.get<Summary>('/api/billing/summary', { headers: authHeaders() }),
        axios.get<Invoice[]>('/api/billing/invoices', { headers: authHeaders() }),
        axios.get<Client[]>('/api/billing/clients', { headers: authHeaders() }),
        axios.get('/api/stripe/config', { headers: authHeaders() }).catch(() => ({ data: { configured: false } })),
        axios.get('/api/paypal/config', { headers: authHeaders() }).catch(() => ({ data: { configured: false } })),
      ]);
      setSummary(sRes.data);
      setInvoices(iRes.data);
      setClients(cRes.data);
      setStripeConfigured(stripeRes.data.configured);
      setPaypalConfigured(ppRes.data.configured);
    } catch { toast.error('Failed to load billing data'); } finally { setPageLoading(false); }
  }

  useEffect(() => {
    document.title = 'Billing — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  // Handle return from Stripe Checkout
  useEffect(() => {
    const payment = searchParams.get('payment');
    if (payment === 'success') {
      toast.success('Payment received! Invoice marked as paid.');
      setTab('invoices');
      setSearchParams({});
      load();
    } else if (payment === 'cancelled') {
      toast.info('Payment cancelled.');
      setSearchParams({});
    }
  }, []);

  useEffect(() => { load(); }, []);

  async function payWithStripe(invoice: Invoice) {
    setPayingId(invoice.id);
    try {
      const { data } = await axios.post('/api/stripe/checkout', { invoice_id: invoice.id }, { headers: authHeaders() });
      const safe = safeHttpUrl(data.url);
      if (!safe) throw new Error('Stripe returned an unexpected redirect URL');
      window.location.href = safe;
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Failed to start Stripe checkout');
      setPayingId(null);
    }
  }

  async function payWithPayPal(invoice: Invoice) {
    setPayingId(invoice.id);
    try {
      const { data } = await axios.post('/api/paypal/checkout', { invoice_id: invoice.id }, { headers: authHeaders() });
      const safe = safeHttpUrl(data.url);
      if (!safe) throw new Error('PayPal returned an unexpected redirect URL');
      window.location.href = safe;
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'PayPal not configured. Add credentials in Settings.');
      setPayingId(null);
    }
  }

  async function emailInvoice(id: number) {
    setEmailingId(id);
    try {
      await axios.post(`/api/billing/invoices/${id}/email`, {}, { headers: authHeaders() });
      toast.success('Invoice emailed to client');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Email failed — check SMTP settings'); }
    setEmailingId(null);
  }

  async function uploadLogo(file: File) {
    setLogoUploading(true);
    const fd = new FormData();
    fd.append('logo', file);
    try {
      await axios.post('/api/billing/settings/logo', fd, { headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' } });
      toast.success('Company logo uploaded');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Upload failed'); }
    finally { setLogoUploading(false); }
  }

  async function removeLogo() {
    try { await axios.delete('/api/billing/settings/logo', { headers: authHeaders() }); toast.success('Logo removed'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function setPortalPassword(clientId: number) {
    const pw = portalPw[clientId];
    if (!pw || pw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    try {
      await axios.post(`/api/billing/clients/${clientId}/portal-password`, { password: pw }, { headers: authHeaders() });
      toast.success('Portal access enabled');
      setPortalPw(p => ({ ...p, [clientId]: '' }));
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function addClient() {
    setLoading(true);
    try {
      await axios.post('/api/billing/clients', clientForm);
      toast.success('Client added');
      setClientForm({ name: '', email: '', phone: '', company: '', address: '', city: '', country: '', notes: '' });
      setShowClientForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function addInvoice() {
    setLoading(true);
    try {
      await axios.post('/api/billing/invoices', { ...invoiceForm, subtotal: parseFloat(invoiceForm.subtotal) || 0, tax_rate: parseFloat(invoiceForm.tax_rate) || 0, discount: parseFloat(invoiceForm.discount) || 0 }, { headers: authHeaders() });
      toast.success('Invoice created');
      setInvoiceForm({ client_id: '', subtotal: '', tax_rate: '', discount: '', due_date: '', notes: '', currency: 'USD' });
      setShowInvoiceForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  }

  async function markStatus(id: number, status: string) {
    try {
      await axios.patch(`/api/billing/invoices/${id}/status`, { status });
      toast.success(`Invoice marked as ${status}`); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  function openRecordPayment(inv: Invoice) {
    if (recordingPaymentId === inv.id) { setRecordingPaymentId(null); return; }
    setRecordingPaymentId(inv.id);
    setPaymentForm({ amount: String(inv.amount), method: 'manual' });
  }

  async function submitPayment(inv: Invoice) {
    try {
      await axios.post('/api/billing/payments', { invoice_id: inv.id, amount: parseFloat(paymentForm.amount), method: paymentForm.method }, { headers: authHeaders() });
      toast.success('Payment recorded');
      setRecordingPaymentId(null);
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function deleteClient(id: number) {
    if (!await confirm('Delete this client? All related invoices will also be deleted.')) return;
    try { await axios.delete(`/api/billing/clients/${id}`); toast.success('Client deleted'); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function updateClient(id: number) {
    try {
      await axios.put(`/api/billing/clients/${id}`, editClientForm, { headers: authHeaders() });
      toast.success('Client updated');
      setEditingClientId(null);
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function validatePromo() {
    if (!promoCode.trim()) return;
    const subtotal = parseFloat(invoiceForm.subtotal) || 0;
    setPromoLoading(true);
    try {
      const { data } = await axios.post('/api/billing/promo-codes/validate', { code: promoCode.trim(), amount: subtotal }, { headers: authHeaders() });
      setPromoResult(data);
      setInvoiceForm(f => ({ ...f, discount: String(data.discount) }));
      toast.success(`Promo applied: ${data.promo.type === 'percent' ? data.promo.value + '%' : fmt(data.promo.value)} off`);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Invalid promo code'); setPromoResult(null); }
    setPromoLoading(false);
  }

  async function deleteInvoice(id: number) {
    if (!await confirm('Delete this invoice?')) return;
    try { await axios.delete(`/api/billing/invoices/${id}`); toast.success('Invoice deleted'); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  const StatCard = ({ label, value, sub, icon: Icon, color }: any) => (
    <div className="card p-5 flex items-start gap-4">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
        <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
        {sub && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );

  if (pageLoading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Billing</h1>
          <p className="page-subtitle">Manage clients, invoices, and payments</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Stripe status pill */}
          <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${
            stripeConfigured
              ? 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
              : 'bg-slate-100 dark:bg-slate-700/60 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400'
          }`}>
            <CreditCard size={12} />
            {stripeConfigured ? 'Stripe connected' : 'Stripe not configured'}
          </div>
          <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
        </div>
      </div>

      {/* Stats row */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Revenue" value={fmt(summary.totalRevenue)} icon={DollarSign} color="bg-emerald-500" />
          <StatCard label="Outstanding"   value={fmt(summary.outstanding)}  sub={summary.overdueCount > 0 ? `${summary.overdueCount} overdue` : undefined} icon={AlertTriangle} color={summary.overdueCount > 0 ? 'bg-rose-500' : 'bg-amber-500'} />
          <StatCard label="Active Accounts" value={summary.activeAccounts} sub={`${summary.totalAccounts} total`} icon={Server}  color="bg-indigo-500" />
          <StatCard label="Clients"        value={summary.totalClients}    icon={Users}  color="bg-violet-500" />
        </div>
      )}

      <div className="tab-bar">
        {(['overview', 'invoices', 'clients', 'settings'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'tab-item-active' : 'tab-item'}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Recent Invoices</h2>
            <button onClick={() => setTab('invoices')} className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">View all →</button>
          </div>
          <table className="w-full text-sm">
            <thead className={theadCls}><tr>
              <th className="table-header-cell">Invoice</th>
              <th className="table-header-cell">Client</th>
              <th className="table-header-cell">Amount</th>
              <th className="table-header-cell">Due</th>
              <th className="table-header-cell">Status</th>
            </tr></thead>
            <tbody>
              {(summary?.recentInvoices ?? []).map(inv => (
                <tr key={inv.id} className={rowCls}>
                  <td className="table-cell font-mono font-semibold text-slate-900 dark:text-slate-100">{inv.invoice_number}</td>
                  <td className="table-cell text-slate-600 dark:text-slate-400">{inv.client_name}</td>
                  <td className="table-cell font-semibold">{fmt(inv.amount, inv.currency)}</td>
                  <td className="table-cell text-slate-500 dark:text-slate-400">{inv.due_date}</td>
                  <td className="table-cell"><span className={STATUS_STYLE[inv.status] || 'badge-gray'}>{inv.status}</span></td>
                </tr>
              ))}
              {(summary?.recentInvoices ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">No invoices yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Invoices ── */}
      {tab === 'invoices' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 justify-end">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-8 w-48 text-sm" placeholder="Search invoices…" value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} />
            </div>
            <button onClick={() => setShowInvoiceForm(v => !v)} className="btn-primary">
              <Plus size={14} /> New Invoice
            </button>
          </div>

          {showInvoiceForm && (
            <div className="card p-5 max-w-md space-y-4">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Create Invoice</h2>
              <div>
                <label className="label">Client</label>
                <select className="input" value={invoiceForm.client_id} onChange={e => setInvoiceForm({ ...invoiceForm, client_id: e.target.value })} required>
                  <option value="">Select client…</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Subtotal</label>
                  <input type="number" step="0.01" className="input" placeholder="0.00"
                    value={invoiceForm.subtotal} onChange={e => setInvoiceForm({ ...invoiceForm, subtotal: e.target.value })} />
                </div>
                <div>
                  <label className="label">Currency</label>
                  <select className="input" value={invoiceForm.currency} onChange={e => setInvoiceForm({ ...invoiceForm, currency: e.target.value })}>
                    {['USD','EUR','GBP','CAD','AUD','JPY','CHF','BRL','MXN'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Tax Rate (%)</label>
                  <input type="number" step="0.01" min="0" max="100" className="input" placeholder="0"
                    value={invoiceForm.tax_rate} onChange={e => setInvoiceForm({ ...invoiceForm, tax_rate: e.target.value })} />
                </div>
                <div>
                  <label className="label">Discount</label>
                  <input type="number" step="0.01" min="0" className="input" placeholder="0.00"
                    value={invoiceForm.discount} onChange={e => { setInvoiceForm({ ...invoiceForm, discount: e.target.value }); setPromoResult(null); }} />
                </div>
              </div>
              <div>
                <label className="label">Promo Code</label>
                <div className="flex gap-2">
                  <input className="input uppercase font-mono tracking-wider flex-1" placeholder="SAVE20"
                    value={promoCode} onChange={e => { setPromoCode(e.target.value.toUpperCase()); setPromoResult(null); }}
                    onKeyDown={e => e.key === 'Enter' && validatePromo()} />
                  <button type="button" onClick={validatePromo} disabled={promoLoading || !promoCode.trim()} className="btn-secondary text-sm">
                    {promoLoading ? '…' : 'Apply'}
                  </button>
                </div>
                {promoResult && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    {promoResult.promo.type === 'percent' ? `${promoResult.promo.value}% off` : fmt(promoResult.promo.value)} — discount set to {fmt(promoResult.discount)}
                  </p>
                )}
              </div>
              <div>
                <label className="label">Due Date</label>
                <input type="date" className="input" value={invoiceForm.due_date}
                  onChange={e => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input resize-none h-16 text-sm" value={invoiceForm.notes}
                  onChange={e => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <button onClick={addInvoice} disabled={loading} className="btn-primary">{loading ? 'Creating…' : 'Create invoice'}</button>
                <button onClick={() => { setShowInvoiceForm(false); setPromoCode(''); setPromoResult(null); }} className="btn-secondary">Cancel</button>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className={theadCls}><tr>
                <th className="table-header-cell">Invoice #</th>
                <th className="table-header-cell">Client</th>
                <th className="table-header-cell hidden md:table-cell">Domain</th>
                <th className="table-header-cell">Amount</th>
                <th className="table-header-cell hidden md:table-cell">Due</th>
                <th className="table-header-cell">Status</th>
                <th className="px-4 py-3 w-36" />
              </tr></thead>
              <tbody>
                {(() => {
                  const q = invoiceSearch.trim().toLowerCase();
                  const visible = q ? invoices.filter(inv =>
                    [inv.invoice_number, inv.client_name, inv.status, inv.account_domain]
                      .some(v => v?.toLowerCase().includes(q))
                  ) : invoices;
                  if (invoices.length === 0) return (
                    <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-slate-400">No invoices yet</td></tr>
                  );
                  if (visible.length === 0) return (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">No invoices match "{invoiceSearch}"</td></tr>
                  );
                  return visible.map(inv => (
                    <Fragment key={inv.id}>
                      <tr className={rowCls}>
                        <td className="table-cell font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{inv.invoice_number}</td>
                        <td className="table-cell text-slate-600 dark:text-slate-400">{inv.client_name || '—'}</td>
                        <td className="table-cell text-slate-400 dark:text-slate-500 text-xs hidden md:table-cell">{inv.account_domain || '—'}</td>
                        <td className="table-cell font-semibold text-slate-900 dark:text-slate-100">{fmt(inv.amount, inv.currency)}</td>
                        <td className="table-cell text-slate-500 dark:text-slate-400 hidden md:table-cell">{inv.due_date}</td>
                        <td className="table-cell"><span className={STATUS_STYLE[inv.status] || 'badge-gray'}>{inv.status}</span></td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <a href={`/api/billing/invoices/${inv.id}/pdf`} target="_blank" rel="noopener noreferrer"
                              className="btn-icon hover:!text-indigo-600 hover:!bg-indigo-50 dark:hover:!bg-indigo-900/30" title="Download PDF">
                              <Download size={13} />
                            </a>
                            <button onClick={() => emailInvoice(inv.id)} disabled={emailingId === inv.id}
                              className="btn-icon hover:!text-sky-600 hover:!bg-sky-50 dark:hover:!bg-sky-900/30" title="Email invoice to client">
                              {emailingId === inv.id ? <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> : <Mail size={13} />}
                            </button>
                            {inv.status !== 'paid' && inv.status !== 'cancelled' && stripeConfigured && (
                              <button onClick={() => payWithStripe(inv)} disabled={payingId === inv.id}
                                className="btn-icon hover:!text-violet-600 dark:hover:!text-violet-400 hover:!bg-violet-50 dark:hover:!bg-violet-900/30" title="Pay with Stripe">
                                {payingId === inv.id ? <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> : <CreditCard size={13} />}
                              </button>
                            )}
                            {inv.status !== 'paid' && inv.status !== 'cancelled' && paypalConfigured && (
                              <button onClick={() => payWithPayPal(inv)} disabled={payingId === inv.id}
                                className="btn-icon hover:!text-blue-600 hover:!bg-blue-50 dark:hover:!bg-blue-900/30" title="Pay with PayPal">
                                <ExternalLink size={13} />
                              </button>
                            )}
                            {inv.status !== 'paid' && (
                              <button onClick={() => openRecordPayment(inv)}
                                className={`btn-icon hover:!text-emerald-600 dark:hover:!text-emerald-400 hover:!bg-emerald-50 dark:hover:!bg-emerald-900/30 ${recordingPaymentId === inv.id ? '!text-emerald-600 !bg-emerald-50 dark:!bg-emerald-900/30' : ''}`}
                                title="Record manual payment"><CheckCircle size={13} /></button>
                            )}
                            {inv.status === 'unpaid' && (
                              <button onClick={() => markStatus(inv.id, 'overdue')}
                                className="btn-icon hover:!text-amber-600 hover:!bg-amber-50 dark:hover:!bg-amber-900/30"
                                title="Mark overdue"><Clock size={13} /></button>
                            )}
                            <button onClick={() => deleteInvoice(inv.id)}
                              className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30"
                              title="Delete"><XCircle size={13} /></button>
                          </div>
                        </td>
                      </tr>
                      {recordingPaymentId === inv.id && (
                        <tr className="bg-emerald-50/60 dark:bg-emerald-900/10 border-b border-slate-100 dark:border-slate-700/40">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="flex items-end gap-3 flex-wrap">
                              <div>
                                <label className="label">Amount</label>
                                <input type="number" step="0.01" min="0" className="input text-sm w-32"
                                  value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
                              </div>
                              <div>
                                <label className="label">Method</label>
                                <select className="input text-sm" value={paymentForm.method} onChange={e => setPaymentForm(f => ({ ...f, method: e.target.value }))}>
                                  <option value="manual">Manual</option>
                                  <option value="bank_transfer">Bank Transfer</option>
                                  <option value="stripe">Stripe</option>
                                  <option value="paypal">PayPal</option>
                                  <option value="crypto">Crypto</option>
                                </select>
                              </div>
                              <button className="btn-primary text-sm" onClick={() => submitPayment(inv)}>Record</button>
                              <button className="btn-secondary text-sm" onClick={() => setRecordingPaymentId(null)}>Cancel</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Settings ── */}
      {tab === 'settings' && (
        <div className="max-w-xl space-y-5">
          {/* Company logo */}
          <div className="card p-5 space-y-3">
            <h2 className="font-bold text-sm text-slate-900 dark:text-slate-100">Company Logo</h2>
            <p className="text-sm text-slate-500">The logo will appear in the top-left of generated invoice PDFs.</p>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}>
                {logoUploading ? 'Uploading…' : 'Upload Logo'}
              </button>
              <button className="btn-secondary text-red-500" onClick={removeLogo}>Remove</button>
              <input ref={logoInputRef} type="file" accept=".png,.jpg,.jpeg,.gif,.svg" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }} />
            </div>
            <p className="text-xs text-slate-400">PNG/JPG/SVG, max 2 MB. Stored on the server at <code className="font-mono">/var/lib/hostpanel/</code>.</p>
          </div>

          {/* Stripe config card */}
          <div className="card p-6 space-y-5">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0">
                <CreditCard size={20} className="text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h2 className="font-bold text-slate-900 dark:text-slate-100">Stripe Integration</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Accept card payments via Stripe Checkout. Clients are redirected to a secure Stripe-hosted payment page.
                </p>
              </div>
            </div>

            <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${
              stripeConfigured
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 text-emerald-800 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 text-amber-800 dark:text-amber-300'
            }`}>
              <div className={`h-2 w-2 rounded-full flex-shrink-0 ${stripeConfigured ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
              {stripeConfigured
                ? 'Stripe is connected and ready to accept payments.'
                : 'Stripe is not configured. Add your API keys to the server .env file.'}
            </div>

            <div className="space-y-3 text-sm">
              <p className="font-semibold text-slate-700 dark:text-slate-300">Setup instructions:</p>
              <ol className="space-y-2 text-slate-600 dark:text-slate-400 list-decimal list-inside">
                <li>
                  Create a free account at{' '}
                  <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer"
                    className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1">
                    dashboard.stripe.com <ExternalLink size={11} />
                  </a>
                </li>
                <li>
                  Go to <strong>Developers → API Keys</strong> and copy your <code className="font-mono bg-slate-100 dark:bg-slate-700 px-1 rounded text-xs">Secret key</code> and <code className="font-mono bg-slate-100 dark:bg-slate-700 px-1 rounded text-xs">Publishable key</code>
                </li>
                <li>
                  Add them to <code className="font-mono bg-slate-100 dark:bg-slate-700 px-1 rounded text-xs">server/.env</code>:
                  <pre className="mt-2 bg-slate-900 dark:bg-slate-950 text-emerald-400 text-xs font-mono rounded-lg p-3 overflow-x-auto">{`STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...`}</pre>
                </li>
                <li>Restart HostPanel — the Stripe badge will turn green.</li>
                <li>
                  <strong>Webhooks (optional but recommended):</strong> In Stripe go to <strong>Developers → Webhooks → Add endpoint</strong>,
                  set URL to <code className="font-mono bg-slate-100 dark:bg-slate-700 px-1 rounded text-xs">https://your-server/api/stripe/webhook</code>,
                  select <code className="font-mono bg-slate-100 dark:bg-slate-700 px-1 rounded text-xs">checkout.session.completed</code>,
                  and paste the signing secret into <code className="font-mono bg-slate-100 dark:bg-slate-700 px-1 rounded text-xs">STRIPE_WEBHOOK_SECRET</code>.
                </li>
              </ol>
            </div>

            <div className="border-t border-slate-100 dark:border-slate-700 pt-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">How payments work</p>
              <div className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
                <div className="flex gap-2"><span className="text-indigo-500 font-bold">1.</span> Click the <CreditCard size={12} className="inline" /> button on any unpaid invoice</div>
                <div className="flex gap-2"><span className="text-indigo-500 font-bold">2.</span> Client is redirected to Stripe's secure checkout page</div>
                <div className="flex gap-2"><span className="text-indigo-500 font-bold">3.</span> On success, the invoice is automatically marked as paid via webhook (or on return if no webhook)</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Clients ── */}
      {tab === 'clients' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 justify-end">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-8 w-48 text-sm" placeholder="Search clients…" value={clientSearch} onChange={e => setClientSearch(e.target.value)} />
            </div>
            <button onClick={() => setShowClientForm(v => !v)} className="btn-primary">
              <Plus size={14} /> Add Client
            </button>
          </div>

          {showClientForm && (
            <div className="card p-5 max-w-lg space-y-4">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add Client</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Full Name</label>
                  <input className="input" value={clientForm.name} onChange={e => setClientForm({ ...clientForm, name: e.target.value })} required />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input type="email" className="input" value={clientForm.email} onChange={e => setClientForm({ ...clientForm, email: e.target.value })} required />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={clientForm.phone} onChange={e => setClientForm({ ...clientForm, phone: e.target.value })} />
                </div>
                <div>
                  <label className="label">Company</label>
                  <input className="input" value={clientForm.company} onChange={e => setClientForm({ ...clientForm, company: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="label">Address</label>
                  <input className="input" value={clientForm.address} onChange={e => setClientForm({ ...clientForm, address: e.target.value })} />
                </div>
                <div>
                  <label className="label">City</label>
                  <input className="input" value={clientForm.city} onChange={e => setClientForm({ ...clientForm, city: e.target.value })} />
                </div>
                <div>
                  <label className="label">Country</label>
                  <input className="input" value={clientForm.country} onChange={e => setClientForm({ ...clientForm, country: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={addClient} disabled={loading} className="btn-primary">{loading ? 'Adding…' : 'Add client'}</button>
                <button onClick={() => setShowClientForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className={theadCls}><tr>
                <th className="table-header-cell">Client</th>
                <th className="table-header-cell hidden md:table-cell">Company</th>
                <th className="table-header-cell">Accounts</th>
                <th className="table-header-cell">Balance Due</th>
                <th className="px-4 py-3 w-12" />
              </tr></thead>
              <tbody>
                {(() => {
                  const q = clientSearch.trim().toLowerCase();
                  const visible = q ? clients.filter(c =>
                    [c.name, c.email, c.company].some(v => v?.toLowerCase().includes(q))
                  ) : clients;
                  if (clients.length === 0) return (
                    <tr><td colSpan={5} className="px-4 py-16 text-center text-sm text-slate-400">No clients yet</td></tr>
                  );
                  if (visible.length === 0) return (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">No clients match "{clientSearch}"</td></tr>
                  );
                  return visible.map(c => (
                  <Fragment key={c.id}>
                    <tr className={rowCls}>
                      <td className="table-cell">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                            <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">{c.name[0].toUpperCase()}</span>
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</div>
                            <div className="text-xs text-slate-400 dark:text-slate-500">{c.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell text-slate-500 dark:text-slate-400 hidden md:table-cell">{c.company || '—'}</td>
                      <td className="table-cell">
                        <span className="badge-blue">{c.account_count}</span>
                      </td>
                      <td className="table-cell">
                        {c.balance_due > 0
                          ? <span className="font-semibold text-rose-600 dark:text-rose-400">{fmt(c.balance_due)}</span>
                          : <span className="text-emerald-600 dark:text-emerald-400 font-semibold">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <input
                            type="password"
                            placeholder="Portal password"
                            value={portalPw[c.id] || ''}
                            onChange={e => setPortalPw(p => ({ ...p, [c.id]: e.target.value }))}
                            className="input text-xs py-1 px-2 w-28"
                          />
                          <button
                            onClick={() => setPortalPassword(c.id)}
                            className="btn-icon hover:!text-indigo-600 hover:!bg-indigo-50 dark:hover:!bg-indigo-900/30"
                            title={`${(c as any).portal_enabled ? 'Update' : 'Enable'} portal access`}>
                            <Lock size={13} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingClientId(editingClientId === c.id ? null : c.id);
                              setEditClientForm({ name: c.name, email: c.email, company: c.company || '', phone: '', address: '', notes: '' });
                            }}
                            className="btn-icon hover:!text-sky-600 hover:!bg-sky-50 dark:hover:!bg-sky-900/30"
                            title="Edit client">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => deleteClient(c.id)}
                            className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30">
                            <XCircle size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editingClientId === c.id && (
                      <tr className="bg-slate-50/80 dark:bg-slate-700/30 border-b border-slate-100 dark:border-slate-700/40">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="grid grid-cols-3 gap-3 max-w-2xl">
                            <div><label className="label">Name</label><input className="input text-sm" value={editClientForm.name} onChange={e => setEditClientForm(f => ({ ...f, name: e.target.value }))} /></div>
                            <div><label className="label">Email</label><input className="input text-sm" value={editClientForm.email} onChange={e => setEditClientForm(f => ({ ...f, email: e.target.value }))} /></div>
                            <div><label className="label">Company</label><input className="input text-sm" value={editClientForm.company} onChange={e => setEditClientForm(f => ({ ...f, company: e.target.value }))} /></div>
                            <div><label className="label">Phone</label><input className="input text-sm" value={editClientForm.phone} onChange={e => setEditClientForm(f => ({ ...f, phone: e.target.value }))} /></div>
                            <div><label className="label">Address</label><input className="input text-sm" value={editClientForm.address} onChange={e => setEditClientForm(f => ({ ...f, address: e.target.value }))} /></div>
                            <div><label className="label">Notes</label><input className="input text-sm" value={editClientForm.notes} onChange={e => setEditClientForm(f => ({ ...f, notes: e.target.value }))} /></div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button className="btn-primary text-sm" onClick={() => updateClient(c.id)}>Save</button>
                            <button className="btn-secondary text-sm" onClick={() => setEditingClientId(null)}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
