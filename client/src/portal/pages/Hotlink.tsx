import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast';
import { api, aput, HotlinkConfig } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Hotlink() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} />}
    </RequireAccount>
  );
}

function Inner({ domain }: { domain: string }) {
  const toast = useToast();
  const [cfg, setCfg]         = useState<HotlinkConfig | null>(null);
  const [allowed, setAllowed] = useState('');
  const [exts, setExts]       = useState('jpg,jpeg,png,gif,webp,mp4,mp3,pdf');
  const [busy, setBusy]       = useState(false);

  useEffect(() => { load(); }, [domain]);
  async function load() {
    try {
      const r = await api<HotlinkConfig>(`/api/portal/hotlink/${domain}`);
      setCfg(r.data);
      setAllowed((r.data.allowed_domains || []).join(', '));
      setExts(r.data.blocked_extensions || 'jpg,jpeg,png,gif,webp,mp4,mp3,pdf');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
  }
  async function save(enabled: boolean) {
    setBusy(true);
    try {
      const allowed_domains = allowed.split(/[\s,]+/).filter(Boolean);
      await aput(`/api/portal/hotlink/${domain}`, { enabled, allowed_domains, blocked_extensions: exts });
      toast.success(enabled ? 'Hotlink protection enabled' : 'Hotlink protection disabled');
      await load();
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl">
      <PageTitle title="Hotlink Protection" subtitle="Block other sites from embedding your images / media. Off-domain Referers get a 403." />
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Status:</span>
          {cfg === null ? <span className="text-slate-400">loading…</span> : cfg.enabled ? <span className="text-emerald-600 font-medium">Enabled</span> : <span className="text-slate-500">Disabled</span>}
        </div>
        <div>
          <label className="label text-xs">Extra allowed referer domains (comma-separated)</label>
          <input className="input font-mono text-xs" placeholder="example.com, cdn.partner.com" value={allowed} onChange={e => setAllowed(e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">Blocked extensions</label>
          <input className="input font-mono text-xs" placeholder="jpg,jpeg,png,gif,webp" value={exts} onChange={e => setExts(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary text-xs" onClick={() => save(true)} disabled={busy}>Enable / Save</button>
          {cfg?.enabled && <button className="btn-secondary text-xs" onClick={() => save(false)} disabled={busy}>Disable</button>}
        </div>
      </div>
    </div>
  );
}
