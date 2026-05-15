import { useEffect, useState } from 'react';
import { Mail, ExternalLink, Terminal, Package } from 'lucide-react';
import { fetchApi } from '../lib/api';

export default function Webmail() {
  const [status, setStatus] = useState<{ webmailUrl: string; installed: string[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Webmail — HostPanel';
    fetchApi('/api/mail-routing/webmail')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ webmailUrl: '', installed: [] }))
      .finally(() => setLoading(false));
    return () => { document.title = 'HostPanel'; };
  }, []);

  const url = status?.webmailUrl || (status?.installed?.length ? '/roundcube' : '');

  if (loading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="page-title">Webmail</h1>
        <p className="page-subtitle">Browser-based email access for hosted accounts</p>
      </div>

      {status?.installed?.length ? (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Mail size={20} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="font-semibold text-sm">{status.installed.join(', ')} detected</p>
              <p className="text-xs text-slate-500">Webmail is available for your hosted accounts</p>
            </div>
          </div>

          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-flex gap-2"
          >
            <ExternalLink size={14} /> Open Webmail
          </a>

          {status.webmailUrl && (
            <p className="text-xs text-slate-400">
              Custom URL: <code className="font-mono">{status.webmailUrl}</code>
            </p>
          )}
        </div>
      ) : (
        <div className="card p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Mail size={20} className="text-slate-400" />
            </div>
            <div>
              <p className="font-semibold text-sm">No webmail client installed</p>
              <p className="text-xs text-slate-500">Install Roundcube to give clients browser-based email access</p>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Package size={14} /> Install Roundcube
            </div>
            <p className="text-xs text-slate-500">Run these commands on the server as root:</p>
            <pre className="text-xs font-mono bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto leading-relaxed">{`dnf install -y epel-release
dnf install -y roundcubemail
# Configure Apache vhost for /roundcube
echo 'Alias /roundcube /usr/share/roundcubemail' \\
  >> /etc/httpd/conf.d/roundcubemail.conf
systemctl reload httpd`}</pre>
          </div>

          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 p-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
            <p>After installing, set <code className="font-mono">WEBMAIL_URL</code> in <code className="font-mono">server/.env</code> if using a custom path, then restart the panel.</p>
            <div className="flex items-center gap-1 mt-1">
              <Terminal size={12} />
              <code className="font-mono">systemctl restart hostpanel</code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
