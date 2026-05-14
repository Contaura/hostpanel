import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useToast } from '../components/Toast';
import { Settings as SettingsIcon, Mail, CreditCard, Building, Save, TestTube, Upload } from 'lucide-react';

type Tab = 'general' | 'smtp' | 'billing' | 'paypal';

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

  useEffect(() => {
    api('/api/settings/').then(r => { setSettings(r.data); setLoading(false); }).catch(() => setLoading(false));
    fetch('/api/settings/logo', { headers: auth() }).then(r => r.ok ? r.json() : null).then(d => { if (d?.url) setLogoPreview(d.url); }).catch(() => {});
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

  const tabs = [
    { id: 'general' as Tab, label: 'General',   icon: Building  },
    { id: 'smtp'    as Tab, label: 'SMTP Email', icon: Mail      },
    { id: 'billing' as Tab, label: 'Billing',    icon: CreditCard},
    { id: 'paypal'  as Tab, label: 'PayPal',     icon: CreditCard},
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
          <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? 'tab-item-active' : 'tab-item'}>
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
