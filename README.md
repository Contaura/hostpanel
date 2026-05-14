# HostPanel

A full-featured web hosting control panel built for **RHEL / Rocky Linux / AlmaLinux**. HostPanel replaces cPanel with a modern, self-hosted interface covering everything from DNS and email to billing, resellers, and security — with no per-server licensing fees.

---

## Feature Overview

### Hosting Management
- Hosting accounts with plan-based limits (disk, bandwidth, email, databases)
- Hosting plans with custom resource allocations
- Per-account cgroup v2 resource limits (CPU, memory, I/O)
- Subdomain, redirect, and error page management
- Hotlink protection, MIME types, disk usage, bandwidth stats

### Email
- Virtual mailbox and alias management (Postfix + Dovecot)
- Email forwarders and autoresponders
- SpamAssassin configuration
- DKIM key generation, SPF and DMARC wizard with DNS verification
- Mail queue viewer (flush, delete, per-message control)
- Mail routing rules and mailing lists

### DNS
- BIND zone management (create, edit, delete records)
- DNS zone import / export
- Cloudflare CDN integration (proxy toggle, analytics, cache purge, zone pause)

### Databases
- MariaDB/MySQL database and user management via web UI

### Security
- SSH key management
- Firewall rule management (firewalld)
- ModSecurity WAF mode (On / DetectionOnly / Off)
- Fail2Ban jail viewer, IP ban/unban
- Two-factor authentication (TOTP) for admin accounts
- IP whitelist for admin login
- Audit log with pagination and search
- Password-protected directories (htpasswd)
- SSL/TLS cipher preset configuration (modern / intermediate / legacy)
- Wildcard SSL via Let's Encrypt DNS challenge
- Per-domain SSL certificate tester

### Server
- Web-based terminal (xterm.js + node-pty)
- Process manager
- Log viewer
- PHP manager (global php.ini)
- Per-domain PHP version assignment (php-fpm socket switching)
- Node.js version management via nvm
- Python version management via pyenv
- Cron job manager
- Backup manager
- FTP account management (vsftpd)
- App manager (PM2 — deploy, start, stop, restart, logs)
- System monitor with alert rules (CPU, memory, disk thresholds)
- Package update manager (dnf)
- Nginx vhost manager (sites-available / sites-enabled)

### Caching
- OPcache stats and flush
- Redis status, flush, start/stop
- Memcached stats and flush

### Git Deployments
- Deployment configurations with auto-generated HMAC webhook secrets
- Manual deploy trigger
- Branch filtering

### Billing & Clients
- Client management with billing history
- Invoice creation with line items, tax, discount
- PDF invoice export and email delivery
- Recurring billing schedules (weekly / monthly / yearly)
- Credit notes with apply-to-invoice
- Promo codes (percent or fixed, with usage limits and expiry)
- Stripe Checkout integration
- PayPal Orders API v2 integration
- Client portal (standalone login, invoice view, PDF download, payment)

### Resellers (WHM)
- Reseller accounts with independent login
- Configurable allocations: disk, bandwidth, accounts, emails, databases

### Admin
- Multi-admin support with roles (superadmin, admin, readonly)
- API token management (SHA-256 hashed, shown once on creation)
- Settings page: company info, SMTP, currency, tax, PayPal
- Webhook/Slack/Discord/email notification channels with per-event filtering
- One-click script installer: WordPress, Joomla, Drupal, phpMyAdmin, PrestaShop, OpenCart, Laravel, Symfony, CodeIgniter, Roundcube, Nextcloud, Matomo

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| API | Express 4 |
| Database | SQLite (better-sqlite3) |
| Frontend | React 18 + Vite + Tailwind CSS v3 |
| Auth | JWT + bcrypt + TOTP (speakeasy) |
| PDF | PDFKit |
| Email | Nodemailer |
| Terminal | node-pty + xterm.js |
| Payments | Stripe SDK + PayPal REST API v2 |

---

## Requirements

- RHEL 8/9, Rocky Linux 8/9, or AlmaLinux 8/9
- Node.js 20+
- Root or sudo access
- Services: Apache (httpd), MariaDB, Postfix, Dovecot, BIND (named), vsftpd

---

## Quick Install

```bash
git clone https://github.com/Contaura/hostpanel.git
cd hostpanel
sudo bash install.sh
```

The installer:
1. Installs Node.js 20 via NodeSource
2. Installs system packages (httpd, mariadb, postfix, dovecot, bind, vsftpd, certbot)
3. Generates a random `JWT_SECRET`
4. Prompts for an admin password and bcrypt-hashes it
5. Builds the React frontend
6. Creates and starts a `hostpanel` systemd service
7. Opens ports 80, 443, 3001 in firewalld

After install, open `http://<server-ip>:3001`.

---

## Manual Setup

See the full documentation in [`docs/`](docs/):

- [Installation Guide](docs/01-installation.md)
- [Configuration Reference](docs/02-configuration.md)
- [Service Setup](docs/03-services.md)
- [First Login & Admin Setup](docs/04-first-login.md)
- [SSL Certificates](docs/05-ssl.md)
- [Payment Gateways](docs/06-payments.md)
- [Resellers](docs/07-resellers.md)
- [Client Portal](docs/08-client-portal.md)
- [API Reference](docs/09-api.md)
- [Upgrade & Backup](docs/10-upgrade.md)

---

## Default Credentials

The installer prompts for a password. If you cloned without running the installer, the `.env.example` ships with a placeholder hash — replace `ADMIN_PASS_HASH` before starting the server.

```bash
node -e "console.log(require('bcryptjs').hashSync('yourpassword', 12))"
```

---

## License

MIT — see [LICENSE](LICENSE).
