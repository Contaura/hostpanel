import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Zap, LogOut, FileText, Download, CreditCard, ExternalLink, CheckCircle, Clock, AlertCircle, Shield, Lock, Server, Globe, Mail, Plus, Trash2, KeyRound, RefreshCw } from 'lucide-react';
import { useConfirm } from '../context/ConfirmContext';
import { safeHttpUrl } from '../lib/safeUrl';
import { openAuthenticatedDownload } from '../lib/api';

interface Invoice { id: number; invoice_number: string; amount: number; currency: string; status: string; due_date: string; paid_date: string; created_at: string; account_domain: string; notes: string }
interface PortalAccount { id: number; username: string; domain: string; status: string; expires_at: string | null; created_at: string; plan_name?: string; plan_price?: number; disk_quota?: number; email_accts?: number }
interface DnsRecord { name: string; type: string; value: string; ttl: string }
interface EmailAcct { email: string }
interface Forwarder { from: string; to: string }
interface FtpUser { username: string; directory: string | null }
interface DbRow { name: string }
interface DbUserRow { User?: string; user?: string; Host?: string; host?: string }
interface SslStatus { issued: boolean; expires?: string | null }
interface PortalSub { fqdn: string; parent: string; docroot: string }
interface PortalRedirect { id: number; domain: string; source: string; target: string; type: string; created_at: string }
interface PortalAutoresponder { id: number; email: string; subject: string; body: string; enabled: number }
interface MailAuth { domain: string; dkim: string | null; spf: string; dmarc: string }
interface PortalBackup { name: string; size: number; created: string }
interface FileItem { name: string; type: string; size: number; modified: string; permissions: string }
interface SshKey { id: number; raw: string; comment: string }
interface SshKeyGroup { user: string; keys: SshKey[] }
interface CronGroup { user: string; jobs: { id: number; line: string }[] }

function portalAuth() { return { Authorization: 'Bearer ' + (localStorage.getItem('hp_portal_token') || '') }; }
const api   = (p: string) => axios.get(p, { headers: portalAuth() });
const apost = (p: string, d?: any) => axios.post(p, d || {}, { headers: portalAuth() });
const adel  = (p: string) => axios.delete(p, { headers: portalAuth() });

const STATUS_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  paid:      { icon: CheckCircle, color: 'text-emerald-500', label: 'Paid' },
  unpaid:    { icon: Clock,       color: 'text-amber-500',   label: 'Unpaid' },
  overdue:   { icon: AlertCircle, color: 'text-red-500',     label: 'Overdue' },
  cancelled: { icon: AlertCircle, color: 'text-slate-400',   label: 'Cancelled' },
};

export default function ClientPortal() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'invoices' | 'hosting' | 'security'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [client, setClient]     = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [payingId, setPayingId] = useState<number | null>(null);

  // Hosting state
  const [accounts, setAccounts]                 = useState<PortalAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded]     = useState(false);
  const [selectedAccount, setSelectedAccount]   = useState<PortalAccount | null>(null);
  const [accountSubtab, setAccountSubtab]       = useState<'details' | 'files' | 'subdomains' | 'dns' | 'redirects' | 'errpages' | 'email' | 'mailauth' | 'ftp' | 'databases' | 'cron' | 'sshkeys' | 'backups' | 'scripts' | 'ssl'>('details');
  const [usage, setUsage]                       = useState<{ disk_bytes: number } | null>(null);
  const [dnsRecords, setDnsRecords]             = useState<DnsRecord[]>([]);
  const [dnsForm, setDnsForm]                   = useState({ name: '', type: 'A', value: '', ttl: '3600' });
  const [emailAccts, setEmailAccts]             = useState<EmailAcct[]>([]);
  const [emailForm, setEmailForm]               = useState({ user: '', password: '' });
  const [forwarders, setForwarders]             = useState<Forwarder[]>([]);
  const [fwdForm, setFwdForm]                   = useState({ from: '', to: '' });
  const [ftpUsers, setFtpUsers]                 = useState<FtpUser[]>([]);
  const [ftpForm, setFtpForm]                   = useState({ username: '', password: '' });
  const [dbs, setDbs]                           = useState<DbRow[]>([]);
  const [dbUsers, setDbUsers]                   = useState<DbUserRow[]>([]);
  const [dbForm, setDbForm]                     = useState({ name: '' });
  const [dbUserForm, setDbUserForm]             = useState({ username: '', password: '', database: '' });
  const [sslStatus, setSslStatus]               = useState<SslStatus | null>(null);
  // Round-4 additions: subdomains, redirects, files, errpages, mail-auth, cron, ssh keys, backups, scripts, autoresp+catchall
  const [subdomains, setSubdomains]             = useState<PortalSub[]>([]);
  const [subForm, setSubForm]                   = useState({ subdomain: '' });
  const [redirects, setRedirects]               = useState<PortalRedirect[]>([]);
  const [redForm, setRedForm]                   = useState({ source: '', target: '', type: '301' });
  const [filePath, setFilePath]                 = useState('/');
  const [files, setFiles]                       = useState<FileItem[]>([]);
  const [fileEditor, setFileEditor]             = useState<{ path: string; content: string } | null>(null);
  const [autoresp, setAutoresp]                 = useState<PortalAutoresponder[]>([]);
  const [autorespForm, setAutorespForm]         = useState({ user: '', subject: '', body: '' });
  const [catchall, setCatchall]                 = useState<{ destination: string | null } | null>(null);
  const [catchallForm, setCatchallForm]         = useState({ destination: '' });
  const [mailAuth, setMailAuth]                 = useState<MailAuth | null>(null);
  const [spfForm, setSpfForm]                   = useState({ include: '' });
  const [dmarcForm, setDmarcForm]               = useState({ policy: 'none', rua: '' });
  const [errCode, setErrCode]                   = useState('404');
  const [errContent, setErrContent]             = useState('');
  const [cronGroups, setCronGroups]             = useState<CronGroup[]>([]);
  const [cronForm, setCronForm]                 = useState({ user: '', schedule: '0 * * * *', command: '' });
  const [sshGroups, setSshGroups]               = useState<SshKeyGroup[]>([]);
  const [sshForm, setSshForm]                   = useState({ user: '', key: '' });
  const [backups, setBackups]                   = useState<PortalBackup[]>([]);
  const [scriptForm, setScriptForm]             = useState({ dbName: '', dbUser: '', dbPass: '', siteTitle: '', adminUser: '', adminPass: '', adminEmail: '' });
  const [hostingBusy, setHostingBusy]           = useState(false);

  // 2FA state
  const [totpStatus, setTotpStatus]     = useState<{ enabled: boolean } | null>(null);
  const [totpSetup, setTotpSetup]       = useState<{ qr: string; secret: string } | null>(null);
  const [totpCode, setTotpCode]         = useState('');
  const [totpLoading, setTotpLoading]   = useState(false);

  // Password change
  const [pwForm, setPwForm]   = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwBusy, setPwBusy]   = useState(false);

  const portalName = localStorage.getItem('hp_portal_name') || 'Client';

  useEffect(() => {
    const tk = localStorage.getItem('hp_portal_token');
    if (!tk) { navigate('/portal/login'); return; }
    load();

    const payment = params.get('payment');
    if (payment === 'success') setToast({ type: 'success', msg: 'Payment successful! Your invoice has been marked as paid.' });
    if (payment === 'cancelled') setToast({ type: 'error', msg: 'Payment was cancelled.' });
  }, []);

  useEffect(() => { if (tab === 'security') loadTotpStatus(); }, [tab]);
  useEffect(() => { if (tab === 'hosting' && !accountsLoaded) loadAccounts(); }, [tab]);
  useEffect(() => {
    // When the user picks an account, refresh its sub-tab data based on
    // which sub-tab is currently active. Switching sub-tabs lazily fetches
    // the matching slice — no point loading DNS for an account whose user
    // only wants to see the details pane.
    if (!selectedAccount) return;
    setUsage(null); setDnsRecords([]); setEmailAccts([]); setForwarders([]);
    setFtpUsers([]); setDbs([]); setDbUsers([]); setSslStatus(null);
    setSubdomains([]); setRedirects([]); setFiles([]); setFileEditor(null); setAutoresp([]);
    setCatchall(null); setMailAuth(null); setCronGroups([]); setSshGroups([]); setBackups([]);
    if (accountSubtab === 'details')    loadUsage(selectedAccount.id);
    if (accountSubtab === 'dns')        loadDns(selectedAccount.domain);
    if (accountSubtab === 'email')      { loadEmailAccts(selectedAccount.domain); loadForwarders(selectedAccount.domain); loadAutoresp(); loadCatchall(selectedAccount.domain); }
    if (accountSubtab === 'mailauth')   loadMailAuth(selectedAccount.domain);
    if (accountSubtab === 'ftp')        loadFtpUsers();
    if (accountSubtab === 'databases')  { loadDbs(); loadDbUsers(); }
    if (accountSubtab === 'ssl')        loadSslStatus(selectedAccount.domain);
    if (accountSubtab === 'subdomains') loadSubdomains();
    if (accountSubtab === 'redirects')  loadRedirects();
    if (accountSubtab === 'files')      { setFilePath('/'); loadFiles(selectedAccount.domain, '/'); }
    if (accountSubtab === 'errpages')   { setErrCode('404'); loadErrPage(selectedAccount.domain, '404'); }
    if (accountSubtab === 'cron')       loadCron();
    if (accountSubtab === 'sshkeys')    loadSshKeys();
    if (accountSubtab === 'backups')    loadBackups();
  }, [selectedAccount, accountSubtab]);

  async function load() {
    setLoading(true);
    try {
      const [iRes, cRes] = await Promise.all([api('/api/portal/invoices'), api('/api/portal/me')]);
      setInvoices(iRes.data); setClient(cRes.data);
    } catch { navigate('/portal/login'); }
    setLoading(false);
  }

  async function loadTotpStatus() {
    try { const r = await api('/api/portal/totp'); setTotpStatus(r.data); }
    catch { setTotpStatus(null); }
  }

  async function startTotpSetup() {
    setTotpLoading(true);
    try { const r = await apost('/api/portal/totp/setup'); setTotpSetup(r.data); setTotpCode(''); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Setup failed' }); }
    setTotpLoading(false);
  }

  async function verifyTotp() {
    if (totpCode.length !== 6) return;
    setTotpLoading(true);
    try {
      await apost('/api/portal/totp/verify', { token: totpCode });
      setToast({ type: 'success', msg: '2FA enabled successfully' });
      setTotpSetup(null); setTotpCode(''); loadTotpStatus();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Invalid code' }); }
    setTotpLoading(false);
  }

  async function disableTotp() {
    if (!await confirm('Disable two-factor authentication? This will reduce your account security.')) return;
    setTotpLoading(true);
    try {
      await adel('/api/portal/totp');
      setToast({ type: 'success', msg: '2FA disabled' });
      loadTotpStatus();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setTotpLoading(false);
  }

  /* ── Hosting tab actions ───────────────────────────────────── */

  async function loadAccounts() {
    try { const r = await api('/api/portal/accounts'); setAccounts(r.data); setAccountsLoaded(true); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed to load hosting accounts' }); }
  }

  async function loadUsage(accountId: number) {
    try { const r = await api(`/api/portal/accounts/${accountId}/usage`); setUsage(r.data); }
    catch { /* leave null */ }
  }

  async function loadDns(domain: string) {
    try { const r = await api(`/api/portal/domains/${domain}/dns`); setDnsRecords(r.data.records || []); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed to load DNS records' }); }
  }

  async function addDnsRecord() {
    if (!selectedAccount) return;
    if (!dnsForm.name || !dnsForm.value) { setToast({ type: 'error', msg: 'Name and value are required' }); return; }
    setHostingBusy(true);
    try {
      await apost(`/api/portal/domains/${selectedAccount.domain}/dns`, dnsForm);
      setToast({ type: 'success', msg: 'DNS record added' });
      setDnsForm({ name: '', type: 'A', value: '', ttl: '3600' });
      await loadDns(selectedAccount.domain);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function deleteDnsRecord(index: number) {
    if (!selectedAccount) return;
    if (!await confirm('Delete this DNS record?')) return;
    setHostingBusy(true);
    try {
      await adel(`/api/portal/domains/${selectedAccount.domain}/dns/${index}`);
      setToast({ type: 'success', msg: 'DNS record removed' });
      await loadDns(selectedAccount.domain);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadEmailAccts(domain: string) {
    try { const r = await api(`/api/portal/email/accounts?domain=${encodeURIComponent(domain)}`); setEmailAccts(r.data); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed to load mailboxes' }); }
  }

  async function addEmailAcct() {
    if (!selectedAccount) return;
    if (!emailForm.user || !emailForm.password) { setToast({ type: 'error', msg: 'Username and password are required' }); return; }
    if (emailForm.password.length < 8) { setToast({ type: 'error', msg: 'Password must be at least 8 characters' }); return; }
    setHostingBusy(true);
    try {
      await apost('/api/portal/email/accounts', { email: `${emailForm.user}@${selectedAccount.domain}`, password: emailForm.password });
      setToast({ type: 'success', msg: 'Mailbox created' });
      setEmailForm({ user: '', password: '' });
      await loadEmailAccts(selectedAccount.domain);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function deleteEmailAcct(email: string) {
    if (!await confirm(`Delete mailbox ${email}? All mail will be lost.`)) return;
    setHostingBusy(true);
    try {
      await adel(`/api/portal/email/accounts/${encodeURIComponent(email)}`);
      setToast({ type: 'success', msg: 'Mailbox deleted' });
      if (selectedAccount) await loadEmailAccts(selectedAccount.domain);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadForwarders(domain: string) {
    try { const r = await api(`/api/portal/email/forwarders?domain=${encodeURIComponent(domain)}`); setForwarders(r.data); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed to load forwarders' }); }
  }
  async function addForwarder() {
    if (!selectedAccount || !fwdForm.from || !fwdForm.to) return;
    setHostingBusy(true);
    try {
      const from = fwdForm.from.includes('@') ? fwdForm.from : `${fwdForm.from}@${selectedAccount.domain}`;
      await apost('/api/portal/email/forwarders', { from, to: fwdForm.to });
      setToast({ type: 'success', msg: 'Forwarder created' });
      setFwdForm({ from: '', to: '' });
      await loadForwarders(selectedAccount.domain);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteForwarder(from: string) {
    if (!await confirm(`Delete forwarder for ${from}?`)) return;
    setHostingBusy(true);
    try {
      await adel(`/api/portal/email/forwarders/${encodeURIComponent(from)}`);
      setToast({ type: 'success', msg: 'Forwarder removed' });
      if (selectedAccount) await loadForwarders(selectedAccount.domain);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadFtpUsers() {
    try { const r = await api('/api/portal/ftp/users'); setFtpUsers(r.data); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }
  async function addFtpUser() {
    if (!selectedAccount || !ftpForm.username || !ftpForm.password) return;
    if (ftpForm.password.length < 8) { setToast({ type: 'error', msg: 'Password must be ≥ 8 chars' }); return; }
    setHostingBusy(true);
    try {
      await apost('/api/portal/ftp/users', { username: ftpForm.username, password: ftpForm.password, domain: selectedAccount.domain });
      setToast({ type: 'success', msg: 'FTP user created' });
      setFtpForm({ username: '', password: '' });
      await loadFtpUsers();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteFtpUser(username: string) {
    if (!await confirm(`Delete FTP user ${username}?`)) return;
    setHostingBusy(true);
    try {
      await adel(`/api/portal/ftp/users/${encodeURIComponent(username)}`);
      setToast({ type: 'success', msg: 'FTP user deleted' });
      await loadFtpUsers();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadDbs()      { try { const r = await api('/api/portal/databases');        setDbs(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function loadDbUsers()  { try { const r = await api('/api/portal/databases/users');  setDbUsers(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function addDb() {
    if (!dbForm.name) return;
    setHostingBusy(true);
    try {
      await apost('/api/portal/databases', { name: dbForm.name });
      setToast({ type: 'success', msg: 'Database created' }); setDbForm({ name: '' }); await loadDbs();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteDb(name: string) {
    if (!await confirm(`Drop database ${name}? All data will be lost.`)) return;
    setHostingBusy(true);
    try { await adel(`/api/portal/databases/${encodeURIComponent(name)}`); setToast({ type: 'success', msg: 'Database dropped' }); await loadDbs(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function addDbUser() {
    if (!dbUserForm.username || !dbUserForm.password) return;
    if (dbUserForm.password.length < 8) { setToast({ type: 'error', msg: 'Password must be ≥ 8 chars' }); return; }
    setHostingBusy(true);
    try {
      await apost('/api/portal/databases/users', dbUserForm);
      setToast({ type: 'success', msg: 'DB user created' });
      setDbUserForm({ username: '', password: '', database: '' });
      await loadDbUsers();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteDbUser(username: string) {
    if (!await confirm(`Delete DB user ${username}?`)) return;
    setHostingBusy(true);
    try { await adel(`/api/portal/databases/users/${encodeURIComponent(username)}`); setToast({ type: 'success', msg: 'DB user deleted' }); await loadDbUsers(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadSslStatus(domain: string) {
    try { const r = await api(`/api/portal/ssl/${domain}/status`); setSslStatus(r.data); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }
  async function issueSsl() {
    if (!selectedAccount) return;
    if (!await confirm(`Issue a Let's Encrypt certificate for ${selectedAccount.domain}? DNS must point to this server.`)) return;
    setHostingBusy(true);
    try {
      await apost(`/api/portal/ssl/${selectedAccount.domain}`);
      setToast({ type: 'success', msg: 'Certificate issued — your site now serves HTTPS' });
      await loadSslStatus(selectedAccount.domain);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Issuance failed — check DNS' }); }
    setHostingBusy(false);
  }

  /* ── Round-4 actions ────────────────────────────────────────────── */

  async function loadSubdomains() { try { const r = await api('/api/portal/subdomains'); setSubdomains(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function addSubdomain() {
    if (!selectedAccount || !subForm.subdomain) return;
    setHostingBusy(true);
    try {
      await apost('/api/portal/subdomains', { subdomain: subForm.subdomain, domain: selectedAccount.domain });
      setToast({ type: 'success', msg: 'Subdomain created' }); setSubForm({ subdomain: '' }); await loadSubdomains();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteSubdomain(fqdn: string) {
    if (!await confirm(`Delete subdomain ${fqdn}?`)) return;
    setHostingBusy(true);
    try { await adel(`/api/portal/subdomains/${encodeURIComponent(fqdn)}`); setToast({ type: 'success', msg: 'Subdomain deleted' }); await loadSubdomains(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadRedirects() { try { const r = await api('/api/portal/redirects'); setRedirects(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function addRedirect() {
    if (!selectedAccount || !redForm.source || !redForm.target) return;
    setHostingBusy(true);
    try {
      await apost('/api/portal/redirects', { domain: selectedAccount.domain, source: redForm.source, target: redForm.target, type: redForm.type });
      setToast({ type: 'success', msg: 'Redirect created' }); setRedForm({ source: '', target: '', type: '301' }); await loadRedirects();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteRedirect(id: number) {
    if (!await confirm('Delete this redirect?')) return;
    setHostingBusy(true);
    try { await adel(`/api/portal/redirects/${id}`); setToast({ type: 'success', msg: 'Redirect removed' }); await loadRedirects(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadFiles(domain: string, p: string) {
    try {
      const r = await api(`/api/portal/files/${domain}/list?path=${encodeURIComponent(p)}`);
      setFiles(r.data.items || []); setFilePath(r.data.path || p);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }
  async function openFile(name: string) {
    if (!selectedAccount) return;
    const full = filePath.replace(/\/$/, '') + '/' + name;
    try {
      const r = await api(`/api/portal/files/${selectedAccount.domain}/read?path=${encodeURIComponent(full)}`);
      setFileEditor({ path: full, content: r.data.content });
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }
  async function saveFile() {
    if (!selectedAccount || !fileEditor) return;
    setHostingBusy(true);
    try { await apost(`/api/portal/files/${selectedAccount.domain}/write`, { path: fileEditor.path, content: fileEditor.content }); setToast({ type: 'success', msg: 'File saved' }); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteFile(name: string, type: string) {
    if (!selectedAccount) return;
    if (!await confirm(`Delete ${type === 'directory' ? 'folder' : 'file'} "${name}"?`)) return;
    const full = filePath.replace(/\/$/, '') + '/' + name;
    setHostingBusy(true);
    try {
      await axios.delete(`/api/portal/files/${selectedAccount.domain}/delete`, { headers: portalAuth(), data: { path: full } });
      setToast({ type: 'success', msg: 'Deleted' });
      await loadFiles(selectedAccount.domain, filePath);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function mkdir() {
    if (!selectedAccount) return;
    const name = window.prompt('Folder name'); if (!name) return;
    setHostingBusy(true);
    try {
      const full = filePath.replace(/\/$/, '') + '/' + name.replace(/[/\\]/g, '');
      await apost(`/api/portal/files/${selectedAccount.domain}/mkdir`, { path: full });
      setToast({ type: 'success', msg: 'Folder created' });
      await loadFiles(selectedAccount.domain, filePath);
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadAutoresp() { try { const r = await api('/api/portal/email/autoresponders'); setAutoresp(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function addAutoresp() {
    if (!selectedAccount || !autorespForm.user || !autorespForm.subject || !autorespForm.body) return;
    setHostingBusy(true);
    try {
      await apost('/api/portal/email/autoresponders', { email: `${autorespForm.user}@${selectedAccount.domain}`, subject: autorespForm.subject, body: autorespForm.body });
      setToast({ type: 'success', msg: 'Autoresponder created' }); setAutorespForm({ user: '', subject: '', body: '' }); await loadAutoresp();
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteAutoresp(id: number) {
    if (!await confirm('Delete this autoresponder?')) return;
    try { await adel(`/api/portal/email/autoresponders/${id}`); setToast({ type: 'success', msg: 'Deleted' }); await loadAutoresp(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }

  async function loadCatchall(domain: string) { try { const r = await api(`/api/portal/email/catch-all?domain=${encodeURIComponent(domain)}`); setCatchall(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function saveCatchall() {
    if (!selectedAccount || !catchallForm.destination) return;
    setHostingBusy(true);
    try { await apost('/api/portal/email/catch-all', { domain: selectedAccount.domain, destination: catchallForm.destination }); setToast({ type: 'success', msg: 'Catch-all updated' }); await loadCatchall(selectedAccount.domain); setCatchallForm({ destination: '' }); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function clearCatchall() {
    if (!selectedAccount) return;
    if (!await confirm('Remove catch-all for this domain?')) return;
    try { await adel(`/api/portal/email/catch-all/${selectedAccount.domain}`); setToast({ type: 'success', msg: 'Catch-all removed' }); await loadCatchall(selectedAccount.domain); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }

  async function loadMailAuth(domain: string) { try { const r = await api(`/api/portal/mail-auth/${domain}`); setMailAuth(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function genDkim() {
    if (!selectedAccount) return;
    setHostingBusy(true);
    try { await apost(`/api/portal/mail-auth/${selectedAccount.domain}/dkim`); setToast({ type: 'success', msg: 'DKIM key generated' }); await loadMailAuth(selectedAccount.domain); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function saveSpf() {
    if (!selectedAccount) return;
    const include = spfForm.include.split(/[\s,]+/).filter(Boolean);
    setHostingBusy(true);
    try { await apost(`/api/portal/mail-auth/${selectedAccount.domain}/spf`, { include }); setToast({ type: 'success', msg: 'SPF saved' }); await loadMailAuth(selectedAccount.domain); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function saveDmarc() {
    if (!selectedAccount) return;
    setHostingBusy(true);
    try { await apost(`/api/portal/mail-auth/${selectedAccount.domain}/dmarc`, dmarcForm); setToast({ type: 'success', msg: 'DMARC saved' }); await loadMailAuth(selectedAccount.domain); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadErrPage(domain: string, code: string) {
    try { const r = await api(`/api/portal/errpages/${domain}/${code}`); setErrContent(r.data.content || ''); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }
  async function saveErrPage() {
    if (!selectedAccount) return;
    setHostingBusy(true);
    try { await apost(`/api/portal/errpages/${selectedAccount.domain}/${errCode}`, { content: errContent }); setToast({ type: 'success', msg: 'Error page saved' }); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  async function loadCron() { try { const r = await api('/api/portal/cron'); setCronGroups(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function addCron() {
    if (!cronForm.user || !cronForm.schedule || !cronForm.command) return;
    setHostingBusy(true);
    try { await apost('/api/portal/cron', cronForm); setToast({ type: 'success', msg: 'Cron job added' }); setCronForm({ user: '', schedule: '0 * * * *', command: '' }); await loadCron(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteCron(user: string, index: number) {
    if (!await confirm('Delete this cron job?')) return;
    try { await adel(`/api/portal/cron/${user}/${index}`); setToast({ type: 'success', msg: 'Deleted' }); await loadCron(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }

  async function loadSshKeys() { try { const r = await api('/api/portal/sshkeys'); setSshGroups(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function addSshKey() {
    if (!sshForm.user || !sshForm.key) return;
    setHostingBusy(true);
    try { await apost('/api/portal/sshkeys', sshForm); setToast({ type: 'success', msg: 'SSH key added' }); setSshForm({ user: '', key: '' }); await loadSshKeys(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteSshKey(user: string, id: number) {
    if (!await confirm('Delete this SSH key?')) return;
    try { await adel(`/api/portal/sshkeys/${user}/${id}`); setToast({ type: 'success', msg: 'Deleted' }); await loadSshKeys(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }

  async function loadBackups() { try { const r = await api('/api/portal/backups'); setBackups(r.data); } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); } }
  async function createBackup() {
    if (!selectedAccount) return;
    if (!await confirm(`Create a tar.gz of ${selectedAccount.domain}'s public_html tree? May take a minute.`)) return;
    setHostingBusy(true);
    try { await apost(`/api/portal/backups/${selectedAccount.domain}`); setToast({ type: 'success', msg: 'Backup created' }); await loadBackups(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }
  async function deleteBackup(name: string) {
    if (!await confirm(`Delete ${name}?`)) return;
    try { await adel(`/api/portal/backups/${encodeURIComponent(name)}`); setToast({ type: 'success', msg: 'Deleted' }); await loadBackups(); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
  }

  async function installWordpress() {
    if (!selectedAccount) return;
    if (!scriptForm.dbName || !scriptForm.dbUser || !scriptForm.dbPass) { setToast({ type: 'error', msg: 'Fill in DB name, user, password' }); return; }
    if (!await confirm(`Install WordPress into ${selectedAccount.domain}/public_html? This will overwrite existing files there.`)) return;
    setHostingBusy(true);
    try { await apost('/api/portal/scripts/install', { script: 'wordpress', domain: selectedAccount.domain, ...scriptForm }); setToast({ type: 'success', msg: 'WordPress installed' }); }
    catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setHostingBusy(false);
  }

  /* ── Password change ───────────────────────────────────────── */

  async function changePassword() {
    if (!pwForm.currentPassword || !pwForm.newPassword) { setToast({ type: 'error', msg: 'Both fields are required' }); return; }
    if (pwForm.newPassword.length < 8) { setToast({ type: 'error', msg: 'New password must be at least 8 characters' }); return; }
    if (pwForm.newPassword !== pwForm.confirmPassword) { setToast({ type: 'error', msg: 'New password and confirmation do not match' }); return; }
    setPwBusy(true);
    try {
      await apost('/api/portal/change-password', { currentPassword: pwForm.currentPassword, newPassword: pwForm.newPassword });
      setToast({ type: 'success', msg: 'Password updated' });
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || 'Failed' }); }
    setPwBusy(false);
  }

  async function payStripe(invoice: Invoice) {
    setPayingId(invoice.id);
    try {
      const r = await axios.post('/api/stripe/checkout', { invoice_id: invoice.id });
      const safe = safeHttpUrl(r.data.url);
      if (!safe) throw new Error('Stripe returned an unexpected redirect URL');
      window.location.href = safe;
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || e.message || 'Payment failed' }); }
    setPayingId(null);
  }

  async function payPayPal(invoice: Invoice) {
    setPayingId(invoice.id);
    try {
      const r = await axios.post('/api/paypal/checkout', { invoice_id: invoice.id });
      const safe = safeHttpUrl(r.data.url);
      if (!safe) throw new Error('PayPal returned an unexpected redirect URL');
      window.location.href = safe;
    } catch (e: any) { setToast({ type: 'error', msg: e.response?.data?.error || e.message || 'PayPal not configured' }); }
    setPayingId(null);
  }

  function logout() { localStorage.removeItem('hp_portal_token'); localStorage.removeItem('hp_portal_name'); navigate('/portal/login'); }

  const totalDue = invoices.filter(i => ['unpaid', 'overdue'].includes(i.status)).reduce((s, i) => s + i.amount, 0);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-indigo-600">
            <Zap size={15} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-slate-900 dark:text-white">Client Portal</span>
        </div>
        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-1">
            <button onClick={() => setTab('invoices')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'invoices' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              <FileText size={13} className="inline mr-1" />Invoices
            </button>
            <button onClick={() => setTab('hosting')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'hosting' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              <Server size={13} className="inline mr-1" />Hosting
            </button>
            <button onClick={() => setTab('security')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'security' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
              <Shield size={13} className="inline mr-1" />Security
            </button>
          </nav>
          <span className="text-sm text-slate-600 dark:text-slate-400">{portalName}</span>
          <button className="btn-ghost text-slate-500" onClick={logout}><LogOut size={15} /> Logout</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Toast */}
        {toast && (
          <div className={`p-4 rounded-xl border flex items-start gap-3 ${toast.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'}`}>
            {toast.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            <span className="text-sm">{toast.msg}</span>
            <button className="ml-auto text-xs opacity-60 hover:opacity-100" onClick={() => setToast(null)}>✕</button>
          </div>
        )}

        {tab === 'invoices' && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="card p-4 text-center">
                <div className="text-2xl font-bold text-slate-900 dark:text-white">{invoices.length}</div>
                <div className="text-xs text-slate-500 mt-1">Total Invoices</div>
              </div>
              <div className="card p-4 text-center">
                <div className="text-2xl font-bold text-emerald-600">{invoices.filter(i => i.status === 'paid').length}</div>
                <div className="text-xs text-slate-500 mt-1">Paid</div>
              </div>
              <div className="card p-4 text-center">
                <div className={`text-2xl font-bold ${totalDue > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                  {invoices[0]?.currency || 'USD'} {totalDue.toFixed(2)}
                </div>
                <div className="text-xs text-slate-500 mt-1">Balance Due</div>
              </div>
            </div>

            {/* Invoice list */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                <FileText size={15} className="text-slate-500" />
                <h2 className="font-semibold text-sm text-slate-900 dark:text-white">Your Invoices</h2>
              </div>

              {loading && <div className="p-8 text-center text-slate-400">Loading…</div>}

              {!loading && invoices.length === 0 && (
                <div className="p-8 text-center text-slate-400 text-sm">No invoices found</div>
              )}

              {!loading && invoices.map(inv => {
                const sc = STATUS_CONFIG[inv.status] || STATUS_CONFIG.unpaid;
                const Icon = sc.icon;
                const canPay = ['unpaid', 'overdue'].includes(inv.status);
                return (
                  <div key={inv.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0 p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-slate-900 dark:text-white text-sm">{inv.invoice_number}</span>
                        <Icon size={13} className={sc.color} />
                        <span className={`text-xs font-medium ${sc.color}`}>{sc.label}</span>
                      </div>
                      <div className="text-xs text-slate-500 flex gap-3">
                        {inv.account_domain && <span>{inv.account_domain}</span>}
                        <span>Due: {inv.due_date}</span>
                        {inv.paid_date && <span>Paid: {inv.paid_date}</span>}
                      </div>
                    </div>

                    <div className="font-bold text-slate-900 dark:text-white">{inv.currency} {Number(inv.amount).toFixed(2)}</div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openAuthenticatedDownload(`/api/portal/invoices/${inv.id}/pdf`, { tokenKey: 'hp_portal_token' }).catch(e => setToast({ type: 'error', msg: e.message || 'PDF failed' }))}
                        className="btn-ghost text-slate-500" title="Download PDF">
                        <Download size={14} />
                      </button>
                      {canPay && (
                        <>
                          <button className="btn-primary text-xs px-3 py-1.5" onClick={() => payStripe(inv)} disabled={payingId === inv.id}>
                            {payingId === inv.id ? '…' : <><CreditCard size={12} /> Pay by Card</>}
                          </button>
                          <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => payPayPal(inv)} disabled={payingId === inv.id}>
                            <ExternalLink size={12} /> PayPal
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {client && (
              <div className="card p-4 text-xs text-slate-500 space-y-1">
                <p className="font-medium text-slate-700 dark:text-slate-300 mb-2">Account Details</p>
                <p>Name: {client.name}</p>
                <p>Email: {client.email}</p>
                {client.company && <p>Company: {client.company}</p>}
                {client.phone && <p>Phone: {client.phone}</p>}
              </div>
            )}
          </>
        )}

        {tab === 'hosting' && (
          <div className="space-y-4">
            {!accountsLoaded && <div className="card p-8 text-center text-slate-400">Loading hosting accounts…</div>}
            {accountsLoaded && accounts.length === 0 && (
              <div className="card p-8 text-center text-slate-400 text-sm">
                You don't have any hosting accounts yet. Contact your hosting provider to get set up.
              </div>
            )}
            {accountsLoaded && accounts.length > 0 && (
              <>
                {/* Account picker */}
                <div className="card overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                    <Server size={15} className="text-slate-500" />
                    <h2 className="font-semibold text-sm text-slate-900 dark:text-white">Your Hosting Accounts</h2>
                  </div>
                  {accounts.map(a => (
                    <button
                      key={a.id}
                      onClick={() => { setSelectedAccount(a); setAccountSubtab('details'); }}
                      className={`w-full text-left border-b border-slate-100 dark:border-slate-800 last:border-0 p-4 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${selectedAccount?.id === a.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-white text-sm">{a.domain}</div>
                        <div className="text-xs text-slate-500 mt-0.5 flex gap-3">
                          {a.plan_name && <span>{a.plan_name}</span>}
                          <span className={a.status === 'active' ? 'text-emerald-500' : 'text-amber-500'}>{a.status}</span>
                          {a.expires_at && <span>Expires {a.expires_at}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Selected account panel */}
                {selectedAccount && (
                  <div className="card p-5 space-y-4">
                    <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                      <Globe size={15} className="text-slate-500" />
                      <h3 className="font-semibold text-sm text-slate-900 dark:text-white">{selectedAccount.domain}</h3>
                      <nav className="ml-auto flex items-center gap-1 flex-wrap max-w-[70%] justify-end">
                        {([
                          ['details',    'Details'],
                          ['files',      'Files'],
                          ['subdomains', 'Subdomains'],
                          ['dns',        'DNS'],
                          ['redirects',  'Redirects'],
                          ['errpages',   'Errors'],
                          ['email',      'Email'],
                          ['mailauth',   'Mail Auth'],
                          ['ftp',        'FTP'],
                          ['databases',  'Databases'],
                          ['cron',       'Cron'],
                          ['sshkeys',    'SSH'],
                          ['backups',    'Backups'],
                          ['scripts',    'Apps'],
                          ['ssl',        'SSL'],
                        ] as const).map(([t, label]) => (
                          <button key={t} onClick={() => setAccountSubtab(t as any)}
                            className={`px-2.5 py-1 rounded text-xs font-medium ${accountSubtab === t ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                            {label}
                          </button>
                        ))}
                      </nav>
                    </div>

                    {accountSubtab === 'details' && (
                      <div className="space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                          <div><div className="text-xs text-slate-500">Plan</div><div className="font-medium">{selectedAccount.plan_name || '—'}</div></div>
                          <div><div className="text-xs text-slate-500">Status</div><div className="font-medium">{selectedAccount.status}</div></div>
                          <div><div className="text-xs text-slate-500">Created</div><div className="font-medium">{selectedAccount.created_at}</div></div>
                          <div><div className="text-xs text-slate-500">Expires</div><div className="font-medium">{selectedAccount.expires_at || 'Never'}</div></div>
                          {selectedAccount.disk_quota != null && (
                            <div>
                              <div className="text-xs text-slate-500">Disk quota</div>
                              <div className="font-medium">{selectedAccount.disk_quota} MB</div>
                            </div>
                          )}
                          {usage && (
                            <div>
                              <div className="text-xs text-slate-500">Disk used</div>
                              <div className="font-medium">{(usage.disk_bytes / 1024 / 1024).toFixed(2)} MB</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {accountSubtab === 'dns' && (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-500">A, AAAA, CNAME, MX, and TXT records only. NS / SRV records are managed by your hosting provider.</p>
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <input className="input col-span-3" placeholder="name (e.g. @ or www)" value={dnsForm.name} onChange={e => setDnsForm(f => ({ ...f, name: e.target.value }))} />
                          <select className="input col-span-2" value={dnsForm.type} onChange={e => setDnsForm(f => ({ ...f, type: e.target.value }))}>
                            {['A','AAAA','CNAME','MX','TXT'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <input className="input col-span-4" placeholder="value" value={dnsForm.value} onChange={e => setDnsForm(f => ({ ...f, value: e.target.value }))} />
                          <input className="input col-span-1" placeholder="ttl" value={dnsForm.ttl} onChange={e => setDnsForm(f => ({ ...f, ttl: e.target.value.replace(/\D/g, '') }))} />
                          <button className="btn-primary col-span-2 text-xs" onClick={addDnsRecord} disabled={hostingBusy}>
                            <Plus size={12} /> Add
                          </button>
                        </div>
                        <table className="w-full text-sm">
                          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <th className="text-left py-2 px-1">Name</th><th className="text-left">Type</th><th className="text-left">Value</th><th className="text-left">TTL</th><th></th>
                          </tr></thead>
                          <tbody>
                            {dnsRecords.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-400 text-xs">No records</td></tr>}
                            {dnsRecords.map((r, i) => (
                              <tr key={i} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                <td className="py-2 px-1 font-mono text-xs">{r.name}</td>
                                <td className="text-xs">{r.type}</td>
                                <td className="font-mono text-xs truncate max-w-[200px]">{r.value}</td>
                                <td className="text-xs text-slate-500">{r.ttl}</td>
                                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteDnsRecord(i)} disabled={hostingBusy}><Trash2 size={12} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {accountSubtab === 'email' && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-4">
                            <label className="label text-xs">Mailbox</label>
                            <div className="flex items-center">
                              <input className="input rounded-r-none" placeholder="user" value={emailForm.user} onChange={e => setEmailForm(f => ({ ...f, user: e.target.value.replace(/[^a-zA-Z0-9._+-]/g, '') }))} />
                              <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-l-0 border-slate-300 dark:border-slate-700 rounded-r text-xs text-slate-500">@{selectedAccount.domain}</span>
                            </div>
                          </div>
                          <div className="col-span-5">
                            <label className="label text-xs">Password</label>
                            <input className="input" type="password" placeholder="min 8 characters" value={emailForm.password} onChange={e => setEmailForm(f => ({ ...f, password: e.target.value }))} />
                          </div>
                          <button className="btn-primary col-span-3 text-xs" onClick={addEmailAcct} disabled={hostingBusy}>
                            <Plus size={12} /> Create
                          </button>
                        </div>
                        <table className="w-full text-sm">
                          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <th className="text-left py-2 px-1">Mailbox</th><th></th>
                          </tr></thead>
                          <tbody>
                            {emailAccts.length === 0 && <tr><td colSpan={2} className="py-4 text-center text-slate-400 text-xs">No mailboxes</td></tr>}
                            {emailAccts.map(e => (
                              <tr key={e.email} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                <td className="py-2 px-1 font-mono text-xs">{e.email}</td>
                                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteEmailAcct(e.email)} disabled={hostingBusy}><Trash2 size={12} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-4">
                          <p className="text-sm font-medium mb-2">Forwarders</p>
                          <p className="text-xs text-slate-500 mb-3">Forward mail addressed to one of your addresses on to another mailbox. Useful for catching mail at addresses you don't want a full inbox for.</p>
                          <div className="grid grid-cols-12 gap-2 items-end">
                            <div className="col-span-5">
                              <label className="label text-xs">From</label>
                              <div className="flex items-center">
                                <input className="input rounded-r-none" placeholder="sales" value={fwdForm.from} onChange={e => setFwdForm(f => ({ ...f, from: e.target.value }))} />
                                <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-l-0 border-slate-300 dark:border-slate-700 rounded-r text-xs text-slate-500">@{selectedAccount.domain}</span>
                              </div>
                            </div>
                            <div className="col-span-5">
                              <label className="label text-xs">Forward to</label>
                              <input className="input" placeholder="you@elsewhere.com" value={fwdForm.to} onChange={e => setFwdForm(f => ({ ...f, to: e.target.value }))} />
                            </div>
                            <button className="btn-primary col-span-2 text-xs" onClick={addForwarder} disabled={hostingBusy}><Plus size={12} /> Add</button>
                          </div>
                          <table className="w-full text-sm mt-3">
                            <tbody>
                              {forwarders.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-slate-400 text-xs">No forwarders</td></tr>}
                              {forwarders.map(f => (
                                <tr key={f.from} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                  <td className="py-2 px-1 font-mono text-xs">{f.from}</td>
                                  <td className="text-xs text-slate-500">→ {f.to}</td>
                                  <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteForwarder(f.from)} disabled={hostingBusy}><Trash2 size={12} /></button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-4">
                          <p className="text-sm font-medium mb-2">Autoresponders</p>
                          <p className="text-xs text-slate-500 mb-3">Auto-reply to incoming mail (vacation responder, "received your message", etc.).</p>
                          <div className="grid grid-cols-12 gap-2 items-end">
                            <div className="col-span-3">
                              <label className="label text-xs">For mailbox</label>
                              <div className="flex items-center">
                                <input className="input rounded-r-none font-mono text-xs" placeholder="user" value={autorespForm.user} onChange={e => setAutorespForm(f => ({ ...f, user: e.target.value.replace(/[^a-zA-Z0-9._+-]/g, '') }))} />
                                <span className="px-1 py-1.5 bg-slate-100 dark:bg-slate-800 border border-l-0 border-slate-300 dark:border-slate-700 rounded-r text-xs text-slate-500">@{selectedAccount.domain}</span>
                              </div>
                            </div>
                            <div className="col-span-3"><label className="label text-xs">Subject</label><input className="input text-xs" placeholder="Out of office" value={autorespForm.subject} onChange={e => setAutorespForm(f => ({ ...f, subject: e.target.value }))} /></div>
                            <div className="col-span-4"><label className="label text-xs">Body</label><input className="input text-xs" placeholder="I'll be back next week…" value={autorespForm.body} onChange={e => setAutorespForm(f => ({ ...f, body: e.target.value }))} /></div>
                            <button className="btn-primary col-span-2 text-xs" onClick={addAutoresp} disabled={hostingBusy}><Plus size={12} /> Add</button>
                          </div>
                          <table className="w-full text-sm mt-3">
                            <tbody>
                              {autoresp.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-slate-400 text-xs">No autoresponders</td></tr>}
                              {autoresp.map(a => (
                                <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                  <td className="py-2 px-1 font-mono text-xs">{a.email}</td>
                                  <td className="text-xs text-slate-500 truncate max-w-[260px]">{a.subject}</td>
                                  <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteAutoresp(a.id)}><Trash2 size={12} /></button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-4">
                          <p className="text-sm font-medium mb-2">Catch-all address</p>
                          <p className="text-xs text-slate-500 mb-3">A single address that receives mail addressed to <em>anything</em>@{selectedAccount.domain} that doesn't have a real mailbox.</p>
                          {catchall?.destination ? (
                            <div className="flex items-center gap-2 text-sm">
                              <span className="text-slate-500">Currently:</span> <code className="font-mono">{catchall.destination}</code>
                              <button className="btn-secondary text-xs ml-auto" onClick={clearCatchall}>Remove</button>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400">No catch-all set</p>
                          )}
                          <div className="flex gap-2 mt-2">
                            <input className="input flex-1 text-xs" placeholder="forward unknown mail to…" value={catchallForm.destination} onChange={e => setCatchallForm({ destination: e.target.value })} />
                            <button className="btn-primary text-xs" onClick={saveCatchall} disabled={hostingBusy || !catchallForm.destination}>Save</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {accountSubtab === 'ftp' && (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-500">FTP users are chrooted to <code className="font-mono">/var/www/{selectedAccount.domain}/public_html</code>. Your account username is prepended automatically (so a name like <code>web</code> becomes <code>{selectedAccount.username}_web</code>).</p>
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-4">
                            <label className="label text-xs">Username</label>
                            <div className="flex items-center">
                              <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-r-0 border-slate-300 dark:border-slate-700 rounded-l text-xs text-slate-500 font-mono">{selectedAccount.username}_</span>
                              <input className="input rounded-l-none font-mono" placeholder="suffix" value={ftpForm.username} onChange={e => setFtpForm(f => ({ ...f, username: e.target.value.replace(/[^a-z0-9_]/g, '') }))} />
                            </div>
                          </div>
                          <div className="col-span-5">
                            <label className="label text-xs">Password</label>
                            <input className="input" type="password" placeholder="min 8 characters" value={ftpForm.password} onChange={e => setFtpForm(f => ({ ...f, password: e.target.value }))} />
                          </div>
                          <button className="btn-primary col-span-3 text-xs" onClick={addFtpUser} disabled={hostingBusy}><Plus size={12} /> Create</button>
                        </div>
                        <table className="w-full text-sm">
                          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <th className="text-left py-2 px-1">Username</th><th className="text-left">Home</th><th></th>
                          </tr></thead>
                          <tbody>
                            {ftpUsers.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400 text-xs">No FTP users</td></tr>}
                            {ftpUsers.map(u => (
                              <tr key={u.username} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                <td className="py-2 px-1 font-mono text-xs">{u.username}</td>
                                <td className="text-xs text-slate-500 font-mono truncate max-w-[260px]">{u.directory || '—'}</td>
                                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteFtpUser(u.username)} disabled={hostingBusy}><Trash2 size={12} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {accountSubtab === 'databases' && (
                      <div className="space-y-5">
                        <p className="text-xs text-slate-500">Databases and users must start with your account username (<code className="font-mono">{selectedAccount.username}_</code>) — same cPanel-style namespacing.</p>

                        <div>
                          <p className="text-sm font-medium mb-2">Databases</p>
                          <div className="grid grid-cols-12 gap-2 items-end mb-3">
                            <div className="col-span-9">
                              <label className="label text-xs">Database name</label>
                              <div className="flex items-center">
                                <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-r-0 border-slate-300 dark:border-slate-700 rounded-l text-xs text-slate-500 font-mono">{selectedAccount.username}_</span>
                                <input className="input rounded-l-none font-mono" placeholder="suffix" value={dbForm.name.replace(new RegExp('^' + selectedAccount.username + '_'), '')} onChange={e => setDbForm({ name: selectedAccount.username + '_' + e.target.value.replace(/[^a-z0-9_]/g, '') })} />
                              </div>
                            </div>
                            <button className="btn-primary col-span-3 text-xs" onClick={addDb} disabled={hostingBusy || !dbForm.name}><Plus size={12} /> Create</button>
                          </div>
                          <table className="w-full text-sm">
                            <tbody>
                              {dbs.length === 0 && <tr><td colSpan={2} className="py-3 text-center text-slate-400 text-xs">No databases</td></tr>}
                              {dbs.map(d => (
                                <tr key={d.name} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                  <td className="py-2 px-1 font-mono text-xs">{d.name}</td>
                                  <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteDb(d.name)} disabled={hostingBusy}><Trash2 size={12} /></button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div>
                          <p className="text-sm font-medium mb-2">Database users</p>
                          <div className="grid grid-cols-12 gap-2 items-end mb-3">
                            <div className="col-span-3">
                              <label className="label text-xs">Username</label>
                              <div className="flex items-center">
                                <span className="px-1.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-r-0 border-slate-300 dark:border-slate-700 rounded-l text-xs text-slate-500 font-mono">{selectedAccount.username}_</span>
                                <input className="input rounded-l-none font-mono text-xs" placeholder="suffix" value={dbUserForm.username.replace(new RegExp('^' + selectedAccount.username + '_'), '')} onChange={e => setDbUserForm(f => ({ ...f, username: selectedAccount.username + '_' + e.target.value.replace(/[^a-z0-9_]/g, '') }))} />
                              </div>
                            </div>
                            <div className="col-span-3">
                              <label className="label text-xs">Password</label>
                              <input className="input" type="password" placeholder="min 8" value={dbUserForm.password} onChange={e => setDbUserForm(f => ({ ...f, password: e.target.value }))} />
                            </div>
                            <div className="col-span-4">
                              <label className="label text-xs">Grant on (optional)</label>
                              <select className="input text-xs" value={dbUserForm.database} onChange={e => setDbUserForm(f => ({ ...f, database: e.target.value }))}>
                                <option value="">— no grant —</option>
                                {dbs.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                              </select>
                            </div>
                            <button className="btn-primary col-span-2 text-xs" onClick={addDbUser} disabled={hostingBusy || !dbUserForm.username || !dbUserForm.password}><Plus size={12} /> Create</button>
                          </div>
                          <table className="w-full text-sm">
                            <tbody>
                              {dbUsers.length === 0 && <tr><td colSpan={3} className="py-3 text-center text-slate-400 text-xs">No DB users</td></tr>}
                              {dbUsers.map(u => {
                                const name = u.User ?? u.user ?? '';
                                const host = u.Host ?? u.host ?? '';
                                return (
                                  <tr key={`${name}@${host}`} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                    <td className="py-2 px-1 font-mono text-xs">{name}</td>
                                    <td className="text-xs text-slate-500">@{host}</td>
                                    <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteDbUser(name)} disabled={hostingBusy}><Trash2 size={12} /></button></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {accountSubtab === 'ssl' && (
                      <div className="space-y-4 max-w-lg">
                        <p className="text-xs text-slate-500">Issue a free Let's Encrypt certificate for <code className="font-mono">{selectedAccount.domain}</code>. DNS must already point to this server.</p>
                        {sslStatus === null && <p className="text-sm text-slate-400">Loading certificate status…</p>}
                        {sslStatus && !sslStatus.issued && (
                          <button className="btn-primary text-sm" onClick={issueSsl} disabled={hostingBusy}>Issue certificate</button>
                        )}
                        {sslStatus?.issued && (
                          <div className="card border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm space-y-1">
                            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                              <CheckCircle size={14} />
                              <span className="font-medium">Certificate active</span>
                            </div>
                            {sslStatus.expires && <p className="text-xs text-emerald-700 dark:text-emerald-300">Expires: {sslStatus.expires}</p>}
                            <button className="btn-secondary text-xs mt-2" onClick={issueSsl} disabled={hostingBusy}>Re-issue / renew</button>
                          </div>
                        )}
                      </div>
                    )}

                    {accountSubtab === 'subdomains' && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-9">
                            <label className="label text-xs">Subdomain</label>
                            <div className="flex items-center">
                              <input className="input rounded-r-none font-mono" placeholder="blog" value={subForm.subdomain} onChange={e => setSubForm({ subdomain: e.target.value.replace(/[^a-z0-9-]/g, '') })} />
                              <span className="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 border border-l-0 border-slate-300 dark:border-slate-700 rounded-r text-xs text-slate-500">.{selectedAccount.domain}</span>
                            </div>
                          </div>
                          <button className="btn-primary col-span-3 text-xs" onClick={addSubdomain} disabled={hostingBusy || !subForm.subdomain}><Plus size={12} /> Create</button>
                        </div>
                        <table className="w-full text-sm">
                          <tbody>
                            {subdomains.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400 text-xs">No subdomains</td></tr>}
                            {subdomains.map(s => (
                              <tr key={s.fqdn} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                <td className="py-2 px-1 font-mono text-xs">{s.fqdn}</td>
                                <td className="text-xs text-slate-500 truncate max-w-[260px]">{s.docroot}</td>
                                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteSubdomain(s.fqdn)} disabled={hostingBusy}><Trash2 size={12} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {accountSubtab === 'redirects' && (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-500">Send visitors of one URL to another. Writes a <code>Redirect</code> directive into <code>.htaccess</code>.</p>
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-4">
                            <label className="label text-xs">Source path</label>
                            <input className="input font-mono" placeholder="/old" value={redForm.source} onChange={e => setRedForm(f => ({ ...f, source: e.target.value }))} />
                          </div>
                          <div className="col-span-5">
                            <label className="label text-xs">Target URL</label>
                            <input className="input font-mono" placeholder="https://example.com/new" value={redForm.target} onChange={e => setRedForm(f => ({ ...f, target: e.target.value }))} />
                          </div>
                          <select className="input col-span-1 text-xs" value={redForm.type} onChange={e => setRedForm(f => ({ ...f, type: e.target.value }))}>
                            <option value="301">301</option><option value="302">302</option>
                          </select>
                          <button className="btn-primary col-span-2 text-xs" onClick={addRedirect} disabled={hostingBusy}><Plus size={12} /> Add</button>
                        </div>
                        <table className="w-full text-sm">
                          <tbody>
                            {redirects.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-400 text-xs">No redirects</td></tr>}
                            {redirects.map(r => (
                              <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                <td className="py-2 px-1 font-mono text-xs">{r.source}</td>
                                <td className="text-xs">→ <span className="font-mono">{r.target}</span></td>
                                <td className="text-xs text-slate-500">{r.type}</td>
                                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteRedirect(r.id)} disabled={hostingBusy}><Trash2 size={12} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {accountSubtab === 'files' && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-500">{selectedAccount.domain}:{filePath}</span>
                          <button className="btn-secondary text-xs ml-auto" onClick={() => loadFiles(selectedAccount.domain, filePath)}><RefreshCw size={11} /> Refresh</button>
                          <button className="btn-secondary text-xs" onClick={mkdir} disabled={hostingBusy}><Plus size={11} /> New folder</button>
                          {filePath !== '/' && (
                            <button className="btn-secondary text-xs" onClick={() => { const up = filePath.replace(/\/[^/]+\/?$/, '') || '/'; loadFiles(selectedAccount.domain, up); }}>↑ Up</button>
                          )}
                        </div>
                        <table className="w-full text-sm">
                          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
                            <th className="text-left py-2 px-1">Name</th><th className="text-left">Size</th><th className="text-left">Modified</th><th></th>
                          </tr></thead>
                          <tbody>
                            {files.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-400 text-xs">Empty</td></tr>}
                            {files.map(f => (
                              <tr key={f.name} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                <td className="py-2 px-1 font-mono text-xs">
                                  {f.type === 'directory' ? (
                                    <button className="text-indigo-600 hover:underline" onClick={() => loadFiles(selectedAccount.domain, (filePath.replace(/\/$/, '') + '/' + f.name))}>{f.name}/</button>
                                  ) : (
                                    <button className="hover:underline" onClick={() => openFile(f.name)}>{f.name}</button>
                                  )}
                                </td>
                                <td className="text-xs text-slate-500">{f.type === 'file' ? `${f.size} B` : '—'}</td>
                                <td className="text-xs text-slate-500">{new Date(f.modified).toLocaleString()}</td>
                                <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteFile(f.name, f.type)} disabled={hostingBusy}><Trash2 size={12} /></button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {fileEditor && (
                          <div className="card p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono">{fileEditor.path}</span>
                              <button className="btn-secondary text-xs ml-auto" onClick={() => setFileEditor(null)}>Close</button>
                              <button className="btn-primary text-xs" onClick={saveFile} disabled={hostingBusy}>Save</button>
                            </div>
                            <textarea className="input font-mono text-xs h-64" value={fileEditor.content} onChange={e => setFileEditor({ ...fileEditor, content: e.target.value })} />
                          </div>
                        )}
                      </div>
                    )}

                    {accountSubtab === 'errpages' && (
                      <div className="space-y-4 max-w-2xl">
                        <p className="text-xs text-slate-500">Custom HTML page Apache shows when one of these HTTP codes happens on <code className="font-mono">{selectedAccount.domain}</code>.</p>
                        <div className="flex items-center gap-2">
                          <label className="label text-xs">Code</label>
                          <select className="input w-28 text-xs" value={errCode} onChange={e => { setErrCode(e.target.value); if (selectedAccount) loadErrPage(selectedAccount.domain, e.target.value); }}>
                            {['400','401','403','404','500','502','503'].map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <button className="btn-primary text-xs ml-auto" onClick={saveErrPage} disabled={hostingBusy}>Save error page</button>
                        </div>
                        <textarea className="input font-mono text-xs h-64" placeholder="<html>…</html>" value={errContent} onChange={e => setErrContent(e.target.value)} />
                      </div>
                    )}

                    {accountSubtab === 'mailauth' && (
                      <div className="space-y-5">
                        <p className="text-xs text-slate-500">Authenticate mail you send so it doesn't land in spam. DKIM uses a private key on this server; SPF and DMARC are TXT records in your DNS zone.</p>
                        <div className="space-y-2">
                          <p className="text-sm font-medium">DKIM</p>
                          <p className="text-xs text-slate-500">{mailAuth?.dkim ? 'Key generated. Public key TXT record:' : 'No DKIM key yet.'}</p>
                          {mailAuth?.dkim && <code className="block text-xs font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded break-all">{mailAuth.dkim}</code>}
                          <button className="btn-primary text-xs" onClick={genDkim} disabled={hostingBusy}>{mailAuth?.dkim ? 'Re-generate' : 'Generate DKIM key'}</button>
                        </div>
                        <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4">
                          <p className="text-sm font-medium">SPF</p>
                          <p className="text-xs text-slate-500">Current: <code className="font-mono">{mailAuth?.spf || '(none)'}</code></p>
                          <div className="flex gap-2">
                            <input className="input font-mono text-xs flex-1" placeholder="include domains, comma-separated (e.g. _spf.google.com, sendgrid.net)" value={spfForm.include} onChange={e => setSpfForm({ include: e.target.value })} />
                            <button className="btn-primary text-xs" onClick={saveSpf} disabled={hostingBusy}>Save SPF</button>
                          </div>
                        </div>
                        <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4">
                          <p className="text-sm font-medium">DMARC</p>
                          <p className="text-xs text-slate-500">Current: <code className="font-mono">{mailAuth?.dmarc || '(none)'}</code></p>
                          <div className="grid grid-cols-12 gap-2">
                            <select className="input col-span-3 text-xs" value={dmarcForm.policy} onChange={e => setDmarcForm(f => ({ ...f, policy: e.target.value }))}>
                              <option value="none">none</option><option value="quarantine">quarantine</option><option value="reject">reject</option>
                            </select>
                            <input className="input col-span-7 text-xs" placeholder="rua: where to send aggregate reports" value={dmarcForm.rua} onChange={e => setDmarcForm(f => ({ ...f, rua: e.target.value }))} />
                            <button className="btn-primary col-span-2 text-xs" onClick={saveDmarc} disabled={hostingBusy}>Save DMARC</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {accountSubtab === 'cron' && (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-500">Scheduled tasks. <code>user</code> must be a real OS user prefixed with your account name (use the FTP tab to create one first).</p>
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-3"><label className="label text-xs">OS user</label><input className="input font-mono text-xs" placeholder={`${selectedAccount.username}_web`} value={cronForm.user} onChange={e => setCronForm(f => ({ ...f, user: e.target.value }))} /></div>
                          <div className="col-span-3"><label className="label text-xs">Schedule</label><input className="input font-mono text-xs" placeholder="0 * * * *" value={cronForm.schedule} onChange={e => setCronForm(f => ({ ...f, schedule: e.target.value }))} /></div>
                          <div className="col-span-4"><label className="label text-xs">Command</label><input className="input font-mono text-xs" placeholder="curl https://example.com/cron" value={cronForm.command} onChange={e => setCronForm(f => ({ ...f, command: e.target.value }))} /></div>
                          <button className="btn-primary col-span-2 text-xs" onClick={addCron} disabled={hostingBusy}><Plus size={12} /> Add</button>
                        </div>
                        {cronGroups.length === 0 && <p className="text-center text-slate-400 text-xs py-2">No scheduled tasks</p>}
                        {cronGroups.map(g => (
                          <div key={g.user} className="space-y-1">
                            <p className="text-xs font-mono text-slate-500">{g.user}</p>
                            <table className="w-full text-sm">
                              <tbody>
                                {g.jobs.map(j => (
                                  <tr key={j.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                    <td className="py-2 px-1 font-mono text-xs">{j.line}</td>
                                    <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteCron(g.user, j.id)}><Trash2 size={12} /></button></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}

                    {accountSubtab === 'sshkeys' && (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-500">SSH public keys for an OS user. Only OS users prefixed with your account name (e.g. <code>{selectedAccount.username}_web</code>) — create them in the FTP tab first.</p>
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-3"><label className="label text-xs">OS user</label><input className="input font-mono text-xs" placeholder={`${selectedAccount.username}_web`} value={sshForm.user} onChange={e => setSshForm(f => ({ ...f, user: e.target.value }))} /></div>
                          <div className="col-span-7"><label className="label text-xs">Public key</label><input className="input font-mono text-xs" placeholder="ssh-ed25519 AAAA…" value={sshForm.key} onChange={e => setSshForm(f => ({ ...f, key: e.target.value }))} /></div>
                          <button className="btn-primary col-span-2 text-xs" onClick={addSshKey} disabled={hostingBusy}><Plus size={12} /> Add</button>
                        </div>
                        {sshGroups.length === 0 && <p className="text-center text-slate-400 text-xs py-2">No SSH keys</p>}
                        {sshGroups.map(g => (
                          <div key={g.user} className="space-y-1">
                            <p className="text-xs font-mono text-slate-500">{g.user}</p>
                            <table className="w-full text-sm">
                              <tbody>
                                {g.keys.length === 0 && <tr><td className="py-2 text-center text-slate-400 text-xs">No keys</td></tr>}
                                {g.keys.map(k => (
                                  <tr key={k.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                    <td className="py-2 px-1 font-mono text-xs truncate max-w-[420px]">{k.raw}</td>
                                    <td className="text-right"><button className="btn-icon text-rose-500" onClick={() => deleteSshKey(g.user, k.id)}><Trash2 size={12} /></button></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}

                    {accountSubtab === 'backups' && (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-500">Create a tar.gz of your domain's webroot — files only, not databases (use the Databases tab to export those).</p>
                        <button className="btn-primary text-xs" onClick={createBackup} disabled={hostingBusy}><Plus size={12} /> Create backup of {selectedAccount.domain}</button>
                        <table className="w-full text-sm">
                          <tbody>
                            {backups.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-400 text-xs">No backups</td></tr>}
                            {backups.map(b => (
                              <tr key={b.name} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                                <td className="py-2 px-1 font-mono text-xs">{b.name}</td>
                                <td className="text-xs text-slate-500">{(b.size / 1024).toFixed(1)} KB · {new Date(b.created).toLocaleString()}</td>
                                <td className="text-right">
                                  <button className="btn-icon" title="Download" onClick={() => openAuthenticatedDownload(`/api/portal/backups/${encodeURIComponent(b.name)}/download`, { tokenKey: 'hp_portal_token', filename: b.name }).catch(e => setToast({ type: 'error', msg: e.message }))}><Download size={12} /></button>
                                  <button className="btn-icon text-rose-500" onClick={() => deleteBackup(b.name)}><Trash2 size={12} /></button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {accountSubtab === 'scripts' && (
                      <div className="space-y-4 max-w-2xl">
                        <p className="text-xs text-slate-500">One-click WordPress install into <code className="font-mono">/var/www/{selectedAccount.domain}/public_html</code>. DB name and DB user must start with your account username (<code className="font-mono">{selectedAccount.username}_</code>).</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div><label className="label text-xs">DB name</label><input className="input font-mono text-xs" placeholder={`${selectedAccount.username}_wp`} value={scriptForm.dbName} onChange={e => setScriptForm(f => ({ ...f, dbName: e.target.value }))} /></div>
                          <div><label className="label text-xs">DB user</label><input className="input font-mono text-xs" placeholder={`${selectedAccount.username}_wpu`} value={scriptForm.dbUser} onChange={e => setScriptForm(f => ({ ...f, dbUser: e.target.value }))} /></div>
                          <div><label className="label text-xs">DB password</label><input className="input" type="password" value={scriptForm.dbPass} onChange={e => setScriptForm(f => ({ ...f, dbPass: e.target.value }))} /></div>
                          <div><label className="label text-xs">Site title</label><input className="input text-xs" placeholder="My WordPress Site" value={scriptForm.siteTitle} onChange={e => setScriptForm(f => ({ ...f, siteTitle: e.target.value }))} /></div>
                          <div><label className="label text-xs">WP admin user</label><input className="input text-xs" placeholder="admin" value={scriptForm.adminUser} onChange={e => setScriptForm(f => ({ ...f, adminUser: e.target.value }))} /></div>
                          <div><label className="label text-xs">WP admin password</label><input className="input" type="password" value={scriptForm.adminPass} onChange={e => setScriptForm(f => ({ ...f, adminPass: e.target.value }))} /></div>
                          <div className="col-span-2"><label className="label text-xs">WP admin email</label><input className="input text-xs" placeholder="you@example.com" value={scriptForm.adminEmail} onChange={e => setScriptForm(f => ({ ...f, adminEmail: e.target.value }))} /></div>
                        </div>
                        <button className="btn-primary text-sm" onClick={installWordpress} disabled={hostingBusy}>Install WordPress</button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'security' && (
          <div className="space-y-4 max-w-md">
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-slate-500" />
                <h2 className="font-semibold text-sm text-slate-900 dark:text-white">Change Password</h2>
              </div>
              <p className="text-xs text-slate-500">Rotate your portal password. Requires your current password.</p>
              <input type="password" className="input" placeholder="Current password" value={pwForm.currentPassword} onChange={e => setPwForm(f => ({ ...f, currentPassword: e.target.value }))} />
              <input type="password" className="input" placeholder="New password (min 8 chars)" value={pwForm.newPassword} onChange={e => setPwForm(f => ({ ...f, newPassword: e.target.value }))} />
              <input type="password" className="input" placeholder="Confirm new password" value={pwForm.confirmPassword} onChange={e => setPwForm(f => ({ ...f, confirmPassword: e.target.value }))} />
              <button className="btn-primary text-sm" onClick={changePassword} disabled={pwBusy || !pwForm.currentPassword || !pwForm.newPassword}>
                {pwBusy ? 'Updating…' : 'Update password'}
              </button>
            </div>

            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Lock size={15} className="text-slate-500" />
                <h2 className="font-semibold text-sm text-slate-900 dark:text-white">Two-Factor Authentication</h2>
                {totpStatus?.enabled && <span className="badge-success text-xs ml-auto">Enabled</span>}
              </div>

              {totpStatus === null && <p className="text-sm text-slate-400">Loading…</p>}

              {totpStatus && !totpStatus.enabled && !totpSetup && (
                <>
                  <p className="text-sm text-slate-500">Add an extra layer of security using an authenticator app (Google Authenticator, Authy, etc.).</p>
                  <button className="btn-primary text-sm" onClick={startTotpSetup} disabled={totpLoading}>
                    <Shield size={13} /> {totpLoading ? 'Setting up…' : 'Enable 2FA'}
                  </button>
                </>
              )}

              {totpSetup && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-500">Scan the QR code with your authenticator app, then enter the 6-digit code to confirm.</p>
                  {totpSetup.qr && (
                    <div className="flex justify-center">
                      <img src={totpSetup.qr} alt="2FA QR Code" className="w-40 h-40 rounded-lg border border-slate-200 dark:border-slate-700" />
                    </div>
                  )}
                  <div>
                    <label className="label">Manual entry key</label>
                    <code className="block text-xs font-mono bg-slate-100 dark:bg-slate-800 p-2 rounded break-all">{totpSetup.secret}</code>
                  </div>
                  <div>
                    <label className="label">Verification code</label>
                    <input
                      className="input font-mono text-center text-lg tracking-widest w-40"
                      maxLength={6}
                      placeholder="000000"
                      value={totpCode}
                      onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={e => e.key === 'Enter' && verifyTotp()}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-primary text-sm" onClick={verifyTotp} disabled={totpLoading || totpCode.length !== 6}>
                      {totpLoading ? 'Verifying…' : 'Verify & Enable'}
                    </button>
                    <button className="btn-secondary text-sm" onClick={() => { setTotpSetup(null); setTotpCode(''); }}>Cancel</button>
                  </div>
                </div>
              )}

              {totpStatus?.enabled && !totpSetup && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm">
                    <CheckCircle size={14} />
                    <span>Two-factor authentication is active on your account.</span>
                  </div>
                  <button className="btn-secondary text-sm text-rose-600 hover:!text-rose-700" onClick={disableTotp} disabled={totpLoading}>
                    {totpLoading ? 'Disabling…' : 'Disable 2FA'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
