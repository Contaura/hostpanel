import { useEffect, useState } from 'react';
import axios from 'axios';
import { CheckCircle, Clock, AlertCircle, Download, CreditCard, ExternalLink, FileText } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { safeHttpUrl } from '../../lib/safeUrl';
import { openAuthenticatedDownload } from '../../lib/api';
import { api, Invoice } from '../api';
import { PageTitle } from '../components';

const STATUS_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  paid:      { icon: CheckCircle, color: 'text-emerald-500', label: 'Paid' },
  unpaid:    { icon: Clock,       color: 'text-amber-500',   label: 'Unpaid' },
  overdue:   { icon: AlertCircle, color: 'text-red-500',     label: 'Overdue' },
  cancelled: { icon: AlertCircle, color: 'text-slate-400',   label: 'Cancelled' },
};

export default function Invoices() {
  const toast = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [payingId, setPayingId] = useState<number | null>(null);

  useEffect(() => {
    api<Invoice[]>('/api/portal/invoices')
      .then(r => setInvoices(r.data))
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }, []);

  async function payStripe(inv: Invoice) {
    setPayingId(inv.id);
    try {
      const r = await axios.post('/api/stripe/checkout', { invoice_id: inv.id });
      const safe = safeHttpUrl(r.data.url);
      if (!safe) throw new Error('Stripe returned an unexpected redirect URL');
      window.location.href = safe;
    } catch (e: any) { toast.error(e.response?.data?.error || e.message || 'Payment failed'); }
    setPayingId(null);
  }

  async function payPayPal(inv: Invoice) {
    setPayingId(inv.id);
    try {
      const r = await axios.post('/api/paypal/checkout', { invoice_id: inv.id });
      const safe = safeHttpUrl(r.data.url);
      if (!safe) throw new Error('PayPal returned an unexpected redirect URL');
      window.location.href = safe;
    } catch (e: any) { toast.error(e.response?.data?.error || e.message || 'PayPal not configured'); }
    setPayingId(null);
  }

  const totalDue = invoices.filter(i => ['unpaid', 'overdue'].includes(i.status)).reduce((s, i) => s + Number(i.amount || 0), 0);
  const currency = invoices[0]?.currency || 'USD';

  return (
    <div>
      <PageTitle title="Invoices" subtitle="Pay your hosting bill, download receipts." />

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{invoices.length}</div>
          <div className="text-xs text-slate-500 mt-1">Total invoices</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{invoices.filter(i => i.status === 'paid').length}</div>
          <div className="text-xs text-slate-500 mt-1">Paid</div>
        </div>
        <div className="card p-4 text-center">
          <div className={`text-2xl font-bold ${totalDue > 0 ? 'text-red-500' : 'text-slate-400'}`}>
            {currency} {totalDue.toFixed(2)}
          </div>
          <div className="text-xs text-slate-500 mt-1">Balance due</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
          <FileText size={15} className="text-slate-500" />
          <h2 className="font-semibold text-sm">Your invoices</h2>
        </div>
        {loading && <div className="p-8 text-center text-slate-400">Loading…</div>}
        {!loading && invoices.length === 0 && <div className="p-8 text-center text-slate-400 text-sm">No invoices found</div>}
        {!loading && invoices.map(inv => {
          const sc = STATUS_CONFIG[inv.status] || STATUS_CONFIG.unpaid;
          const Icon = sc.icon;
          const canPay = ['unpaid', 'overdue'].includes(inv.status);
          return (
            <div key={inv.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0 p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-sm">{inv.invoice_number}</span>
                  <Icon size={13} className={sc.color} />
                  <span className={`text-xs font-medium ${sc.color}`}>{sc.label}</span>
                </div>
                <div className="text-xs text-slate-500 flex gap-3">
                  {inv.account_domain && <span>{inv.account_domain}</span>}
                  <span>Due: {inv.due_date}</span>
                  {inv.paid_date && <span>Paid: {inv.paid_date}</span>}
                </div>
              </div>
              <div className="font-bold">{inv.currency} {Number(inv.amount).toFixed(2)}</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openAuthenticatedDownload(`/api/portal/invoices/${inv.id}/pdf`, { tokenKey: 'hp_portal_token' }).catch(e => toast.error(e.message || 'PDF failed'))}
                  className="btn-ghost text-slate-500" title="Download PDF">
                  <Download size={14} />
                </button>
                {canPay && (
                  <>
                    <button className="btn-primary text-xs px-3 py-1.5" onClick={() => payStripe(inv)} disabled={payingId === inv.id}>
                      {payingId === inv.id ? '…' : <><CreditCard size={12} /> Pay by card</>}
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
    </div>
  );
}
