import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { usePortalAuth } from './PortalAuthContext';
import {
  LayoutDashboard, FolderOpen, Archive,
  Globe, Network, ArrowRightLeft, AlertTriangle, FileCode,
  Database,
  Mail, MailPlus, MailSearch, Filter, MailOpen,
  Lock, Shield, Key, ShieldAlert,
  Clock, Upload, PackageOpen,
  Receipt, User, BarChart3,
  Zap, ExternalLink, ChevronDown, Server, CheckCircle2,
} from 'lucide-react';

interface NavItem { to: string; icon: React.ElementType; label: string; end?: boolean; disabled?: boolean; permission?: string; ownerOnly?: boolean }
interface Section { label: string; items: NavItem[] }

function buildSections(hasAccount: boolean, teamPerms?: string[] | null): Section[] {
  const isTeam = Array.isArray(teamPerms);
  const allowed = (item: NavItem) => !isTeam || (!item.ownerOnly && (!item.permission || teamPerms.includes(item.permission)));

  return [
    { label: 'Main', items: [
      { to: '/portal',            icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/portal/invoices',   icon: Receipt,         label: 'Invoices', permission: 'billing' },
    ]},
    { label: 'Files & Backups', items: [
      { to: '/portal/files',      icon: FolderOpen, label: 'File Manager', disabled: !hasAccount, permission: 'files' },
      { to: '/portal/backups',    icon: Archive,    label: 'Backups',       disabled: !hasAccount, permission: 'backup-wizard' },
    ]},
    { label: 'Domains & Web', items: [
      { to: '/portal/dns',         icon: Globe,          label: 'DNS Records',  disabled: !hasAccount, permission: 'dns' },
      { to: '/portal/subdomains',  icon: Network,        label: 'Subdomains',   disabled: !hasAccount, permission: 'files' },
      { to: '/portal/redirects',   icon: ArrowRightLeft, label: 'Redirects',    disabled: !hasAccount, permission: 'files' },
      { to: '/portal/error-pages', icon: AlertTriangle,  label: 'Error Pages',  disabled: !hasAccount, permission: 'files' },
      { to: '/portal/htaccess',    icon: FileCode,       label: '.htaccess',    disabled: !hasAccount, permission: 'files' },
    ]},
    { label: 'Databases', items: [
      { to: '/portal/databases',   icon: Database, label: 'MySQL Databases', disabled: !hasAccount, permission: 'databases' },
    ]},
    { label: 'Email', items: [
      { to: '/portal/email',         icon: Mail,       label: 'Email Accounts', disabled: !hasAccount, permission: 'email-accounts' },
      { to: '/portal/email-extras',  icon: MailPlus,   label: 'Forwarders & Auto-reply', disabled: !hasAccount, permission: 'email-accounts' },
      { to: '/portal/mail-auth',     icon: MailSearch, label: 'DKIM / SPF / DMARC', disabled: !hasAccount, permission: 'email-accounts' },
      { to: '/portal/spam-rules',    icon: Filter,     label: 'Spam Rules',     disabled: !hasAccount, permission: 'email-accounts' },
      { to: '/portal/webmail',       icon: MailOpen,   label: 'Webmail', permission: 'email-accounts' },
    ]},
    { label: 'Security', items: [
      { to: '/portal/ssl',              icon: Lock,        label: 'SSL', disabled: !hasAccount, permission: 'files' },
      { to: '/portal/htpasswd',         icon: Shield,      label: 'Protected Dirs', disabled: !hasAccount, permission: 'files' },
      { to: '/portal/hotlink',          icon: ShieldAlert, label: 'Hotlink Protection', disabled: !hasAccount, permission: 'files' },
      { to: '/portal/security-scanner', icon: ShieldAlert, label: 'Security Scanner', disabled: !hasAccount, permission: 'files' },
      { to: '/portal/ssh-keys',         icon: Key,         label: 'SSH Keys', permission: 'files' },
    ]},
    { label: 'Server', items: [
      { to: '/portal/cron',     icon: Clock,       label: 'Cron Jobs', permission: 'files' },
      { to: '/portal/ftp',      icon: Upload,      label: 'FTP Accounts', permission: 'ftp' },
      { to: '/portal/stats',    icon: BarChart3,   label: 'Site Stats',     disabled: !hasAccount, permission: 'analytics' },
      { to: '/portal/scripts',  icon: PackageOpen, label: 'Install WordPress', disabled: !hasAccount, permission: 'files' },
    ]},
    { label: 'Account', items: [
      { to: '/portal/profile',  icon: User, label: 'Profile & 2FA', ownerOnly: true },
    ]},
  ].map(section => ({ ...section, items: section.items.filter(allowed) })).filter(section => section.items.length > 0);
}

function AccountSwitcher() {
  const { accounts, selectedAccount, setSelectedAccount } = usePortalAuth();
  const [open, setOpen] = useState(false);

  if (accounts.length === 0) {
    return <div className="px-4 py-3 text-xs text-slate-500 italic">No hosting accounts yet</div>;
  }

  return (
    <div className="relative px-3 py-3 border-b border-white/5">
      <p className="px-1 mb-1 text-[9px] font-bold tracking-widest text-slate-600 uppercase">Hosting Account</p>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-left"
      >
        <Server size={14} className="text-indigo-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-white truncate">{selectedAccount?.domain || 'Choose…'}</div>
          {selectedAccount && <div className="text-[10px] text-slate-400 truncate">{selectedAccount.plan_name || selectedAccount.username}</div>}
        </div>
        <ChevronDown size={12} className={`text-slate-400 flex-shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-10 left-3 right-3 mt-1 rounded-lg bg-slate-800 border border-white/10 shadow-xl max-h-64 overflow-y-auto">
          {accounts.map(a => (
            <button
              key={a.id}
              onClick={() => { setSelectedAccount(a); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-white/5 ${a.id === selectedAccount?.id ? 'bg-indigo-600/20' : ''}`}
            >
              <Server size={11} className="text-slate-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-white truncate">{a.domain}</div>
                <div className="text-[10px] text-slate-500 truncate">{a.plan_name || a.username} · {a.status}</div>
              </div>
              {a.id === selectedAccount?.id && <CheckCircle2 size={12} className="text-emerald-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PortalSidebar() {
  const { selectedAccount, client } = usePortalAuth();
  const [logoUrl, setLogoUrl]   = useState<string | null>(null);
  const [panelName, setPanelName] = useState('Client Portal');
  const teamPerms = client?.team_user?.permissions || null;
  const sections = buildSections(!!selectedAccount, teamPerms);

  useEffect(() => {
    // Plain fetch (no Authorization header, no auto-redirect on 401) — the
    // logo/name endpoint is a public branding helper but the admin-flavored
    // fetchApi() would force-redirect portal users to /login on a 401.
    fetch('/api/settings/branding')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.url) setLogoUrl(d.url); if (d?.name) setPanelName(d.name); })
      .catch(() => {});
  }, []);

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col bg-slate-900 dark:bg-slate-950 text-slate-100 select-none transition-colors duration-200">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-white/5 flex-shrink-0">
        {logoUrl
          ? <img src={logoUrl} alt="Logo" className="h-8 w-auto object-contain" />
          : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 shadow-lg shadow-indigo-900/50">
              <Zap size={16} className="text-white" strokeWidth={2.5} />
            </div>
          )
        }
        <div className="min-w-0">
          <span className="text-[15px] font-bold text-white tracking-tight truncate block">{panelName}</span>
          <span className="block text-[10px] text-slate-500 -mt-0.5 font-medium">{teamPerms ? 'Team Portal' : 'Client Portal'}</span>
        </div>
      </div>

      <AccountSwitcher />

      <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-4 scrollbar-none">
        {sections.map(section => (
          <div key={section.label}>
            <p className="px-3 mb-1 text-[9px] font-bold tracking-widest text-slate-600 uppercase">{section.label}</p>
            <div className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label, end, disabled }) => disabled ? (
                <div
                  key={to}
                  title="Select a hosting account first"
                  className="group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-slate-600 cursor-not-allowed opacity-50"
                >
                  <Icon size={15} strokeWidth={2} className="text-slate-700 flex-shrink-0" />
                  {label}
                </div>
              ) : (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-900/40'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        size={15}
                        strokeWidth={isActive ? 2.5 : 2}
                        className={isActive ? 'text-white flex-shrink-0' : 'text-slate-500 group-hover:text-slate-300 flex-shrink-0'}
                      />
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-white/5 flex-shrink-0 space-y-2">
        <a
          href="/login"
          className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
        >
          <ExternalLink size={10} /> Admin sign-in
        </a>
      </div>
    </aside>
  );
}
