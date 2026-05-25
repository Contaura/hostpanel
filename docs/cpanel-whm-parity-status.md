# cPanel/WHM Parity Status

This document tracks implementation of the requested cPanel/WHM parity areas.

## Implemented foundations in this release

- **cPanel / WHM Parity UI hub**
  - UI: `/cpanel-parity`
  - Exposes the next nine parity areas in the requested order with real API calls, no mock-only controls.

- **User Manager / team subaccounts**
  - API: `/api/team-users`, `/api/team-users/permissions`
  - Stores scoped subaccounts with hashed passwords, account/client associations, status, notes, and permission keys.
  - Team subaccounts can log into the client portal with their own credentials.
  - Client-portal team tokens are checked server-side against route permission groups before protected actions run.
  - Client-portal team navigation is filtered to assigned permission groups.

- **WHM-style feature catalog / feature lists**
  - API: `/api/feature-lists/catalog`, `/api/feature-lists`, `/api/feature-lists/effective/:planId`, `/api/feature-lists/assign-plan`, `/api/feature-lists/reseller/:id`
  - Purpose: package/feature-list enforcement foundation for plans, reseller privileges, and client portal visibility.

- **Track Delivery / deep mail delivery reporting foundation**
  - API: `/api/mail-trace/search`
  - Parses Postfix-style logs without shelling out.
  - Filters by sender, recipient, queue ID, status, and limit.

- **Detailed visitor/error/bandwidth analytics foundation**
  - API: `/api/analytics/visitors`, `/api/analytics/errors`, `/api/analytics/bandwidth`, `/api/analytics/raw-access`, `/api/analytics/awstats`
  - Provides visitor, HTTP error, raw access, bandwidth, and Awstats/Webalizer-style summaries from local web logs.

- **Server update/plugin ecosystem foundation**
  - API: `/api/extensions/updates`, `/api/extensions/plugins`, `/api/extensions/plugins/refresh`, `/api/extensions/plugins/install`, `/api/extensions/plugins/:id/enable`, `/api/extensions/plugins/:id/disable`, `/api/extensions/plugins/:id/rollback`
  - Reports git update state, npm audit metadata when available, and plugin manifests from a controlled plugin directory.
  - Installs `.tgz` plugin packages only after sha256/package verification, snapshots existing plugin directories before changes, supports enable/disable, and can roll back to the latest saved snapshot.

- **Web Disk / WebDAV**
  - API: `/api/webdav`, `/api/webdav/provision`, `/api/webdav/config-preview`, `/api/webdav/reload`
  - Stores WebDAV account metadata, validates paths under `/var/www`, maintains htpasswd-compatible password entries, writes managed Apache DAV config, provisions Apache/httpd-tools packages, and reloads httpd.

- **DNS clustering and nameserver automation**
  - API: `/api/dns-cluster/nodes`, `/api/dns-cluster/health-check`, `/api/dns-cluster/sync-preview`, `/api/dns-cluster/sync`, `/api/dns-cluster/nameserver-plan`
  - Adds node registry, health checks, zone sync dry-runs, authenticated `rndc retransfer` execution with temporary key files, and nameserver record planning.

- **Full account transfer/import**
  - API: `/api/transfer-import`, `/api/transfer-import/inspect`, `/api/transfer-import/:id`, `/api/transfer-import/:id/execute`
  - Adds cPanel archive inspection plus guarded execution that extracts to staging, restores `homedir/public_html` with rollback points, upserts HostPanel account records, imports MySQL SQL dumps, and tracks progress in the import report.

- **Guided backup wizard foundation**
  - UI: `/cpanel-parity`
  - Calls existing `/api/backup/create` using guided presets for file/home and database backups.

- **phpMyAdmin integration**
  - UI: `/cpanel-parity`, admin Database Manager, and client portal Databases page.
  - API: `/api/databases/phpmyadmin`, `/api/databases/phpmyadmin/install`, `/api/databases/phpmyadmin/account-scope`, `/api/portal/phpmyadmin`.
  - Detects installed phpMyAdmin, can install the package via `dnf`, writes a managed Apache alias, reloads Apache, and generates account/database-scoped launch links while enforcing reseller/client feature permissions.

## Remaining build-out after this foundation

These areas need deeper production hardening beyond the new API/UI foundations:

- Remaining team subaccount hardening: account-level domain/resource narrowing for every portal route and audit log attribution with team user IDs.
- Feature-list enforcement middleware on existing account, reseller, portal, and navigation actions.
- Backup wizard restore dry-run UI and selective restore execution.
- phpMyAdmin SSO-style handoff is not implemented; current behavior is package install/detection plus account/database-scoped launch links.

## Verification

Every parity foundation route has a Vitest integration test. Full verification command:

```bash
npm run build
npm test --workspaces --if-present
```
