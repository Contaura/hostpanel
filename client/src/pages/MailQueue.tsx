import { useEffect, useState } from 'react';
import { RefreshCw, Trash2, Send } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/mail-queue${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, ...o });

export default function MailQueue() {
  const toast = useToast();
  const [messages, setMessages] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [q, s] = await Promise.all([api('/').then(r => r.json()), api('/stats').then(r => r.json())]);
      setMessages(Array.isArray(q) ? q : []);
      setStats(s);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function flush() {
    await api('/flush', { method: 'POST' });
    toast.success('Queue flushed');
    load();
  }

  async function deleteMsg(id: string) {
    await api(`/${id}`, { method: 'DELETE' });
    setMessages(m => m.filter(x => x.id !== id));
  }

  async function deleteAll() {
    if (!confirm('Delete all deferred messages?')) return;
    await api('/', { method: 'DELETE' });
    toast.success('Deferred queue cleared');
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Mail Queue</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={load}><RefreshCw size={14} /></button>
          <button className="btn-secondary" onClick={flush}><Send size={14} className="mr-1" />Flush Queue</button>
          <button className="btn-danger" onClick={deleteAll}><Trash2 size={14} className="mr-1" />Clear Deferred</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[['Active', stats.active ?? 0, 'bg-emerald-500'], ['Deferred', stats.deferred ?? 0, 'bg-amber-500'], ['Held', stats.held ?? 0, 'bg-red-500']].map(([label, val, color]) => (
          <div key={label as string} className="card flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${color}`} />
            <div>
              <p className="text-2xl font-bold">{val}</p>
              <p className="text-xs text-slate-500">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {['ID', 'From', 'Recipients', 'Size', 'Date', 'Status', ''].map(h => (
                <th key={h} className="table-header-cell">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="table-cell text-center text-slate-500">Loading…</td></tr>}
            {!loading && messages.length === 0 && <tr><td colSpan={7} className="table-cell text-center text-slate-500">Queue is empty</td></tr>}
            {messages.map((m: any) => (
              <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="table-cell font-mono text-xs">{m.id}</td>
                <td className="table-cell text-xs">{m.sender}</td>
                <td className="table-cell text-xs">{(m.recipients || []).join(', ')}</td>
                <td className="table-cell text-xs">{m.size}</td>
                <td className="table-cell text-xs">{m.date}</td>
                <td className="table-cell">
                  <span className={`badge-${m.status === 'active' ? 'success' : m.status === 'deferred' ? 'warning' : 'danger'}`}>{m.status}</span>
                </td>
                <td className="table-cell">
                  <button className="btn-icon text-red-500" onClick={() => deleteMsg(m.id)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
