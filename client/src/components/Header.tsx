import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LogOut, ChevronRight, Sun, Moon } from 'lucide-react';

const titles: Record<string, string> = {
  '/':          'Dashboard',
  '/files':     'File Manager',
  '/email':     'Email',
  '/databases': 'Databases',
  '/domains':   'Domains & DNS',
  '/ftp':       'FTP Accounts',
  '/scripts':   'Script Installer',
};

export default function Header() {
  const { username, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const title = titles[pathname] || 'HostPanel';

  return (
    <header className="h-16 flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between px-6 transition-colors duration-200">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-400 dark:text-slate-500 font-medium">HostPanel</span>
        <ChevronRight size={14} className="text-slate-300 dark:text-slate-600" />
        <span className="font-semibold text-slate-800 dark:text-slate-200">{title}</span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Dark mode toggle */}
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
            {username?.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{username}</span>
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
