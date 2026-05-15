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
import { authenticateToken, readonlyGuard } from './middleware/auth';
import { ipWhitelistMiddleware } from './middleware/ipWhitelist';
import { setupTerminal } from './terminal';

dotenv.config();

// Fail closed on insecure defaults in production. A warning isn't enough —
// running with the example JWT_SECRET means every JWT can be forged by anyone
// who has read the README, and a warning in stderr won't stop that.
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'hostpanel-secret-change-in-production') {
    console.error('[SECURITY] Refusing to start: JWT_SECRET is missing or set to the example value. Set a strong random value in /etc/hostpanel.env.');
    process.exit(1);
  }
  if (!process.env.ADMIN_PASS_HASH || process.env.ADMIN_PASS_HASH === '$2b$12$examplehashhere') {
    console.warn('[SECURITY] ADMIN_PASS_HASH is set to the example value. Change your admin password immediately.');
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// The Node process sits behind Apache on the loopback interface (see install.sh).
// Trust X-Forwarded-* only from loopback so express-rate-limit keys on the real client IP.
app.set('trust proxy', 'loopback');

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

// Security response headers (X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, Strict-Transport-Security) are emitted by Apache via
// /etc/httpd/conf.d/zz-hostpanel-headers.conf — see install.sh. Node is
// always behind Apache in a real deployment (port 3001 is not opened in
// the firewall), so duplicating them here just produced two copies in
// every response.

// IP whitelist — blocks non-listed IPs when any entries exist
app.use('/api/', ipWhitelistMiddleware);

// Global API rate limit — 300 req/min per IP
app.use('/api/', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, slow down.' } }));
// Strict limit on auth endpoints — 20 req/min
app.use('/api/auth/', rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts.' } }));
// Client portal *login* paths only — 20 req/min. The portal also exposes
// data routes (/portal/accounts, /portal/files/..., etc.) under the same
// prefix and those should fall under the regular /api/ limiter, not the
// stricter login budget. Without this narrow path the file manager would
// burn the 20-req budget on a single page load.
app.use(['/api/portal/login', '/api/portal/login/totp'], rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts.' } }));

// Stripe webhook needs the raw body BEFORE json parsing
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
// Git-deploy webhooks also need the raw body so HMAC can verify the exact bytes
// GitHub / GitLab signed. The route handler parses the JSON itself.
app.use('/api/git-deploy/webhook', express.raw({ type: '*/*', limit: '1mb' }));

// Cap JSON / urlencoded bodies. 1 MB is plenty for control-plane operations
// (file uploads go through multer, which has its own per-route fileSize
// limit). Without an explicit cap, body-parser uses ~100 KB by default,
// which is silently below what some panel operations actually need, and
// gives no signal to a caller hammering us with megabyte JSON payloads.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Block all write operations for readonly-role tokens before any route handler runs
app.use('/api/', readonlyGuard);

// Audit log — must be installed BEFORE route mounts so it captures non-GET requests
// across every protected route. The middleware itself only writes on res.statusCode < 400
// and falls back to username='anonymous' when req.user isn't populated yet.
app.use('/api/', auditMiddleware);

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

// Stripe — POST /webhook is public (Stripe-signature authenticated); all other routes require JWT
app.use('/api/stripe', (req, res, next) => {
  if (req.path === '/webhook' && req.method === 'POST') return next();
  return (authenticateToken as any)(req, res, next);
}, stripeRoutes);

// PayPal
app.use('/api/paypal', authenticateToken, paypalRoutes);

// Email extras
app.use('/api/dkim',         authenticateToken, dkimRoutes);
app.use('/api/mail-queue',   authenticateToken, mailQueueRoutes);
app.use('/api/mail-routing', authenticateToken, mailRoutingRoutes);

// Web / CDN / Deploy
app.use('/api/cloudflare',      authenticateToken, cloudflareRoutes);
// Git deploy — POST /webhook/* is public (HMAC authenticated); all other routes require JWT
app.use('/api/git-deploy', (req, res, next) => {
  if (req.method === 'POST' && req.path.startsWith('/webhook/')) return next();
  return (authenticateToken as any)(req, res, next);
}, gitDeployRoutes);
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
  // Unmatched /api/* requests must return JSON 404, not the SPA HTML.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(path.join(__dirname, '../../client/dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
  });
}

// Global error handler — must be 4-argument to be recognized by Express.
// In production we surface a generic message because err.message often
// contains DB error text, file paths, or SQL fragments that help an
// attacker fingerprint the box. Route handlers that want a specific
// client-visible error still call res.status(...).json({ error: '...' })
// directly — those skip this fallback.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  const message = isProd && status >= 500 ? 'Internal server error' : (err.message || 'Internal server error');
  if (status >= 500) console.error('[unhandled]', err);
  res.status(status).json({ error: message });
});

const httpServer = createServer(app);
setupTerminal(httpServer);

httpServer.listen(PORT, () => {
  console.log(`HostPanel API running on port ${PORT}`);
});

export default app;
