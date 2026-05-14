import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { Key, Plus, Trash2, Copy } from 'lucide-react';
import { useToast } from '../components/Toast';

interface SSHKey {
  id: number;
  type: string;
  key: string;
  comment: string;
}

const theadCls = 'bg-slate-50 dark:bg-slate-700/40 border-b border-slate-100 dark:border-slate-700';
const rowCls   = 'border-b border-slate-50 dark:border-slate-700/40 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 group';

export default function SSHKeys() {
  const toast = useToast();
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const { data } = await axios.get<SSHKey[]>('/api/sshkeys/list');
      setKeys(data);
    } catch { setKeys([]); }
  }
  useEffect(() => { load(); }, []);

  async function addKey(e: FormEvent) {
    e.preventDefault(); setLoading(true);
    try {
      await axios.post('/api/sshkeys/add', { key: newKey });
      toast.success('SSH key added');
      setNewKey(''); setShowForm(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to add key'); }
    finally { setLoading(false); }
  }

  async function remove(id: number) {
    if (!confirm('Remove this SSH key? You may lose SSH access if it\'s the only key.')) return;
    try {
      await axios.delete(`/api/sshkeys/${id}`);
      toast.success('SSH key removed'); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  function copyKey(fullKey: string) {
    navigator.clipboard.writeText(fullKey).then(() => toast.success('Key copied to clipboard'));
  }

  const TYPE_COLORS: Record<string, string> = {
    'ssh-rsa': 'badge-blue', 'ssh-ed25519': 'badge-green',
    'ecdsa-sha2-nistp256': 'badge-yellow', 'ssh-dss': 'badge-gray',
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">SSH Key Manager</h1>
          <p className="page-subtitle">Manage authorized SSH public keys for this server</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <Plus size={14} /> Add SSH Key
        </button>
      </div>

      {showForm && (
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

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className={theadCls}><tr>
            <th className="table-header-cell">Type</th>
            <th className="table-header-cell">Key Fingerprint</th>
            <th className="table-header-cell hidden md:table-cell">Comment</th>
            <th className="px-4 py-3 w-20" />
          </tr></thead>
          <tbody>
            {keys.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-16 text-center">
                <Key className="mx-auto mb-2 text-slate-300 dark:text-slate-600" size={32} />
                <p className="text-slate-400 text-sm">No SSH keys configured</p>
              </td></tr>
            ) : keys.map(k => (
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
                      className="btn-icon hover:!text-rose-600 dark:hover:!text-rose-400 hover:!bg-rose-50 dark:hover:!bg-rose-900/30"
                      title="Remove">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
