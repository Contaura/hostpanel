import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { api, SiteStats } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Stats() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const [stats, setStats] = useState<SiteStats | null>(null);

  useEffect(() => {
    setStats(null);
    api<SiteStats>(`/api/portal/stats/${domain}`)
      .then(r => setStats(r.data))
      .catch(e => toast.error(e.response?.data?.error || 'Failed'));
  }, [domain]);

  return (
    <div>
      <PageTitle title="Site statistics" subtitle={`Parsed from the last ~50,000 lines of /var/log/httpd/${domain}-access.log.`} />
      {!stats && <p className="text-sm text-slate-400">Loading…</p>}
      {stats && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="card p-4"><div className="text-xs text-slate-500">Hits</div><div className="text-2xl font-bold">{stats.hits.toLocaleString()}</div></div>
            <div className="card p-4"><div className="text-xs text-slate-500">Bandwidth</div><div className="text-2xl font-bold">{(stats.bytes / 1024 / 1024).toFixed(1)} MB</div></div>
            <div className="card p-4"><div className="text-xs text-slate-500">Top paths</div><div className="text-2xl font-bold">{stats.top.length}</div></div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left py-2 px-3">Hits</th><th className="text-left">Path</th>
              </tr></thead>
              <tbody>
                {stats.top.map(t => (
                  <tr key={t.path} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td className="py-2 px-3 text-xs">{t.hits}</td>
                    <td className="font-mono text-xs truncate max-w-[480px]">{t.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
