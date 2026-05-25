# cPanel/WHM Parity Implementation Roadmap

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Close the listed cPanel/WHM parity gaps with safe HostPanel-native modules, tests, and UI integration.

**Architecture:** Implement parity as independent modules under the existing Express API and React UI. Prefer read-only/reporting foundations first for high-risk server areas, then add controlled mutation workflows once the data model and permissions are in place. Preserve HostPanel's hardened `runFile` argv execution pattern.

**Tech Stack:** Node.js 20, TypeScript, Express, SQLite/better-sqlite3, React/Vite/Tailwind, Vitest.

---

## Phase 1 — Parity foundations implemented first

### Task 1: Feature catalog and feature-list enforcement foundation

**Objective:** Add a cPanel/WHM-style feature catalog and package feature-list store that can be used by plans, resellers, and client-portal visibility.

**Files:**
- Create: `server/src/routes/feature-lists.ts`
- Create: `server/src/routes/feature-lists.integration.test.ts`
- Modify: `server/src/index.ts`
- Modify: `client/src/pages/Plans.tsx` later for full UI wiring

**Behavior:**
- `GET /api/feature-lists/catalog` returns grouped features for all parity areas.
- `GET /api/feature-lists` lists named feature lists from SQLite.
- `POST /api/feature-lists` creates/updates a feature list with enabled feature keys.
- `GET /api/feature-lists/effective/:planId` returns a plan's enabled features, defaulting to all features until plan wiring is added.

### Task 2: Track Delivery / deep mail delivery reporting foundation

**Objective:** Add mail log tracing that searches Postfix-style mail logs by sender, recipient, status, queue ID, and date window.

**Files:**
- Create: `server/src/routes/mail-trace.ts`
- Create: `server/src/routes/mail-trace.integration.test.ts`
- Modify: `server/src/index.ts`
- UI later: add page under Mail tools or Email Extras

**Behavior:**
- `GET /api/mail-trace/search` accepts `sender`, `recipient`, `queueId`, `status`, `limit`.
- Parses `/var/log/maillog`, `/var/log/mail.log`, or `MAIL_LOG_FILE` env override.
- Returns normalized events with timestamp, queueId, sender, recipient, status, relay, delay, diagnostic.
- Never shells out for parsing.

### Task 3: Detailed analytics foundation

**Objective:** Add visitor/error/bandwidth/raw-access analytics endpoints equivalent to the base cPanel metrics pages.

**Files:**
- Create: `server/src/routes/analytics.ts`
- Create: `server/src/routes/analytics.integration.test.ts`
- Modify: `server/src/index.ts`

**Behavior:**
- `GET /api/analytics/visitors` parses Apache combined logs into top pages, top IPs, status codes, referrers, user agents.
- `GET /api/analytics/errors` parses Apache error logs and 4xx/5xx access statuses.
- `GET /api/analytics/bandwidth` summarizes bytes by day and domain/path.
- `GET /api/analytics/raw-access` lists downloadable log files.
- `GET /api/analytics/raw-access/:name/download` safely downloads an allowed raw log.
- `GET /api/analytics/awstats` returns an Awstats/Webalizer-style summary generated from logs when those tools are not installed.

### Task 4: Server updates and plugin ecosystem foundation

**Objective:** Add a WHM-style update/plugin registry page foundation without executing destructive updates automatically.

**Files:**
- Create: `server/src/routes/extensions.ts`
- Create: `server/src/routes/extensions.integration.test.ts`
- Modify: `server/src/index.ts`

**Behavior:**
- `GET /api/extensions/updates` reports current git revision, remote revision if available, package manager availability, and pending npm audit summary when available.
- `GET /api/extensions/plugins` lists installed plugin manifests from a controlled plugin directory.
- `POST /api/extensions/plugins/refresh` rescans manifests.
- Future phase adds install/enable/disable with signatures.

## Phase 2 — Control-plane workflows

### Task 5: Web Disk / WebDAV

Implement WebDAV account definitions, Apache/nginx WebDAV config generation, per-user credentials, and UI. This requires careful OS package/service detection and should be gated behind feature lists.

### Task 6: User Manager / team subaccounts

Create team user table, scoped permissions, invitation/reset flows, TOTP compatibility, and middleware enforcement. This is prerequisite for cPanel-style subaccounts across email/FTP/Web Disk.

### Task 7: Guided backup wizard

Create wizard presets for full account backup, home directory, database-only, email-only, and restore validation. Integrate existing backup engine.

### Task 8: phpMyAdmin/database GUI integration

Detect phpMyAdmin, configure safe panel links, DB-user login flow, and per-account DB privilege mapping.

### Task 9: Account transfer/import tool

Support cPanel backup archive inspection, domain/email/db/file restore mapping, dry-run report, then restore execution.

### Task 10: DNS clustering and nameserver automation

Add cluster node registry, TSIG/key validation, zone sync dry-runs, nameserver health checks, and controlled sync. Add nameserver setup wizard for glue/NS/A records.

### Task 11: Granular reseller privileges

Add privilege keys using the feature catalog, enforce in reseller middleware/routes, and expose plan/reseller assignment UI.

## Verification for every phase

- Run targeted Vitest tests and verify RED before implementation.
- Run `npm run build`.
- Run `npm test --workspaces --if-present`.
- Deploy to `/root/hostpanel`, restart `hostpanel`, and verify HTTP 200 on `127.0.0.1:3001`.
