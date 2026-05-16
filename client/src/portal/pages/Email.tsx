import { useEffect, useState } from 'react';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { safeHttpUrl } from '../../lib/safeUrl';
import { api, apost, adel, EmailAcct, WebmailInfo } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Email() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [accts, setAccts] = useState<EmailAcct[]>([]);
  const [form, setForm]   = useState({ user: '', password: '' });
  const [webmail, setWebmail] = useState<WebmailInfo | null>(null);
  const [busy, setBusy]   = useState(false);

  useEffect(() => { load(); loadWebmail(); }, [domain]);

  async function load() {
    try { const r = await api<EmailAcct[]>(`/api/portal/email/accounts?domain=${encodeURIComponent(domain)}`); setAccts(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function loadWebmail() {
    try { const r = await api<WebmailInfo>('/api/portal/webmail'); setWebmail(r.data); }
    catch { setWebmail({ installed: false, url: '' }); }
  }

  async function add() {
    if (!form.user || !form.password) return toast.error('Username and password are required');
    if (form.password.length < 8) return toast.error('Password must be at least 8 characters');
    setBusy(true);
    try { await apost('/api/portal/email/accounts', { email: `${form.user}@${domain}`, password: form.password }); toast.success('Mailbox created'); setForm({ user: '', password: '' }); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(email: string) {
    if (!await confirm(`Delete mailbox ${email}? All mail will be lost.`)) return;
    setBusy(true);
    try { await adel(`/api/portal/email/accounts/${encodeURIComponent(email)}`); toast.success('Mailbox deleted'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  const wmBase = webmail?.installed ? safeHttpUrl(webmail.url) : null;

  return (
    <div>
      <PageTitle title="Email accounts" subtitle={`Mailboxes for @${domain}.`} />

      {webmail && (
        <div className="card p-3 mb-4 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${webmail.installed ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span className="font-medium">Webmail</span>
            <span className="text-slate-500 text-xs">{webmail.installed ? 'Roundcube available' : 'Not installed on this server'}</span>
          </div>
          {wmBase && (
            <a href={wmBase} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs inline-flex items-center gap-1">
              <ExternalLink size={12} /> Open Webmail
            </a>
          )}
        </div>
      )}

      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-4">
            <label className="label text-xs">Mailbox</label>
            <div className="flex items-center">
              <input className="input rounded-r-none" placeholder="user" value={form.user} onChange={e => setForm(f => ({ ...f, user: e.target.value.replace(/[^a-zA-Z0-9._+-]/g, '') }))} />
              <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-l-0 border-slate-300 dark:border-slate-700 rounded-r text-xs text-slate-500">@{domain}</span>
            </div>
          </div>
          <div className="col-span-5">
            <label className="label text-xs">Password</label>
            <input className="input" type="password" placeholder="min 8 characters" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <button className="btn-primary col-span-3 text-xs" onClick={add} disabled={busy}><Plus size={12} /> Create</button>
        </div>

        <table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
            <th className="text-left py-2 px-1">Mailbox</th><th></th>
          </tr></thead>
          <tbody>
            {accts.length === 0 && <tr><td colSpan={2} className="py-4 text-center text-slate-400 text-xs">No mailboxes</td></tr>}
            {accts.map(e => {
              const wmHref = wmBase ? `${wmBase}${wmBase.includes('?') ? '&' : '?'}_user=${encodeURIComponent(e.email)}` : null;
              return (
                <tr key={e.email} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="py-2 px-1 font-mono text-xs">{e.email}</td>
                  <td className="text-right">
                    {wmHref && (
                      <a href={wmHref} target="_blank" rel="noopener noreferrer" className="btn-icon text-emerald-600 dark:text-emerald-400 mr-1" title="Open in webmail">
                        <ExternalLink size={12} />
                      </a>
                    )}
                    <button className="btn-icon text-rose-500" onClick={() => del(e.email)} disabled={busy}><Trash2 size={12} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
