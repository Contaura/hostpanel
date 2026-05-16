import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { api, apost, adel, Forwarder, PortalAutoresp, CatchAll } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function EmailExtras() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const confirm = useConfirm();

  const [fwds, setFwds]       = useState<Forwarder[]>([]);
  const [fwdForm, setFwdForm] = useState({ from: '', to: '' });

  const [auto, setAuto]             = useState<PortalAutoresp[]>([]);
  const [autoForm, setAutoForm]     = useState({ user: '', subject: '', body: '' });

  const [catchall, setCatchall]         = useState<CatchAll | null>(null);
  const [catchallForm, setCatchallForm] = useState({ destination: '' });

  const [busy, setBusy] = useState(false);

  useEffect(() => { loadAll(); }, [domain]);

  async function loadAll() { await Promise.all([loadFwd(), loadAuto(), loadCatch()]); }
  async function loadFwd() {
    try { const r = await api<Forwarder[]>(`/api/portal/email/forwarders?domain=${encodeURIComponent(domain)}`); setFwds(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function loadAuto() {
    try { const r = await api<PortalAutoresp[]>('/api/portal/email/autoresponders'); setAuto(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function loadCatch() {
    try { const r = await api<CatchAll>(`/api/portal/email/catch-all?domain=${encodeURIComponent(domain)}`); setCatchall(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  async function addFwd() {
    if (!fwdForm.from || !fwdForm.to) return;
    setBusy(true);
    try {
      const from = fwdForm.from.includes('@') ? fwdForm.from : `${fwdForm.from}@${domain}`;
      await apost('/api/portal/email/forwarders', { from, to: fwdForm.to });
      toast.success('Forwarder created'); setFwdForm({ from: '', to: '' }); await loadFwd();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function delFwd(from: string) {
    if (!await confirm(`Delete forwarder for ${from}?`)) return;
    setBusy(true);
    try { await adel(`/api/portal/email/forwarders/${encodeURIComponent(from)}`); toast.success('Forwarder removed'); await loadFwd(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  async function addAuto() {
    if (!autoForm.user || !autoForm.subject || !autoForm.body) return;
    setBusy(true);
    try {
      await apost('/api/portal/email/autoresponders', { email: `${autoForm.user}@${domain}`, subject: autoForm.subject, body: autoForm.body });
      toast.success('Autoresponder created'); setAutoForm({ user: '', subject: '', body: '' }); await loadAuto();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function delAuto(id: number) {
    if (!await confirm('Delete this autoresponder?')) return;
    try { await adel(`/api/portal/email/autoresponders/${id}`); toast.success('Deleted'); await loadAuto(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  async function saveCatch() {
    if (!catchallForm.destination) return;
    setBusy(true);
    try { await apost('/api/portal/email/catch-all', { domain, destination: catchallForm.destination }); toast.success('Catch-all updated'); setCatchallForm({ destination: '' }); await loadCatch(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function clearCatch() {
    if (!await confirm('Remove catch-all for this domain?')) return;
    try { await adel(`/api/portal/email/catch-all/${domain}`); toast.success('Catch-all removed'); await loadCatch(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  return (
    <div>
      <PageTitle title="Forwarders, autoresponders & catch-all" subtitle="Forward mail elsewhere, auto-reply to incoming, or catch unaddressed mail." />

      <div className="card p-5 mb-4">
        <p className="text-sm font-semibold mb-1">Forwarders</p>
        <p className="text-xs text-slate-500 mb-3">Forward mail addressed to one of your addresses on to another mailbox.</p>
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5">
            <label className="label text-xs">From</label>
            <div className="flex items-center">
              <input className="input rounded-r-none" placeholder="sales" value={fwdForm.from} onChange={e => setFwdForm(f => ({ ...f, from: e.target.value }))} />
              <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-l-0 border-slate-300 dark:border-slate-700 rounded-r text-xs text-slate-500">@{domain}</span>
            </div>
          </div>
          <div className="col-span-5">
            <label className="label text-xs">Forward to</label>
            <input className="input" placeholder="you@elsewhere.com" value={fwdForm.to} onChange={e => setFwdForm(f => ({ ...f, to: e.target.value }))} />
          </div>
          <button className="btn-primary col-span-2 text-xs" onClick={addFwd} disabled={busy}><Plus size={12} /> Add</button>
        </div>
        <table className="w-full text-sm mt-3">
          <tbody>
            {fwds.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-slate-400 text-xs">No forwarders</td></tr>}
            {fwds.map(f => (
              <tr key={f.from} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs">{f.from}</td>
                <td className="text-xs text-slate-500">→ {f.to}</td>
                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => delFwd(f.from)} disabled={busy}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5 mb-4">
        <p className="text-sm font-semibold mb-1">Autoresponders</p>
        <p className="text-xs text-slate-500 mb-3">Auto-reply to incoming mail (vacation responder, "received your message", etc.).</p>
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3">
            <label className="label text-xs">For mailbox</label>
            <div className="flex items-center">
              <input className="input rounded-r-none font-mono text-xs" placeholder="user" value={autoForm.user} onChange={e => setAutoForm(f => ({ ...f, user: e.target.value.replace(/[^a-zA-Z0-9._+-]/g, '') }))} />
              <span className="px-1 py-1.5 bg-slate-100 dark:bg-slate-800 border border-l-0 border-slate-300 dark:border-slate-700 rounded-r text-xs text-slate-500">@{domain}</span>
            </div>
          </div>
          <div className="col-span-3"><label className="label text-xs">Subject</label><input className="input text-xs" placeholder="Out of office" value={autoForm.subject} onChange={e => setAutoForm(f => ({ ...f, subject: e.target.value }))} /></div>
          <div className="col-span-4"><label className="label text-xs">Body</label><input className="input text-xs" placeholder="I'll be back next week…" value={autoForm.body} onChange={e => setAutoForm(f => ({ ...f, body: e.target.value }))} /></div>
          <button className="btn-primary col-span-2 text-xs" onClick={addAuto} disabled={busy}><Plus size={12} /> Add</button>
        </div>
        <table className="w-full text-sm mt-3">
          <tbody>
            {auto.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-slate-400 text-xs">No autoresponders</td></tr>}
            {auto.map(a => (
              <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs">{a.email}</td>
                <td className="text-xs text-slate-500 truncate max-w-[260px]">{a.subject}</td>
                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => delAuto(a.id)}><Trash2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <p className="text-sm font-semibold mb-1">Catch-all address</p>
        <p className="text-xs text-slate-500 mb-3">A single address that receives mail addressed to <em>anything</em>@{domain} that doesn't have a real mailbox.</p>
        {catchall?.destination
          ? <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Currently:</span> <code className="font-mono">{catchall.destination}</code>
              <button className="btn-secondary text-xs ml-auto" onClick={clearCatch}>Remove</button>
            </div>
          : <p className="text-xs text-slate-400">No catch-all set</p>
        }
        <div className="flex gap-2 mt-2">
          <input className="input flex-1 text-xs" placeholder="forward unknown mail to…" value={catchallForm.destination} onChange={e => setCatchallForm({ destination: e.target.value })} />
          <button className="btn-primary text-xs" onClick={saveCatch} disabled={busy || !catchallForm.destination}>Save</button>
        </div>
      </div>
    </div>
  );
}
