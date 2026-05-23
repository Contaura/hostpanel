import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './context/ConfirmContext';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import NotFound from './pages/NotFound';
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
import ClientPortalLogin from './pages/ClientPortalLogin';
import PortalLayout from './portal/PortalLayout';
import PortalDashboard from './portal/pages/Dashboard';
import PortalInvoices from './portal/pages/Invoices';
import PortalProfile from './portal/pages/Profile';
import PortalFiles from './portal/pages/Files';
import PortalBackups from './portal/pages/Backups';
import PortalDns from './portal/pages/Dns';
import PortalSubdomains from './portal/pages/Subdomains';
import PortalRedirects from './portal/pages/Redirects';
import PortalErrorPages from './portal/pages/ErrorPages';
import PortalHtaccess from './portal/pages/Htaccess';
import PortalDatabases from './portal/pages/Databases';
import PortalEmail from './portal/pages/Email';
import PortalEmailExtras from './portal/pages/EmailExtras';
import PortalMailAuth from './portal/pages/MailAuth';
import PortalSpamRules from './portal/pages/SpamRules';
import PortalWebmail from './portal/pages/Webmail';
import PortalSsl from './portal/pages/Ssl';
import PortalHtpasswd from './portal/pages/Htpasswd';
import PortalHotlink from './portal/pages/Hotlink';
import PortalSecurityScanner from './portal/pages/SecurityScanner';
import PortalSshKeys from './portal/pages/SshKeys';
import PortalCron from './portal/pages/Cron';
import PortalFtp from './portal/pages/Ftp';
import PortalStats from './portal/pages/Stats';
import PortalScripts from './portal/pages/Scripts';
import DkimManager from './pages/DkimManager';
import MailQueue from './pages/MailQueue';
import SpamFilter from './pages/SpamFilter';
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
import ServerInfo from './pages/ServerInfo';
import SecurityScanner from './pages/SecurityScanner';
import MailTools from './pages/MailTools';
import Webmail from './pages/Webmail';

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
      <Route path="/portal" element={<PortalLayout />}>
        <Route index                      element={<PortalDashboard />} />
        <Route path="invoices"            element={<PortalInvoices />} />
        <Route path="profile"             element={<PortalProfile />} />
        <Route path="files"               element={<PortalFiles />} />
        <Route path="backups"             element={<PortalBackups />} />
        <Route path="dns"                 element={<PortalDns />} />
        <Route path="subdomains"          element={<PortalSubdomains />} />
        <Route path="redirects"           element={<PortalRedirects />} />
        <Route path="error-pages"         element={<PortalErrorPages />} />
        <Route path="htaccess"            element={<PortalHtaccess />} />
        <Route path="databases"           element={<PortalDatabases />} />
        <Route path="email"               element={<PortalEmail />} />
        <Route path="email-extras"        element={<PortalEmailExtras />} />
        <Route path="mail-auth"           element={<PortalMailAuth />} />
        <Route path="spam-rules"          element={<PortalSpamRules />} />
        <Route path="webmail"             element={<PortalWebmail />} />
        <Route path="ssl"                 element={<PortalSsl />} />
        <Route path="htpasswd"            element={<PortalHtpasswd />} />
        <Route path="hotlink"             element={<PortalHotlink />} />
        <Route path="security-scanner"    element={<PortalSecurityScanner />} />
        <Route path="ssh-keys"            element={<PortalSshKeys />} />
        <Route path="cron"                element={<PortalCron />} />
        <Route path="ftp"                 element={<PortalFtp />} />
        <Route path="stats"               element={<PortalStats />} />
        <Route path="scripts"             element={<PortalScripts />} />
      </Route>

      <Route path="/" element={<PrivateRoute><ErrorBoundary><Layout /></ErrorBoundary></PrivateRoute>}>
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
        <Route path="spam-filter" element={<SpamFilter />} />

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
        <Route path="server-info"       element={<ServerInfo />} />
        <Route path="security-scanner"  element={<SecurityScanner />} />
        <Route path="mail-tools"        element={<MailTools />} />
        <Route path="webmail"           element={<Webmail />} />

        {/* Admin Config */}
        <Route path="settings"    element={<Settings />} />
        <Route path="admin-users" element={<AdminUsers />} />
        <Route path="api-tokens"  element={<ApiTokens />} />

        <Route path="*" element={<NotFound />} />
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
            <ConfirmProvider>
              <AppRoutes />
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
