# Upgrade & Backup

---

## Upgrading HostPanel

### 1. Pull the latest code

```bash
cd /opt/hostpanel
sudo git pull origin master
```

### 2. Install any new dependencies

```bash
npm install
npm install --workspace=server
npm install --workspace=client
```

### 3. Rebuild the frontend

```bash
npm run build --workspace=client
```

### 4. Restart the service

```bash
sudo systemctl restart hostpanel
sudo systemctl status hostpanel
```

The SQLite database schema is managed by `server/src/db.ts` using `tryAlter()` migrations. New columns are added automatically on startup — you do not need to run migration scripts manually.

---

## Backing Up HostPanel

### What to back up

| Path | Contents |
|---|---|
| `/opt/hostpanel/data/hostpanel.db` | All panel data (accounts, clients, invoices, settings) |
| `/opt/hostpanel/server/.env` | Configuration and secrets |
| `/var/named/` | DNS zone files |
| `/etc/httpd/conf.d/` | Apache vhost configs |
| `/etc/postfix/virtual/` | Email mailbox and alias maps |
| `/etc/dovecot/users` | Email account credentials |
| `/etc/vsftpd/users/` | FTP user configs |
| `/etc/letsencrypt/` | SSL certificates |
| `/var/www/` | Website files |

### Automated backup script

```bash
#!/bin/bash
# /opt/hostpanel-backup.sh
DATE=$(date +%Y%m%d-%H%M%S)
DEST="/backups/hostpanel-$DATE"
mkdir -p "$DEST"

cp /opt/hostpanel/data/hostpanel.db "$DEST/"
cp /opt/hostpanel/server/.env "$DEST/"
tar -czf "$DEST/named.tar.gz" /var/named/
tar -czf "$DEST/httpd.tar.gz" /etc/httpd/conf.d/
tar -czf "$DEST/postfix.tar.gz" /etc/postfix/virtual/
cp /etc/dovecot/users "$DEST/dovecot-users"
tar -czf "$DEST/letsencrypt.tar.gz" /etc/letsencrypt/

echo "Backup complete: $DEST"
```

Schedule with cron:

```bash
echo "0 3 * * * root bash /opt/hostpanel-backup.sh" | sudo tee /etc/cron.d/hostpanel-backup
```

---

## Restoring from Backup

### Restore the database

```bash
sudo systemctl stop hostpanel
cp /backups/hostpanel-<date>/hostpanel.db /opt/hostpanel/data/hostpanel.db
sudo systemctl start hostpanel
```

### Restore configuration

```bash
cp /backups/hostpanel-<date>/.env /opt/hostpanel/server/.env
sudo systemctl restart hostpanel
```

### Restore vhosts and DNS

```bash
tar -xzf /backups/hostpanel-<date>/httpd.tar.gz -C /
tar -xzf /backups/hostpanel-<date>/named.tar.gz -C /
sudo systemctl reload httpd named
```

---

## Logs

### HostPanel service logs

```bash
sudo journalctl -u hostpanel -f           # follow live
sudo journalctl -u hostpanel --since today
sudo journalctl -u hostpanel -n 200       # last 200 lines
```

### Application audit log

All admin actions are stored in the SQLite `audit_logs` table and visible in the panel under **Security → Audit Log**.

---

## Troubleshooting

### Service won't start

```bash
sudo journalctl -u hostpanel -n 50
# Common causes:
# - Missing or invalid .env
# - Port 3001 already in use
# - Node.js version too old (need 20+)
node -v
```

### Cannot connect to MariaDB

```bash
mysql -u root -p -e "SELECT 1"
# Ensure DB_ROOT_PASS in .env matches the MariaDB root password
```

### Frontend shows blank page

```bash
# Rebuild the client
npm run build --workspace=client
sudo systemctl restart hostpanel
```

### 2FA locked out

If you lose your TOTP device, disable 2FA directly in the database:

```bash
sqlite3 /opt/hostpanel/data/hostpanel.db \
  "UPDATE admin_users SET totp_enabled=0, totp_secret=NULL WHERE username='admin';"
```

### Reset admin password

```bash
HASH=$(node -e "console.log(require('bcryptjs').hashSync('NewPassword123', 12))")
sqlite3 /opt/hostpanel/data/hostpanel.db \
  "UPDATE admin_users SET password_hash='$HASH' WHERE username='admin';"
```
