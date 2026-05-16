import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../context/ConfirmContext';
import { apost } from '../api';
import { RequireAccount, PageTitle } from '../components';

export default function Scripts() {
  return (
    <RequireAccount>
      {(account) => <Inner key={account.id} domain={account.domain} username={account.username} />}
    </RequireAccount>
  );
}

function Inner({ domain, username }: { domain: string; username: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ dbName: '', dbUser: '', dbPass: '', siteTitle: '', adminUser: '', adminPass: '', adminEmail: '' });
  const [busy, setBusy] = useState(false);

  async function install() {
    if (!form.dbName || !form.dbUser || !form.dbPass) return toast.error('Fill in DB name, user, password');
    if (!await confirm(`Install WordPress into ${domain}/public_html? This will overwrite existing files there.`)) return;
    setBusy(true);
    try { await apost('/api/portal/scripts/install', { script: 'wordpress', domain, ...form }); toast.success('WordPress installed'); }
    catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl">
      <PageTitle title="Install WordPress" subtitle={`One-click install into /var/www/${domain}/public_html. DB name and user must start with ${username}_.`} />
      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">DB name</label><input className="input font-mono text-xs" placeholder={`${username}_wp`} value={form.dbName} onChange={e => setForm(f => ({ ...f, dbName: e.target.value }))} /></div>
          <div><label className="label text-xs">DB user</label><input className="input font-mono text-xs" placeholder={`${username}_wpu`} value={form.dbUser} onChange={e => setForm(f => ({ ...f, dbUser: e.target.value }))} /></div>
          <div><label className="label text-xs">DB password</label><input className="input" type="password" value={form.dbPass} onChange={e => setForm(f => ({ ...f, dbPass: e.target.value }))} /></div>
          <div><label className="label text-xs">Site title</label><input className="input text-xs" placeholder="My WordPress Site" value={form.siteTitle} onChange={e => setForm(f => ({ ...f, siteTitle: e.target.value }))} /></div>
          <div><label className="label text-xs">WP admin user</label><input className="input text-xs" placeholder="admin" value={form.adminUser} onChange={e => setForm(f => ({ ...f, adminUser: e.target.value }))} /></div>
          <div><label className="label text-xs">WP admin password</label><input className="input" type="password" value={form.adminPass} onChange={e => setForm(f => ({ ...f, adminPass: e.target.value }))} /></div>
          <div className="col-span-2"><label className="label text-xs">WP admin email</label><input className="input text-xs" placeholder="you@example.com" value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} /></div>
        </div>
        <button className="btn-primary text-sm" onClick={install} disabled={busy}>Install WordPress</button>
      </div>
    </div>
  );
}
