import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { fetchApi } from '../lib/api';
import {
  LayoutDashboard, FolderOpen, Archive,
  Globe, Network, ArrowRightLeft, AlertTriangle, Globe2,
  Database,
  Mail, MailPlus, MailSearch, ListOrdered, MailOpen, PlusSquare, BrainCircuit, ServerCog,
  Key, ShieldCheck, Lock, Shield, ShieldAlert, ClipboardList,
  Clock, Code2, Activity, FileText, Upload, PackageOpen, TerminalSquare,
  Server, Package, Receipt, Info,
  Settings, Users, KeyRound, Bell, Cpu, ExternalLink,
  Zap, Cloud, GitBranch, Layers, RefreshCw, UserCheck, Tag,
} from 'lucide-react';

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
}
interface Section {
  label: string;
  items: NavItem[];
}

const sections: Section[] = [
  {
    label: 'Main',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
    ],
  },
  {
    label: 'Files & Storage',
    items: [
      { to: '/files',  icon: FolderOpen, label: 'File Manager' },
      { to: '/backup', icon: Archive,    label: 'Backup Manager' },
    ],
  },
  {
    label: 'Domains & Web',
    items: [
      { to: '/domains',      icon: Globe,          label: 'Domains & DNS' },
      { to: '/subdomains',  icon: Network,        label: 'Subdomains' },
      { to: '/addon-domains',  icon: PlusSquare,    label: 'Addon Domains' },
      { to: '/parked-domains', icon: Globe,         label: 'Parked Domains' },
      { to: '/redirects',     icon: ArrowRightLeft, label: 'Redirects' },
      { to: '/error-pages', icon: AlertTriangle,  label: 'Error Pages' },
    ],
  },
  {
    label: 'Databases',
    items: [
      { to: '/databases', icon: Database, label: 'MySQL Databases' },
    ],
  },
  {
    label: 'Email',
    items: [
      { to: '/email',        icon: Mail,        label: 'Email Accounts' },
      { to: '/email-extras', icon: MailPlus,   label: 'Email Extras' },
      { to: '/dkim',         icon: MailSearch, label: 'DKIM / SPF / DMARC' },
      { to: '/mail-queue',   icon: ListOrdered, label: 'Mail Queue' },
      { to: '/spam-filter',  icon: ShieldAlert, label: 'Spam Filter' },
      { to: '/mail-routing', icon: MailOpen,   label: 'Mail Routing & Lists' },
    ],
  },
  {
    label: 'Web & CDN',
    items: [
      { to: '/web-extras',  icon: Globe2,     label: 'Web Extras' },
      { to: '/ssl-advanced', icon: Lock,      label: 'SSL Advanced' },
      { to: '/cloudflare',  icon: Cloud,      label: 'Cloudflare CDN' },
      { to: '/git-deploy',  icon: GitBranch,  label: 'Git Deploy' },
      { to: '/cache',       icon: Layers,     label: 'Cache Manager' },
    ],
  },
  {
    label: 'Security',
    items: [
      { to: '/ssh-keys',          icon: Key,          label: 'SSH Keys' },
      { to: '/firewall',          icon: ShieldCheck,  label: 'Firewall & IPs' },
      { to: '/htpasswd',          icon: Lock,         label: 'Protected Dirs' },
      { to: '/security',          icon: Shield,       label: 'Security Center' },
      { to: '/waf',               icon: ShieldAlert,  label: 'WAF & Fail2Ban' },
      { to: '/security-scanner',  icon: ShieldAlert,  label: 'Security Scanner' },
      { to: '/audit-log',         icon: ClipboardList, label: 'Audit Log' },
    ],
  },
  {
    label: 'Server',
    items: [
      { to: '/cron',            icon: Clock,          label: 'Cron Jobs' },
      { to: '/php',             icon: Code2,          label: 'PHP Manager' },
      { to: '/php-versions',    icon: Code2,          label: 'Multi-PHP / nvm' },
      { to: '/resource-limits', icon: Cpu,            label: 'Resource Limits' },
      { to: '/processes',       icon: Activity,       label: 'Process Manager' },
      { to: '/logs',            icon: FileText,       label: 'Log Viewer' },
      { to: '/ftp',             icon: Upload,         label: 'FTP Accounts' },
      { to: '/scripts',         icon: PackageOpen,    label: 'Script Installer' },
      { to: '/terminal',        icon: TerminalSquare, label: 'Terminal' },
      { to: '/apps',            icon: Cpu,            label: 'App Manager' },
      { to: '/monitor',         icon: Bell,           label: 'System Monitor' },
      { to: '/wordpress',       icon: BrainCircuit,   label: 'WordPress Manager' },
      { to: '/node-apps',       icon: ServerCog,      label: 'Node.js / Python' },
      { to: '/server-info',     icon: Info,           label: 'Server Info' },
      { to: '/mail-tools',      icon: MailSearch,     label: 'Mail Tools' },
      { to: '/cpanel-parity',   icon: ServerCog,      label: 'cPanel / WHM Parity' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/accounts',  icon: Server,      label: 'Hosting Accounts' },
      { to: '/plans',     icon: Package,     label: 'Hosting Plans' },
      { to: '/billing',   icon: Receipt,     label: 'Billing & Invoices' },
      { to: '/recurring', icon: RefreshCw,   label: 'Recurring Billing' },
      { to: '/resellers', icon: UserCheck,   label: 'Resellers (WHM)' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/settings',       icon: Settings,      label: 'Settings' },
      { to: '/admin-users',    icon: Users,         label: 'Admin Users' },
      { to: '/api-tokens',     icon: KeyRound,      label: 'API Tokens' },
      { to: '/notifications',  icon: Bell,          label: 'Notifications' },
    ],
  },
];

export default function Sidebar() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [panelName, setPanelName] = useState('HostPanel');

  useEffect(() => {
    fetchApi('/api/settings/branding')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.url) setLogoUrl(d.url); if (d?.name) setPanelName(d.name); })
      .catch(() => {});
  }, []);

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col bg-slate-900 dark:bg-slate-950 text-slate-100 select-none transition-colors duration-200">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-white/5 flex-shrink-0">
        {logoUrl
          ? <img src={logoUrl} alt="Logo" className="h-8 w-auto object-contain" />
          : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 shadow-lg shadow-indigo-900/50">
              <Zap size={16} className="text-white" strokeWidth={2.5} />
            </div>
          )
        }
        <div>
          <span className="text-[15px] font-bold text-white tracking-tight">{panelName}</span>
          <span className="block text-[10px] text-slate-500 -mt-0.5 font-medium">Control Panel</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-4 scrollbar-none">
        {sections.map(section => (
          <div key={section.label}>
            <p className="px-3 mb-1 text-[9px] font-bold tracking-widest text-slate-600 uppercase">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label, end }) => (
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

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/5 flex-shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] text-slate-500">All systems operational</span>
        </div>
        <a
          href="/portal"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
        >
          <ExternalLink size={10} /> Client Portal
        </a>
      </div>
    </aside>
  );
}
