import { useEffect, useState } from 'react';
import { fetchApi, openAuthenticatedDownload } from '../lib/api';
import { useToast } from '../components/Toast';

type AnyObj = Record<string, any>;
const featureKeys = ['files','backup-wizard','webdav','email-accounts','mail-trace','analytics','databases','phpmyadmin','dns','ftp','billing','support'];

async function json<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const r = await fetchApi(url, options);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r.json();
}
function post(url: string, body: any) { return json(url, { method: 'POST', body: JSON.stringify(body) }); }
function del(url: string) { return json(url, { method: 'DELETE' }); }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="card p-5 space-y-4"><h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h2>{children}</section>; }
function Text({ value, onChange, placeholder='', type='text' }: { value: string; onChange: (v: string)=>void; placeholder?: string; type?: string }) { return <input className="input" type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} />; }

export default function CpanelParity() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<AnyObj[]>([]);
  const [features, setFeatures] = useState<AnyObj[]>([]);
  const [featureLists, setFeatureLists] = useState<AnyObj[]>([]);
  const [plans, setPlans] = useState<AnyObj[]>([]);
  const [planAssignments, setPlanAssignments] = useState<AnyObj[]>([]);
  const [analytics, setAnalytics] = useState<AnyObj>({});
  const [mailEvents, setMailEvents] = useState<AnyObj[]>([]);
  const [rawLogs, setRawLogs] = useState<AnyObj[]>([]);
  const [backups, setBackups] = useState<AnyObj[]>([]);
  const [phpmyadmin, setPhpmyadmin] = useState<AnyObj>({});
  const [webdav, setWebdav] = useState<AnyObj[]>([]);
  const [dnsNodes, setDnsNodes] = useState<AnyObj[]>([]);
  const [dnsSync, setDnsSync] = useState<AnyObj | null>(null);
  const [plugins, setPlugins] = useState<AnyObj[]>([]);
  const [updates, setUpdates] = useState<AnyObj>({});
  const [imports, setImports] = useState<AnyObj[]>([]);
  const [form, setForm] = useState<AnyObj>({ teamPerms: ['files','email-accounts'], featurePerms: ['file-manager','email-accounts','databases'], mailQuery: '', backupType: 'files', backupTarget: '', nsDomain: '', archivePath: '', webdavHome: '/var/www/', webdavUser: '', dnsName: '', dnsHost: '' });

  async function load() {
    setLoading(true);
    try {
      const [t, cat, fl, p, pa, vis, errs, bw, raw, b, php, wd, nodes, plug, upd, im] = await Promise.all([
        json('/api/team-users'), json('/api/feature-lists/catalog'), json('/api/feature-lists'), json('/api/billing/plans'), json('/api/feature-lists/assignments/plans'),
        json('/api/analytics/visitors'), json('/api/analytics/errors'), json('/api/analytics/bandwidth'), json('/api/analytics/raw-access'), json('/api/backup/list'), json('/api/databases/phpmyadmin'), json('/api/webdav'), json('/api/dns-cluster/nodes'), json('/api/extensions/plugins'), json('/api/extensions/updates'), json('/api/transfer-import')
      ]);
      setTeam(t); setFeatures(cat.features || []); setFeatureLists(fl); setPlans(p); setPlanAssignments(pa);
      setAnalytics({ visitors: vis, errors: errs, bandwidth: bw }); setRawLogs(raw.files || []); setBackups(b); setPhpmyadmin(php); setWebdav(wd); setDnsNodes(nodes); setPlugins(plug.plugins || []); setUpdates(upd); setImports(im);
    } catch (e: any) { toast.error(e.message || 'Failed to load parity data'); }
    finally { setLoading(false); }
  }
  useEffect(() => { document.title = 'cPanel / WHM Parity — HostPanel'; load(); return () => { document.title = 'HostPanel'; }; }, []);
  const set = (k: string, v: any) => setForm((f: AnyObj) => ({ ...f, [k]: v }));
  const toggle = (key: string, listKey: string) => set(listKey, (form[listKey] || []).includes(key) ? form[listKey].filter((x: string) => x !== key) : [...(form[listKey] || []), key]);

  async function createTeam() { await post('/api/team-users', { username: form.teamUser, email: form.teamEmail, password: form.teamPass, permissions: form.teamPerms }); toast.success('Team subaccount created'); set('teamPass',''); load(); }
  async function createFeatureList() { await post('/api/feature-lists', { name: form.featureName, description: form.featureDesc || '', features: form.featurePerms }); toast.success('Feature list saved'); load(); }
  async function assignPlan() { await post('/api/feature-lists/assign-plan', { planId: Number(form.planId), featureListId: Number(form.featureListId) }); toast.success('Plan feature list assigned'); load(); }
  async function searchMail() { const data = await json(`/api/mail-trace/search?limit=100&recipient=${encodeURIComponent(form.mailQuery || '')}&sender=${encodeURIComponent(form.mailQuery || '')}`); setMailEvents(data.events || []); }
  async function runBackup() { await post('/api/backup/create', { type: form.backupType, target: form.backupTarget || undefined }); toast.success('Backup job completed'); load(); }
  async function saveWebdav() { await post('/api/webdav', { username: form.webdavUser, home: form.webdavHome, domain: form.webdavDomain || '', permissions: form.webdavPerm || 'rw' }); toast.success('WebDAV account saved'); load(); }
  async function saveDnsNode() { await post('/api/dns-cluster/nodes', { name: form.dnsName, host: form.dnsHost, role: 'secondary', tsig_name: form.dnsTsigName || '', tsig_secret: form.dnsTsigSecret || '' }); toast.success('DNS cluster node saved'); set('dnsTsigSecret',''); load(); }
  async function previewDnsSync() { const data = await post('/api/dns-cluster/sync-preview', { domain: form.nsDomain }); setDnsSync(data); }
  async function runDnsSync() { const data = await post('/api/dns-cluster/sync', { domain: form.nsDomain }); setDnsSync(data); toast.success('DNS sync requested'); load(); }
  async function inspectImport() { await post('/api/transfer-import/inspect', { archivePath: form.archivePath }); toast.success('Transfer archive inspected'); load(); }
  async function executeImport(id: number) { await post(`/api/transfer-import/${id}/execute`, { confirm: true, domain: form.importDomain || undefined, username: form.importUsername || undefined }); toast.success('Transfer import executed'); load(); }
  async function installPlugin() { await post('/api/extensions/plugins/install', { packagePath: form.pluginPackage, sha256: form.pluginSha256 || undefined }); toast.success('Plugin installed'); set('pluginPackage',''); set('pluginSha256',''); load(); }
  async function togglePlugin(id: string, enabled: boolean) { await post(`/api/extensions/plugins/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, {}); toast.success(enabled ? 'Plugin enabled' : 'Plugin disabled'); load(); }
  async function rollbackPlugin(id: string) { await post(`/api/extensions/plugins/${encodeURIComponent(id)}/rollback`, {}); toast.success('Plugin rolled back'); load(); }

  if (loading) return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  return <div className="space-y-5">
    <div><h1 className="page-title">cPanel / WHM Parity</h1><p className="page-subtitle">Real control-plane workflows for the remaining cPanel-style features.</p></div>

    <Panel title="1. User Manager / Team Subaccounts">
      <div className="grid md:grid-cols-4 gap-3"><Text value={form.teamUser || ''} onChange={v=>set('teamUser',v)} placeholder="username"/><Text value={form.teamEmail || ''} onChange={v=>set('teamEmail',v)} placeholder="email"/><Text value={form.teamPass || ''} onChange={v=>set('teamPass',v)} placeholder="temporary password" type="password"/><button className="btn-primary" onClick={createTeam}>Create Subaccount</button></div>
      <div className="flex flex-wrap gap-2">{featureKeys.map(k => <button key={k} className={`px-2 py-1 rounded text-xs ${(form.teamPerms||[]).includes(k) ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`} onClick={()=>toggle(k,'teamPerms')}>{k}</button>)}</div>
      <div className="grid md:grid-cols-2 gap-2">{team.map(u => <div key={u.id} className="rounded border border-slate-200 dark:border-slate-800 p-3 text-sm"><b>{u.username}</b> <span className="text-slate-500">{u.email}</span><div className="text-xs text-slate-500">{(u.permissions||[]).join(', ') || 'No permissions'}</div></div>)}</div>
    </Panel>

    <Panel title="2. Feature Lists / Plan Enforcement / Reseller Privileges">
      <div className="grid md:grid-cols-4 gap-3"><Text value={form.featureName || ''} onChange={v=>set('featureName',v)} placeholder="feature list name"/><Text value={form.featureDesc || ''} onChange={v=>set('featureDesc',v)} placeholder="description"/><button className="btn-primary" onClick={createFeatureList}>Save Feature List</button></div>
      <div className="flex flex-wrap gap-2">{features.map(f => <button key={f.key} className={`px-2 py-1 rounded text-xs ${(form.featurePerms||[]).includes(f.key) ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`} onClick={()=>toggle(f.key,'featurePerms')}>{f.label}</button>)}</div>
      <div className="grid md:grid-cols-3 gap-3"><select className="input" value={form.planId || ''} onChange={e=>set('planId',e.target.value)}><option value="">Select plan</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select className="input" value={form.featureListId || ''} onChange={e=>set('featureListId',e.target.value)}><option value="">Select feature list</option>{featureLists.map(fl => <option key={fl.id} value={fl.id}>{fl.name}</option>)}</select><button className="btn-secondary" onClick={assignPlan}>Assign to Plan</button></div>
      <div className="text-sm text-slate-600 dark:text-slate-400">Assignments: {planAssignments.map(a => `${a.plan_name}: ${a.feature_list_name || 'Default all features'}`).join(' • ') || 'No plans yet'}</div>
    </Panel>

    <Panel title="3. Analytics + Track Delivery UI">
      <div className="grid md:grid-cols-4 gap-3 text-sm"><div className="card p-3">Hits: <b>{analytics.visitors?.hits || 0}</b></div><div className="card p-3">Bandwidth: <b>{analytics.bandwidth?.totalBytes || 0} bytes</b></div><div className="card p-3">Errors: <b>{analytics.errors ? (Object.values(analytics.errors.httpStatuses || {}) as number[]).reduce((a, b)=>a + Number(b), 0) : 0}</b></div><div className="card p-3">Raw logs: <b>{rawLogs.length}</b></div></div>
      <div className="grid md:grid-cols-3 gap-3"><Text value={form.mailQuery || ''} onChange={v=>set('mailQuery',v)} placeholder="sender or recipient"/><button className="btn-secondary" onClick={searchMail}>Search Mail Trace</button>{rawLogs[0] && <button className="btn-secondary" onClick={()=>openAuthenticatedDownload(`/api/analytics/raw-access/${rawLogs[0].name}/download`, { filename: rawLogs[0].name })}>Download Latest Raw Log</button>}</div>
      <div className="max-h-52 overflow-auto space-y-2">{mailEvents.map((e,i) => <div key={i} className="text-xs rounded bg-slate-50 dark:bg-slate-900 p-2 font-mono">{e.timestamp} {e.queueId} {e.sender} → {e.recipient} {e.status} {e.diagnostic}</div>)}</div>
    </Panel>

    <Panel title="4. Guided Backup Wizard">
      <div className="grid md:grid-cols-4 gap-3"><select className="input" value={form.backupType} onChange={e=>set('backupType',e.target.value)}><option value="files">Home/files backup</option><option value="database">Database backup</option></select><Text value={form.backupTarget || ''} onChange={v=>set('backupTarget',v)} placeholder="target path under webroot or db name"/><button className="btn-primary" onClick={runBackup}>Run Wizard Backup</button></div>
      <div className="text-sm text-slate-500">Recent backups: {backups.slice(0,5).map(b=>b.name).join(' • ') || 'None'}</div>
    </Panel>

    <Panel title="5. phpMyAdmin / Database GUI Integration">
      <div className="text-sm">Installed: <b>{phpmyadmin.installed ? 'Yes' : 'No'}</b> {phpmyadmin.path || ''} {phpmyadmin.url && <a className="text-indigo-500 ml-2" href={phpmyadmin.url} target="_blank" rel="noreferrer">Open phpMyAdmin</a>}</div>
    </Panel>

    <Panel title="6. Web Disk / WebDAV">
      <div className="grid md:grid-cols-4 gap-3"><Text value={form.webdavUser || ''} onChange={v=>set('webdavUser',v)} placeholder="webdav username"/><Text value={form.webdavHome || ''} onChange={v=>set('webdavHome',v)} placeholder="/var/www/domain/public_html"/><Text value={form.webdavDomain || ''} onChange={v=>set('webdavDomain',v)} placeholder="domain"/><button className="btn-primary" onClick={saveWebdav}>Save WebDAV Account</button></div>
      <div className="text-sm text-slate-500">Accounts: {webdav.map(w=>`${w.username}:${w.home}`).join(' • ') || 'None'}</div>
    </Panel>

    <Panel title="7. DNS Clustering + Nameserver Automation">
      <div className="grid md:grid-cols-5 gap-3"><Text value={form.dnsName || ''} onChange={v=>set('dnsName',v)} placeholder="node name"/><Text value={form.dnsHost || ''} onChange={v=>set('dnsHost',v)} placeholder="node IP/host"/><Text value={form.dnsTsigName || ''} onChange={v=>set('dnsTsigName',v)} placeholder="rndc key name"/><Text value={form.dnsTsigSecret || ''} onChange={v=>set('dnsTsigSecret',v)} placeholder="rndc key secret" type="password"/><button className="btn-primary" onClick={saveDnsNode}>Save DNS Node</button></div>
      <div className="grid md:grid-cols-3 gap-3"><Text value={form.nsDomain || ''} onChange={v=>set('nsDomain',v)} placeholder="domain to sync / plan"/><button className="btn-secondary" onClick={previewDnsSync}>Preview Sync</button><button className="btn-primary" onClick={runDnsSync}>Run Auth Sync</button></div>
      <div className="text-sm text-slate-500">Nodes: {dnsNodes.map(n=>`${n.name}@${n.host}${n.authenticated ? ' (auth)' : ''}`).join(' • ') || 'None'}</div>
      {dnsSync && <div className="rounded bg-slate-50 dark:bg-slate-900 p-3 text-xs font-mono max-h-44 overflow-auto">{JSON.stringify(dnsSync, null, 2)}</div>}
    </Panel>

    <Panel title="8. Full Transfer / Import Tool">
      <div className="grid md:grid-cols-4 gap-3"><Text value={form.archivePath || ''} onChange={v=>set('archivePath',v)} placeholder="/root/cpmove-user.tar.gz"/><Text value={form.importDomain || ''} onChange={v=>set('importDomain',v)} placeholder="override domain optional"/><Text value={form.importUsername || ''} onChange={v=>set('importUsername',v)} placeholder="override username optional"/><button className="btn-secondary" onClick={inspectImport}>Inspect / Dry Run</button></div>
      <div className="space-y-2">{imports.map(i=><div key={i.id} className="rounded border border-slate-200 dark:border-slate-800 p-3 text-sm flex flex-wrap items-center justify-between gap-2"><div><b>#{i.id}</b> {i.status} <span className="text-slate-500">{i.report?.archivePath || i.archive_path}</span><div className="text-xs text-slate-500">Domains: {(i.report?.domains || []).join(', ') || 'none'} · DBs: {(i.report?.databases || []).length || 0} · Steps: {(i.report?.steps || []).length}</div></div><button className="btn-primary text-xs" disabled={!['inspected','failed'].includes(i.status)} onClick={()=>executeImport(i.id)}>Execute Import</button></div>)}</div>
    </Panel>

    <Panel title="9. Plugin / Update Ecosystem">
      <div className="grid md:grid-cols-3 gap-3 text-sm"><div>Current: <b>{updates.currentRevision || 'unknown'}</b></div><div>Remote: <b>{updates.remoteRevision || 'unknown'}</b></div><button className="btn-secondary" onClick={async()=>{ await post('/api/extensions/plugins/refresh', {}); load(); }}>Refresh Plugins</button></div>
      <div className="grid md:grid-cols-3 gap-3"><Text value={form.pluginPackage || ''} onChange={v=>set('pluginPackage',v)} placeholder="/root/plugin-package.tgz"/><Text value={form.pluginSha256 || ''} onChange={v=>set('pluginSha256',v)} placeholder="sha256 required/recommended"/><button className="btn-primary" onClick={installPlugin}>Verify + Install</button></div>
      <div className="space-y-2">{plugins.map(p=><div key={p.id} className="rounded border border-slate-200 dark:border-slate-800 p-3 text-sm flex flex-wrap items-center justify-between gap-2"><div><b>{p.name || p.id}</b> <span className="text-slate-500">{p.version || 'unknown'} · {p.enabled ? 'enabled' : 'disabled'} · {p.signed ? 'signed' : 'unsigned'}</span></div><div className="flex gap-2"><button className="btn-secondary text-xs" onClick={()=>togglePlugin(p.id, !p.enabled)}>{p.enabled ? 'Disable' : 'Enable'}</button><button className="btn-secondary text-xs" onClick={()=>rollbackPlugin(p.id)}>Rollback</button></div></div>)}</div>
    </Panel>
  </div>;
}
