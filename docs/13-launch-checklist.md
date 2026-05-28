# HostPanel Production Launch Checklist

> **Deadline:** 2026-06-09 23:59 UTC
> **Owner:** Ron (senior IT)
> **Purpose:** Gate-check before declaring HostPanel production-launch ready.
> Every item must be ✅ before the final launch report is filed.

---

## How to Use This Checklist

Work through each section in order. Mark items ✅ (done), ⚠️ (done with caveats — document them), or ❌ (blocked — document the blocker). Do not mark an item ✅ without evidence (test output, commit hash, or direct verification command).

---

## 1. Security Hardening

- [ ] SSH password authentication disabled (`sshd -T | grep passwordauthentication` → `no`)
- [ ] SSH root login requires key only (`sshd -T | grep permitrootlogin` → `without-password` or `prohibit-password`)
- [ ] Production `.env` has a strong, unique `JWT_SECRET` (≥ 64 random hex chars, not the example value)
- [ ] `NODE_ENV=production` is set in the systemd unit (Node refuses to start with example JWT_SECRET in production)
- [ ] `ADMIN_PASS_HASH` is set to a non-example bcrypt hash
- [ ] Rate limiting active: 300 req/min global `/api/`, 20 req/min on `/api/auth/` and portal login paths
- [ ] IP whitelist feature documented; empty whitelist = open to all (expected for SaaS; document if intentional)
- [ ] All admin routes protected by `authenticateToken + blockPortalRoles` middleware
- [ ] Portal-role JWTs (`client`, `client_team`) cannot reach admin routes (verified by security auth integration tests)
- [ ] Readonly-role guard blocks write operations for readonly tokens
- [ ] File manager symlink escape hardening in place (`assertSafeFileTarget()` on all file ops)
- [ ] Archive path traversal validation in place (`assertSafeArchiveName()`)
- [ ] All shell command routes use argv-based `runFile()` / `execFile()`, not shell-string `execAsync()` (grep check clean)
- [ ] Git-deploy recipes parsed through `deploy-plan.ts` (no `sh -c admin-string` execution)
- [ ] Web terminal allowlists shells and strips secrets from environment
- [ ] Web terminal opens audit log row on session start
- [ ] SSRF protection on webhook target URLs (`assertHttpTargetAllowed()` in safe-target.ts)
- [ ] phpMyAdmin Signon validation endpoint (`/api/phpmyadmin/validate`) returns correct status
- [ ] Security headers (X-Content-Type-Options, X-Frame-Options, HSTS) emitted by Apache (verify with `curl -I`)

---

## 2. Reliability & Availability

- [ ] `hostpanel.service` enabled in systemd (`systemctl is-enabled hostpanel` → `enabled`)
- [ ] `Restart=on-failure` in systemd unit (service auto-recovers from crashes)
- [ ] `After=network.target mariadb.service` in unit (correct startup ordering)
- [ ] Built-in watchdog polls `/healthz` every 60 seconds and dispatches alerts on 3 consecutive failures
- [ ] External uptime monitor configured (UptimeRobot / BetterStack) pointing at `https://panel.contaura.com/healthz`
- [ ] SQLite database on persistent volume (not on tmpfs or ephemeral disk)
- [ ] Automated nightly database backup scheduled (cron or panel backup wizard)
- [ ] Backup includes `.env`, DB, vhosts, DNS zones, SSL certs, email config
- [ ] Backup stored off-server (S3, B2, or equivalent)
- [ ] Restore procedure documented and tested via DR drill (`POST /api/backup/drill`)
- [ ] Disk usage alert configured (readiness endpoint returns 503 when ≥95% full)

---

## 3. Performance

- [ ] Frontend shipped as lazy-loaded per-route chunks (no single massive initial bundle)
- [ ] API response times acceptable under normal load (< 200ms for common endpoints)
- [ ] Long-running operations (backups, scans, app installs, WordPress install) run as background jobs with `/api/jobs` polling
- [ ] Background job table does not have a runaway accumulation of failed rows
- [ ] No memory leak observed after 24h uptime (check `systemctl status hostpanel` memory field)

---

## 4. Code Quality & Tests

- [ ] All server tests pass: `npm run test --workspace=server` → 22 files, 114 tests (or more), 0 failures
- [ ] Full build passes: `npm run build` → no TypeScript errors, no build failures
- [ ] No npm audit vulnerabilities at moderate or higher: `npm audit --omit=dev --audit-level=moderate` → 0
- [ ] No legacy `execAsync()`/`promisify(exec)` call sites in route source files (grep check clean)
- [ ] CI workflow (`.github/workflows/ci.yml`) runs on every push to `master`
- [ ] CI checks: install, test, build, audit

---

## 5. Monitoring & Alerting

- [ ] Webhook notification channel configured (Slack / Discord / email) in panel Settings
- [ ] Alerts fire on: background job failures, watchdog health failures, cert expiry warnings
- [ ] Audit log retains all admin actions in `audit_logs` table
- [ ] Security scan alerts are routed to the notification channel
- [ ] No unresolved critical alerts in the panel UI at launch time

---

## 6. Documentation

- [ ] Installation guide (`docs/01-installation.md`) reflects current install path
- [ ] Operations runbook (`docs/12-operations-runbook.md`) complete and accurate
- [ ] Upgrade procedure documented (`docs/10-upgrade.md`) and tested on a staging host
- [ ] Disaster recovery procedure documented in runbook and tested via DR drill
- [ ] This launch checklist (`docs/13-launch-checklist.md`) fully checked off
- [ ] `docs/11-production-readiness.md` log updated with all hardening passes

---

## 7. Access & Credentials

- [ ] Production secrets are **not** committed to git (`.env` is in `.gitignore`)
- [ ] All default/example credentials changed (JWT_SECRET, ADMIN_PASS_HASH, DB passwords)
- [ ] Only key-based SSH access is permitted (no passwords, no shared keys)
- [ ] Admin account password is strong and unique (bcrypt hash cost ≥ 12)
- [ ] 2FA (TOTP) enabled for the admin account
- [ ] Emergency 2FA bypass procedure documented (and tested) in runbook
- [ ] Stripe/PayPal webhook secrets are set and validated (if payment integration active)

---

## 8. Launch Day Verification Sequence

Run this sequence on launch day, in order:

```bash
# 1. Confirm code is up to date
cd /root/hostpanel && git log --oneline -3

# 2. Confirm service active
systemctl is-active hostpanel

# 3. Confirm port listening
ss -tlnp | grep 3001

# 4. Public health check
curl -sf http://localhost:3001/healthz

# 5. External health check (Apache proxy)
curl -sf https://panel.contaura.com/healthz

# 6. SSH password auth check
sshd -T | grep passwordauthentication   # → passwordauthentication no

# 7. Security headers from Apache
curl -sI https://panel.contaura.com/healthz | grep -E "X-Content-Type|X-Frame|Strict-Transport"

# 8. No legacy shell strings in routes
grep -rn 'execAsync\|promisify(exec)' /root/hostpanel/server/src/routes/ && echo "FOUND" || echo "CLEAN"

# 9. All tests pass (takes ~10 seconds)
cd /root/hostpanel && npm run test --workspace=server

# 10. No audit vulnerabilities
npm audit --omit=dev --audit-level=moderate
```

All 10 commands must succeed with no errors before filing the launch report.

---

## 9. Launch Report Template

```
# HostPanel Production Launch Report

**Date:** YYYY-MM-DD
**Launch by:** Ron
**Commit:** <git hash>
**Branch:** master

## Verification Results
- Service: active (running) since <timestamp>
- /healthz: 200 OK
- External /healthz: 200 OK
- SSH password auth: disabled
- Security headers: present
- Shell-string grep: CLEAN
- Tests: 20 files / 99 tests PASSED
- npm audit: 0 vulnerabilities (omit=dev, moderate+)

## Remaining Known Issues / Non-Blockers
(list any caveats with mitigation plans)

## Signed Off
Ron — <date>
```

---

*Document created: 2026-05-27 — Ron (senior IT, autonomous hardening cycle)*