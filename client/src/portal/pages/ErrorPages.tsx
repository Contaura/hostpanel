import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { api, apost } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function ErrorPages() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const [code, setCode]       = useState('404');
  const [content, setContent] = useState('');
  const [busy, setBusy]       = useState(false);

  useEffect(() => { load(code); }, [code, domain]);
  async function load(c: string) {
    try { const r = await api(`/api/portal/errpages/${domain}/${c}`); setContent(r.data.content || ''); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function save() {
    setBusy(true);
    try { await apost(`/api/portal/errpages/${domain}/${code}`, { content }); toast.success('Error page saved'); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  return (
    <div className="max-w-3xl">
      <PageTitle title="Error Pages" subtitle={`Custom HTML pages Apache shows when an HTTP error happens on ${domain}.`} />
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <label className="label text-xs">Code</label>
          <select className="input w-28 text-xs" value={code} onChange={e => setCode(e.target.value)}>
            {['400','401','403','404','500','502','503'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn-primary text-xs ml-auto" onClick={save} disabled={busy}>Save error page</button>
        </div>
        <textarea className="input font-mono text-xs h-72" placeholder="<html>…</html>" value={content} onChange={e => setContent(e.target.value)} />
      </div>
    </div>
  );
}
