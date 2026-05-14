import { useEffect, useState } from 'react';
import { Plus, Trash2, Bell, Send } from 'lucide-react';
import { useToast } from '../components/Toast';

const api = (p: string, o?: RequestInit) => fetch(`/api/notifications${p}`, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hp_token')}` }, ...o });

const blank = { name: '', url: '', type: 'webhook', events: [] as string[], secret: '' };

export default function Notifications() {
  const toast = useToast();
  const [hooks, setHooks] = useState<any[]>([]);
  const [allEvents, setAllEvents] = useState<string[]>([]);
  const [form, setForm] = useState<any>(blank);
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); api('/events').then(r => r.json()).then(setAllEvents); }, []);

  async function load() {
    const r = await api('/');
    setHooks(Array.isArray(await r.json()) ? await r.clone().json() : []);
  }

  async function save() {
    const r = await api('/', { method: 'POST', body: JSON.stringify(form) });
    const d = await r.json();
    if (d.error) { toast.error(d.error); return; }
    toast.success('Webhook created');
    setAdding(false); setForm({ ...blank, events: [] });
    load();
  }

  async function del(id: number) {
    await api(`/${id}`, { method: 'DELETE' });
    setHooks(h => h.filter(x => x.id !== id));
  }

  async function test(id: number) {
    const r = await api(`/${id}/test`, { method: 'POST' });
    const d = await r.json();
    if (d.error) toast.error(d.error);
    else toast.success('Test notification sent');
  }

  async function toggleEnabled(hook: any) {
    await api(`/${hook.id}`, { method: 'PUT', body: JSON.stringify({ ...hook, enabled: !hook.enabled }) });
    load();
  }

  function toggleEvent(e: string) {
    setForm((f: any) => ({
      ...f,
      events: f.events.includes(e) ? f.events.filter((x: string) => x !== e) : [...f.events, e],
    }));
  }

  const typeIcon: Record<string, string> = { webhook: '🔗', slack: '💬', discord: '🎮', email: '📧' };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Notification Webhooks</h1>
        <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={14} className="mr-1" />Add Webhook</button>
      </div>

      {adding && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-sm">New Notification Channel</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} /></div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type} onChange={e => setForm((f: any) => ({ ...f, type: e.target.value }))}>
                <option value="webhook">Generic Webhook</option>
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
                <option value="email">Email</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">{form.type === 'email' ? 'Recipient Email' : 'Webhook URL'}</label>
              <input className="input" type={form.type === 'email' ? 'email' : 'url'} value={form.url} onChange={e => setForm((f: any) => ({ ...f, url: e.target.value }))} />
            </div>
            {form.type === 'webhook' && (
              <div className="col-span-2"><label className="label">Secret (optional)</label><input className="input" value={form.secret} onChange={e => setForm((f: any) => ({ ...f, secret: e.target.value }))} /></div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Events to send</label>
              <div className="flex gap-2 text-xs">
                <button className="text-indigo-500" onClick={() => setForm((f: any) => ({ ...f, events: [...allEvents] }))}>All</button>
                <button className="text-slate-500" onClick={() => setForm((f: any) => ({ ...f, events: [] }))}>None</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allEvents.map(e => (
                <button
                  key={e}
                  onClick={() => toggleEvent(e)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${form.events.includes(e) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={save}>Create</button>
            <button className="btn-ghost text-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {hooks.length === 0 && <p className="text-sm text-slate-500">No notification channels configured.</p>}
        {hooks.map((h: any) => (
          <div key={h.id} className="card">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{typeIcon[h.type] || '🔗'}</span>
                <div>
                  <p className="font-medium text-sm">{h.name}</p>
                  <p className="text-xs text-slate-500 font-mono truncate max-w-[300px]">{h.url}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleEnabled(h)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${h.enabled ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${h.enabled ? 'left-4' : 'left-0.5'}`} />
                </button>
                <button className="btn-icon" title="Send test" onClick={() => test(h.id)}><Send size={13} /></button>
                <button className="btn-icon text-red-500" onClick={() => del(h.id)}><Trash2 size={13} /></button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(h.events || []).slice(0, 8).map((e: string) => (
                <span key={e} className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded">{e}</span>
              ))}
              {(h.events || []).length > 8 && <span className="text-xs text-slate-400">+{h.events.length - 8} more</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
