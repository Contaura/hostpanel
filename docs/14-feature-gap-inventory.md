# HostPanel Feature Gap Inventory

Last audited: 2026-06-07

This inventory is intentionally stricter than the broad parity/status documents. A module being present in the UI or API does **not** mean it has cPanel/WHM-level depth. HostPanel has many real wired foundations, but Marcos is right: a lot of production-grade hosting-panel functionality is still missing or shallow.

## Current reality

- The deployed service is healthy, builds successfully, and has a real API/UI surface.
- The repository currently exposes hundreds of backend route handlers and dozens of admin/client-portal pages.
- Placeholder search did not find obvious mock-only modules, but that is not the same thing as feature completeness.
- Many modules are control-plane foundations: they perform real actions, but still lack the full workflow depth, validation, reporting, automation, and edge-case coverage expected from a mature cPanel/WHM replacement.

## Highest-priority missing or shallow areas

### P0 — Must close before broad public rollout

1. **WordPress/script installs need centralized async job execution**
   - Current install/update operations can exceed normal request time.
   - Need job records, progress events, logs, retry/failure states, and portal/admin polling for wp-cli and script installer flows.

2. **Fresh-install/bootstrap validation needs repeated hardening**
   - Every system-level feature must be idempotently installed by `install.sh`, not only by manual post-install fixes.
   - Need a repeatable fresh-server install test/checklist for Apache aliases, phpMyAdmin Signon, service units, headers, token dirs, package dependencies, permissions, and firewall assumptions.

3. **End-to-end live validation for destructive workflows**
   - Backups, restores, transfer/import, DNS sync, WebDAV reloads, plugin rollback, and WordPress install flows need live drill evidence, not only mocked/integration-path tests.
   - Need production-safe dry-runs plus rollback verification for each destructive path.

4. **Authorization/team-scope regression expansion**
   - Existing coverage is good, but every newly exposed client-portal module must prove same-client/different-account and different-client isolation.
   - Team-subaccount permissions need regression coverage per module as portal features expand.

5. **Monitoring/alerting must cover user-visible failures, not only service liveness**
   - Existing health/watchdog checks should expand into job-failure alerts, backup age checks, disk/mail-queue thresholds, cert expiry, DNS sync failures, and payment/webhook failures.

### P1 — Needed for credible cPanel/WHM replacement depth

1. **Metrics and mail reporting UX**
   - Backend data exists for analytics and mail trace, but the frontend still needs richer time-series charts, drilldowns, retention controls, CSV UX, and clearer empty/error states.

2. **Email administration depth**
   - Need more Exim/cPanel-like delivery views, queue search/filter ergonomics, spam-policy management depth, per-domain deliverability diagnostics, and historical trend reporting.

3. **DNS editor ergonomics and safety**
   - Need richer record validation, bulk edits/import/export, zone backups, safer diff previews, DNSSEC ergonomics, and better nameserver/glue guidance.

4. **Account/package lifecycle completeness**
   - Need deeper package templating, skeleton directories, quota enforcement evidence, account move/rename flows, service-level provisioning checks, and stronger suspension/unsuspension side-effect verification.

5. **Backup scheduling and remote storage maturity**
   - Need stronger remote-target validation, schedule run history, retention enforcement evidence, restore drill reports, encryption options, and failure alerts.

6. **Application/runtime support breadth**
   - Node/Python/WordPress exist, but mature hosting panels also cover clearer app lifecycle state, logs, environment management, staging/promote history, and possibly additional runtimes if in scope.

7. **Payment/billing operations depth**
   - Billing exists, but production billing needs dunning, retries, taxes, credits/refunds, subscription lifecycle sync, dispute/webhook auditing, invoice email delivery validation, and client self-service hardening.

### P2 — Later parity / market-depth work

1. **WHM-grade update channels / EasyApache-style stack management**
   - HostPanel reports updates and has plugin controls, but does not yet replace WHM update tiers or EasyApache profile management.

2. **Multi-server / clustering beyond DNS**
   - Need service-aware multi-node management if the product is expected to manage fleets, not only one server plus DNS nodes.

3. **Migration breadth**
   - cPanel archive import exists, but broader migration should include more archive variants, email/mailbox restore depth, DNS zone edge cases, incremental sync, and migration reports.

4. **Plugin marketplace ecosystem**
   - Verified tgz plugin install/rollback exists, but a real marketplace needs signing policy, compatibility constraints, dependency handling, UI distribution, and update channels.

5. **UX polish across all modules**
   - Bulk actions, filters, pagination, inline validation, job timelines, actionable errors, and documentation links need consistent treatment across the app.

## Working definition of “feature complete” going forward

A HostPanel feature should not be called complete until it has:

1. Real backend behavior with no fake/mocked side effects.
2. Frontend UI wired to the real endpoint and authoritative state.
3. Permission/feature-list enforcement for admin, reseller, client, and team users where applicable.
4. Dry-run/preview for destructive operations.
5. Progress/job tracking for long-running operations.
6. Regression tests for success, failure, and authorization boundaries.
7. Fresh-install/bootstrap coverage when system packages/config are required.
8. Deployment verification on the production server.
9. Documentation/runbook notes for operations and rollback.

## Next recommended build slices

1. Move WordPress/wp-cli and script installer operations to persisted background jobs.
2. Add analytics/mail frontend charts and export UX polish.
3. Add live drill automation/reporting for backup restore and transfer/import.
4. Expand portal/team authorization tests module-by-module.
5. Add backup age, cert expiry, job-failure, disk, mail-queue, and DNS-sync watchdog checks.
