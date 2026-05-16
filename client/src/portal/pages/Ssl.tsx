import { useEffect, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, SslStatus } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Ssl() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<SslStatus | null>(null);
  const [busy, setBusy]     = useState(false);

  useEffect(() => { load(); }, [domain]);
  async function load() {
    try { const r = await api<SslStatus>(`/api/portal/ssl/${domain}/status`); setStatus(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function issue() {
    if (!await confirm(`Issue a Let's Encrypt certificate for ${domain}? DNS must point to this server.`)) return;
    setBusy(true);
    try { await apost(`/api/portal/ssl/${domain}`); toast.success('Certificate issued — your site now serves HTTPS'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Issuance failed — check DNS'); }
    setBusy(false);
  }

  return (
    <div className="max-w-lg">
      <PageTitle title="SSL" subtitle={`Free Let's Encrypt certificate for ${domain}. DNS must already point to this server.`} />
      <div className="card p-5 space-y-3">
        {status === null && <p className="text-sm text-slate-400">Loading certificate status…</p>}
        {status && !status.issued && (
          <button className="btn-primary text-sm" onClick={issue} disabled={busy}>Issue certificate</button>
        )}
        {status?.issued && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm space-y-2">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
              <CheckCircle size={14} />
              <span className="font-medium">Certificate active</span>
            </div>
            {status.expires && <p className="text-xs text-emerald-700 dark:text-emerald-300">Expires: {status.expires}</p>}
            <button className="btn-secondary text-xs mt-1" onClick={issue} disabled={busy}>Re-issue / renew</button>
          </div>
        )}
      </div>
    </div>
  );
}
