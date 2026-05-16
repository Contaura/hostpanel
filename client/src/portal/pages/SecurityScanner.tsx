import { useState } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { apost, ScanResult } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function SecurityScanner() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  async function run() {
    setBusy(true);
    try { const r = await apost<ScanResult>(`/api/portal/security-scan/${domain}`); setResult(r.data); toast.success(`Scanned — ${r.data.infected_count} infected files`); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Scan failed'); }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl">
      <PageTitle title="Security Scanner" subtitle={`Run ClamAV against /var/www/${domain}. Slow on large trees.`} />
      <div className="card p-5 space-y-4">
        <button className="btn-primary text-sm" onClick={run} disabled={busy}>{busy ? 'Scanning…' : 'Start scan'}</button>
        {result && (
          <div className={`rounded-lg p-3 text-sm border ${result.infected_count > 0 ? 'border-rose-300 bg-rose-50 dark:bg-rose-900/20' : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20'}`}>
            <div className="flex items-center gap-2">
              {result.infected_count > 0 ? <AlertCircle size={14} className="text-rose-600" /> : <CheckCircle size={14} className="text-emerald-600" />}
              <span className="font-medium">{result.infected_count} infected file{result.infected_count !== 1 ? 's' : ''}</span>
            </div>
            {result.infected.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs font-mono">
                {result.infected.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
