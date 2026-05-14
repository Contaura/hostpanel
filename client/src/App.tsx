import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FileManager from './pages/FileManager';
import EmailManager from './pages/EmailManager';
import DatabaseManager from './pages/DatabaseManager';
import DomainManager from './pages/DomainManager';
import FTPManager from './pages/FTPManager';
import ScriptInstaller from './pages/ScriptInstaller';
import CronJobs from './pages/CronJobs';
import BackupManager from './pages/BackupManager';
import Firewall from './pages/Firewall';
import LogViewer from './pages/LogViewer';
import ProcessManager from './pages/ProcessManager';
import PHPManager from './pages/PHPManager';
import Subdomains from './pages/Subdomains';
import Redirects from './pages/Redirects';
import SSHKeys from './pages/SSHKeys';
import ErrorPages from './pages/ErrorPages';
import HtpasswdManager from './pages/HtpasswdManager';
import TerminalPage from './pages/Terminal';
import Accounts from './pages/Accounts';
import Plans from './pages/Plans';
import Billing from './pages/Billing';
import EmailExtras from './pages/EmailExtras';
import WebExtras from './pages/WebExtras';
import SecurityPlus from './pages/SecurityPlus';
import AppManager from './pages/AppManager';
import SystemMonitor from './pages/SystemMonitor';
import Settings from './pages/Settings';
import AdminUsers from './pages/AdminUsers';
import ApiTokens from './pages/ApiTokens';
import ClientPortal from './pages/ClientPortal';
import ClientPortalLogin from './pages/ClientPortalLogin';
import DkimManager from './pages/DkimManager';
import MailQueue from './pages/MailQueue';
import CloudflareManager from './pages/CloudflareManager';
import GitDeploy from './pages/GitDeploy';
import CacheManager from './pages/CacheManager';
import WafManager from './pages/WafManager';
import AuditLog from './pages/AuditLog';
import SslAdvanced from './pages/SslAdvanced';
import PhpVersions from './pages/PhpVersions';
import ResourceLimits from './pages/ResourceLimits';
import RecurringBilling from './pages/RecurringBilling';
import Reseller from './pages/Reseller';
import Notifications from './pages/Notifications';
import MailRouting from './pages/MailRouting';
import AddonDomains from './pages/AddonDomains';
import WordPressManager from './pages/WordPressManager';
import ParkedDomains from './pages/ParkedDomains';
import NodeApps from './pages/NodeApps';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <Login />} />

      {/* Client Portal — standalone, no admin auth */}
      <Route path="/portal/login" element={<ClientPortalLogin />} />
      <Route path="/portal" element={<ClientPortal />} />

      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<Dashboard />} />

        {/* Files & Storage */}
        <Route path="files"   element={<FileManager />} />
        <Route path="backup"  element={<BackupManager />} />

        {/* Domains & Web */}
        <Route path="domains"     element={<DomainManager />} />
        <Route path="subdomains"  element={<Subdomains />} />
        <Route path="redirects"   element={<Redirects />} />
        <Route path="error-pages" element={<ErrorPages />} />
        <Route path="web-extras"  element={<WebExtras />} />

        {/* Databases */}
        <Route path="databases" element={<DatabaseManager />} />

        {/* Email */}
        <Route path="email"       element={<EmailManager />} />
        <Route path="email-extras" element={<EmailExtras />} />

        {/* Security */}
        <Route path="ssh-keys"   element={<SSHKeys />} />
        <Route path="firewall"   element={<Firewall />} />
        <Route path="htpasswd"   element={<HtpasswdManager />} />
        <Route path="security"   element={<SecurityPlus />} />

        {/* Server / Advanced */}
        <Route path="cron"       element={<CronJobs />} />
        <Route path="php"        element={<PHPManager />} />
        <Route path="processes"  element={<ProcessManager />} />
        <Route path="logs"       element={<LogViewer />} />
        <Route path="ftp"        element={<FTPManager />} />
        <Route path="scripts"    element={<ScriptInstaller />} />
        <Route path="terminal"   element={<TerminalPage />} />
        <Route path="apps"       element={<AppManager />} />
        <Route path="monitor"    element={<SystemMonitor />} />

        {/* Hosting & Billing */}
        <Route path="accounts" element={<Accounts />} />
        <Route path="plans"    element={<Plans />} />
        <Route path="billing"  element={<Billing />} />

        {/* Email / DNS extras */}
        <Route path="dkim"       element={<DkimManager />} />
        <Route path="mail-queue" element={<MailQueue />} />

        {/* Web / CDN / Deploy */}
        <Route path="cloudflare"   element={<CloudflareManager />} />
        <Route path="git-deploy"   element={<GitDeploy />} />
        <Route path="cache"        element={<CacheManager />} />
        <Route path="ssl-advanced" element={<SslAdvanced />} />

        {/* Security */}
        <Route path="waf"       element={<WafManager />} />
        <Route path="audit-log" element={<AuditLog />} />

        {/* Server / Runtime */}
        <Route path="php-versions"    element={<PhpVersions />} />
        <Route path="resource-limits" element={<ResourceLimits />} />

        {/* Billing extras */}
        <Route path="recurring"  element={<RecurringBilling />} />

        {/* Resellers */}
        <Route path="resellers" element={<Reseller />} />

        {/* Notifications */}
        <Route path="notifications" element={<Notifications />} />

        {/* Mail Routing / Addon Domains / WordPress */}
        <Route path="mail-routing"   element={<MailRouting />} />
        <Route path="addon-domains"  element={<AddonDomains />} />
        <Route path="wordpress"      element={<WordPressManager />} />
        <Route path="parked-domains" element={<ParkedDomains />} />
        <Route path="node-apps"      element={<NodeApps />} />

        {/* Admin Config */}
        <Route path="settings"    element={<Settings />} />
        <Route path="admin-users" element={<AdminUsers />} />
        <Route path="api-tokens"  element={<ApiTokens />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
