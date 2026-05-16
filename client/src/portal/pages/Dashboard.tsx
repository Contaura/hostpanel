import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Receipt, Server, ArrowRight, FileText, CreditCard } from 'lucide-react';
import { api, Invoice, PortalAccount } from '../api';
import { usePortalAuth } from '../PortalAuthContext';
import { PageTitle } from '../components';

export default function PortalDashboard() {
  const { client, accounts, selectedAccount, setSelectedAccount } = usePortalAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api<Invoice[]>('/api/portal/invoices')
      .then(r => setInvoices(r.data))
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }, []);

  const totalDue = invoices.filter(i => ['unpaid', 'overdue'].includes(i.status)).reduce((s, i) => s + Number(i.amount || 0), 0);
  const unpaidCount = invoices.filter(i => ['unpaid', 'overdue'].includes(i.status)).length;
  const currency = invoices[0]?.currency || 'USD';

  return (
    <div>
      <PageTitle title={`Welcome back${client?.name ? ', ' + client.name : ''}`} subtitle="Manage your hosting, billing, and account from one place." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs"><Server size={14} /> Hosting accounts</div>
          <div className="text-2xl font-bold mt-1">{accounts.length}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs"><Receipt size={14} /> Invoices</div>
          <div className="text-2xl font-bold mt-1">{invoices.length}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs"><CreditCard size={14} /> Balance due</div>
          <div className={`text-2xl font-bold mt-1 ${totalDue > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
            {currency} {totalDue.toFixed(2)}
          </div>
          {unpaidCount > 0 && <div className="text-xs text-slate-500 mt-0.5">{unpaidCount} unpaid invoice{unpaidCount === 1 ? '' : 's'}</div>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <Server size={15} className="text-slate-500" />
            <h2 className="font-semibold text-sm">Your hosting accounts</h2>
            <span className="text-xs text-slate-400 ml-auto">{accounts.length}</span>
          </div>
          {accounts.length === 0
            ? <div className="p-6 text-center text-slate-400 text-sm">No hosting accounts yet.</div>
            : accounts.map((a: PortalAccount) => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAccount(a)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 ${a.id === selectedAccount?.id ? 'bg-indigo-50/60 dark:bg-indigo-900/20' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{a.domain}</div>
                    <div className="text-xs text-slate-500 mt-0.5 flex gap-3">
                      {a.plan_name && <span>{a.plan_name}</span>}
                      <span className={a.status === 'active' ? 'text-emerald-500' : 'text-amber-500'}>{a.status}</span>
                      {a.expires_at && <span>Expires {a.expires_at}</span>}
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-slate-400" />
                </button>
              ))
          }
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <FileText size={15} className="text-slate-500" />
            <h2 className="font-semibold text-sm">Recent invoices</h2>
            <Link to="/portal/invoices" className="ml-auto text-xs text-indigo-600 hover:underline">View all</Link>
          </div>
          {loading
            ? <div className="p-6 text-center text-slate-400 text-sm">Loading…</div>
            : invoices.length === 0
              ? <div className="p-6 text-center text-slate-400 text-sm">No invoices yet.</div>
              : invoices.slice(0, 5).map(inv => (
                  <div key={inv.id} className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{inv.invoice_number}</div>
                      <div className="text-xs text-slate-500">Due {inv.due_date}</div>
                    </div>
                    <div className="font-semibold">{inv.currency} {Number(inv.amount).toFixed(2)}</div>
                    <span className={`text-xs px-2 py-0.5 rounded ${inv.status === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : inv.status === 'overdue' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                      {inv.status}
                    </span>
                  </div>
                ))
          }
        </div>
      </div>
    </div>
  );
}
