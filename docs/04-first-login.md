# First Login & Admin Setup

## Accessing the Panel

Open a browser and navigate to:

```
http://<server-ip>:3001
```

Or, if you configured a reverse proxy:

```
https://panel.yourdomain.com
```

Log in with `ADMIN_USER` and the password you set during installation.

---

## Recommended First Steps

### 1. Change the Admin Password

Go to **Security Center → Change Password** and set a strong password. This updates the database record — the `.env` fallback hash is no longer used once a DB user exists.

### 2. Enable Two-Factor Authentication

Go to **Security Center → Two-Factor Auth**.

1. Click **Set Up 2FA**.
2. Scan the QR code with Google Authenticator, Authy, or any TOTP app.
3. Enter the 6-digit code to confirm.
4. On future logins, you will be prompted for the code after entering your password.

### 3. Configure Company Settings

Go to **Settings → General** and fill in:

- Company name (appears on invoices and emails)
- Company email
- Company address
- Invoice prefix (e.g. `INV`)
- Currency code (e.g. `USD`)
- Default tax rate and tax label

### 4. Configure SMTP

Go to **Settings → SMTP** and fill in your mail server details, then click **Send Test Email** to verify delivery.

Without SMTP configured, invoice email delivery and notification emails will not work.

### 5. Restrict Admin Access by IP

Go to **Security Center → IP Whitelist** and add your office/home IP address. Once any entry is added, login attempts from unlisted IPs are rejected.

### 6. Create Additional Admin Users

Go to **Admin → Admin Users** and add team members. Available roles:

| Role | Access |
|---|---|
| `superadmin` | Full access, can manage other admins |
| `admin` | Full access except admin user management |
| `readonly` | View-only, no modifications |

### 7. Create Hosting Plans

Go to **Hosting Plans** and create at least one plan before creating hosting accounts. Set disk quota, bandwidth, and feature limits.

### 8. Create Your First Hosting Account

Go to **Hosting Accounts → Create Account**. Assign a plan and client. The panel creates the system user and directory structure.

---

## API Tokens

For automation and CI/CD integrations, go to **Admin → API Tokens** and generate a token. The full token is shown **once** on creation — store it securely. All API endpoints accept Bearer token auth:

```bash
curl -H "Authorization: Bearer hp_<your-token>" \
     http://localhost:3001/api/billing/invoices
```

---

## Audit Log

Every non-GET admin action (POST, PUT, PATCH, DELETE) is recorded in the audit log under **Security → Audit Log**. Each entry captures:

- Timestamp
- Admin username
- HTTP method and path
- Response status code
- Client IP address
