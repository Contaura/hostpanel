import { useEffect, useState } from 'react';
import axios from 'axios';
import { Code2, Settings, Package, Save } from 'lucide-react';
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
  const [tab, setTab] = useState<'info' | 'settings' | 'extensions'>('info');
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
        {([['info', 'Overview', Code2], ['settings', 'Settings', Settings], ['extensions', 'Extensions', Package]] as const).map(([t, label, Icon]) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? 'tab-item-active' : 'tab-item'}>
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
          <input className="input" placeholder="Search extensions…"
            value={extSearch} onChange={e => setExtSearch(e.target.value)} />
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
    </div>
  );
}
