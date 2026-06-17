# Production Readiness Log

This document tracks production-readiness work performed on HostPanel. Every entry should include the risk addressed, files changed, validation performed, and any follow-up work.

## 2026-05-25 — SSRF hardening for webhook targets

### Risk addressed

HostPanel allows administrators to configure outbound webhook targets. Those URLs are validated by `server/src/utils/safe-target.ts` to reduce Server-Side Request Forgery (SSRF) risk. Node.js keeps brackets in `URL.hostname` for IPv6 literals, for example `[::1]`. The previous validation passed that bracketed string directly to `net.isIP()`, which returns `0` for bracketed IPv6 values. As a result, bracketed IPv6 loopback, unique-local, and IPv4-mapped literals could bypass the private-address blocklist.

### Changes made

- Added a server-side Vitest test script: `npm run test --workspace=server`.
- Added regression coverage in `server/src/utils/safe-target.test.ts` for:
  - IPv4 loopback targets.
  - Bracketed IPv6 loopback targets.
  - Bracketed IPv6 unique-local targets.
  - IPv4-mapped IPv6 literals.
- Updated `server/src/utils/safe-target.ts` to normalize hostnames before IP checks by:
  - Lowercasing host names.
  - Removing URL IPv6 brackets.
  - Removing IPv6 zone IDs.
  - Checking normalized hostnames with `net.isIP()`.
  - Treating IPv4-mapped IPv6 literals as blocked.

### Validation performed

```bash
npm run test --workspace=server -- safe-target
npm run build
```

Both commands passed. The frontend build still reports existing Vite warnings about the CJS Node API, PostCSS module type, and large bundle size; no build failure was introduced.

### Follow-up

- Add broader route-level tests for webhook senders that call `assertHttpTargetAllowed()`.
- Continue reviewing all routes that execute shell commands or write system configuration as `root`.
- Add CI so tests and builds run automatically before merge/deploy.

## 2026-05-25 — CI and dependency audit baseline

### Risk addressed

HostPanel did not have a repository-level CI workflow, so production-readiness checks depended on manual execution on the server. The dependency audit also reported moderate vulnerabilities in production and development dependency trees.

### Changes made

- Added `.github/workflows/ci.yml` to run on pushes and pull requests to `master`.
- CI now installs dependencies with `npm ci`, runs server tests, builds the server/client, and fails on moderate-or-higher production or development dependency vulnerabilities.
- Ran `npm audit fix --omit=dev` to update the vulnerable transitive `qs` dependency.
- Removed the direct `uuid` server dependency because it was unused in `server/src` and its advisory required a semver-major upgrade.
- Upgraded client Vite to `^6.4.2`, clearing the dev dependency advisories without jumping to Vite 8.

### Validation performed

```bash
npm audit --omit=dev
npm audit
npm run test --workspace=server
npm run build
```

All audit, test, and build checks passed with zero reported npm vulnerabilities. The frontend build still reports the existing large bundle warning.

### Follow-up

- Consider adding branch protection once GitHub Actions is confirmed green on GitHub.
- Add linting once an ESLint/Prettier policy is selected.
- Add targeted integration tests for authenticated routes and dangerous root-level operations.

## 2026-05-25 — File manager symlink escape hardening

### Risk addressed

The file manager already normalized paths under `FILES_BASE_DIR`, but filesystem operations can still escape a base directory through symlinks that live inside the base. For example, a symlink under `/var/www` could point to `/etc/passwd` or another sensitive location. Because HostPanel runs as root, file-manager reads, writes, downloads, archive operations, deletes, and chmod operations must validate the real filesystem target, not just the lexical path string.

### Changes made

- Added `server/src/utils/file-path.ts` with shared file-manager path helpers:
  - `resolveInsideBase()` for lexical base-directory containment and shell-metacharacter rejection.
  - `assertSafeFileTarget()` for realpath validation of existing targets and nearest existing parents for new files.
- Added `server/src/utils/file-path.test.ts` regression coverage for:
  - `../` traversal rejection.
  - Normal in-base paths.
  - Existing symlinks that resolve outside the base.
  - New files under a symlinked parent outside the base.
  - New files under a real in-base directory.
- Added `server/src/utils/archive-path.ts` and tests to reject unsafe archive entry names before extraction, including absolute paths, parent-directory traversal, Windows drive paths, empty names, and NUL-containing names.
- Updated `server/src/routes/files.ts` so file-manager operations validate real targets before list, read, write, mkdir, delete, rename, upload, download, compress, extract, move, bulk-delete, and chmod operations.
- Hardened archive extraction by listing archive entries before extraction, rejecting symlink/hardlink entries from verbose listings, and adding `tar --no-same-owner --no-same-permissions` for tar extraction.

### Validation performed

```bash
npm run test --workspace=server -- archive-path file-path
npm run build --workspace=server
```

Both checks passed during the TDD cycle. Full audit, full server test run, and full build were run before commit.

### Follow-up

- Replace remaining archive/chmod shell commands with argv-based `spawn()` helpers.
- Use `lstat()` in directory listings so listing a directory does not follow symlinks for metadata.
- Add authenticated route integration tests for `/api/files/*` endpoints.
- For the strongest race resistance, move high-risk file operations toward descriptor-based/openat-style primitives where Node support allows it.

## 2026-05-25 — Authenticated route tests, terminal audit, argv process helpers, and frontend code splitting

### Risk addressed

Several high-risk operations still needed production-readiness follow-up: file-manager archive/chmod operations used shell-string commands, git deploy executed admin-authored deploy strings through `sh -c`, the web terminal needed stronger environment/shell controls and audit visibility, authenticated file routes lacked integration coverage, and the frontend shipped most pages in the initial bundle.

### Changes made

- Added `server/src/utils/process-runner.ts` with `execFile`-based helpers that force `shell: false`.
- Reworked file-manager archive creation, archive listing/extraction, and recursive chmod calls to use executable-plus-argv helpers instead of interpolated shell strings.
- Added `server/src/utils/deploy-plan.ts` to parse simple `&&`-chained deploy recipes into allowlisted argv command steps and reject unsupported shell syntax/metacharacters.
- Updated git-deploy execution to run parsed deploy steps with `execFile` and a validated `cwd` instead of `sh -c`.
- Added authenticated `/api/files/*` integration tests for unauthenticated access, admin write/read/list/delete, and readonly write blocking.
- Added middleware integration tests proving admin/superadmin access and readonly/reseller/client rejection for admin-config-style routes.
- Hardened the web terminal by allowlisting local shells, stripping exact and pattern-matched secret environment variables, and inserting an audit-log row when an admin opens a terminal session.
- Converted `client/src/App.tsx` route pages to `React.lazy()` plus `Suspense`, splitting page code into per-route chunks and reducing the initial JS bundle.

### Validation performed

```bash
npm run test --workspace=server
npm run build
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=moderate
```

All tests, full build, and both audit checks passed with zero reported vulnerabilities. The frontend build now emits per-route chunks; the largest initial `index` JS chunk is much smaller than before, with terminal/chart-heavy code isolated into lazy chunks.

### Follow-up

- Continue replacing legacy `execAsync()` shell-string call sites across the older service/config routes.
- Add endpoint-level integration tests around individual root-level service/config routes before each shell replacement.
- Add GitHub branch protection after the pushed CI run is confirmed green on GitHub.


## 2026-05-25 — High-risk service/config route execAsync reduction

### Risk addressed

The older root-level service/config routes still contained many `execAsync()` shell-string calls. Several accepted values that were already validated, but interpolating operational commands into a shell keeps command injection risk higher than necessary and makes future validation regressions more dangerous.

### Changes made

- Converted the prioritized high-risk route modules away from `execAsync()` shell strings:
  - `sshkeys.ts`
  - `settings.ts`
  - `databases.ts`
  - `domains.ts`
  - `subdomains.ts`
  - `php.ts`
  - `firewall.ts`
  - `mail-queue.ts`
  - `mail-routing.ts`
  - `mail-tools.ts`
- Reused `runFile()`/`execFile`-style command execution so OS commands receive explicit argv arrays and run with `shell: false`.
- Replaced shell pipelines and redirection with safer primitives where practical:
  - PHP info/settings now use direct `php` argv calls and in-process parsing.
  - Database import streams the uploaded SQL file into `mysql` via `spawn()` stdin instead of shell `<` redirection.
  - phpMyAdmin probing uses `fetch()` instead of `curl` shelling.
  - Slow-query and mail log views read/filter/tail files in Node instead of `tail`, `grep`, and pipeline strings.
  - Firewall geo-block range loading uses `fetch()` plus per-CIDR `ipset add` argv calls instead of a `curl | while read` shell pipeline.
  - DNSSEC unsign removes matched files through filesystem APIs instead of `rm -f` wildcard shell expansion.
- Added `server/src/routes/command-execution.integration.test.ts` covering high-risk route command behavior with mocked process execution, including firewall, domains/certbot, subdomains/httpd reload, PHP-FPM reload, and mail queue actions.

### Validation performed

```bash
# Confirm prioritized files no longer use execAsync/promisify(exec)
grep -R "execAsync\|promisify(exec)" -n   server/src/routes/{sshkeys,settings,databases,domains,subdomains,php,firewall}.ts   server/src/routes/mail-*.ts

npm run test --workspace=server
npm run build
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=moderate
```

The grep returned no matches for the prioritized route set. Server tests passed with 9 files / 30 tests, the full server+client build passed, and both npm audit checks reported zero vulnerabilities.

### Follow-up

- Continue the same route-by-route pattern for remaining lower-priority legacy `execAsync()` call sites outside the prioritized list, especially large modules such as `client-portal.ts`, `accounts.ts`, `ftp.ts`, and installer/script-management routes.
- Expand mocked command-execution integration coverage to more individual endpoints as those lower-priority routes are converted.

## Third shell-execution hardening pass

Converted the remaining set of legacy `execAsync()`/`promisify(exec)` route modules to argv-based execution via the shared `runFile` helper:

- `server/src/routes/stats.ts` — systemctl service checks
- `server/src/routes/redirects.ts` — httpd reload after writing redirects
- `server/src/routes/errpages.ts` — httpd reload after vhost update
- `server/src/routes/processes.ts` — `ps aux` listing and `kill -15/-9`
- `server/src/routes/ftp.ts` — `useradd`/`chown`/`userdel`; FTP user-list rewrite via fs APIs (no `sed`)
- `server/src/routes/security-scanner.ts` — `which`, `clamscan`, `freshclam`; file-integrity baseline/check via Node `crypto`+`fs` walk (no `find | xargs sha256sum`)
- `server/src/routes/web-extras.ts` — apachectl/du/df/vnstat/openssl/grep argv; bandwidth log aggregation in Node
- `server/src/routes/parked-domains.ts` — apachectl graceful
- `server/src/routes/addon-domains.ts` — apachectl graceful; vhost removal via `fs.rm` (no `rm -f`)
- `server/src/routes/server-info.ts` — uname/hostname/lscpu/nproc/free/df/httpd/php/nginx/mysql/systemctl argv; `/etc/os-release` and `/proc/loadavg` read in Node
- `server/src/routes/rspamd.ts` — systemctl is-active
- `server/src/routes/alerts.ts` — `dnf check-update`/`dnf update -y …` as argv (package names validated then passed as separate args)
- `server/src/routes/dkim.ts` — `opendkim-genkey`, `dig` argv; key dir creation via `mkdirSync`
- `server/src/routes/waf.ts` — `httpd -M`, `apachectl graceful`, `fail2ban-client …` argv; ModSec rule list via `readdirSync`
- `server/src/routes/php-domains.ts` — `apachectl graceful`, `node`/`python3`/`pyenv` argv; FPM version detection via `readdirSync` (no `ls | grep -oP | sort -V`)

### Validation
- `npm run test --workspace=server` — 9 files / 44 tests passed (added 13 new integration assertions for the routes above)
- `npm run build` — passed
- `npm audit --omit=dev --audit-level=moderate` — 0 vulnerabilities
- Targeted grep for `execAsync|promisify(exec)` across this set returned no matches

### Remaining follow-up
Legacy `execAsync()` still lives in larger/older modules: `accounts.ts`, `backup.ts`, `client-portal.ts`, `cron.ts`, `dkim.ts` (already converted), `email.ts`, `scripts.ts`, `ssl-advanced.ts`, `wordpress.ts`, `apps.ts`, `reseller.ts`. These should be converted route-by-route with endpoint tests in a future pass.

## Fourth shell-execution hardening pass (partial)

Converted to argv-based execution via `runFile` (and Node primitives where shell pipelines were involved):

- `server/src/routes/cron.ts` — `crontab -l/-u`, `id`. The `/api/cron/run` admin endpoint intentionally retains `spawn("sh", ["-c", command], { shell: false })` because admins legitimately need shell features in cron commands; the endpoint is gated to superadmin/admin.
- `server/src/routes/email.ts` — `cat` → `fs.readFile`; `sed -i` → exact line-equality filter in Node; `postmap`, `chown`, `chmod` argv.
- `server/src/routes/backup.ts` — `tar -czf/-xzf` argv; mysqldump|gzip and gunzip|mysql replaced with spawn + zlib piping; `crontab` argv; remote push (`aws`/`b2`/`rclone`) argv.
- `server/src/routes/scripts.ts` — `composer create-project`, `unzip`, `tar -xjf/-xzf`, `cp -r`, `chown -R`, `find -exec chmod`, wp-cli all argv; `curl` → native `fetch`; `rm -rf` → `fs.rm`.
- `server/src/routes/ssl-advanced.ts` — `apachectl graceful`, `certbot certonly/certificates/renew`, `openssl req` argv; subject components sanitized; `cat` → `fs.readFile`; `rm -f` → `fs.rm`; `mkdir -p` → `fs.mkdir`; `curl` → `fetch` w/AbortController; the `s_client | x509` pipeline was replaced with `tls.connect` + `spawn("openssl", ["x509", ...])` with PEM piped via stdin.
- `server/src/routes/wordpress.ts` — `wp(domain, args[])` helper refactored to runFile argv (13 callers updated); `find` argv; `crontab` argv.
- `server/src/routes/apps.ts` — `pm2 jlist`, `apachectl graceful` argv.
- `server/src/routes/reseller.ts` — removed `promisify(exec)`; `du -sb` argv with per-account domain validation.

Added 11 new integration tests covering crontab argv, mail account/forwarder argv flows, tar/mysqldump backup paths, scripts composer install, ssl-advanced certbot email validation, wordpress `wp` argv helper, apps pm2 jlist argv, and reseller import hygiene.

### Validation
- `npm run test --workspace=server` — 9 files / 52 tests passed
- `npm run build` — passed
- `npm audit --omit=dev --audit-level=moderate` — 0 vulnerabilities
- Grep `execAsync|promisify(exec)` over the 8 converted files — clean

### Remaining
`accounts.ts` and `client-portal.ts` retain legacy `execAsync()` call sites and will be converted in a follow-up pass (each route-by-route with endpoint tests).

## Fourth shell-execution hardening pass (continued)

Converted the remaining modules from the user-prioritized set:

- `server/src/routes/accounts.ts` — suspend/unsuspend now use `fs.rename` for vhost.conf moves; `systemctl reload httpd` and `du -sb` via argv; `du | sort | head` and `find | wc` replaced with `fs.readdir` + per-entry stat aggregation; `tar -czf … && rm -rf` split into argv `tar` + `fs.rm` recursive; `mysqldump | gzip` replaced with `spawn("mysqldump", argv) → zlib.createGzip() → createWriteStream`.
- `server/src/routes/client-portal.ts` — 30+ exec call sites converted: `rndc reload`, `postmap`, `chown/chmod`, `useradd`/`userdel`, `id`, `whois`, `openssl x509`, `certbot --apache`, `systemctl reload httpd`, `getent passwd`, `crontab -u/-l/<file>`, `rpm -q`, `opendkim-genkey`, `clamscan` all argv; `sed -i` patterns replaced with line-equality filtering in Node; WordPress install download switched from `curl` to native `fetch` + `stream.pipeline`, with `tar`/`cp`/`rm` via argv/fs primitives and added input validation (siteTitle, adminUser, adminPass, adminEmail) before `wp config create`/`wp core install` argv; access-log `tail|awk|sort|uniq|head` aggregation moved to in-process JS.
- `server/src/routes/email-extras.ts` — final stragglers (`postmap`, `postfix reload`, `systemctl restart spamassassin`, `repquota`) all argv.

Added 3 integration tests covering: account suspend reloads httpd via argv; account `usage` reports `du` via argv; client-portal DNS append reloads `rndc` via argv.

### Validation
- `npm run test --workspace=server` — 9 files / 55 tests passed
- `npm run build` — passed
- `npm audit --omit=dev --audit-level=moderate` — 0 vulnerabilities
- Grep `execAsync|promisify(exec)` across all 10 user-listed files (accounts, backup, client-portal, cron, email, scripts, ssl-advanced, wordpress, apps, reseller) plus email-extras — clean

### Remaining
No legacy `execAsync()` route sources remain in the previously identified modules (`node-apps.ts`, `resource-limits.ts`, `logs.ts`, `cache.ts`). Continue enforcing the `runFile` argv/Node-primitive pattern for any new service-command routes.

## 2026-05-27 — Production docs and operations runbook

### Risk addressed

HostPanel lacked a comprehensive operations runbook and formal launch checklist. Without these, on-call engineers have no authoritative reference for incident response, rollback procedures, or launch-day verification — increasing MTTR and the risk of a failed launch.

### Changes made

- Added `docs/12-operations-runbook.md` covering:
  - Service overview (ports, paths, systemd unit, database, .env)
  - Health check commands (public `/healthz`, readiness, systemd, port)
  - Service management (restart, update, rollback, enable/disable)
  - Log access (journalctl, audit log SQL query, Apache logs)
  - Deployment procedure (pull → install → build → test → restart → verify)
  - Rollback to a previous git commit
  - Database operations (backup, restore, SQLite shell, schema migrations)
  - Common incident playbooks: service down, /healthz connection refused, high disk, admin lockout, password reset, stuck background job
  - Security procedures: SSH auth check, JWT rotation, audit log review, firewall check
  - Monitoring and alerting: built-in watchdog, webhook notifications, external uptime monitor, disk alert threshold
  - Disaster recovery: full server loss restore steps, automated DR drill reference
  - Useful one-liners for operations

- Added `docs/13-launch-checklist.md` covering:
  - Security hardening checklist (20 items)
  - Reliability and availability checklist (11 items)
  - Performance checklist (5 items)
  - Code quality and tests checklist (6 items)
  - Monitoring and alerting checklist (5 items)
  - Documentation checklist (6 items)
  - Access and credentials checklist (7 items)
  - Launch-day 10-command verification sequence
  - Launch report template

### Validation performed

Documentation only — no production code changes in this slice. All existing server tests remain green:

```bash
npm run test --workspace=server   # 20 files / 99 tests passed
npm run build                     # passed
```

### Follow-up

- Item 7 (final production readiness verification and launch report) — fill in the launch checklist completely, run the 10-command verification sequence, and file the formal launch report by 2026-06-09.
- Complete launch checklist items that require live verification (external uptime monitor, Stripe webhook secrets, 2FA enrollment) before the final report.

---

## 2026-05-28 — Final Production Verification, 2FA Advisory, CSP Header, Checklist Evidence

### Risk addressed

Production was running without a Content-Security-Policy header and without a machine-verifiable signal that admin 2FA is not yet enabled. Both gaps were identified during the final launch-readiness audit.

### Changes made

**1. Health endpoint 2FA advisory** (`server/src/routes/health.ts`):
- In `production` mode, the `/api/health/readiness` endpoint now runs an additional `security` check.
- If no admin user has `totp_enabled = 1`, a warning string is included in `checks.security.warnings`.
- The advisory is non-blocking (does not flip `ok` to `false`) but makes the gap visible to any monitoring system consuming the readiness endpoint.
- `ok` calculation changed from `every c.ok === true` to `every c.ok !== false` so that checks without an `ok` field (e.g. the advisory `security` block) do not contribute to failure.

**2. Test coverage** (`server/src/routes/health.integration.test.ts`):
- Added test: `includes a security advisory when no admin has 2FA enabled in production`.
- Follows strict TDD: test written and confirmed to fail before implementation (expected `undefined` for `checks.security`), then implementation added to make it pass.
- Test count: 22 files / **115 tests** (was 114).

**3. Content-Security-Policy header** (`/etc/httpd/conf.d/zz-hostpanel-headers.conf` on production server):
- Added `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' wss:; frame-ancestors 'none';`
- Production HTML has no inline scripts (verified: only `<script type="module" src="...">` elements).
- `unsafe-inline` in `style-src` is required for Vite's CSS-in-JS runtime style injection.

**4. Launch checklist evidence** (`docs/13-launch-checklist.md`):
- Marked ✅ all items with direct verification evidence gathered during this audit.
- Identified remaining manual steps for Marcos: external uptime monitor, nightly backup destination, admin 2FA enrollment, Stripe webhook secrets.

### Verification performed

```bash
# TDD cycle — RED
npm run test --workspace=server -- src/routes/health.integration.test.ts
# → 1 failed (checks.security undefined) ✓ confirmed RED

# GREEN — implemented security advisory block in health.ts
npm run test --workspace=server -- src/routes/health.integration.test.ts
# → 3 passed ✓ confirmed GREEN

# Full suite
npm run test --workspace=server   # 22 files / 115 tests passed
npm run build                     # passed (client + server, no errors)
npm audit --omit=dev --audit-level=moderate  # 0 vulnerabilities

# Production verification (server: root@45.79.189.4)
sshd -T | grep passwordauthentication  # passwordauthentication no ✓
sshd -T | grep permitrootlogin         # permitrootlogin without-password ✓
systemctl is-active hostpanel          # active ✓
systemctl is-enabled hostpanel         # enabled ✓
curl -sf http://localhost:3001/healthz  # {"ok":true,...} ✓
curl -sf https://panel.contaura.com/healthz  # {"ok":true,...} ✓
curl -sI https://panel.contaura.com/healthz | grep -E "X-Content-Type|X-Frame|Strict-Transport|Content-Security"
# Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options,
# Content-Security-Policy all present ✓
grep -rn 'execAsync\|promisify(exec)' /root/hostpanel/server/src/routes/ --include="*.ts" | grep -v '\.test\.ts'
# → CLEAN ✓
npm audit --omit=dev --audit-level=moderate  # 0 vulnerabilities ✓
```

### Follow-up (manual, requires Marcos)

1. **Admin 2FA enrollment** — log into the panel at `/admin-users`, enable TOTP for the `admin` account. The readiness endpoint will warn until this is done.
2. **External uptime monitor** — configure UptimeRobot or BetterStack to monitor `https://panel.contaura.com/healthz`.
3. **Nightly backup** — configure a backup schedule in the panel or a cron job; store backups off-server (S3, B2, or equivalent).
4. **Stripe/PayPal webhook secrets** — if payment integrations are live, configure and validate secrets in the panel Settings.
5. **Staging upgrade test** — perform a test upgrade on a staging server before the next major release.


---

## Hardening Pass 9 — Self-health watchdog implementation (2026-05-28)

**Goal:** Close the gap between the checklist claim ("watchdog polls /healthz every 60s, dispatches on 3 consecutive failures") and the actual code (which only had a systemd service watchdog for httpd/mariadb/postfix, no self-health polling).

### Changes

**1. New utility: `server/src/utils/self-health-watchdog.ts`**
- `startSelfHealthWatchdog(opts)` — polls a URL on a fixed interval, tracks consecutive failures, dispatches a `system.healthz_down` notification after N consecutive failures (configurable, default 3).
- Resets failure counter on any successful response.
- Swallows fetch errors, counts them as failures (ECONNREFUSED triggers alert).
- Returns `stop()` function that clears the interval.
- Fully injectable: accepts `fetch` override for deterministic testing.

**2. Tests: `server/src/utils/self-health-watchdog.test.ts`** (6 new tests)
- dispatches after 3 consecutive failures
- does not dispatch below threshold
- dispatches exactly once per burst (no repeat on ticks 4-N)
- resets counter after success
- stop() clears interval
- swallows fetch errors and counts them as failures

**3. `server/src/index.ts`**
- Imports and starts `startSelfHealthWatchdog` on server startup.
- Polls `http://localhost:<PORT>/healthz` every 60 seconds.
- Threshold: 3 consecutive failures.
- Dispatches via `dispatchNotification` (existing webhook channel).

### Verification performed

```bash
# TDD cycle — RED
npm run test --workspace=server -- src/utils/self-health-watchdog.test.ts
# → 1 test file failed (module not found) ✓ confirmed RED

# GREEN — implemented self-health-watchdog.ts
npm run test --workspace=server -- src/utils/self-health-watchdog.test.ts
# → 6 tests passed ✓ confirmed GREEN

# Full suite
npm run test --workspace=server   # 23 files / 121 tests passed (was 22 / 115)
npm run build                     # passed (client + server, no errors)

# Production deployment (server: root@45.79.189.4)
git push origin master            # 67a5db3..97876a8 ✓
systemctl restart hostpanel       # active ✓
curl -sf http://localhost:3001/healthz  # {"ok":true,...} ✓
curl -sI https://panel.contaura.com/healthz | grep -E "HTTP/|Strict-Transport|X-Content|X-Frame|Content-Security"
# HTTP/1.1 200 OK ✓ + all 4 security headers present ✓
sshd -T | grep passwordauthentication  # passwordauthentication no ✓
grep -rn 'execAsync|promisify(exec)' /root/hostpanel/server/src/routes/ | grep -v .test.ts
# → CLEAN ✓
git status --short  # (empty — working tree clean) ✓
```

### Commit
`97876a8` — "Add self-health watchdog: /healthz polling, 3-failure threshold, system.healthz_down alert"

## 2026-05-29 — Documentation hardening: fix stale install paths and update counts

### Risk addressed

`docs/10-upgrade.md` and `docs/01-installation.md` referenced `/opt/hostpanel` throughout — the old install path. Production runs from `/root/hostpanel`. Operators following the stale upgrade guide would run commands in the wrong directory, potentially breaking the service. The launch checklist also listed 22 files / 115 tests (the count before the watchdog TDD cycle) instead of the verified 23 files / 121 tests.

### Changes made

- **`docs/10-upgrade.md`** — complete rewrite:
  - All `/opt/hostpanel` → `/root/hostpanel` (11 occurrences).
  - Upgrade procedure now matches the operations runbook: `git pull → npm ci → npm run build → npm test → systemctl restart → healthz`.
  - Backup script updated with 14-day prune (`find ... -mtime +14`), correct paths, and `set -euo pipefail`.
  - Rollback and restore procedures use correct paths.
  - SQLite commands use `/usr/bin/sqlite3` (full path, required on this host).
- **`docs/01-installation.md`** — manual install section updated:
  - Clone target changed to `/root/hostpanel`.
  - Systemd service template uses `PANEL_DIR=/root/hostpanel` variable with note that it follows the clone location.
  - `sudo` removed (running as root on production).
  - `npm run build` simplified (workspace flags not needed from repo root).
  - Uninstall command updated to `/root/hostpanel`.
- **`docs/13-launch-checklist.md`**:
  - Test counts updated to 23 files / 121 tests (×3 occurrences).
  - Upgrade doc item marked ✅ with caveats (paths fixed; staging test remains manual).

### Validation performed

No code changes — doc changes only. Tests unchanged.

```bash
# Confirmed current test suite on production server (pre-commit):
# 23 files / 121 tests / 0 failures
# Build: passed
# Service: active
# /healthz: {"ok":true,...}
# SSH password auth: passwordauthentication no
```

### Commit

See next commit for hash.

---

## 2026-06-01 — Readiness advisory for SSH password authentication

### Risk addressed

Production launch verification already requires key-only SSH, but `/api/health/readiness` only surfaced admin 2FA security advisories. If a future package update or manual config drift re-enabled SSH password login, monitoring would not have an application-level warning.

### Changes made

- **`server/src/routes/health.ts`** — production readiness now checks effective sshd password-authentication state and appends a non-blocking security warning when password login is enabled.
  - Uses `sshd -T` for the live effective config in production.
  - Supports `SSHD_CONFIG_FILE` for deterministic tests without touching host SSH config.
  - Falls back to `/etc/ssh/sshd_config` parsing if `sshd -T` is unavailable.
- **`server/src/routes/health.integration.test.ts`** — added regression coverage for a production readiness warning when `PasswordAuthentication yes` is detected.

### Verification performed

```bash
# TDD cycle — RED
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "warns in production readiness when SSH password authentication is enabled"
# → failed as expected: only the existing 2FA warning was returned

# GREEN
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "warns in production readiness when SSH password authentication is enabled"
# → passed

# Full suite/build
npm run test --workspace=server   # 23 files / 122 tests passed
npm run build                     # passed (client + server)
```

### Follow-up

Continue final production validation and runbook polish. Admin 2FA enrollment remains a manual Marcos action until he logs into `/admin-users` and enables TOTP.

---

## 2026-06-02 — Launch-blocking readiness failure for SSH password authentication

### Risk addressed

The prior readiness pass exposed `PasswordAuthentication yes` as a warning. For production launch, key-only SSH is a hard requirement, not an advisory. If sshd config drift re-enables password login, the readiness endpoint should fail so monitoring and launch checks block immediately.

### Changes made

- **`server/src/routes/health.ts`** — production `checks.security` now includes `{ ok, warnings, failures }`.
  - Missing admin TOTP remains a non-blocking warning because enrollment requires Marcos's manual UI action.
  - Enabled SSH password authentication is now a blocking failure that makes `/api/health/readiness` return HTTP 503.
  - Readiness-check errors while evaluating security state also fail closed.
- **`server/src/routes/health.integration.test.ts`** — updated the SSH-password-auth regression to require HTTP 503, `body.ok=false`, `checks.security.ok=false`, and an explicit SSH password-auth failure message.

### Verification performed

```bash
# TDD RED — new expectation failed against warning-only implementation
npm run test --workspace=server -- health.integration
# → failed as expected: expected 503, received 200

# GREEN + full regression/build
npm run test --workspace=server -- health.integration  # 23 files / 124 tests passed
npm run test --workspace=server                       # 23 files / 124 tests passed
npm run build                                         # passed (server + client)
```

### Follow-up

Continue final production validation and runbook polish. Remaining launch blockers are manual operational items: external uptime monitor, off-server/nightly backup configuration, notification webhook, final critical-alert check, admin TOTP enrollment, emergency 2FA bypass test, and payment webhook secret validation if payments are live.

## 2026-06-03 6-hour slice — monitoring alert-rule readiness advisory

### Risk addressed

Production monitoring should not only confirm that alerts can leave the panel; it should also surface whether any threshold rules are enabled. Without at least one enabled CPU, memory, disk, or load rule, the alerting channel can be configured but never fire for resource exhaustion.

### Changes made

- **`server/src/routes/health.ts`** — production `/api/health/readiness` now reports `checks.monitoring.enabledAlertRuleCount` and adds a warning when zero alert rules are enabled.
- **`server/src/routes/health.integration.test.ts`** — added a TDD regression proving readiness remains HTTP 200/advisory-only, but exposes `enabledAlertRuleCount: 0` and an explicit alert-rule warning when webhooks exist and no alert rules are enabled.

### Verification performed

```bash
# TDD RED — new test failed before implementation because enabledAlertRuleCount was absent
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "no system alert rule"
# → failed as expected: expected enabledAlertRuleCount: 0, property absent

# GREEN
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "no system alert rule"
# → passed
```

---

## 2026-06-04 6-hour slice — machine-readable manual launch blockers

### Risk addressed

The launch checklist still has a few Marcos-owned/manual items (admin TOTP enrollment and outbound notification webhook setup). They were visible only as separate readiness warnings and checklist text, making it easy to miss them during automated launch gating.

### Changes made

- **`server/src/routes/health.ts`** — production `/api/health/readiness` now includes a top-level `launchBlockers` array for manual launch gates that should be tracked before declaring production-ready without making liveness/readiness fail while the service is otherwise healthy.
  - `admin_2fa_missing` is emitted when no admin has TOTP enabled.
  - `notification_webhook_missing` is emitted when no enabled notification webhook exists.
  - SSH password authentication remains a hard readiness failure, not a manual advisory.
- **`server/src/routes/health.integration.test.ts`** — added a TDD regression proving the endpoint remains HTTP 200 when only manual launch blockers are present, while exposing both blocker codes in a stable response field.

### Verification performed

```bash
# TDD RED — new expectation failed because launchBlockers was absent
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "summarizes manual production launch blockers"
# → failed as expected: expected launchBlockers array, received undefined

# GREEN
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "summarizes manual production launch blockers"
# → passed
```

---

## 2026-06-04 6-hour slice — disaster-recovery drill launch-blocker visibility

### Risk addressed

The automated DR drill existed, but production readiness did not expose whether any persisted drill evidence was present. A launch review could therefore miss that the restore drill still needs to be executed against the current backup set before declaring production ready.

### Changes made

- **`server/src/routes/health.ts`** — production `/api/health/readiness` now inspects the DR drill report directory (`DRILL_REPORT_DIR`, or `BACKUP_DIR/drills`, defaulting to `/var/backups/hostpanel/drills`).
  - Adds `checks.disasterRecovery.latestDrillReport`, `reportDir`, `maxAgeDays`, and drill evidence age for launch verification.
  - Adds a manual `launchBlockers` entry with code `dr_drill_evidence_missing` when no JSON drill report exists.
  - Adds a manual `launchBlockers` entry with code `dr_drill_evidence_stale` when the newest drill report is older than `DRILL_REPORT_MAX_AGE_DAYS` (default 7), forcing a current restore drill before launch.
  - Keeps readiness HTTP 200 when only this manual launch blocker is present, matching the existing manual-blocker model for admin 2FA and notification webhooks.
- **`server/src/routes/health.integration.test.ts`** — extended the manual launch-blockers regression to require DR drill evidence visibility.

### Verification performed

```bash
# TDD RED — new expectation failed because stale DR drill blocker/age fields were absent
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "adds a manual launch blocker when the latest disaster-recovery drill evidence is stale"
# → failed as expected: checks.disasterRecovery did not include maxAgeDays and no stale launch blocker existed

# GREEN
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "adds a manual launch blocker when the latest disaster-recovery drill evidence is stale"
# → passed

# Regression for missing evidence blocker
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "summarizes manual production launch blockers"
# → passed
```

---

## 2026-06-05 6-hour slice — critical alert launch-blocker automation

### Risk addressed

The launch checklist still required a manual panel/UI review for unresolved critical alerts. That manual-only gate could be skipped during final launch pressure, even though HostPanel already knows the enabled CPU, memory, and disk alert thresholds.

### Changes made

- **`server/src/routes/health.ts`** — production `/api/health/readiness` now evaluates live enabled CPU/memory/disk alert rules and returns `checks.monitoring.criticalAlerts`.
  - Critical alerts are defined as rule breaches at or above 95% for CPU, memory, or disk.
  - Readiness fails closed when any critical alert is active.
  - Adds a `launchBlockers` entry with code `critical_alerts_active` so launch reports have a stable machine-readable blocker.
- **`server/src/routes/health.integration.test.ts`** — added TDD regression coverage for an active critical disk alert.
- **`docs/13-launch-checklist.md`** — converted the unresolved-critical-alert checklist item from manual-only to automated readiness evidence.

### Verification performed

```bash
# TDD RED — new expectation failed because checks.monitoring.criticalAlerts was absent
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "critical live alert"
# → failed as expected: expected criticalAlerts array, received undefined

# GREEN
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "critical live alert"
# → passed
```

---

## 2026-06-06 6-hour slice — backup evidence launch-blocker visibility

### Risk addressed

The launch checklist still required fresh backup scheduling and off-server replication as manual reliability gates. Without a machine-readable backup-evidence signal, final launch verification could miss that no current HostPanel backup archive had been produced before the deadline.

### Changes made

- **`server/src/routes/health.ts`** — production `/api/health/readiness` now inspects the backup archive directory (`BACKUP_DIR`, default `/var/backups/hostpanel`) for `.tar.gz` and `.sql.gz` backups.
  - Adds `checks.backups.latestArchive`, `backupDir`, and `maxAgeDays` (default 1 day, configurable with `BACKUP_ARCHIVE_MAX_AGE_DAYS`).
  - Adds manual launch blocker `backup_evidence_missing` when no backup archive exists.
  - Adds manual launch blocker `backup_evidence_stale` when the newest archive is older than the allowed age.
  - Keeps readiness HTTP 200 when this is the only issue, matching the manual-launch-blocker model while making the launch gate visible to monitoring and the final report.
- **`server/src/routes/health.integration.test.ts`** — added TDD regression coverage for stale backup evidence and updated exact launch-blocker expectations.
- **`docs/13-launch-checklist.md`** — documented the new backup evidence signal alongside the manual backup/off-server replication steps.

### Verification performed

```bash
# TDD RED — new expectation failed because checks.backups was absent
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "latest backup archive is stale"
# → failed as expected: expected body.checks.backups, received undefined

# GREEN
npm run test --workspace=server -- src/routes/health.integration.test.ts -t "latest backup archive is stale"
# → passed

# Regression suite for health readiness behavior
npm run test --workspace=server -- src/routes/health.integration.test.ts
# → 25 files / 138 tests passed (Vitest project run selected all server source tests)
```

---

## 2026-06-06 6-hour slice — WordPress maintenance background-job hardening

### Risk addressed

The WordPress install flow already supported `/api/jobs` polling, but the bulk maintenance endpoint `POST /api/wordpress/:domain/update-all` still executed core/plugin/theme updates synchronously. On production sites that can hold an HTTP request open through multiple wp-cli operations, obscuring progress and increasing timeout risk during launch maintenance.

### Changes made

- **`server/src/routes/wordpress.ts`** — `POST /api/wordpress/:domain/update-all` now accepts `async: true` and enqueues a `wordpress.update_all` background job with progress messages.
  - The job preserves the hardened argv-based `wp` calls for core, plugin, and theme updates.
  - Synchronous compatibility is preserved when `async` is omitted.
  - The job result includes the domain plus the same core/plugin/theme output fields returned by the synchronous path.
- **`server/src/routes/wordpress.integration.test.ts`** — added TDD coverage proving `async: true` returns `202`, exposes `/api/jobs/:id`, completes as `wordpress.update_all`, and invokes the exact wp-cli operations.
- **`docs/13-launch-checklist.md`** — updated the long-running-operations launch checklist evidence for WordPress maintenance update-all.

### Verification performed

```bash
# TDD RED — new expectation failed because update-all returned 200 synchronously instead of 202/jobId
npm run test --workspace=server -- wordpress.integration.test.ts -t "enqueues update-all"
# → failed as expected: expected 202, received 200

# GREEN targeted + route regression
npm run test --workspace=server -- wordpress.integration.test.ts -t "enqueues update-all"
npm run test --workspace=server -- wordpress.integration.test.ts
# → passed: 25 server test files / 139 tests
```

---

## 2026-06-13 6-hour slice — app deletion background-job hardening

Priority: continue closing production-depth gaps for long-running app operations.

### Risk addressed

App create/stage/promote, scripts, and WordPress maintenance already had `/api/jobs` support, but managed-app deletion still ran synchronously while it could invoke PM2, remove Apache vhost files, and reload Apache. During launch operations, that left no durable job record or polling path if deletion took longer than a normal HTTP request.

### Changes made

- **`server/src/routes/apps.ts`** — `DELETE /api/apps/:name` now accepts `{ "async": true }` and returns `202` with `jobId`/`statusUrl` while preserving the existing synchronous response when `async` is omitted.
- The asynchronous delete job records type `app.delete`, reports progress, removes the managed-app row, and returns `{ success: true, appName }`.
- Added app-name validation to the delete route before database lookup.
- **`server/src/routes/scanner-jobs.integration.test.ts`** — added a regression proving app deletion enqueues through `/api/jobs` and removes the database record after completion.

### TDD evidence

```bash
# RED — failed because DELETE /api/apps/:name ignored async:true and returned 200
npm run test --workspace=server -- src/routes/scanner-jobs.integration.test.ts -t "enqueues app deletion"
# → failed as expected: expected 202, received 200

# GREEN
npm run test --workspace=server -- src/routes/scanner-jobs.integration.test.ts -t "enqueues app deletion"
# → passed
```

---

## 2026-06-15 6-hour slice — app lifecycle background-job hardening

Priority: continue closing production-depth gaps for remaining app lifecycle operations after the launch deadline, while preserving synchronous compatibility for existing callers.

### Risk addressed

Managed-app start/create/stage/promote/delete already had `/api/jobs` coverage, but `POST /api/apps/:name/stop` and `POST /api/apps/:name/restart` still ran synchronously. PM2 control can block or fail during production maintenance, leaving operators without a durable job record or polling path.

### Changes made

- **`server/src/routes/apps.ts`** — `POST /api/apps/:name/stop` now accepts `{ "async": true }` and enqueues an `app.stop` background job with progress, `jobId`, and `statusUrl`; the legacy synchronous response remains available when `async` is omitted.
- **`server/src/routes/apps.ts`** — `POST /api/apps/:name/restart` now accepts `{ "async": true }` and enqueues an `app.restart` background job with progress, `jobId`, and `statusUrl`; synchronous compatibility is preserved.
- **`server/src/routes/scanner-jobs.integration.test.ts`** — added TDD coverage for app stop/restart background jobs and job-result evidence.
- **`docs/13-launch-checklist.md`** — updated long-running-operation evidence to include app stop/restart lifecycle operations.

### TDD evidence

```bash
# RED — stop failed because async:true returned 200 synchronously instead of 202/jobId
npm run test --workspace=server -- src/routes/scanner-jobs.integration.test.ts -t "enqueues app stop"
# → failed as expected: expected 202, received 200

# GREEN — stop background job
npm run test --workspace=server -- src/routes/scanner-jobs.integration.test.ts -t "enqueues app stop"
# → passed

# RED — restart failed because async:true returned 200 synchronously instead of 202/jobId
npm run test --workspace=server -- src/routes/scanner-jobs.integration.test.ts -t "enqueues app restart"
# → failed as expected: expected 202, received 200

# GREEN — stop/restart targeted regression
npm run test --workspace=server -- src/routes/scanner-jobs.integration.test.ts -t "enqueues app restart|enqueues app stop"
# → passed
```


---

## 2026-06-15 6-hour slice — scanner definition-update background-job hardening

Priority: continue closing production-depth gaps for remaining long-running security-scanner operations after the launch deadline, while preserving synchronous compatibility for existing callers.

### Risk addressed

Security-scanner malware scans and integrity baselines already supported `/api/jobs`, but `POST /api/security-scanner/update-definitions` still invoked `freshclam` synchronously. ClamAV definition refreshes can block on mirrors or package locks during production maintenance, leaving operators without a durable job record or polling path.

### Changes made

- **`server/src/routes/security-scanner.ts`** — `POST /api/security-scanner/update-definitions` now accepts `{ "async": true }` and enqueues a `scanner.update_definitions` background job with progress, `jobId`, and `statusUrl`.
- The legacy synchronous response is preserved when `async` is omitted.
- **`server/src/routes/scanner-jobs.integration.test.ts`** — added regression coverage proving the async ClamAV definition update completes through `/api/jobs` and returns command output evidence.
- **`docs/13-launch-checklist.md`** — updated long-running-operation evidence to include ClamAV definition updates.

### TDD evidence

```bash
# RED — failed because async:true returned 200 synchronously instead of 202/jobId
npm run test --workspace=server -- src/routes/scanner-jobs.integration.test.ts -t "enqueues a ClamAV definition update"
# → failed as expected: expected 202, received 200

# GREEN
npm run test --workspace=server -- src/routes/scanner-jobs.integration.test.ts -t "enqueues a ClamAV definition update"
# → passed
```

---

## 2026-06-17 6-hour slice — payment integration reseller-privilege hardening

Priority: continue closing production security/authorization coverage gaps for sensitive routes.

### Risk addressed

Stripe and PayPal payment integration endpoints are sensitive billing-adjacent controls. The generic admin/portal-role guard protected them from unauthenticated and portal-role access, but reseller feature-list enforcement was not wired on those two route mounts. A reseller account without Billing privileges could still query payment config or initiate payment operations if it had a valid reseller JWT.

### Changes made

- **`server/src/index.ts`** — protected non-webhook Stripe routes with `enforceResellerPrivilege('billing')` after JWT/portal-role validation while preserving the public signed Stripe webhook path.
- **`server/src/index.ts`** — protected all PayPal routes with `enforceResellerPrivilege('billing')`.
- **`server/src/routes/security-authorization.integration.test.ts`** — added a regression that keeps Stripe/PayPal route wiring tied to the Billing reseller privilege.

### TDD evidence

```bash
# RED — failed because Stripe/PayPal route mounts lacked enforceResellerPrivilege('billing')
npm run test --workspace=server -- src/routes/security-authorization.integration.test.ts -t "keeps protected Stripe and PayPal routes behind the billing reseller privilege"
# → failed as expected

# GREEN
npm run test --workspace=server -- src/routes/security-authorization.integration.test.ts -t "keeps protected Stripe and PayPal routes behind the billing reseller privilege"
# → passed
```
