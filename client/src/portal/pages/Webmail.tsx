import { useEffect, useState } from 'react';
import { ExternalLink, MailOpen } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { safeHttpUrl } from '../../lib/safeUrl';
import { api, WebmailInfo } from '../api';
import { PageTitle } from '../components';

export default function Webmail() {
  const toast = useToast();
  const [info, setInfo] = useState<WebmailInfo | null>(null);

  useEffect(() => {
    api<WebmailInfo>('/api/portal/webmail')
      .then(r => setInfo(r.data))
      .catch(e => { setInfo({ installed: false, url: '' }); toast.error(e.response?.data?.error || 'Failed'); });
  }, []);

  const safe = info?.installed ? safeHttpUrl(info.url) : null;

  return (
    <div className="max-w-2xl">
      <PageTitle title="Webmail" subtitle="Open Roundcube to read mail in any of your mailboxes." />
      <div className="card p-6">
        {info === null && <p className="text-sm text-slate-400">Checking…</p>}
        {info && !info.installed && (
          <div className="flex items-start gap-3 text-sm">
            <div className="h-2 w-2 rounded-full bg-slate-300 mt-2" />
            <div>
              <p className="font-medium">Webmail is not installed on this server.</p>
              <p className="text-slate-500 text-xs mt-1">Contact your hosting provider to install Roundcube.</p>
            </div>
          </div>
        )}
        {info?.installed && safe && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 text-sm">
              <div className="h-2 w-2 rounded-full bg-emerald-500 mt-2" />
              <div>
                <p className="font-medium">Roundcube is available.</p>
                <p className="text-slate-500 text-xs mt-1">Sign in with your full mailbox address (e.g. you@yourdomain.com) and the mailbox password.</p>
              </div>
            </div>
            <a href={safe} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm inline-flex items-center gap-2">
              <MailOpen size={14} /> Open Webmail <ExternalLink size={12} className="opacity-70" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
