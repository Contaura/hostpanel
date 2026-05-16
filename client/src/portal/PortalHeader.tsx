import { useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { usePortalAuth } from './PortalAuthContext';
import { LogOut, ChevronRight, Sun, Moon } from 'lucide-react';

const titles: Record<string, string> = {
  '/portal':                  'Dashboard',
  '/portal/invoices':         'Invoices',
  '/portal/profile':          'Profile & 2FA',
  '/portal/files':            'File Manager',
  '/portal/backups':          'Backups',
  '/portal/dns':              'DNS Records',
  '/portal/subdomains':       'Subdomains',
  '/portal/redirects':        'Redirects',
  '/portal/error-pages':      'Error Pages',
  '/portal/htaccess':         '.htaccess',
  '/portal/databases':        'MySQL Databases',
  '/portal/email':            'Email Accounts',
  '/portal/email-extras':     'Forwarders & Auto-reply',
  '/portal/mail-auth':        'DKIM / SPF / DMARC',
  '/portal/spam-rules':       'Spam Rules',
  '/portal/webmail':          'Webmail',
  '/portal/ssl':              'SSL',
  '/portal/htpasswd':         'Protected Directories',
  '/portal/hotlink':          'Hotlink Protection',
  '/portal/security-scanner': 'Security Scanner',
  '/portal/ssh-keys':         'SSH Keys',
  '/portal/cron':             'Cron Jobs',
  '/portal/ftp':              'FTP Accounts',
  '/portal/stats':            'Site Statistics',
  '/portal/scripts':          'Install WordPress',
};

export default function PortalHeader() {
  const { client, selectedAccount, logout } = usePortalAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const title = titles[pathname] || 'Client Portal';
  const name = client?.name || localStorage.getItem('hp_portal_name') || 'Client';

  return (
    <header className="h-16 flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between px-6 transition-colors duration-200">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <span className="text-slate-400 dark:text-slate-500 font-medium">Portal</span>
        <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />
        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{title}</span>
        {selectedAccount && (
          <>
            <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />
            <span className="text-slate-500 dark:text-slate-400 font-mono text-xs truncate">{selectedAccount.domain}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-200 transition-all duration-150"
          aria-label="Toggle dark mode"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
            {name.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{name}</span>
        </div>

        <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors duration-150 font-medium"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </header>
  );
}
