import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './context/ConfirmContext';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';


const NotFound = lazy(() => import('./pages/NotFound'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const FileManager = lazy(() => import('./pages/FileManager'));
const EmailManager = lazy(() => import('./pages/EmailManager'));
const DatabaseManager = lazy(() => import('./pages/DatabaseManager'));
const DomainManager = lazy(() => import('./pages/DomainManager'));
const FTPManager = lazy(() => import('./pages/FTPManager'));
const ScriptInstaller = lazy(() => import('./pages/ScriptInstaller'));
const CronJobs = lazy(() => import('./pages/CronJobs'));
const BackupManager = lazy(() => import('./pages/BackupManager'));
const Firewall = lazy(() => import('./pages/Firewall'));
const LogViewer = lazy(() => import('./pages/LogViewer'));
const ProcessManager = lazy(() => import('./pages/ProcessManager'));
const PHPManager = lazy(() => import('./pages/PHPManager'));
const Subdomains = lazy(() => import('./pages/Subdomains'));
const Redirects = lazy(() => import('./pages/Redirects'));
const SSHKeys = lazy(() => import('./pages/SSHKeys'));
const ErrorPages = lazy(() => import('./pages/ErrorPages'));
const HtpasswdManager = lazy(() => import('./pages/HtpasswdManager'));
const TerminalPage = lazy(() => import('./pages/Terminal'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Plans = lazy(() => import('./pages/Plans'));
const Billing = lazy(() => import('./pages/Billing'));
const EmailExtras = lazy(() => import('./pages/EmailExtras'));
const WebExtras = lazy(() => import('./pages/WebExtras'));
const SecurityPlus = lazy(() => import('./pages/SecurityPlus'));
const AppManager = lazy(() => import('./pages/AppManager'));
const SystemMonitor = lazy(() => import('./pages/SystemMonitor'));
const Settings = lazy(() => import('./pages/Settings'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const ApiTokens = lazy(() => import('./pages/ApiTokens'));
const ClientPortalLogin = lazy(() => import('./pages/ClientPortalLogin'));
const PortalLayout = lazy(() => import('./portal/PortalLayout'));
const PortalDashboard = lazy(() => import('./portal/pages/Dashboard'));
const PortalInvoices = lazy(() => import('./portal/pages/Invoices'));
const PortalProfile = lazy(() => import('./portal/pages/Profile'));
const PortalFiles = lazy(() => import('./portal/pages/Files'));
const PortalBackups = lazy(() => import('./portal/pages/Backups'));
const PortalDns = lazy(() => import('./portal/pages/Dns'));
const PortalSubdomains = lazy(() => import('./portal/pages/Subdomains'));
const PortalRedirects = lazy(() => import('./portal/pages/Redirects'));
const PortalErrorPages = lazy(() => import('./portal/pages/ErrorPages'));
const PortalHtaccess = lazy(() => import('./portal/pages/Htaccess'));
const PortalDatabases = lazy(() => import('./portal/pages/Databases'));
const PortalEmail = lazy(() => import('./portal/pages/Email'));
const PortalEmailExtras = lazy(() => import('./portal/pages/EmailExtras'));
const PortalMailAuth = lazy(() => import('./portal/pages/MailAuth'));
const PortalSpamRules = lazy(() => import('./portal/pages/SpamRules'));
const PortalWebmail = lazy(() => import('./portal/pages/Webmail'));
const PortalSsl = lazy(() => import('./portal/pages/Ssl'));
const PortalHtpasswd = lazy(() => import('./portal/pages/Htpasswd'));
const PortalHotlink = lazy(() => import('./portal/pages/Hotlink'));
const PortalSecurityScanner = lazy(() => import('./portal/pages/SecurityScanner'));
const PortalSshKeys = lazy(() => import('./portal/pages/SshKeys'));
const PortalCron = lazy(() => import('./portal/pages/Cron'));
const PortalFtp = lazy(() => import('./portal/pages/Ftp'));
const PortalStats = lazy(() => import('./portal/pages/Stats'));
const PortalScripts = lazy(() => import('./portal/pages/Scripts'));
const DkimManager = lazy(() => import('./pages/DkimManager'));
const MailQueue = lazy(() => import('./pages/MailQueue'));
const SpamFilter = lazy(() => import('./pages/SpamFilter'));
const CloudflareManager = lazy(() => import('./pages/CloudflareManager'));
const GitDeploy = lazy(() => import('./pages/GitDeploy'));
const CacheManager = lazy(() => import('./pages/CacheManager'));
const WafManager = lazy(() => import('./pages/WafManager'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const SslAdvanced = lazy(() => import('./pages/SslAdvanced'));
const PhpVersions = lazy(() => import('./pages/PhpVersions'));
const ResourceLimits = lazy(() => import('./pages/ResourceLimits'));
const RecurringBilling = lazy(() => import('./pages/RecurringBilling'));
const Reseller = lazy(() => import('./pages/Reseller'));
const Notifications = lazy(() => import('./pages/Notifications'));
const MailRouting = lazy(() => import('./pages/MailRouting'));
const AddonDomains = lazy(() => import('./pages/AddonDomains'));
const WordPressManager = lazy(() => import('./pages/WordPressManager'));
const ParkedDomains = lazy(() => import('./pages/ParkedDomains'));
const NodeApps = lazy(() => import('./pages/NodeApps'));
const ServerInfo = lazy(() => import('./pages/ServerInfo'));
const SecurityScanner = lazy(() => import('./pages/SecurityScanner'));
const MailTools = lazy(() => import('./pages/MailTools'));
const Webmail = lazy(() => import('./pages/Webmail'));

function PrivateRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">Loading…</div>}>
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
    </Suspense>
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