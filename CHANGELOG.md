# Changelog

All notable changes to HostPanel are documented in this file.

## Unreleased

### Added

- Added `docs/cpanel-comparison.md` comparing HostPanel with cPanel/WHM for end-user and administrator functionality, including a prioritized gap list.
- Added `docs/plans/cpanel-whm-parity-roadmap.md` and `docs/cpanel-whm-parity-status.md` to track full cPanel/WHM parity implementation.
- Added a cPanel-style Address Importer in Email Extras for bulk CSV import of email forwarders with duplicate skipping and row-level validation feedback.
- Added WHM-style feature-list foundation APIs for package feature catalog, named feature lists, and effective plan features.
- Added Track Delivery-style mail trace APIs for Postfix log search by sender, recipient, queue ID, and status.
- Added visitor, error, bandwidth, raw-access, and Awstats/Webalizer-style analytics APIs backed by local web logs.
- Added server update and plugin registry foundation APIs for git/audit status and controlled plugin manifest discovery.
- Added a cPanel/WHM parity hub UI at `/cpanel-parity` covering the requested next implementation order.
- Added cPanel-style team subaccount APIs with scoped permissions, hashed credentials, client-portal login, and server-side route permission enforcement for team tokens.
- Added feature-list assignment APIs for plans and reseller privilege feature sets.
- Added Web Disk/WebDAV account registry, Apache config preview, and reload endpoint.
- Added DNS clustering/nameserver automation foundations for node registry, health checks, sync dry-runs, and nameserver record planning.
- Added cPanel transfer/import dry-run inspection with guarded execution.
- Wired guided backup wizard, phpMyAdmin detection, mail trace, analytics, raw logs, update status, and plugin registry into the new parity UI.
- Added phpMyAdmin installation and account-scoped launch flows for admins and client-portal users, including Apache alias config generation and feature/permission enforcement.
- Added authenticated DNS cluster sync execution using `rndc retransfer` with managed temporary key files so TSIG secrets are not exposed in API responses or command previews.
- Added guarded cPanel transfer/import execution with inspect reports, progress tracking, homedir restore rollback points, account record upserts, and MySQL SQL import support.
- Added plugin package installation, enable/disable operations, sha256 verification, manifest sanitization, and rollback snapshots to the extension ecosystem.
- Added WebDAV prerequisite provisioning plus UI password handling so new Web Disk accounts create/update htpasswd entries and managed Apache DAV config from the parity hub.
- Added guided backup restore controls in the parity hub for restore planning, dry-run execution, selective entries, and actual restore execution.
- Added broad reseller privilege enforcement across existing HostPanel admin modules and expanded the WHM feature catalog beyond the original parity-only entries.
- Added one-time phpMyAdmin Signon bridge generation, distro config registration for a dedicated Signon server entry, and a credential-verified SSO launch endpoint for short-lived phpMyAdmin handoff URLs.
- Completed shell-execution hardening for the remaining legacy route modules (`node-apps`, `resource-limits`, `logs`, and `cache`) by replacing shell pipelines with `runFile` argv calls or Node primitives.
- Expanded team-subaccount regression coverage for account, file, and database namespace scoping.
- Added a centralized background jobs API (`/api/jobs`) with persisted status, progress, result/error, and structured logs; backup creation now has Backup Manager UI polling, and backup restore, transfer execution, DNS sync, WebDAV provision/reload, and plugin install/rollback can enqueue asynchronous jobs.
- Added production health endpoints: public `/healthz` liveness plus authenticated `/api/health/readiness` checks for database, disk, memory, and recent failed background jobs.
- Added phpMyAdmin Signon field validation endpoint that checks managed Apache alias/config, bridge PHP syntax, httpd state, token directory presence, and avoids returning token payloads.

### Fixed

- Cache Manager now uses the actual cache API response schema for OPcache, Redis, and Memcached status/details, and sends Redis start/stop requests to the implemented `/api/cache/redis/toggle` endpoint instead of non-existent placeholder action URLs.
- WAF / Fail2Ban now renders jail objects returned by the API directly, expands real jail metrics and banned IPs without calling a non-existent detail endpoint, and disables ban/unban actions until required input is present.

## [1.1.0] — 2026-05-15

### Security

This release is a dedicated security hardening pass covering all server-side
route handlers, middleware, and the WebSocket terminal. No functional behaviour
was changed; every fix closes an injection or privilege-escalation vector.

---

#### Shell Injection

- **`resource-limits.ts`** — Quoted shell variables in `useradd`, `usermod`,
  and quota commands; added domain/docroot validation before any exec call.
- **`cron.ts`** — Quoted `user` parameter in all `crontab -u` invocations.
- **`ssl-advanced.ts`** — Added domain regex guard; introduced `stripSubj()` to
  sanitize certificate subject fields before passing them to OpenSSL.
- **`mail-routing.ts`** — Added domain and email regex validation; removed SASL
  password from visible command-line arguments.
- **`wordpress.ts`** — Added `DOMAIN_RE` and `SLUG_RE` guards across all 11
  domain and slug route handlers before exec calls.
- **`web-extras.ts`** — Quoted `target` variable in `du` and `df` commands.
- **`files.ts`** — Extended `safePath()` with a `/$["\\!]/.test()` check so
  shell metacharacters are rejected even after the boundary check passes.
- **`node-apps.ts`** — Added `APP_NAME_RE`, `SAFE_PATH_RE`, and
  `INTERP_ALLOWLIST` guards on `name`, `script`, `cwd`, `interpreter`, and env
  before all PM2 exec calls.
- **`domains.ts`** — Validated `email` field before interpolating into the
  `certbot --email` argument.
- **`scripts.ts`** — Escaped single quotes in the WP-CLI `--admin_email`
  argument using `replace(/'/g, "'\\''")`
- **`apps.ts`** — Sanitised `env_vars` before interpolation into
  `--env-var="${envStr}"`: keys must match `[a-zA-Z_][a-zA-Z0-9_]*` and double
  quotes are stripped from values. Applied to both `/start` and `/stage` routes.
- **`logs.ts`** — Replaced `fgrep -i ${JSON.stringify(search)}` with Node.js
  `Array.filter` / `String.includes`. `JSON.stringify` quotes strings but does
  not escape backticks or `$()`, enabling command substitution. Fixed in both
  `/search/:key` and `/domain/:domain/:type`.
- **`mail-queue.ts`** — Same `JSON.stringify` command-substitution vector in
  `GET /delivery-log`; replaced with Node.js filtering.

#### Password Exposure in Process List

- **`htpasswd.ts`** — Replaced `htpasswd -b` (password as CLI argument) with a
  `spawn` + stdin pattern (`htpasswdStdin`).
- **`ftp.ts`** — Replaced `echo 'user:pass' | chpasswd` with a `spawn` + stdin
  pattern (`chpasswdStdin`).
- **`email.ts`** — Replaced `doveadm pw -p '${pass}'` exec with a `spawn` +
  stdin pattern (`doveadmHashStdin`).
- **`databases.ts`** — `mysqldump` export used `-p$PASS` as a spawn argument
  and `mysql` import used `-p$PASS` inline in an exec string; both expose the
  DB root password in `ps aux`. Moved credential to `MYSQL_PWD` env var passed
  via the `env` option.
- **`accounts.ts`** — `POST /export` ran `mysql` and `mysqldump` with
  `-p$DB_ROOT_PASS` in the shell command string. Same `MYSQL_PWD` env var fix.
- **`backup.ts`** — AWS credentials (`--access-key`, `--secret-key`) were
  inline in the `aws s3` exec string. Moved to the `execAsync` `env` option.

#### Path Traversal

- **`files.ts`** — `safePath()` now rejects paths containing shell metacharacters
  in addition to enforcing the `BASE_DIR` boundary.
- **`addon-domains.ts`** — Added `path.resolve()` boundary check: document root
  must remain within `WEBROOT`.
- **`backup.ts`** — Added `WEBROOT` boundary check on the `target` parameter
  before constructing the `tar` source path.
- **`security-scanner.ts`** — Added `WEBROOT` boundary check in both
  `/integrity/baseline` and `/integrity/check` before reading file paths.
- **`php.ts`** — `iniPath` was validated only with `.endsWith('.ini')`, allowing
  traversal to arbitrary `.ini`-suffixed files (e.g. `../../../../etc/cron.d/evil.ini`).
  Now requires an absolute path with no `..` component.
- **`php-domains.ts`** — `domain` from the request body was used directly in
  `path.join(VHOST_DIR, domain + '.conf')` without validation, enabling
  traversal outside the vhost directory. Added `DOMAIN_RE` validation.
- **`email-extras.ts`** — `domain` param in `/spam-rules/:domain` was used as a
  filename (`${SA_DOMAIN_DIR}/${domain}.cf`) with no validation. Added
  `DOMAIN_RE` check on GET, POST, and DELETE.

#### Config Injection

- **`parked-domains.ts`** — Added `DOMAIN_RE` validation on both `domain` and
  `primary_domain` before writing them into an Apache `VirtualHost` block.
- **`redirects.ts`** — Added `DOMAIN_RE`, `FROM_RE` (`/^\/[^\r\n\s]*$/`), and
  `TO_RE` (`/^https?:\/\/[^\r\n\s]+$/`) validation before writing Apache
  `Redirect` directives.
- **`apps.ts`** — Added `DOMAIN_RE` for domain, integer range check for port,
  and `isSafePath()` for `start_script` and `working_dir` before writing Apache
  `VirtualHost` config.
- **`settings.ts`** — Added `[\r\n]` rejection on `relayhost` before writing
  Postfix `main.cf`.
- **`mail-routing.ts`** — Added domain and email regex guards before writing
  Postfix transport map entries.
- **`subdomains.ts`** — `customRoot` from the request body was placed directly
  into Apache `DocumentRoot` and `<Directory>` blocks without validation.
  Newlines enabled injecting arbitrary Apache directives.
- **`php.ts`** — `settings.user` was written verbatim to the PHP-FPM pool
  config file. A newline in the value injected arbitrary FPM directives. Value
  is now sanitised with `replace(/[^a-zA-Z0-9._-]/g, '')`.
- **`email-extras.ts`** — SpamAssassin config values written via `PUT /spam`
  were not stripped of newlines, enabling directive injection. Values now have
  `\r\n` stripped before being written to the config file.
- **`email-extras.ts`** — `domain` body param in `POST /catch-all` was written
  as `@${domain}` to the Postfix virtual aliases file without validation.
  A newline injected arbitrary forwarder entries.

#### SQL Injection

- **`databases.ts`** — `GRANT` and `REVOKE` privilege names cannot be
  parameterized in SQL DDL. Added a `VALID_PRIVILEGES` Set allowlist; any
  privilege not in the set is rejected before the query runs.

#### Authentication & Authorisation Bypasses

- **`git-deploy.ts`** — Webhook HMAC validation was skipped entirely when the
  `X-Hub-Signature-256` header was absent, allowing unauthenticated webhook
  delivery. Missing header with a configured secret now returns 401.
- **`index.ts`** (Stripe routing) — `app.use('/api/stripe/webhook', stripeRoutes)`
  mounted the entire Stripe router without authentication, exposing
  `POST /checkout` and `GET /config` at `/api/stripe/webhook/*` to
  unauthenticated callers. Replaced with a single conditional-auth mount:
  only `POST /webhook` (Stripe-signature verified) bypasses JWT.
- **`index.ts`** (git-deploy routing) — `app.use('/api/git-deploy', authenticateToken, ...)`
  intercepted all `/api/git-deploy/*` paths before the unauthenticated webhook
  mount, making GitHub/GitLab webhook delivery always return 401. Replaced with
  a single conditional-auth mount: only `POST /webhook/:name` (HMAC verified)
  bypasses JWT.
- **`terminal.ts`** — The WebSocket terminal verified JWT validity but never
  inspected the role claim. `readonly` admins and client-portal users (who
  receive `role: 'client'` tokens signed with the same secret) could open an
  interactive root shell. Now requires `admin` or `superadmin` role.

#### Brute-Force / Rate Limiting

- **`index.ts`** — `POST /api/portal/login` received only the global 300 req/min
  limit (~5 password guesses per second against client portal accounts). Added
  the same 20 req/min strict rate limit already applied to `/api/auth/`.

---

### Commits

| SHA | Description |
|-----|-------------|
| `df243df` | fix: DB root password in process list; no rate limit on portal login |
| `ca508dd` | fix: terminal WebSocket accessible to readonly/client roles; env_vars quote injection in apps |
| `ca4b2d9` | fix: shell injection, path traversal, and config injection in 6 routes |
| `84dfbdb` | fix: stripe double-mount exposes routes without auth; fix git-deploy webhook routing |
| `60b0487` | fix: config injection and password exposure in 5 more route files |
| `5660c4b` | fix: shell injection and path traversal in 7 more route files |
| `6d00c63` | fix: webhook auth bypass in git-deploy.ts |
| `e4bfa74` | fix: SQL injection in databases.ts grant/revoke routes |
| `93419bd` | fix: shell injection in files.ts via safePath shell metacharacter check |
| `c8c6f7f` | fix: shell injection in htpasswd.ts and web-extras.ts |
| `e123a11` | fix: shell injection in ssl-advanced.ts, mail-routing.ts, and wordpress.ts |
| `7f7daaa` | fix: shell injection in resource-limits.ts and cron.ts |
