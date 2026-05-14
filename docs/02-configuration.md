# Configuration Reference

All configuration lives in `server/.env`. Copy `server/.env.example` as a starting point.

```bash
cp server/.env.example server/.env
nano server/.env
```

After changing `.env`, restart the service:

```bash
sudo systemctl restart hostpanel
```

---

## Core

| Key | Default | Description |
|---|---|---|
| `PORT` | `3001` | Port the Express API listens on |
| `NODE_ENV` | `development` | Set to `production` to serve the built React app |
| `JWT_SECRET` | — | **Required.** Random 64-char hex string. Generate: `openssl rand -hex 64` |
| `CLIENT_URL` | `http://localhost:5173` | Allowed CORS origin. In production: your panel domain |

---

## Admin Credentials (fallback)

These are used only if the `admin_users` database table is empty (first boot). Once you create an admin via the Admin Users page, these `.env` values are ignored.

| Key | Default | Description |
|---|---|---|
| `ADMIN_USER` | `admin` | Default admin username |
| `ADMIN_PASS_HASH` | — | bcrypt hash of the admin password. Generate: `node -e "console.log(require('bcryptjs').hashSync('pass', 12))"` |

---

## File Paths

| Key | Default | Description |
|---|---|---|
| `FILES_BASE_DIR` | `/var/www` | Root for the file manager |
| `WEBROOT` | `/var/www` | Root for one-click script installs |

---

## Web Servers

| Key | Default | Description |
|---|---|---|
| `VHOST_DIR` | `/etc/httpd/conf.d` | Apache vhost config directory |
| `NGINX_DIR` | `/etc/nginx/sites-available` | Nginx available vhosts (if using Nginx) |
| `NGINX_EN` | `/etc/nginx/sites-enabled` | Nginx enabled vhosts symlink dir |

---

## DNS

| Key | Default | Description |
|---|---|---|
| `NAMED_DIR` | `/var/named` | BIND zone files directory |
| `NAMED_CONF` | `/etc/named.conf` | Main named configuration file |

---

## Email

| Key | Default | Description |
|---|---|---|
| `VMAIL_DIR` | `/etc/postfix/virtual` | Postfix virtual mailbox / alias maps directory |
| `MAIL_PASSWD` | `/etc/dovecot/users` | Dovecot passwd-file path |

---

## FTP

| Key | Default | Description |
|---|---|---|
| `FTP_USER_DIR` | `/etc/vsftpd/users` | Per-user vsftpd config directory |

---

## Database

| Key | Default | Description |
|---|---|---|
| `DB_HOST` | `127.0.0.1` | MariaDB/MySQL host |
| `DB_PORT` | `3306` | MariaDB/MySQL port |
| `DB_ROOT_USER` | `root` | MariaDB root user for creating hosted databases |
| `DB_ROOT_PASS` | — | MariaDB root password |

---

## Stripe

Get your keys from the [Stripe Dashboard](https://dashboard.stripe.com/apikeys).

| Key | Description |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` or `sk_test_...` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` or `pk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | From Stripe → Webhooks → your endpoint. Used to verify webhook signatures. |

Stripe webhook endpoint to register: `https://panel.yourdomain.com/api/stripe/webhook`

---

## PayPal

Get credentials from the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications).

| Key | Default | Description |
|---|---|---|
| `PAYPAL_CLIENT_ID` | — | App client ID |
| `PAYPAL_SECRET` | — | App secret |
| `PAYPAL_MODE` | `sandbox` | `sandbox` for testing, `live` for production |

---

## SMTP

SMTP can also be configured in the admin UI under **Settings → SMTP**. The `.env` values are overridden by database settings if both are present.

| Key | Default | Description |
|---|---|---|
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port (587 = STARTTLS, 465 = SSL) |
| `SMTP_SECURE` | `false` | `true` for port 465 (SSL), `false` for STARTTLS |
| `SMTP_USER` | — | SMTP login username |
| `SMTP_PASS` | — | SMTP login password |
| `SMTP_FROM` | — | From address for system emails |

---

## Settings Configurable in the UI

The following are stored in the SQLite `settings` table and editable from **Admin → Settings**:

| Setting key | Description |
|---|---|
| `company_name` | Shown on invoices and emails |
| `company_email` | Contact email |
| `company_address` | Address on invoices |
| `currency` | Default currency code (USD, EUR, etc.) |
| `tax_rate` | Default tax percentage |
| `tax_name` | Label on invoice (e.g. VAT, GST) |
| `invoice_prefix` | Invoice number prefix (e.g. INV) |
| `smtp_host` | SMTP host (overrides `.env`) |
| `smtp_port` | SMTP port |
| `smtp_secure` | `1` for SSL |
| `smtp_user` | SMTP username |
| `smtp_pass` | SMTP password |
| `smtp_from` | SMTP from address |
| `paypal_client_id` | PayPal client ID (overrides `.env`) |
| `paypal_secret` | PayPal secret |
| `paypal_mode` | `sandbox` or `live` |
