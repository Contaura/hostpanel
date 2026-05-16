import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { api, apost, MailAuth } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function MailAuthPage() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const [data, setData]         = useState<MailAuth | null>(null);
  const [spfForm, setSpfForm]   = useState({ include: '' });
  const [dmarcForm, setDmarc]   = useState({ policy: 'none', rua: '' });
  const [busy, setBusy]         = useState(false);

  useEffect(() => { load(); }, [domain]);
  async function load() {
    try { const r = await api<MailAuth>(`/api/portal/mail-auth/${domain}`); setData(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  async function genDkim() {
    setBusy(true);
    try { await apost(`/api/portal/mail-auth/${domain}/dkim`); toast.success('DKIM key generated'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function saveSpf() {
    const include = spfForm.include.split(/[\s,]+/).filter(Boolean);
    setBusy(true);
    try { await apost(`/api/portal/mail-auth/${domain}/spf`, { include }); toast.success('SPF saved'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function saveDmarc() {
    setBusy(true);
    try { await apost(`/api/portal/mail-auth/${domain}/dmarc`, dmarcForm); toast.success('DMARC saved'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  return (
    <div className="max-w-3xl">
      <PageTitle title="DKIM / SPF / DMARC" subtitle="Authenticate mail you send so it doesn't land in spam." />
      <div className="card p-5 space-y-5">
        <div className="space-y-2">
          <p className="text-sm font-semibold">DKIM</p>
          <p className="text-xs text-slate-500">{data?.dkim ? 'Key generated. Public key TXT record:' : 'No DKIM key yet.'}</p>
          {data?.dkim && <code className="block text-xs font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded break-all">{data.dkim}</code>}
          <button className="btn-primary text-xs" onClick={genDkim} disabled={busy}>{data?.dkim ? 'Re-generate' : 'Generate DKIM key'}</button>
        </div>
        <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4">
          <p className="text-sm font-semibold">SPF</p>
          <p className="text-xs text-slate-500">Current: <code className="font-mono">{data?.spf || '(none)'}</code></p>
          <div className="flex gap-2">
            <input className="input font-mono text-xs flex-1" placeholder="include domains, comma-separated (e.g. _spf.google.com, sendgrid.net)" value={spfForm.include} onChange={e => setSpfForm({ include: e.target.value })} />
            <button className="btn-primary text-xs" onClick={saveSpf} disabled={busy}>Save SPF</button>
          </div>
        </div>
        <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4">
          <p className="text-sm font-semibold">DMARC</p>
          <p className="text-xs text-slate-500">Current: <code className="font-mono">{data?.dmarc || '(none)'}</code></p>
          <div className="grid grid-cols-12 gap-2">
            <select className="input col-span-3 text-xs" value={dmarcForm.policy} onChange={e => setDmarc(f => ({ ...f, policy: e.target.value }))}>
              <option value="none">none</option><option value="quarantine">quarantine</option><option value="reject">reject</option>
            </select>
            <input className="input col-span-7 text-xs" placeholder="rua: where to send aggregate reports" value={dmarcForm.rua} onChange={e => setDmarc(f => ({ ...f, rua: e.target.value }))} />
            <button className="btn-primary col-span-2 text-xs" onClick={saveDmarc} disabled={busy}>Save DMARC</button>
          </div>
        </div>
      </div>
    </div>
  );
}
