import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Key, Plus, Trash2, Copy, User, Search } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useConfirm } from '../context/ConfirmContext';

interface SSHKey {
  id: number;
  type: string;
  key: string;
  comment: string;
}

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

type Tab = 'admin' | 'account';

export default function SSHKeys() {
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('admin');
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  // Per-account state
  const [acctUsername, setAcctUsername] = useState('');
  const [acctKeys, setAcctKeys] = useState<SSHKey[]>([]);
  const [showAcctForm, setShowAcctForm] = useState(false);
  const [newAcctKey, setNewAcctKey] = useState('');
  const [acctLoading, setAcctLoading] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const [acctSearch, setAcctSearch] = useState('');
  const [removing, setRemoving] = useState<number | null>(null);
  const [removingAcct, setRemovingAcct] = useState<number | null>(null);

  async function load() {
    try {
      const { data } = await axios.get<SSHKey[]>('/api/ssh-keys/list');
      setKeys(data);
    } catch { setKeys([]); } finally { setPageLoading(false); }
  }
  useEffect(() => {
    document.title = 'SSH Keys — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => { load(); }, []);

  async function addKey(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/ssh-keys/add', { key: newKey });
      toast.success('SSH key added');
      setNewKey(''); setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to add key'); }
    finally { setLoading(false); }
  }

  async function remove(id: number) {
    if (!await confirm('Remove this SSH key? You may lose SSH access if it\'s the only key.')) return;
    setRemoving(id);
    try {
      await axios.delete(`/api/ssh-keys/${id}`);
      toast.success('SSH key removed'); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setRemoving(null); }
  }

  async function loadAcctKeys() {
    if (!acctUsername.trim()) return;
    try {
      const { data } = await axios.get<SSHKey[]>(`/api/ssh-keys/account/${acctUsername.trim()}`);
      setAcctKeys(data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); setAcctKeys([]); }
  }

  async function addAcctKey(e: FormEvent) {
    e.preventDefault(); setAcctLoading(true);
    try {
      await axios.post(`/api/ssh-keys/account/${acctUsername.trim()}/add`, { key: newAcctKey });
      toast.success('Key added'); setNewAcctKey(''); setShowAcctForm(false); loadAcctKeys();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setAcctLoading(false); }
  }

  async function removeAcctKey(id: number) {
    if (!await confirm('Remove this SSH key?')) return;
    setRemovingAcct(id);
    try { await axios.delete(`/api/ssh-keys/account/${acctUsername.trim()}/${id}`); toast.success('Removed'); loadAcctKeys(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setRemovingAcct(null); }
  }

  function copyKey(fullKey: string) {
    navigator.clipboard.writeText(fullKey).then(() => toast.success('Key copied to clipboard'));
  }

  const TYPE_COLORS: Record<string, string> = {
    'ssh-rsa': 'badge-blue', 'ssh-ed25519': 'badge-green',
    'ecdsa-sha2-nistp256': 'badge-yellow', 'ssh-dss': 'badge-gray',
  };

  if (pageLoading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">SSH Key Manager</h1>
          <p className="page-subtitle">Manage authorized SSH public keys for this server</p>
        </div>
        {tab === 'admin' && (
          <button onClick={() => setShowForm(v => !v)} className="btn-primary">
            <Plus size={14} /> Add SSH Key
          </button>
        )}
        {tab === 'account' && acctUsername && (
          <button onClick={() => setShowAcctForm(v => !v)} className="btn-primary">
            <Plus size={14} /> Add Key
          </button>
        )}
      </div>

      <div className="tab-bar">
        <button className={tab === 'admin' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('admin')}><Key size={14} /> Admin Keys</button>
        <button className={tab === 'account' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('account')}><User size={14} /> Account Keys</button>
      </div>

      {tab === 'account' && (
        <div className="space-y-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="label">System Username</label>
              <input className="input font-mono" placeholder="ftpuser or hosting account username" value={acctUsername} onChange={e => setAcctUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadAcctKeys()} />
            </div>
            <button className="btn-secondary self-end" onClick={loadAcctKeys}>Load Keys</button>
          </div>

          {showAcctForm && (
            <form onSubmit={addAcctKey} className="card p-5 max-w-2xl space-y-4">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add Key for {acctUsername}</h2>
              <div>
                <label className="label">Public Key</label>
                <textarea className="input font-mono text-xs h-28 resize-none leading-relaxed" placeholder="ssh-ed25519 AAAA... user@machine"
                  value={newAcctKey} onChange={e => setNewAcctKey(e.target.value)} required />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={acctLoading} className="btn-primary">{acctLoading ? 'Adding…' : 'Add key'}</button>
                <button type="button" onClick={() => setShowAcctForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input className="input pl-8 w-48 text-sm" placeholder="Search keys…" value={acctSearch} onChange={e => setAcctSearch(e.target.value)} />
              </div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className={theadCls}><tr>
                  <th className="table-header-cell">Type</th>
                  <th className="table-header-cell">Key Fingerprint</th>
                  <th className="table-header-cell hidden md:table-cell">Comment</th>
                  <th className="px-4 py-3 w-20" />
                </tr></thead>
                <tbody>
                  {(() => {
                    const q = acctSearch.trim().toLowerCase();
                    const visible = q ? acctKeys.filter(k => [k.type, k.comment, k.key].some(v => String(v ?? '').toLowerCase().includes(q))) : acctKeys;
                    if (acctKeys.length === 0) return (
                      <tr><td colSpan={4} className="px-4 py-16 text-center">
                        <Key className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                        <p className="text-slate-400 text-sm">{acctUsername ? 'No SSH keys for this user' : 'Enter a username and click Load Keys'}</p>
                      </td></tr>
                    );
                    if (visible.length === 0) return <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No keys match "{acctSearch}"</td></tr>;
                    return visible.map(k => (
                      <tr key={k.id} className={rowCls}>
                        <td className="table-cell"><span className={TYPE_COLORS[k.type] || 'badge-gray'}>{k.type}</span></td>
                        <td className="table-cell font-mono text-xs text-slate-500 dark:text-slate-400">{k.key.slice(0, 20)}…{k.key.slice(-8)}</td>
                        <td className="table-cell text-slate-500 dark:text-slate-400 hidden md:table-cell">{k.comment || '—'}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => copyKey(`${k.type} ${k.key} ${k.comment}`.trim())} className="btn-icon hover:!text-indigo-600" title="Copy"><Copy size={13} /></button>
                            <button onClick={() => removeAcctKey(k.id)} disabled={removingAcct === k.id} className="btn-icon hover:!text-rose-600" title="Remove"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'admin' && showForm && (
        <form onSubmit={addKey} className="card p-5 max-w-2xl space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add Public Key</h2>
          <div>
            <label className="label">Public Key</label>
            <textarea
              className="input font-mono text-xs h-28 resize-none leading-relaxed"
              placeholder="ssh-ed25519 AAAA... user@machine"
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              required
            />
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              Paste the contents of your <code className="font-mono">~/.ssh/id_ed25519.pub</code> or <code className="font-mono">id_rsa.pub</code> file.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Adding…' : 'Add key'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {tab === 'admin' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-8 w-48 text-sm" placeholder="Search keys…" value={adminSearch} onChange={e => setAdminSearch(e.target.value)} />
            </div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className={theadCls}><tr>
                <th className="table-header-cell">Type</th>
                <th className="table-header-cell">Key Fingerprint</th>
                <th className="table-header-cell hidden md:table-cell">Comment</th>
                <th className="px-4 py-3 w-20" />
              </tr></thead>
              <tbody>
                {(() => {
                  const q = adminSearch.trim().toLowerCase();
                  const visible = q ? keys.filter(k => [k.type, k.comment, k.key].some(v => String(v ?? '').toLowerCase().includes(q))) : keys;
                  if (keys.length === 0) return (
                    <tr><td colSpan={4} className="px-4 py-16 text-center">
                      <Key className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                      <p className="text-slate-400 text-sm">No SSH keys configured</p>
                    </td></tr>
                  );
                  if (visible.length === 0) return <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No keys match "{adminSearch}"</td></tr>;
                  return visible.map(k => (
                    <tr key={k.id} className={rowCls}>
                      <td className="table-cell">
                        <span className={TYPE_COLORS[k.type] || 'badge-gray'}>{k.type}</span>
                      </td>
                      <td className="table-cell font-mono text-xs text-slate-500 dark:text-slate-400">
                        {k.key.slice(0, 20)}…{k.key.slice(-8)}
                      </td>
                      <td className="table-cell text-slate-500 dark:text-slate-400 hidden md:table-cell">{k.comment || '—'}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => copyKey(`${k.type} ${k.key} ${k.comment}`.trim())}
                            className="btn-icon hover:!text-indigo-600 dark:hover:!text-indigo-400 hover:!bg-indigo-50 dark:hover:!bg-indigo-900/30"
                            title="Copy">
                            <Copy size={13} />
                          </button>
                          <button onClick={() => remove(k.id)}
                            disabled={removing === k.id}
                            className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30"
                            title="Remove">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
