import { useEffect, useState } from 'react';
import { RefreshCw, Trash2, Send, FileSearch, RotateCcw, PauseCircle, PlayCircle, AlertOctagon, Search } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/mail-queue${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

type Tab = 'queue' | 'delivery-log' | 'bounce-log';

export default function MailQueue() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('queue');
  const [messages, setMessages] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [deliveryLog, setDeliveryLog] = useState<any[]>([]);
  const [logSearch, setLogSearch] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [bounceLog, setBounceLog] = useState<string[]>([]);
  const [bounceLoading, setBounceLoading] = useState(false);
  const [queueSearch, setQueueSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [q, s] = await Promise.all([api('/').then(r => r.json()), api('/stats').then(r => r.json())]);
      setMessages(Array.isArray(q) ? q : []);
      setStats(s);
    } finally { setLoading(false); }
  }

  async function loadDeliveryLog() {
    setLogLoading(true);
    const r = await api(`/delivery-log${logSearch ? `?search=${encodeURIComponent(logSearch)}` : ''}`);
    const d = await r.json();
    setDeliveryLog(d.lines || []);
    setLogLoading(false);
  }

  async function loadBounceLog() {
    setBounceLoading(true);
    const r = await api('/bounce-log');
    const d = await r.json();
    setBounceLog(d.lines || []);
    setBounceLoading(false);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { if (tab === 'delivery-log') loadDeliveryLog(); if (tab === 'bounce-log') loadBounceLog(); }, [tab]);

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

  async function retryMsg(id: string) {
    await api(`/retry/${id}`, { method: 'POST' });
    toast.success('Retry queued');
    load();
  }

  async function holdMsg(id: string) {
    await api(`/hold/${id}`, { method: 'POST' });
    toast.success('Message held');
    load();
  }

  async function unholdMsg(id: string) {
    await api(`/unhold/${id}`, { method: 'POST' });
    toast.success('Message released');
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Mail Queue</h1>
        <div className="flex gap-2">
          {tab === 'queue' && <>
            <button className="btn-ghost" onClick={load}><RefreshCw size={14} /></button>
            <button className="btn-secondary" onClick={flush}><Send size={14} className="mr-1" />Flush Queue</button>
            <button className="btn-danger" onClick={deleteAll}><Trash2 size={14} className="mr-1" />Clear Deferred</button>
          </>}
          {tab === 'delivery-log' && <button className="btn-secondary" onClick={loadDeliveryLog}><RefreshCw size={14} /> Refresh</button>}
          {tab === 'bounce-log' && <button className="btn-secondary" onClick={loadBounceLog}><RefreshCw size={14} /> Refresh</button>}
        </div>
      </div>

      <div className="tab-bar">
        <button className={tab === 'queue' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('queue')}><Send size={14} /> Mail Queue</button>
        <button className={tab === 'delivery-log' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('delivery-log')}><FileSearch size={14} /> Delivery Log</button>
        <button className={tab === 'bounce-log' ? 'tab-item-active' : 'tab-item'} onClick={() => setTab('bounce-log')}><AlertOctagon size={14} /> Bounce Log</button>
      </div>

      {tab === 'delivery-log' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Search by address, queue ID, domain…" value={logSearch} onChange={e => setLogSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadDeliveryLog()} />
            <button className="btn-secondary" onClick={loadDeliveryLog}><FileSearch size={14} /> Search</button>
          </div>
          <div className="card bg-slate-950 p-4 max-h-[60vh] overflow-y-auto">
            {logLoading && <p className="text-slate-400 text-xs">Loading…</p>}
            {!logLoading && deliveryLog.length === 0 && <p className="text-slate-400 text-xs">No log entries found.</p>}
            {deliveryLog.map((l: any) => (
              <div key={l.id} className="border-b border-slate-800 py-1.5">
                <span className="text-slate-500 text-xs mr-2">{l.time}</span>
                {l.queue_id && <span className="text-indigo-400 text-xs font-mono mr-2">[{l.queue_id}]</span>}
                <span className="text-slate-300 text-xs">{l.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'bounce-log' && (
        <div className="space-y-4">
          <div className="card bg-slate-950 p-4 max-h-[60vh] overflow-y-auto">
            {bounceLoading && <p className="text-slate-400 text-xs">Loading…</p>}
            {!bounceLoading && bounceLog.length === 0 && <p className="text-slate-400 text-xs">No bounce entries found in mail log.</p>}
            {bounceLog.map((line, i) => (
              <div key={i} className="text-xs font-mono text-slate-300 py-0.5 border-b border-slate-800/50 last:border-0">{line}</div>
            ))}
          </div>
        </div>
      )}

      {tab === 'queue' && <><div className="grid grid-cols-3 gap-4">
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

      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8 w-56 text-sm" placeholder="Search queue…" value={queueSearch} onChange={e => setQueueSearch(e.target.value)} />
          </div>
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
              {!loading && (() => {
                const q = queueSearch.trim().toLowerCase();
                const visible = q ? messages.filter((m: any) => [m.id, m.sender, m.status, ...(m.recipients || [])].some((v: any) => String(v ?? '').toLowerCase().includes(q))) : messages;
                if (messages.length === 0) return <tr><td colSpan={7} className="table-cell text-center text-slate-500">Queue is empty</td></tr>;
                if (visible.length === 0) return <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">No messages match "{queueSearch}"</td></tr>;
                return visible.map((m: any) => (
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
                      <div className="flex gap-1">
                        <button className="btn-icon text-blue-500" title="Retry" onClick={() => retryMsg(m.id)}><RotateCcw size={13} /></button>
                        {m.status === 'held'
                          ? <button className="btn-icon text-emerald-500" title="Unhold" onClick={() => unholdMsg(m.id)}><PlayCircle size={13} /></button>
                          : <button className="btn-icon text-amber-500" title="Hold" onClick={() => holdMsg(m.id)}><PauseCircle size={13} /></button>
                        }
                        <button className="btn-icon text-red-500" title="Delete" onClick={() => deleteMsg(m.id)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </div>
      </div></>}
    </div>
  );
}
