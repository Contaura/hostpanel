import { useEffect, useState, FormEvent } from 'react';
import axios from 'axios';
import { PackageOpen, CheckCircle2, ExternalLink, ChevronLeft } from 'lucide-react';
import { useToast } from '../components/Toast';

interface Script { id: string; name: string; description: string }

const SCRIPT_META: Record<string, { color: string; darkColor: string; bg: string; darkBg: string; initial: string }> = {
  wordpress:  { color: 'text-blue-600',   darkColor: 'dark:text-blue-400',   bg: 'bg-blue-50',   darkBg: 'dark:bg-blue-900/30',   initial: 'W' },
  joomla:     { color: 'text-orange-600', darkColor: 'dark:text-orange-400', bg: 'bg-orange-50', darkBg: 'dark:bg-orange-900/30', initial: 'J' },
  drupal:     { color: 'text-teal-600',   darkColor: 'dark:text-teal-400',   bg: 'bg-teal-50',   darkBg: 'dark:bg-teal-900/30',   initial: 'D' },
  phpmyadmin: { color: 'text-rose-600',   darkColor: 'dark:text-rose-400',   bg: 'bg-rose-50',   darkBg: 'dark:bg-rose-900/30',   initial: 'P' },
};

export default function ScriptInstaller() {
  const toast = useToast();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [selected, setSelected] = useState<Script | null>(null);
  const [domains, setDomains] = useState<string[]>([]);
  const [form, setForm] = useState({
    domain: '', dbName: '', dbUser: '', dbPass: '',
    siteTitle: '', adminUser: 'admin', adminPass: '', adminEmail: '',
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ message: string; url: string } | null>(null);

  useEffect(() => {
    axios.get<Script[]>('/api/scripts/available').then(r => setScripts(r.data));
    axios.get<string[]>('/api/domains/domains').then(r => setDomains(r.data));
  }, []);

  async function install(e: FormEvent) {
    e.preventDefault(); if (!selected) return; setLoading(true);
    try {
      const { data } = await axios.post('/api/scripts/install', { script: selected.id, ...form });
      setResult(data); toast.success(`${selected.name} installed successfully`);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Installation failed'); }
    finally { setLoading(false); }
  }

  if (result) {
    return (
      <div className="space-y-5">
        <h1 className="page-title">Script Installer</h1>
        <div className="card p-10 max-w-md text-center space-y-4">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{selected?.name} installed!</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{result.message}</p>
          </div>
          <a href={result.url} target="_blank" rel="noopener noreferrer" className="btn-primary w-full justify-center">
            <ExternalLink size={14} /> Visit site
          </a>
          <button onClick={() => { setResult(null); setSelected(null); }} className="btn-secondary w-full justify-center">
            Install another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Script Installer</h1>
        <p className="page-subtitle">One-click installation of popular web applications</p>
      </div>

      {!selected ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {scripts.map(script => {
            const m = SCRIPT_META[script.id] || { color: 'text-slate-600', darkColor: 'dark:text-slate-400', bg: 'bg-slate-100', darkBg: 'dark:bg-slate-700', initial: script.name[0] };
            return (
              <button key={script.id} onClick={() => setSelected(script)} className="card-hover p-6 text-left space-y-3">
                <div className={`h-12 w-12 rounded-2xl ${m.bg} ${m.darkBg} flex items-center justify-center`}>
                  <span className={`text-2xl font-black ${m.color} ${m.darkColor}`}>{m.initial}</span>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-100">{script.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{script.description}</p>
                </div>
                <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Install →</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="max-w-xl space-y-5">
          <button onClick={() => setSelected(null)} className="btn-ghost -ml-1">
            <ChevronLeft size={16} /> Back to scripts
          </button>

          {(() => {
            const m = SCRIPT_META[selected.id] || { color: 'text-slate-600', darkColor: 'dark:text-slate-400', bg: 'bg-slate-100', darkBg: 'dark:bg-slate-700', initial: selected.name[0] };
            return (
              <div className="flex items-center gap-4">
                <div className={`h-14 w-14 rounded-2xl ${m.bg} ${m.darkBg} flex items-center justify-center flex-shrink-0`}>
                  <span className={`text-3xl font-black ${m.color} ${m.darkColor}`}>{m.initial}</span>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Install {selected.name}</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{selected.description}</p>
                </div>
              </div>
            );
          })()}

          <form onSubmit={install} className="card p-6 space-y-5">
            <div>
              <label className="label">Install to domain</label>
              <select className="input" value={form.domain}
                onChange={e => setForm({ ...form, domain: e.target.value })} required>
                <option value="">Select domain…</option>
                {domains.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {selected.id !== 'phpmyadmin' && (
              <>
                <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                  <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">Database</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">DB Name</label>
                      <input className="input" placeholder="wp_mysite" value={form.dbName}
                        onChange={e => setForm({ ...form, dbName: e.target.value })} pattern="[a-zA-Z0-9_]*" />
                    </div>
                    <div>
                      <label className="label">DB Username</label>
                      <input className="input" placeholder="wp_user" value={form.dbUser}
                        onChange={e => setForm({ ...form, dbUser: e.target.value })} pattern="[a-zA-Z0-9_]*" />
                    </div>
                    <div className="col-span-2">
                      <label className="label">DB Password</label>
                      <input type="password" className="input" placeholder="••••••••" value={form.dbPass}
                        onChange={e => setForm({ ...form, dbPass: e.target.value })} />
                    </div>
                  </div>
                </div>

                {selected.id === 'wordpress' && (
                  <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">WordPress Setup</p>
                    <div className="space-y-3">
                      <div>
                        <label className="label">Site Title</label>
                        <input className="input" placeholder="My Awesome Site" value={form.siteTitle}
                          onChange={e => setForm({ ...form, siteTitle: e.target.value })} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="label">Admin Username</label>
                          <input className="input" value={form.adminUser}
                            onChange={e => setForm({ ...form, adminUser: e.target.value })} />
                        </div>
                        <div>
                          <label className="label">Admin Password</label>
                          <input type="password" className="input" placeholder="••••••••" value={form.adminPass}
                            onChange={e => setForm({ ...form, adminPass: e.target.value })} />
                        </div>
                      </div>
                      <div>
                        <label className="label">Admin Email</label>
                        <input type="email" className="input" placeholder="admin@example.com" value={form.adminEmail}
                          onChange={e => setForm({ ...form, adminEmail: e.target.value })} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <button type="submit" disabled={loading || !form.domain} className="btn-primary w-full justify-center py-2.5">
              {loading
                ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Installing {selected.name}…</>
                : <><PackageOpen size={15} /> Install {selected.name}</>
              }
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
