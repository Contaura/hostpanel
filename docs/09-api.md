# API Reference

All admin API routes are prefixed with `/api/` and require a Bearer token in the `Authorization` header, unless noted otherwise.

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/billing/invoices
```

Tokens are obtained from `POST /api/auth/login` or created via **Admin → API Tokens**.

---

## Authentication

### `POST /api/auth/login`

No auth required.

**Body:**
```json
{ "username": "admin", "password": "yourpassword", "totp_token": "123456" }
```

`totp_token` is only required if 2FA is enabled for the account.

**Response (2FA not enabled):**
```json
{ "token": "<jwt>", "user": { "id": 1, "username": "admin", "role": "superadmin" } }
```

**Response (2FA required, token not provided):**
```json
{ "requires2FA": true }
```

---

## Billing

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/billing/plans` | List hosting plans |
| `POST` | `/api/billing/plans` | Create plan |
| `PUT` | `/api/billing/plans/:id` | Update plan |
| `DELETE` | `/api/billing/plans/:id` | Delete plan |
| `GET` | `/api/billing/clients` | List clients with balances |
| `POST` | `/api/billing/clients` | Create client |
| `PUT` | `/api/billing/clients/:id` | Update client |
| `DELETE` | `/api/billing/clients/:id` | Delete client |
| `POST` | `/api/billing/clients/:id/portal-password` | Set client portal password |
| `GET` | `/api/billing/invoices` | List all invoices |
| `GET` | `/api/billing/invoices/:id` | Invoice + payment history |
| `POST` | `/api/billing/invoices` | Create invoice |
| `PATCH` | `/api/billing/invoices/:id/status` | Update invoice status |
| `DELETE` | `/api/billing/invoices/:id` | Delete invoice |
| `GET` | `/api/billing/invoices/:id/pdf` | Download PDF (streams) |
| `POST` | `/api/billing/invoices/:id/email` | Email invoice to client |
| `POST` | `/api/billing/payments` | Record manual payment |
| `GET` | `/api/billing/summary` | Dashboard summary stats |
| `GET` | `/api/billing/recurring` | List recurring schedules |
| `POST` | `/api/billing/recurring` | Create schedule |
| `PUT` | `/api/billing/recurring/:id` | Update schedule |
| `DELETE` | `/api/billing/recurring/:id` | Delete schedule |
| `POST` | `/api/billing/recurring/:id/run` | Generate invoice now |
| `GET` | `/api/billing/credit-notes` | List credit notes |
| `POST` | `/api/billing/credit-notes` | Create credit note |
| `PATCH` | `/api/billing/credit-notes/:id/apply` | Apply to an invoice |
| `DELETE` | `/api/billing/credit-notes/:id` | Delete credit note |
| `GET` | `/api/billing/promo-codes` | List promo codes |
| `POST` | `/api/billing/promo-codes` | Create promo code |
| `POST` | `/api/billing/promo-codes/validate` | Validate a code |
| `PUT` | `/api/billing/promo-codes/:id` | Toggle active / update |
| `DELETE` | `/api/billing/promo-codes/:id` | Delete promo code |

---

## Hosting Accounts

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/accounts` | List accounts |
| `POST` | `/api/accounts` | Create account |
| `PUT` | `/api/accounts/:id` | Update account |
| `DELETE` | `/api/accounts/:id` | Delete account |
| `POST` | `/api/accounts/:id/suspend` | Suspend account |
| `POST` | `/api/accounts/:id/unsuspend` | Unsuspend account |

---

## Notifications

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/notifications` | List notification channels |
| `POST` | `/api/notifications` | Create channel |
| `PUT` | `/api/notifications/:id` | Update channel |
| `DELETE` | `/api/notifications/:id` | Delete channel |
| `POST` | `/api/notifications/:id/test` | Send test notification |
| `GET` | `/api/notifications/events` | List all event names |

---

## Git Deployments

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/git-deploy` | List deployments |
| `POST` | `/api/git-deploy` | Create deployment |
| `PUT` | `/api/git-deploy/:id` | Update deployment |
| `DELETE` | `/api/git-deploy/:id` | Delete deployment |
| `POST` | `/api/git-deploy/:id/deploy` | Manual deploy |
| `POST` | `/api/git-deploy/webhook/:name` | Public webhook (no auth, HMAC verified) |

### Webhook verification

Incoming webhook requests must include an `X-Hub-Signature-256` header containing `sha256=<hmac>` where the HMAC is computed over the raw request body using the deployment's `webhook_secret`.

---

## DNS Cluster

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dns-cluster/nodes` | List cluster nodes without exposing stored TSIG secrets |
| `POST` | `/api/dns-cluster/nodes` | Create/update node with optional `tsig_name` and `tsig_secret` |
| `DELETE` | `/api/dns-cluster/nodes/:id` | Remove node |
| `POST` | `/api/dns-cluster/health-check` | Probe enabled nodes with `dig` |
| `POST` | `/api/dns-cluster/sync-preview` | Preview `rndc retransfer` actions without secrets |
| `POST` | `/api/dns-cluster/sync` | Execute authenticated `rndc retransfer`; pass `async: true` to enqueue `dns.sync` |
| `POST` | `/api/dns-cluster/nameserver-plan` | Generate NS/A record and registrar glue plan |

---

## Databases

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/databases/databases` | List server databases with sizes |
| `POST` | `/api/databases/databases` | Create database |
| `DELETE` | `/api/databases/databases/:name` | Drop database |
| `GET` | `/api/databases/users` | List database users |
| `POST` | `/api/databases/users` | Create database user and optional grant |
| `DELETE` | `/api/databases/users/:user` | Drop database user |
| `GET` | `/api/databases/phpmyadmin` | Detect phpMyAdmin install and managed launch URL |
| `POST` | `/api/databases/phpmyadmin/install` | Install phpMyAdmin via `dnf`, write Apache alias config, reload Apache |
| `GET` | `/api/databases/phpmyadmin/account-scope` | Return account/database-scoped phpMyAdmin URL plus owned database/user lists |
| `POST` | `/api/databases/phpmyadmin/sso` | Verify supplied DB credentials and mint a short-lived one-time phpMyAdmin Signon bridge URL |
| `GET` | `/api/portal/phpmyadmin` | Client portal phpMyAdmin status and account-scoped launch URL |

---

## Resellers

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/resellers` | List resellers |
| `POST` | `/api/resellers` | Create reseller |
| `PUT` | `/api/resellers/:id` | Update allocations |
| `DELETE` | `/api/resellers/:id` | Delete reseller |
| `GET` | `/api/resellers/:id/summary` | Usage summary |

---

## Security

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/security-extra/2fa` | 2FA status |
| `POST` | `/api/security-extra/2fa/setup` | Generate TOTP secret + QR |
| `POST` | `/api/security-extra/2fa/verify` | Enable 2FA |
| `DELETE` | `/api/security-extra/2fa` | Disable 2FA |
| `POST` | `/api/security-extra/change-password` | Change admin password |
| `GET` | `/api/security-extra/ip-whitelist` | List whitelisted IPs |
| `POST` | `/api/security-extra/ip-whitelist` | Add IP |
| `DELETE` | `/api/security-extra/ip-whitelist/:id` | Remove IP |
| `GET` | `/api/audit-log` | Paginated audit log |
| `DELETE` | `/api/audit-log/clear` | Purge entries older than 90 days |

---

## Cache

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cache/opcache` | OPcache status |
| `POST` | `/api/cache/opcache/flush` | Flush OPcache |
| `GET` | `/api/cache/redis` | Redis info |
| `POST` | `/api/cache/redis/flush` | Flush Redis (FLUSHALL) |
| `POST` | `/api/cache/redis/start` | Start Redis service |
| `POST` | `/api/cache/redis/stop` | Stop Redis service |
| `GET` | `/api/cache/memcached` | Memcached stats |
| `POST` | `/api/cache/memcached/flush` | Flush Memcached |

---

## Cloudflare

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cloudflare` | List managed zones |
| `POST` | `/api/cloudflare` | Import zones from API token |
| `DELETE` | `/api/cloudflare/:id` | Remove zone from HostPanel |
| `GET` | `/api/cloudflare/:id/analytics` | Zone analytics (last 7 days) |
| `GET` | `/api/cloudflare/:id/dns` | DNS records |
| `PATCH` | `/api/cloudflare/:id/dns/:recordId/proxy` | Toggle orange-cloud proxy |
| `POST` | `/api/cloudflare/:id/purge` | Purge entire cache |
| `PATCH` | `/api/cloudflare/:id/pause` | Pause / unpause zone |

---

## Backup

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/backup/list` | List local backups |
| `POST` | `/api/backup/create` | Create file or database backup; pass `async: true` to enqueue a background job and poll `/api/jobs/:id` |
| `GET` | `/api/backup/restore/:name/plan` | Inspect restore plan/dry-run metadata |
| `POST` | `/api/backup/restore/:name` | Run dry-run or execute full/selective restore; pass `async: true` for non-dry-run restore jobs |

---

## Background Jobs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/jobs` | List recent background jobs; optional `status` and `type` filters |
| `GET` | `/api/jobs/:id` | Fetch job status, progress percentage, result, error, and structured log entries |

---

## WebDAV

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/webdav` | List WebDAV accounts |
| `POST` | `/api/webdav` | Create/update WebDAV account, password file, and Apache config |
| `POST` | `/api/webdav/provision` | Install/enable Apache DAV prerequisites, render config, reload httpd; supports `async: true` |
| `GET` | `/api/webdav/config-preview` | Preview generated Apache DAV config |
| `POST` | `/api/webdav/reload` | Re-render config and reload httpd; supports `async: true` |
| `DELETE` | `/api/webdav/:id` | Remove WebDAV account/password entry and reload config |

---

## Extensions / Plugins

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/extensions/updates` | Git and npm-audit update status |
| `GET` | `/api/extensions/plugins` | List plugin manifests and available rollback snapshots |
| `POST` | `/api/extensions/plugins/refresh` | Re-read plugin manifests |
| `POST` | `/api/extensions/plugins/install` | Verify sha256 and install `.tgz` plugin package with rollback snapshot; supports `async: true` |
| `POST` | `/api/extensions/plugins/:id/enable` | Enable plugin with rollback snapshot |
| `POST` | `/api/extensions/plugins/:id/disable` | Disable plugin with rollback snapshot |
| `POST` | `/api/extensions/plugins/:id/rollback` | Restore latest or requested rollback snapshot; supports `async: true` |

---

## Transfer Imports

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/transfer-import` | List inspected/executed transfer imports and progress reports |
| `POST` | `/api/transfer-import/inspect` | Inspect cPanel archive and build executable import report |
| `GET` | `/api/transfer-import/:id` | Read one import status/progress report |
| `POST` | `/api/transfer-import/:id/execute` | Execute guarded import with `confirm=true`, file rollback point, account upsert, and SQL import; supports `async: true` |

---

## Common Response Formats

**Success:**
```json
{ "success": true }
```

**Error:**
```json
{ "error": "Human-readable error message" }
```

**Validation error (400):**
```json
{ "error": "field_name required" }
```

**Conflict (409):**
```json
{ "error": "Username or email already exists" }
```

All timestamps are ISO 8601 strings. All money values are stored and returned as decimal numbers with 2 decimal places.
