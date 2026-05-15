import { useEffect, useState } from 'react';
import axios from 'axios';
import { Code2, Settings, Package, Save, Sliders, Trash2, Search } from 'lucide-react';
import { useToast } from '../components/Toast';

interface PHPInfo {
  version: string;
  iniPath: string;
  extensions: string[];
}

type Settings = Record<string, string>;

const SETTING_LABELS: Record<string, { label: string; hint: string; type: 'text' | 'select' }> = {
  memory_limit:          { label: 'Memory Limit',          hint: 'e.g. 128M, 256M, 512M',        type: 'text' },
  max_execution_time:    { label: 'Max Execution Time',    hint: 'seconds (e.g. 30, 60, 120)',    type: 'text' },
  upload_max_filesize:   { label: 'Upload Max Filesize',   hint: 'e.g. 8M, 32M, 64M',            type: 'text' },
  post_max_size:         { label: 'Post Max Size',         hint: 'e.g. 8M, 32M (> upload)',       type: 'text' },
  max_input_vars:        { label: 'Max Input Vars',        hint: 'e.g. 1000, 3000, 5000',         type: 'text' },
  max_file_uploads:      { label: 'Max File Uploads',      hint: 'e.g. 20, 50',                   type: 'text' },
  display_errors:        { label: 'Display Errors',        hint: '',                              type: 'select' },
  default_timezone:      { label: 'Default Timezone',      hint: 'e.g. UTC, America/New_York',    type: 'text' },
  'session.gc_maxlifetime': { label: 'Session Max Lifetime', hint: 'seconds (default 1440)',      type: 'text' },
};

export default function PHPManager() {
  const toast = useToast();
  const [tab, setTab] = useState<'info' | 'settings' | 'extensions' | 'domain-ini' | 'fpm-pool'>('info');
  const [info, setInfo] = useState<PHPInfo | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [editSettings, setEditSettings] = useState<Settings>({});
  const [saving, setSaving] = useState(false);
  const [extSearch, setExtSearch] = useState('');

  async function load() {
    try {
      const [infoRes, settingsRes] = await Promise.all([
        axios.get<PHPInfo>('/api/php/info'),
        axios.get<Settings>('/api/php/settings'),
      ]);
      setInfo(infoRes.data);
      setSettings(settingsRes.data);
      setEditSettings({ ...settingsRes.data });
    } catch (err: any) { toast.error('Failed to load PHP info'); }
  }
  useEffect(() => { load(); }, []);

  async function saveSettings() {
    if (!info?.iniPath) return toast.error('PHP ini path not found');
    setSaving(true);
    try {
      await axios.post('/api/php/settings', { iniPath: info.iniPath, settings: editSettings });
      toast.success('PHP settings saved — changes take effect on next request');
      setSettings({ ...editSettings });
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  }

  const filteredExts = info?.extensions.filter(e => e.toLowerCase().includes(extSearch.toLowerCase())) ?? [];

  const [fpmDomain, setFpmDomain] = useState('');
  const [fpmPool, setFpmPool] = useState<Record<string, string>>({});
  const [fpmLoaded, setFpmLoaded] = useState(false);
  const [fpmSaving, setFpmSaving] = useState(false);
  const [deletingPool, setDeletingPool] = useState(false);

  async function loadFpmPool() {
    if (!fpmDomain.trim()) return toast.error('Enter a domain');
    try {
      const { data } = await axios.get(`/api/php/fpm-pool/${fpmDomain.trim()}`);
      setFpmPool(data || {});
      setFpmLoaded(true);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load FPM pool'); }
  }

  async function saveFpmPool() {
    setFpmSaving(true);
    try {
      await axios.put(`/api/php/fpm-pool/${fpmDomain.trim()}`, fpmPool);
      toast.success('PHP-FPM pool saved and reloaded');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to save'); }
    setFpmSaving(false);
  }

  async function deleteFpmPool() {
    if (!confirm(`Delete PHP-FPM pool for ${fpmDomain}?`)) return;
    setDeletingPool(true);
    try {
      await axios.delete(`/api/php/fpm-pool/${fpmDomain.trim()}`);
      toast.success('FPM pool deleted');
      setFpmLoaded(false); setFpmPool({});
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setDeletingPool(false); }
  }

  const [domainIniDomain, setDomainIniDomain] = useState('');
  const [domainIniSettings, setDomainIniSettings] = useState<Record<string, string>>({});
  const [domainIniLoaded, setDomainIniLoaded] = useState(false);
  const [domainIniSaving, setDomainIniSaving] = useState(false);

  async function loadDomainIni() {
    if (!domainIniDomain.trim()) return toast.error('Enter a domain');
    try {
      const { data } = await axios.get(`/api/php/user-ini/${domainIniDomain.trim()}`);
      setDomainIniSettings(data || {});
      setDomainIniLoaded(true);
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to load'); }
  }

  async function saveDomainIni() {
    setDomainIniSaving(true);
    try {
      await axios.put(`/api/php/user-ini/${domainIniDomain.trim()}`, domainIniSettings);
      toast.success('.user.ini saved');
    } catch (e: any) { toast.error(e.response?.data?.error || 'Failed to save'); }
    setDomainIniSaving(false);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">PHP Manager</h1>
        <p className="page-subtitle">View PHP configuration and manage settings</p>
      </div>

      {info && (
        <div className="flex items-center gap-3 p-4 card">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
            <Code2 size={20} className="text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <div className="font-bold text-slate-900 dark:text-slate-100">{info.version.split(' ').slice(0, 2).join(' ')}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">{info.iniPath || 'ini path unknown'}</div>
          </div>
        </div>
      )}

      <div className="tab-bar">
        {([['info', 'Overview', Code2], ['settings', 'Settings', Settings], ['extensions', 'Extensions', Package], ['domain-ini', 'Per-Domain PHP', Code2], ['fpm-pool', 'FPM Pool', Sliders]] as const).map(([t, label, Icon]) => (
          <button key={t} onClick={() => setTab(t as any)} className={tab === t ? 'tab-item-active' : 'tab-item'}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'info' && (
        <div className="card p-6 max-w-lg space-y-3">
          {info ? (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {Object.entries(settings).map(([key, val]) => (
                  <div key={key}>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{SETTING_LABELS[key]?.label || key}</div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100 font-mono">{val || '—'}</div>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Loaded extensions</div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{info.extensions.length} extensions loaded</div>
              </div>
            </>
          ) : (
            <p className="text-slate-400 text-sm">PHP not detected on this server</p>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="card p-6 max-w-xl space-y-5">
          <div className="grid grid-cols-2 gap-4">
            {Object.entries(SETTING_LABELS).map(([key, { label, hint, type }]) => (
              <div key={key}>
                <label className="label">{label}</label>
                {type === 'select' ? (
                  <select className="input" value={editSettings[key] || ''}
                    onChange={e => setEditSettings(s => ({ ...s, [key]: e.target.value }))}>
                    <option value="On">On</option>
                    <option value="Off">Off</option>
                  </select>
                ) : (
                  <input className="input font-mono" placeholder={hint}
                    value={editSettings[key] || ''}
                    onChange={e => setEditSettings(s => ({ ...s, [key]: e.target.value }))} />
                )}
              </div>
            ))}
          </div>
          <button onClick={saveSettings} disabled={saving} className="btn-primary">
            <Save size={14} /> {saving ? 'Saving…' : 'Save settings'}
          </button>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Changes are written to php.ini. PHP-FPM will be reloaded automatically.
          </p>
        </div>
      )}

      {tab === 'extensions' && (
        <div className="card p-5 space-y-4 max-w-2xl">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input className="input pl-8" placeholder="Search extensions…"
              value={extSearch} onChange={e => setExtSearch(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {filteredExts.map(ext => (
              <div key={ext} className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-sm">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-slate-700 dark:text-slate-300 font-mono text-xs truncate">{ext}</span>
              </div>
            ))}
            {filteredExts.length === 0 && (
              <div className="col-span-3 text-sm text-slate-400 text-center py-4">No extensions found</div>
            )}
          </div>
        </div>
      )}
      {tab === 'fpm-pool' && (
        <div className="card p-6 space-y-4 max-w-xl">
          <p className="text-sm text-slate-600 dark:text-slate-400">Edit the PHP-FPM pool configuration for a specific domain. Changes are written to <code className="text-xs font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">/etc/php-fpm.d/&lt;domain&gt;.conf</code> and FPM is reloaded.</p>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="example.com" value={fpmDomain}
              onChange={e => { setFpmDomain(e.target.value); setFpmLoaded(false); }} />
            <button className="btn-secondary" onClick={loadFpmPool}>Load</button>
          </div>
          {fpmLoaded && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['pm', 'Process Manager', 'dynamic, static, ondemand'],
                  ['pm.max_children', 'Max Children', 'e.g. 10'],
                  ['pm.start_servers', 'Start Servers', 'e.g. 2'],
                  ['pm.min_spare_servers', 'Min Spare Servers', 'e.g. 1'],
                  ['pm.max_spare_servers', 'Max Spare Servers', 'e.g. 3'],
                  ['pm.max_requests', 'Max Requests', 'e.g. 500'],
                  ['request_terminate_timeout', 'Terminate Timeout', 'e.g. 60s'],
                  ['rlimit_files', 'Open Files Limit', 'e.g. 1024'],
                ].map(([key, label, placeholder]) => (
                  <div key={key}>
                    <label className="label">{label}</label>
                    <input className="input font-mono" placeholder={placeholder}
                      value={fpmPool[key] || ''}
                      onChange={e => setFpmPool(p => ({ ...p, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={saveFpmPool} disabled={fpmSaving} className="btn-primary">
                  <Save size={14} /> {fpmSaving ? 'Saving…' : 'Save FPM Pool'}
                </button>
                <button onClick={deleteFpmPool} disabled={deletingPool} className="btn-secondary text-rose-600 dark:text-rose-400">
                  <Trash2 size={14} /> Delete Pool
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {tab === 'domain-ini' && (
        <div className="card p-6 space-y-4 max-w-xl">
          <p className="text-sm text-slate-600 dark:text-slate-400">Override PHP settings per-domain via <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1 rounded">.user.ini</code> in the domain's public_html folder.</p>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="example.com" value={domainIniDomain}
              onChange={e => { setDomainIniDomain(e.target.value); setDomainIniLoaded(false); }} />
            <button className="btn-secondary" onClick={loadDomainIni}>Load</button>
          </div>
          {domainIniLoaded && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(SETTING_LABELS).map(([key, { label, hint, type }]) => (
                  <div key={key}>
                    <label className="label">{label}</label>
                    {type === 'select' ? (
                      <select className="input" value={domainIniSettings[key] || ''}
                        onChange={e => setDomainIniSettings(s => ({ ...s, [key]: e.target.value }))}>
                        <option value="">— use global —</option>
                        <option value="On">On</option>
                        <option value="Off">Off</option>
                      </select>
                    ) : (
                      <input className="input font-mono" placeholder={hint}
                        value={domainIniSettings[key] || ''}
                        onChange={e => setDomainIniSettings(s => ({ ...s, [key]: e.target.value }))} />
                    )}
                  </div>
                ))}
              </div>
              <button onClick={saveDomainIni} disabled={domainIniSaving} className="btn-primary">
                <Save size={14} /> {domainIniSaving ? 'Saving…' : 'Save .user.ini'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
