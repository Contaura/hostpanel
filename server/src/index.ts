import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import rateLimit from 'express-rate-limit';

import authRoutes        from './routes/auth';
import fileRoutes        from './routes/files';
import emailRoutes       from './routes/email';
import databaseRoutes    from './routes/databases';
import domainRoutes      from './routes/domains';
import ftpRoutes         from './routes/ftp';
import scriptRoutes      from './routes/scripts';
import statsRoutes       from './routes/stats';
import cronRoutes        from './routes/cron';
import backupRoutes      from './routes/backup';
import firewallRoutes    from './routes/firewall';
import logsRoutes        from './routes/logs';
import processRoutes     from './routes/processes';
import phpRoutes         from './routes/php';
import subdomainRoutes   from './routes/subdomains';
import redirectRoutes    from './routes/redirects';
import sshkeyRoutes      from './routes/sshkeys';
import errpageRoutes     from './routes/errpages';
import htpasswdRoutes    from './routes/htpasswd';
import accountRoutes     from './routes/accounts';
import billingRoutes     from './routes/billing';
import stripeRoutes      from './routes/stripe';
import emailExtrasRoutes from './routes/email-extras';
import webExtrasRoutes   from './routes/web-extras';
import securityExtraRoutes from './routes/security-extra';
import appsRoutes        from './routes/apps';
import alertsRoutes      from './routes/alerts';
import settingsRoutes    from './routes/settings';
import adminUsersRoutes  from './routes/admin-users';
import apiTokensRoutes   from './routes/api-tokens';
import paypalRoutes          from './routes/paypal';
import clientPortalRoutes    from './routes/client-portal';
import dkimRoutes            from './routes/dkim';
import mailQueueRoutes       from './routes/mail-queue';
import mailRoutingRoutes     from './routes/mail-routing';
import cloudflareRoutes      from './routes/cloudflare';
import gitDeployRoutes       from './routes/git-deploy';
import cacheRoutes           from './routes/cache';
import wafRoutes             from './routes/waf';
import auditLogRoutes, { auditMiddleware } from './routes/audit-log';
import sslAdvancedRoutes     from './routes/ssl-advanced';
import phpDomainsRoutes      from './routes/php-domains';
import resourceLimitsRoutes  from './routes/resource-limits';
import notificationsRoutes   from './routes/notifications';
import resellerRoutes        from './routes/reseller';
import addonDomainsRoutes    from './routes/addon-domains';
import wordpressRoutes       from './routes/wordpress';
import parkedDomainsRoutes   from './routes/parked-domains';
import nodeAppsRoutes        from './routes/node-apps';
import serverInfoRoutes      from './routes/server-info';
import mailToolsRoutes       from './routes/mail-tools';
import securityScannerRoutes from './routes/security-scanner';
import { authenticateToken } from './middleware/auth';
import { setupTerminal } from './terminal';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

// Global API rate limit — 300 req/min per IP
app.use('/api/', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, slow down.' } }));
// Strict limit on auth endpoints — 20 req/min
app.use('/api/auth/', rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts.' } }));

// Stripe webhook needs the raw body BEFORE json parsing
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth
app.use('/api/auth', authRoutes);

// Stats
app.use('/api/stats', authenticateToken, statsRoutes);

// Files & Storage
app.use('/api/files',  authenticateToken, fileRoutes);
app.use('/api/backup', authenticateToken, backupRoutes);

// Domains & Web
app.use('/api/domains',     authenticateToken, domainRoutes);
app.use('/api/subdomains',  authenticateToken, subdomainRoutes);
app.use('/api/redirects',   authenticateToken, redirectRoutes);
app.use('/api/errpages',    authenticateToken, errpageRoutes);
app.use('/api/web',         authenticateToken, webExtrasRoutes);

// Databases
app.use('/api/databases', authenticateToken, databaseRoutes);

// Email
app.use('/api/email',       authenticateToken, emailRoutes);
app.use('/api/email-extras', authenticateToken, emailExtrasRoutes);

// Security
app.use('/api/ssh-keys',        authenticateToken, sshkeyRoutes);
app.use('/api/firewall',        authenticateToken, firewallRoutes);
app.use('/api/htpasswd',        authenticateToken, htpasswdRoutes);
app.use('/api/security-extra',  authenticateToken, securityExtraRoutes);

// Server management
app.use('/api/cron',      authenticateToken, cronRoutes);
app.use('/api/php',       authenticateToken, phpRoutes);
app.use('/api/processes', authenticateToken, processRoutes);
app.use('/api/logs',      authenticateToken, logsRoutes);
app.use('/api/ftp',       authenticateToken, ftpRoutes);
app.use('/api/scripts',   authenticateToken, scriptRoutes);
app.use('/api/apps',      authenticateToken, appsRoutes);
app.use('/api/alerts',    authenticateToken, alertsRoutes);

// Admin config
app.use('/api/settings',     authenticateToken, settingsRoutes);
app.use('/api/admin-users',  authenticateToken, adminUsersRoutes);
app.use('/api/api-tokens',   authenticateToken, apiTokensRoutes);

// Hosting & Billing
app.use('/api/accounts', authenticateToken, accountRoutes);
app.use('/api/billing',  authenticateToken, billingRoutes);

// Client portal — public routes (login uses clientAuth internally; me/invoices use clientAuth inside the router)
app.use('/api/portal', clientPortalRoutes);

// Stripe
app.use('/api/stripe/webhook', stripeRoutes);
app.use('/api/stripe',         authenticateToken, stripeRoutes);

// PayPal
app.use('/api/paypal', authenticateToken, paypalRoutes);

// Audit log middleware (after auth routes, before protected routes)
app.use(auditMiddleware);

// Email extras
app.use('/api/dkim',         authenticateToken, dkimRoutes);
app.use('/api/mail-queue',   authenticateToken, mailQueueRoutes);
app.use('/api/mail-routing', authenticateToken, mailRoutingRoutes);

// Web / CDN / Deploy
app.use('/api/cloudflare',      authenticateToken, cloudflareRoutes);
app.use('/api/git-deploy',      authenticateToken, gitDeployRoutes);
app.use('/api/git-deploy/webhook', gitDeployRoutes); // public webhook endpoint
app.use('/api/cache',           authenticateToken, cacheRoutes);

// Security extras
app.use('/api/waf',         authenticateToken, wafRoutes);
app.use('/api/audit-log',   authenticateToken, auditLogRoutes);
app.use('/api/ssl-advanced', authenticateToken, sslAdvancedRoutes);

// Server / Runtime
app.use('/api/php-domains',      authenticateToken, phpDomainsRoutes);
app.use('/api/resource-limits',  authenticateToken, resourceLimitsRoutes);

// Notifications / Resellers
app.use('/api/notifications',  authenticateToken, notificationsRoutes);
app.use('/api/resellers',      authenticateToken, resellerRoutes);
app.use('/api/addon-domains',  authenticateToken, addonDomainsRoutes);
app.use('/api/wordpress',      authenticateToken, wordpressRoutes);
app.use('/api/parked-domains', authenticateToken, parkedDomainsRoutes);
app.use('/api/node-apps',      authenticateToken, nodeAppsRoutes);
app.use('/api/server-info',       authenticateToken, serverInfoRoutes);
app.use('/api/mail-tools',        authenticateToken, mailToolsRoutes);
app.use('/api/security-scanner',  authenticateToken, securityScannerRoutes);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

const httpServer = createServer(app);
setupTerminal(httpServer);

httpServer.listen(PORT, () => {
  console.log(`HostPanel API running on port ${PORT}`);
});

export default app;
