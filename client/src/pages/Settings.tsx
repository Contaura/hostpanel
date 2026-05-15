import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { fetchApi } from '../lib/api';
import { Settings as SettingsIcon, Mail, CreditCard, Building, Save, TestTube, Upload, Shield, Server, Lock, X } from 'lucide-react';

type Tab = 'general' | 'smtp' | 'billing' | 'paypal' | 'security' | 'relay' | 'password-policy';

function token() { return localStorage.getItem('hp_token') || ''; }
const auth = () => ({ Authorization: 'Bearer ' + token() });
const api   = (p: string) => axios.get(p, { headers: auth() });
const aput  = (p: string, d: any) => axios.put(p, d, { headers: auth() });
const apost = (p: string, d: any) => axios.post(p, d, { headers: auth() });

export default function Settings() {
  const { success, error } = useToast();
  const [tab, setTab] = useState<Tab>('general');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [smtpPass, setSmtpPass] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [relay, setRelay] = useState({ relayhost: '', sasl_user: '', sasl_pass: '' });
  const [relayLoaded, setRelayLoaded] = useState(false);
  const [pwPolicy, setPwPolicy] = useState({ min_length: 8, require_upper: false, require_number: false, require_special: false });
  const [pwPolicyLoaded, setPwPolicyLoaded] = useState(false);

  useEffect(() => {
    document.title = 'Settings — HostPanel';
    return () => { document.title = 'HostPanel'; };
  }, []);

  useEffect(() => {
    api('/api/settings/').then(r => { setSettings(r.data); setLoading(false); }).catch(() => setLoading(false));
    fetchApi('/api/settings/logo').then(r => r.ok ? r.json() : null).then(d => { if (d?.url) setLogoPreview(d.url); }).catch(() => {});
  }, []);

  async function uploadLogo(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const r = await axios.post('/api/settings/logo', fd, { headers: { ...auth(), 'Content-Type': 'multipart/form-data' } });
      setLogoPreview(r.data.url);
      success('Logo uploaded');
    } catch (e: any) { error(e.response?.data?.error || 'Upload failed'); }
    setUploading(false);
  }

  async function removeLogo() {
    try {
      await axios.delete('/api/settings/logo', { headers: auth() });
      setLogoPreview(null);
      success('Logo removed');
    } catch (e: any) { error(e.response?.data?.error || 'Failed to remove logo'); }
  }

  function set(key: string, value: string) { setSettings(p => ({ ...p, [key]: value })); }

  async function save() {
    const payload = { ...settings };
    if (smtpPass) payload.smtp_pass = smtpPass;
    try { await aput('/api/settings/', payload); success('Settings saved'); }
    catch (e: any) { error(e.response?.data?.error || 'Failed to save'); }
  }

  async function testSmtp() {
    if (!testEmail) { error('Enter a test recipient email'); return; }
    setTesting(true);
    try {
      await apost('/api/settings/test-smtp', {
        smtp_host: settings.smtp_host, smtp_port: settings.smtp_port,
        smtp_user: settings.smtp_user, smtp_pass: smtpPass || settings.smtp_pass,
        smtp_from: settings.smtp_from, smtp_secure: settings.smtp_secure, to: testEmail,
      });
      success('Test email sent!');
    } catch (e: any) { error(e.response?.data?.error || 'SMTP test failed'); }
    setTesting(false);
  }

  async function loadRelay() {
    if (relayLoaded) return;
    try {
      const r = await fetchApi('/api/settings/relay');
      const d = await r.json();
      setRelay(v => ({ ...v, relayhost: d.relayhost || '', sasl_user: d.sasl_user || '' }));
      setRelayLoaded(true);
    } catch {}
  }

  async function loadPwPolicy() {
    if (pwPolicyLoaded) return;
    try {
      const r = await fetchApi('/api/admin-users/password-policy');
      const d = await r.json();
      setPwPolicy({ min_length: d.min_length || 8, require_upper: !!d.require_upper, require_number: !!d.require_number, require_special: !!d.require_special });
      setPwPolicyLoaded(true);
    } catch {}
  }

  async function savePwPolicy() {
    try {
      await aput('/api/admin-users/password-policy', pwPolicy);
      success('Password policy saved');
    } catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  async function saveRelay() {
    try {
      await aput('/api/settings/relay', relay);
      success('Postfix relay settings saved');
    } catch (e: any) { error(e.response?.data?.error || 'Failed'); }
  }

  const tabs = [
    { id: 'general'  as Tab, label: 'General',      icon: Building  },
    { id: 'smtp'     as Tab, label: 'SMTP Email',    icon: Mail      },
    { id: 'relay'    as Tab, label: 'Mail Relay',    icon: Server    },
    { id: 'billing'  as Tab, label: 'Billing',       icon: CreditCard},
    { id: 'paypal'   as Tab, label: 'PayPal',        icon: CreditCard},
    { id: 'security' as Tab, label: 'Security',      icon: Shield    },
    { id: 'password-policy' as Tab, label: 'Password Policy', icon: Lock },
  ];

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure company details, email, billing, and payment gateways</p>
      </div>

      <div className="tab-bar">
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); if (t.id === 'relay') loadRelay(); if (t.id === 'password-policy') loadPwPolicy(); }} className={tab === t.id ? 'tab-item-active' : 'tab-item'}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* General */}
      {tab === 'general' && (
        <div className="card p-5 space-y-4 max-w-xl">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Building size={15} /> Company Information</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Company Name</label><input className="input" value={settings.company_name || ''} onChange={e => set('company_name', e.target.value)} /></div>
            <div><label className="label">Company Email</label><input type="email" className="input" value={settings.company_email || ''} onChange={e => set('company_email', e.target.value)} /></div>
          </div>
          <div><label className="label">Address</label><input className="input" value={settings.company_address || ''} onChange={e => set('company_address', e.target.value)} /></div>
          <div className="col-span-2">
            <label className="label">Panel Logo</label>
            <div className="flex items-center gap-4">
              {logoPreview && <img src={logoPreview} alt="Logo" className="h-10 object-contain rounded border border-slate-200 dark:border-slate-700 p-1" />}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
              <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={14} /> {uploading ? 'Uploading…' : 'Upload Logo'}</button>
              {logoPreview && <button className="btn-icon text-red-500 hover:!bg-red-50 dark:hover:!bg-red-900/30" title="Remove logo" onClick={removeLogo}><X size={14} /></button>}
              {logoPreview && <span className="text-xs text-slate-400">Logo active — shows in sidebar</span>}
            </div>
          </div>
          <button className="btn-primary col-span-2" onClick={save}><Save size={14} /> Save</button>
        </div>
      )}

      {/* SMTP */}
      {tab === 'smtp' && (
        <div className="card p-5 space-y-4 max-w-xl">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Mail size={15} /> SMTP Configuration</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">SMTP Host</label><input className="input" placeholder="smtp.gmail.com" value={settings.smtp_host || ''} onChange={e => set('smtp_host', e.target.value)} /></div>
            <div><label className="label">Port</label><input type="number" className="input" placeholder="587" value={settings.smtp_port || ''} onChange={e => set('smtp_port', e.target.value)} /></div>
            <div><label className="label">Username</label><input className="input" value={settings.smtp_user || ''} onChange={e => set('smtp_user', e.target.value)} /></div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" placeholder="(leave blank to keep current)" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} />
            </div>
            <div><label className="label">From Address</label><input type="email" className="input" placeholder="noreply@example.com" value={settings.smtp_from || ''} onChange={e => set('smtp_from', e.target.value)} /></div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded" checked={settings.smtp_secure === '1'} onChange={e => set('smtp_secure', e.target.checked ? '1' : '0')} />
                <span className="text-sm">Use SSL/TLS (port 465)</span>
              </label>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <label className="label">Test Recipient Email</label>
            <div className="flex gap-2">
              <input type="email" className="input flex-1" placeholder="your@email.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} />
              <button className="btn-secondary" onClick={testSmtp} disabled={testing}><TestTube size={14} /> {testing ? 'Sending…' : 'Send Test'}</button>
            </div>
          </div>

          <button className="btn-primary" onClick={save}><Save size={14} /> Save SMTP Settings</button>
        </div>
      )}

      {/* Billing */}
      {tab === 'billing' && (
        <div className="card p-5 space-y-4 max-w-xl">
          <h3 className="font-semibold text-sm flex items-center gap-2"><CreditCard size={15} /> Billing & Invoicing</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Default Currency</label>
              <select className="input" value={settings.currency || 'USD'} onChange={e => set('currency', e.target.value)}>
                {['USD','EUR','GBP','CAD','AUD','JPY','CHF','BRL','MXN'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><label className="label">Invoice Prefix</label><input className="input" placeholder="INV" value={settings.invoice_prefix || ''} onChange={e => set('invoice_prefix', e.target.value)} /></div>
            <div><label className="label">Tax Name</label><input className="input" placeholder="VAT, Tax, GST…" value={settings.tax_name || ''} onChange={e => set('tax_name', e.target.value)} /></div>
            <div><label className="label">Default Tax Rate (%)</label><input type="number" step="0.01" min="0" max="100" className="input" value={settings.tax_rate || ''} onChange={e => set('tax_rate', e.target.value)} /></div>
          </div>
          <button className="btn-primary" onClick={save}><Save size={14} /> Save Billing Settings</button>
        </div>
      )}

      {/* Mail Relay */}
      {tab === 'relay' && (
        <div className="card p-5 space-y-4 max-w-xl">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Server size={15} /> Postfix Outbound Relay (Smarthost)</h3>
          <p className="text-xs text-slate-500">Configure Postfix to relay outgoing mail through an external SMTP provider (SendGrid, Mailgun, etc.).</p>
          <div>
            <label className="label">Relay Host</label>
            <input className="input font-mono" placeholder="[smtp.sendgrid.net]:587" value={relay.relayhost} onChange={e => setRelay(v => ({ ...v, relayhost: e.target.value }))} />
            <p className="text-xs text-slate-400 mt-1">Format: [hostname]:port</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">SASL Username</label><input className="input" placeholder="apikey" value={relay.sasl_user} onChange={e => setRelay(v => ({ ...v, sasl_user: e.target.value }))} /></div>
            <div><label className="label">SASL Password</label><input type="password" className="input" placeholder="(API key or password)" value={relay.sasl_pass} onChange={e => setRelay(v => ({ ...v, sasl_pass: e.target.value }))} /></div>
          </div>
          <button className="btn-primary" onClick={saveRelay}><Save size={14} /> Save Relay Config</button>
        </div>
      )}

      {/* Security */}
      {tab === 'security' && (
        <div className="card p-5 space-y-4 max-w-xl">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Shield size={15} /> Admin Security</h3>
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
            <div>
              <p className="text-sm font-medium">Require 2FA for All Admins</p>
              <p className="text-xs text-slate-500 mt-1">Forces all admin users to enroll in two-factor authentication</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer"
                checked={settings.panel_2fa_required === '1'}
                onChange={async e => {
                  set('panel_2fa_required', e.target.checked ? '1' : '0');
                  await aput('/api/settings/', { panel_2fa_required: e.target.checked ? '1' : '0' });
                  success(e.target.checked ? '2FA enforcement enabled' : '2FA enforcement disabled');
                }} />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>
        </div>
      )}

      {/* Password Policy */}
      {tab === 'password-policy' && (
        <div className="card p-5 space-y-5 max-w-xl">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Lock size={15} /> Admin Password Policy</h3>
          <p className="text-xs text-slate-500">These rules are enforced when creating or changing admin user passwords.</p>
          <div>
            <label className="label">Minimum Length</label>
            <input type="number" className="input w-32" min={6} max={64} value={pwPolicy.min_length}
              onChange={e => setPwPolicy(p => ({ ...p, min_length: parseInt(e.target.value) || 8 }))} />
          </div>
          <div className="space-y-3">
            {([
              ['require_upper', 'Require uppercase letter (A-Z)'],
              ['require_number', 'Require digit (0-9)'],
              ['require_special', 'Require special character (!@#$…)'],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-3 cursor-pointer">
                <div className="relative inline-flex">
                  <input type="checkbox" className="sr-only peer" checked={pwPolicy[k]}
                    onChange={e => setPwPolicy(p => ({ ...p, [k]: e.target.checked }))} />
                  <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </div>
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
          <button className="btn-primary" onClick={savePwPolicy}><Save size={14} /> Save Password Policy</button>
        </div>
      )}

      {/* PayPal */}
      {tab === 'paypal' && (
        <div className="card p-5 space-y-4 max-w-xl">
          <h3 className="font-semibold text-sm flex items-center gap-2"><CreditCard size={15} /> PayPal Integration</h3>
          <div>
            <label className="label">Mode</label>
            <select className="input w-40" value={settings.paypal_mode || 'sandbox'} onChange={e => set('paypal_mode', e.target.value)}>
              <option value="sandbox">Sandbox (testing)</option>
              <option value="live">Live</option>
            </select>
          </div>
          <div><label className="label">Client ID</label><input className="input" value={settings.paypal_client_id || ''} onChange={e => set('paypal_client_id', e.target.value)} /></div>
          <div><label className="label">Secret</label><input type="password" className="input" placeholder="(leave blank to keep current)" onChange={e => set('paypal_secret', e.target.value)} /></div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300">
            Get your credentials at <strong>developer.paypal.com</strong> → My Apps &amp; Credentials → Create App.
          </div>
          <button className="btn-primary" onClick={save}><Save size={14} /> Save PayPal Settings</button>
        </div>
      )}
    </div>
  );
}
