# Upgrade & Backup

> **Install path:** This document assumes HostPanel is installed at `/root/hostpanel` (the directory produced by cloning the repo and running `install.sh` as root — the installer uses `PANEL_DIR=$(dirname install.sh)`, so the path is wherever you cloned to). Adjust paths if you installed elsewhere.

---

## Upgrading HostPanel

### Standard upgrade procedure

```bash
cd /root/hostpanel

# 1. Confirm the working tree is clean before pulling
git status --short

# 2. Pull latest code
git fetch origin
git pull origin master

# 3. Install any new server dependencies (production only, no devDeps)
npm ci --omit=dev --workspace=server

# 4. Rebuild server (TypeScript → dist/) and client (Vite → client/dist/)
npm run build

# 5. Run tests — must pass before restarting
cd server && npm test && cd ..

# 6. Restart the service
systemctl restart hostpanel

# 7. Verify
sleep 3
systemctl is-active hostpanel       # → active
curl -sf http://localhost:3001/healthz
```

### Rollback to a previous commit

```bash
cd /root/hostpanel
git log --oneline -10               # identify target commit
git checkout <commit-hash>          # detached HEAD — safe for rollback
npm ci --omit=dev --workspace=server
npm run build
systemctl restart hostpanel
curl -sf http://localhost:3001/healthz
```

Return to master once the issue is fixed:

```bash
git checkout master && git pull origin master
```

---

## Backing Up HostPanel

### What to back up

| Path | Contents |
|---|---|
| `/root/hostpanel/data/hostpanel.db` | All panel data (accounts, clients, invoices, settings, audit log, background jobs) |
| `/root/hostpanel/server/.env` | Configuration and secrets — **do not commit to git** |
| `/var/named/` | DNS zone files |
| `/etc/httpd/conf.d/` | Apache vhost configs |
| `/etc/postfix/virtual/` | Email mailbox and alias maps |
| `/etc/dovecot/users` | Email account credentials |
| `/etc/vsftpd/users/` | FTP user configs |
| `/etc/letsencrypt/` | SSL certificates |
| `/var/www/` | Website files |

### Automated nightly backup script

```bash
#!/bin/bash
# /root/hostpanel-backup.sh
# Run as root.  Schedule with cron:
#   echo "0 3 * * * root bash /root/hostpanel-backup.sh" > /etc/cron.d/hostpanel-backup
set -euo pipefail

DATE=$(date +%Y%m%d-%H%M%S)
DEST="/backups/hostpanel-$DATE"
mkdir -p "$DEST"

# Panel database and secrets
cp /root/hostpanel/data/hostpanel.db "$DEST/"
cp /root/hostpanel/server/.env "$DEST/"

# System configuration
tar -czf "$DEST/named.tar.gz"      /var/named/
tar -czf "$DEST/httpd.tar.gz"      /etc/httpd/conf.d/
tar -czf "$DEST/postfix.tar.gz"    /etc/postfix/virtual/
cp /etc/dovecot/users              "$DEST/dovecot-users" 2>/dev/null || true
tar -czf "$DEST/letsencrypt.tar.gz" /etc/letsencrypt/

# Prune backups older than 14 days
find /backups -maxdepth 1 -name "hostpanel-*" -type d -mtime +14 -exec rm -rf {} + 2>/dev/null || true

echo "Backup complete: $DEST"
```

Install cron job:

```bash
echo "0 3 * * * root bash /root/hostpanel-backup.sh" > /etc/cron.d/hostpanel-backup
chmod 644 /etc/cron.d/hostpanel-backup
```

### Manual one-liner (quick DB snapshot)

```bash
DATE=$(date +%Y%m%d-%H%M%S)
cp /root/hostpanel/data/hostpanel.db /root/hostpanel/data/hostpanel-$DATE.db
echo "Snapshot: /root/hostpanel/data/hostpanel-$DATE.db"
```

---

## Restoring from Backup

### Restore the database

```bash
systemctl stop hostpanel
cp /backups/hostpanel-<date>/hostpanel.db /root/hostpanel/data/hostpanel.db
systemctl start hostpanel
curl -sf http://localhost:3001/healthz
```

### Restore configuration

```bash
cp /backups/hostpanel-<date>/.env /root/hostpanel/server/.env
systemctl restart hostpanel
```

### Restore vhosts and DNS

```bash
tar -xzf /backups/hostpanel-<date>/httpd.tar.gz   -C /
tar -xzf /backups/hostpanel-<date>/named.tar.gz   -C /
systemctl reload httpd named
```

### Automated restore drill

The panel exposes a dry-run restore verification endpoint that can validate backup integrity without overwriting live data:

```bash
# Requires a valid admin JWT
curl -X POST http://localhost:3001/api/backup/drill/<backup-filename> \
  -H "Authorization: Bearer <admin-token>"
```

See `docs/12-operations-runbook.md` section 10 for the full DR procedure.

---

## Logs

### HostPanel service logs

```bash
journalctl -u hostpanel -f               # follow live
journalctl -u hostpanel --since today
journalctl -u hostpanel -n 200           # last 200 lines
```

### Application audit log

All admin actions are stored in the SQLite `audit_logs` table and visible in the panel under **Security → Audit Log**.

```bash
/usr/bin/sqlite3 /root/hostpanel/data/hostpanel.db \
  "SELECT datetime(created_at,'localtime'), username, action, resource, ip FROM audit_logs ORDER BY id DESC LIMIT 50;"
```

---

## Troubleshooting

### Service won't start

```bash
journalctl -u hostpanel -n 50
# Common causes:
# - Missing or invalid .env (JWT_SECRET must be set and strong in production)
# - Port 3001 already in use
# - Node.js version too old (need 20+)
node -v   # must be v20+
```

### Cannot connect to MariaDB

```bash
mysql -u root -e "SELECT 1"
# Ensure DB_ROOT_PASS in server/.env matches the MariaDB root password
```

### Frontend shows blank page

```bash
# Rebuild the client
npm run build
systemctl restart hostpanel
```

### 2FA locked out

If you lose your TOTP device, disable 2FA directly in the database:

```bash
/usr/bin/sqlite3 /root/hostpanel/data/hostpanel.db \
  "UPDATE admin_users SET totp_enabled=0, totp_secret=NULL WHERE username='admin';"
```

Log back in with username/password, re-enroll 2FA immediately.

### Reset admin password

```bash
HASH=$(node -e "console.log(require('bcryptjs').hashSync('NewTemporaryPass123!', 12))")
/usr/bin/sqlite3 /root/hostpanel/data/hostpanel.db \
  "UPDATE admin_users SET password_hash='$HASH' WHERE username='admin';"
```

Change to a strong unique password immediately after login.
