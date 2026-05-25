# cPanel/WHM Parity Status

This document tracks implementation of the requested cPanel/WHM parity areas.

## Implemented foundations in this release

- **WHM-style feature catalog / feature lists**
  - API: `/api/feature-lists/catalog`, `/api/feature-lists`, `/api/feature-lists/effective/:planId`
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

## Remaining build-out after this foundation

These areas need controlled OS/service integration beyond the API foundations:

- Web Disk / WebDAV account config generation and service enablement.
- Team subaccounts with scoped middleware enforcement.
- Guided backup wizard UI tied into existing backup execution/restore code.
- phpMyAdmin detection, safe links, and database privilege integration.
- Full cPanel backup transfer/import dry-run and restore executor.
- DNS clustering with node registry, TSIG validation, and zone sync dry-run/execution.
- Nameserver automation wizard and health checks.
- Granular reseller privilege enforcement using the feature catalog.

## Verification

Every parity foundation route has a Vitest integration test. Full verification command:

```bash
npm run build
npm test --workspaces --if-present
```
