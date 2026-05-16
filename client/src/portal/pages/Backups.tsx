import { useEffect, useState } from 'react';
import { Plus, Trash2, Download } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { openAuthenticatedDownload } from '../../lib/api';
import { api, apost, adel, PortalBackup } from '../api';
import { usePortalAuth } from '../PortalAuthContext';
import { PageTitle } from '../components';

export default function Backups() {
  const toast = useToast();
  const confirm = useConfirm();
  const { selectedAccount } = usePortalAuth();
  const [backups, setBackups] = useState<PortalBackup[]>([]);
  const [busy, setBusy]       = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    try { const r = await api<PortalBackup[]>('/api/portal/backups'); setBackups(r.data); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function create() {
    if (!selectedAccount) return toast.error('Select a hosting account first');
    if (!await confirm(`Create a tar.gz of ${selectedAccount.domain}'s public_html tree? May take a minute.`)) return;
    setBusy(true);
    try { await apost(`/api/portal/backups/${selectedAccount.domain}`); toast.success('Backup created'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }
  async function del(name: string) {
    if (!await confirm(`Delete ${name}?`)) return;
    try { await adel(`/api/portal/backups/${encodeURIComponent(name)}`); toast.success('Deleted'); await load(); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }

  return (
    <div>
      <PageTitle title="Backups" subtitle="Webroot backups (files only, not databases — use the Databases page for those)." />
      <div className="card p-4 space-y-4">
        <button className="btn-primary text-xs" onClick={create} disabled={busy || !selectedAccount}>
          <Plus size={12} /> Create backup{selectedAccount ? ` of ${selectedAccount.domain}` : ''}
        </button>
        <table className="w-full text-sm">
          <tbody>
            {backups.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400 text-xs">No backups</td></tr>}
            {backups.map(b => (
              <tr key={b.name} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                <td className="py-2 px-1 font-mono text-xs">{b.name}</td>
                <td className="text-xs text-slate-500">{(b.size / 1024).toFixed(1)} KB · {new Date(b.created).toLocaleString()}</td>
                <td className="text-right">
                  <button className="btn-icon" title="Download" onClick={() => openAuthenticatedDownload(`/api/portal/backups/${encodeURIComponent(b.name)}/download`, { tokenKey: 'hp_portal_token', filename: b.name }).catch(e => toast.error(e.message))}><Download size={12} /></button>
                  <button className="btn-icon text-rose-500" onClick={() => del(b.name)}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
