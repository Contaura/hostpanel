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
  - API: `/api/extensions/updates`, `/api/extensions/plugins`, `/api/extensions/plugins/refresh`
  - Reports git update state, npm audit metadata when available, and plugin manifests from a controlled plugin directory.

- **Web Disk / WebDAV foundation**
  - API: `/api/webdav`, `/api/webdav/config-preview`, `/api/webdav/reload`
  - Stores WebDAV account metadata, validates paths under `/var/www`, and previews Apache DAV config before reload.

- **DNS clustering and nameserver automation foundation**
  - API: `/api/dns-cluster/nodes`, `/api/dns-cluster/health-check`, `/api/dns-cluster/sync-preview`, `/api/dns-cluster/nameserver-plan`
  - Adds node registry, health checks, zone sync dry-runs, and nameserver record planning.

- **Full account transfer/import foundation**
  - API: `/api/transfer-import`, `/api/transfer-import/inspect`
  - Adds cPanel archive dry-run inspection with execution intentionally gated.

- **Guided backup wizard foundation**
  - UI: `/cpanel-parity`
  - Calls existing `/api/backup/create` using guided presets for file/home and database backups.

- **phpMyAdmin integration UI**
  - UI: `/cpanel-parity`
  - Uses existing `/api/databases/phpmyadmin` detection and provides a safe launch link when installed.

## Remaining build-out after this foundation

These areas need deeper production hardening beyond the new API/UI foundations:

- Remaining team subaccount hardening: account-level domain/resource narrowing for every portal route and audit log attribution with team user IDs.
- Feature-list enforcement middleware on existing account, reseller, portal, and navigation actions.
- WebDAV password-file management and automated Apache/Nginx DAV package/service provisioning.
- Backup wizard restore dry-run UI and selective restore execution.
- phpMyAdmin SSO-style handoff is not implemented; current behavior is detection + safe link.
- Transfer/import execution remains intentionally gated after dry-run inspection.
- DNS clustering needs signed authenticated remote sync execution after node trust is established.
- Plugin install/enable/disable still needs package signature verification and rollback support.

## Verification

Every parity foundation route has a Vitest integration test. Full verification command:

```bash
npm run build
npm test --workspaces --if-present
```
