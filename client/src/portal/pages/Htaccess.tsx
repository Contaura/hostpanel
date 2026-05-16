import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { api, apost } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Htaccess() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const [content, setContent] = useState('');
  const [busy, setBusy]       = useState(false);

  useEffect(() => { load(); }, [domain]);
  async function load() {
    try { const r = await api(`/api/portal/htaccess/${domain}`); setContent(r.data.content || ''); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function save() {
    setBusy(true);
    try { await apost(`/api/portal/htaccess/${domain}`, { content }); toast.success('.htaccess saved'); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  return (
    <div className="max-w-3xl">
      <PageTitle title=".htaccess editor" subtitle={`Raw /var/www/${domain}/public_html/.htaccess. A syntax error breaks the whole site.`} />
      <div className="card p-4 space-y-3">
        <textarea className="input font-mono text-xs h-96" value={content} onChange={e => setContent(e.target.value)} />
        <button className="btn-primary text-sm" onClick={save} disabled={busy}>Save .htaccess</button>
      </div>
    </div>
  );
}
