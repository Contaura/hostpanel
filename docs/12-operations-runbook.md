# HostPanel Operations Runbook

> **Audience:** On-call engineers and system administrators.
> **Scope:** Day-to-day operations, incident response, rollback, and monitoring for a production HostPanel instance running on RHEL/Rocky/AlmaLinux behind Apache.

---

## 1. Service Overview

| Item | Value |
|---|---|
| Process | `node /root/hostpanel/server/dist/index.js` |
| Systemd unit | `hostpanel.service` |
| Listen port | `3001` (loopback only — Apache proxies public traffic) |
| Working directory | `/root/hostpanel/server` |
| `.env` file | `/root/hostpanel/server/.env` |
| Database | `/root/hostpanel/data/hostpanel.db` (SQLite) |
| Frontend build | `/root/hostpanel/client/dist/` (served by Express static middleware) |

---

## 2. Health Checks

### Public health (unauthenticated, used by load-balancers / watchdogs)

```bash
curl -sf http://localhost:3001/healthz
# Expected: {"ok":true,"service":"hostpanel","version":"1.0.0","uptime":<seconds>,...}
```

### Readiness check (requires admin JWT, checks disk/memory/DB/failed jobs)

```bash
# Obtain a JWT via /api/auth/login or use a pre-issued token
AUTH_TOKEN="***"
curl -sf -H 'Authorization: Bearer AUTH_TOKEN' http://localhost:3001/api/health/readiness
# Expected 200: {"ok":true, "checks":{"database":{"ok":true},"disk":{...},"memory":{...},...}}
# Expected 503: same structure, but ok=false with failing check details
```

### Liveness endpoint (admin token, lightweight)

```bash
AUTH_TOKEN="***"
curl -sf -H 'Authorization: Bearer AUTH_TOKEN' http://localhost:3001/api/health/live
```

### Systemd status

```bash
systemctl is-active hostpanel       # → active
systemctl status hostpanel --no-pager -l
```

### Port check

```bash
ss -tlnp | grep 3001
```

---

## 3. Service Management

### Restart (normal)

```bash
systemctl restart hostpanel
systemctl status hostpanel --no-pager
curl -sf http://localhost:3001/healthz
```

### Restart after a code update

```bash
cd /root/hostpanel
git pull origin master
cd server && npm ci --omit=dev
cd .. && npm run build
systemctl restart hostpanel
# Wait ~5 seconds then health-check
curl -sf http://localhost:3001/healthz
```

### Stop / Start

```bash
systemctl stop hostpanel
systemctl start hostpanel
```

### Enable / Disable auto-start

```bash
systemctl enable hostpanel    # survive reboots
systemctl disable hostpanel   # prevent auto-start (e.g. maintenance mode)
```

---

## 4. Logs

### Live log stream

```bash
journalctl -u hostpanel -f
```

### Recent logs (last 200 lines)

```bash
journalctl -u hostpanel -n 200 --no-pager
```

### Logs since a time

```bash
journalctl -u hostpanel --since "2026-05-27 10:00:00"
```

### Application audit log (in DB)

```bash
sqlite3 /root/hostpanel/data/hostpanel.db \
  "SELECT datetime(created_at,'localtime'), username, action, resource, ip FROM audit_logs ORDER BY id DESC LIMIT 50;"
```

### Apache access/error logs (public-facing)

```bash
tail -f /var/log/httpd/hostpanel_access.log
tail -f /var/log/httpd/hostpanel_error.log
```

---

## 5. Deployments

### Standard deploy procedure

1. **Merge code to `master`** on GitHub (CI must pass).
2. On production server:
   ```bash
   cd /root/hostpanel
   git fetch origin && git status    # confirm clean
   git pull origin master
   npm ci --omit=dev --workspace=server
   npm run build                     # builds both server/dist and client/dist
   npm run test --workspace=server   # must be green before proceeding
   systemctl restart hostpanel
   sleep 5
   curl -sf http://localhost:3001/healthz
   ```
3. Verify CI badge is green. Check `git log --oneline -3`.

### Rollback to previous commit

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
git checkout master
git pull
```

---

## 6. Database Operations

### Backup the database manually

```bash
DATE=$(date +%Y%m%d-%H%M%S)
cp /root/hostpanel/data/hostpanel.db /root/hostpanel/data/hostpanel-$DATE.db
echo "Backup: /root/hostpanel/data/hostpanel-$DATE.db"
```

### Restore the database

```bash
systemctl stop hostpanel
cp /root/hostpanel/data/hostpanel-<date>.db /root/hostpanel/data/hostpanel.db
systemctl start hostpanel
curl -sf http://localhost:3001/healthz
```

### Open SQLite shell (read-only inspection)

```bash
sqlite3 /root/hostpanel/data/hostpanel.db ".tables"
sqlite3 /root/hostpanel/data/hostpanel.db "SELECT count(*) FROM accounts;"
```

### Schema migrations

Schema changes are applied automatically on startup via `tryAlter()` in `server/src/db.ts`. No manual migration scripts are needed.

---

## 7. Common Incidents

### Incident: service not running (`systemctl is-active` → `inactive`)

1. Check exit status: `systemctl status hostpanel --no-pager -l`
2. Check recent journal: `journalctl -u hostpanel -n 50 --no-pager`
3. Common causes:
   - `.env` missing or invalid JWT_SECRET in production → `[SECURITY] Refusing to start`
   - Port 3001 already in use → change `PORT` in `.env` or kill conflicting process
   - Build artifacts missing → run `npm run build` then restart
4. Restart after fixing: `systemctl start hostpanel`

### Incident: /healthz returns connection refused

```bash
ss -tlnp | grep 3001        # is the port even listening?
journalctl -u hostpanel -n 50 --no-pager   # startup errors?
```

Port 3001 is loopback-only. Apache proxies external traffic. Verify Apache config:

```bash
systemctl status httpd
curl -I https://panel.contaura.com/healthz   # public-facing check
```

### Incident: high disk usage → readiness returns ok=false

```bash
df -h                           # identify full filesystems
du -sh /var/www/* | sort -rh | head -20  # per-account usage
sqlite3 /root/hostpanel/data/hostpanel.db "SELECT count(*), sum(size) FROM background_jobs;"
```

Clean up: rotate old backups in `/root/hostpanel/data/`, remove old DB backups, prune old logs.

### Incident: admin locked out (lost 2FA device)

```bash
sqlite3 /root/hostpanel/data/hostpanel.db \
  "UPDATE admin_users SET totp_enabled=0, totp_secret=NULL WHERE username='admin';"
```

Log back in with username/password, re-enroll 2FA.

### Incident: admin password reset needed

```bash
HASH=$(node -e "console.log(require('bcryptjs').hashSync('NewTemporaryPass123!', 12))")
sqlite3 /root/hostpanel/data/hostpanel.db \
  "UPDATE admin_users SET password_hash='$HASH' WHERE username='admin';"
```

Change to a strong password immediately after login.

### Incident: a background job is stuck

```bash
sqlite3 /root/hostpanel/data/hostpanel.db \
  "SELECT id, type, status, created_at, updated_at FROM background_jobs WHERE status IN ('pending','running') ORDER BY id DESC LIMIT 10;"
# Force-fail a stuck job (if safe to do so):
sqlite3 /root/hostpanel/data/hostpanel.db \
  "UPDATE background_jobs SET status='failed', error='manually cancelled', completed_at=datetime('now') WHERE id=<id>;"
```

Restart the service to reset any in-process timers.

---

## 8. Security Procedures

### Verify SSH password auth is disabled

```bash
sshd -T | grep -i passwordauth
# Must return: passwordauthentication no
```

### Rotate JWT secret

1. Generate new secret: `openssl rand -hex 64`
2. Update `JWT_SECRET` in `/root/hostpanel/server/.env`
3. Restart: `systemctl restart hostpanel`
4. **Note:** all existing JWTs are immediately invalidated. All admin sessions and portal client sessions will need to log in again.

### Review recent audit log for suspicious activity

```bash
sqlite3 /root/hostpanel/data/hostpanel.db \
  "SELECT datetime(created_at,'localtime'), username, action, resource, ip FROM audit_logs WHERE created_at >= datetime('now','-1 day') ORDER BY id DESC;"
```

### Check for new failed login attempts

```bash
sqlite3 /root/hostpanel/data/hostpanel.db \
  "SELECT datetime(created_at,'localtime'), username, ip FROM audit_logs WHERE action LIKE '%login%fail%' OR action LIKE '%invalid%' ORDER BY id DESC LIMIT 20;"
```

### Check firewall rules

```bash
firewall-cmd --list-all
iptables -L INPUT -n --line-numbers | head -30
```

### Emergency admin 2FA bypass (break-glass)

Use this only when every admin is locked out of TOTP and Marcos has approved the break-glass action. The procedure requires existing root key-based SSH; do **not** enable SSH password authentication and do **not** store one-time recovery material in the repo.

1. Capture the current state and make a timestamped database backup:
   ```bash
   cd /root/hostpanel
   ts="$(date -u +%Y%m%d%H%M%S)"
   sqlite3 data/hostpanel.db "SELECT id, username, email, totp_enabled FROM admin_users ORDER BY id;"
   cp -a data/hostpanel.db "/root/hostpanel-backup-before-2fa-bypass-${ts}.db"
   ```
2. Disable TOTP for exactly one named admin account, then restart HostPanel:
   ```bash
   admin_user='admin'  # replace with the locked-out admin username
   sqlite3 data/hostpanel.db \
     "UPDATE admin_users SET totp_enabled=0, totp_secret=NULL, totp_backup_codes=NULL WHERE username='$admin_user'; SELECT changes();"
   systemctl restart hostpanel
   systemctl is-active hostpanel
   curl -sf http://localhost:3001/healthz
   ```
   `SELECT changes()` must print `1`. If it prints `0`, stop and restore the pre-bypass database copy instead of making broader updates.
3. Immediately have the admin log in, rotate the password if compromise is suspected, and re-enable TOTP from **Security → Two-Factor Authentication**.
4. Verify readiness returns only the expected advisory until TOTP is re-enabled:
   ```bash
   AUTH_TOKEN="***"
   curl -sf -H 'Authorization: Bearer AUTH_TOKEN' http://localhost:3001/api/health/readiness | jq '.checks.security'
   ```
5. Record the break-glass event in the incident ticket with the backup path, admin username, timestamps, and confirmation that TOTP was re-enabled. Remove any temporary DB copies after retention approval.

#### Non-destructive bypass drill

Run this after upgrades to prove the bypass SQL still matches the schema without changing production data:

```bash
cd /root/hostpanel
tmp="$(mktemp /tmp/hostpanel-2fa-drill.XXXXXX.db)"
cp -a data/hostpanel.db "$tmp"
sqlite3 "$tmp" "UPDATE admin_users SET totp_enabled=0, totp_secret=NULL, totp_backup_codes=NULL WHERE id=(SELECT id FROM admin_users ORDER BY id LIMIT 1); SELECT changes();"
rm -f "$tmp"
```

Expected result: `1` when at least one admin user exists. This verifies the emergency SQL against a disposable database copy only.

---

## 9. Monitoring & Alerting

### Watchdog (silent service monitor)

A built-in watchdog process runs inside the Node process and polls `http://localhost:3001/healthz` every 60 seconds. If three consecutive polls fail, it dispatches a notification via the configured webhook or email. This is independent of systemd's `Restart=on-failure`.

### Webhook notifications

Configure under **Settings → Notifications** in the panel UI. Webhooks are dispatched for:
- Background job failures
- Security scanner alerts
- Service health failures (watchdog)
- Certificate expiry warnings

### External uptime monitoring (recommended)

Point an external uptime monitor (UptimeRobot, BetterStack, etc.) at:

```
https://panel.contaura.com/healthz
```

Expected: HTTP 200, JSON body `{"ok":true}`. Alert if status != 200 for 2 consecutive checks.

### Disk usage alert threshold

The readiness endpoint returns `ok=false` when any filesystem is ≥95% full. Configure your monitoring to poll `/api/health/readiness` (with a long-lived admin token) and alert on 503.

---

## 10. Disaster Recovery

### Full server loss — restore from backup

Assuming backups are stored off-server (S3, B2, etc.):

1. Provision a fresh RHEL/Rocky/AlmaLinux 8/9 VM with the same public IP or update DNS.
2. Clone the repo and run the installer:
   ```bash
   git clone https://github.com/Contaura/hostpanel.git /root/hostpanel
   cd /root/hostpanel && bash install.sh
   ```
3. Restore the database:
   ```bash
   systemctl stop hostpanel
   aws s3 cp s3://your-bucket/hostpanel-latest.db /root/hostpanel/data/hostpanel.db
   systemctl start hostpanel
   ```
4. Restore `.env`:
   ```bash
   cp /path/to/backup/.env /root/hostpanel/server/.env
   systemctl restart hostpanel
   ```
5. Restore vhosts, DNS zones, email config, SSL certificates:
   ```bash
   tar -xzf httpd.tar.gz -C /
   tar -xzf named.tar.gz -C /
   tar -xzf letsencrypt.tar.gz -C /
   systemctl reload httpd named
   ```
6. Run health checks. Verify `https://panel.contaura.com/healthz`.

### Automated DR drill

An API-based restore-drill endpoint is available at `POST /api/backup/drill` (admin token required). It restores a backup to a staging path and validates integrity. See `docs/11-production-readiness.md` (2026-05-25 DR Drill entry) for details.

---

## 11. Useful One-Liners

```bash
# Service uptime in human-readable form
systemctl show hostpanel --property=ActiveEnterTimestamp

# Count open file descriptors (detect descriptor leaks)
ls /proc/$(systemctl show hostpanel -p MainPID --value)/fd | wc -l

# Database row counts
sqlite3 /root/hostpanel/data/hostpanel.db ".tables" | tr ' ' '\n' | while read t; do printf "%s: %s\n" "$t" "$(sqlite3 /root/hostpanel/data/hostpanel.db "SELECT count(*) FROM $t;")"; done

# Check for any execAsync call sites left in route source (should return nothing)
grep -rn 'execAsync\|promisify(exec)' /root/hostpanel/server/src/routes/ && echo "FOUND SHELL STRINGS" || echo "CLEAN"

# Quick npm audit
cd /root/hostpanel && npm audit --omit=dev --audit-level=moderate

# Tail the last 20 failed background jobs
sqlite3 /root/hostpanel/data/hostpanel.db \
  "SELECT id, type, resource, error, datetime(completed_at,'localtime') FROM background_jobs WHERE status='failed' ORDER BY id DESC LIMIT 20;"
```

---

## 12. Escalation

| Situation | Action |
|---|---|
| Service crashes and won't stay up | Check `.env` secrets, rebuild, check disk space, escalate to dev if persists |
| Suspicious audit log entries | Rotate JWT_SECRET, review firewall rules, check SSH authorized_keys, notify security team |
| Data loss suspected | Stop service immediately, preserve DB file, restore from last known-good backup, contact Marcos |
| SSL certificate expired | Run `certbot renew` and `systemctl reload httpd`, check cron schedule |
| Full disk | Stop non-critical services, rotate/remove old backups, contact Marcos for capacity increase |

---

*Last updated: 2026-05-27 — Ron (senior IT, autonomous hardening cycle)*
