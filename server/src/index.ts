import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

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
import paypalRoutes      from './routes/paypal';
import clientPortalRoutes from './routes/client-portal';
import { authenticateToken } from './middleware/auth';
import { setupTerminal } from './terminal';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

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
