# Resellers (WHM)

HostPanel includes a WHM-style reseller system. Resellers get their own login and manage hosting accounts within the limits allocated to them by the superadmin.

---

## Creating a Reseller Account

Go to **Resellers (WHM) → New Reseller** and fill in:

| Field | Description |
|---|---|
| Username | Login username (must be unique across all admin users) |
| Email | Reseller's email address |
| Password | Minimum 8 characters |
| Company | Optional company name displayed in the panel |

### Allocations

Set the resource limits the reseller is allowed to distribute to their clients:

| Allocation | Unit | Description |
|---|---|---|
| `alloc_disk` | MB | Total disk space the reseller can allocate |
| `alloc_bandwidth` | MB | Monthly bandwidth pool |
| `alloc_accounts` | count | Maximum hosting accounts they can create |
| `alloc_emails` | count | Maximum email accounts across all their accounts |
| `alloc_dbs` | count | Maximum databases across all their accounts |

---

## Reseller Login

Resellers log in at the same URL as the admin panel (`http://<server-ip>:3001`) using their own username and password. Their JWT token carries `role: "reseller"` and the panel shows only the features relevant to their scope.

---

## Editing Allocations

Click the **Edit** (pencil) icon on any reseller card to adjust their allocations. Changes take effect immediately.

---

## Deleting a Reseller

Clicking **Delete** removes both the reseller record and the associated admin user login. The hosting accounts the reseller created are **not** deleted — they remain in the system and can be managed by a superadmin.

---

## Reseller Summary

The `GET /api/resellers/:id/summary` endpoint returns the reseller's current usage versus their allocations. This is used internally to enforce limits and can be queried via the API.

---

## Notes

- Resellers share the same SQLite database and services as the main admin.
- There is currently no reseller-specific dashboard — resellers see the full panel scoped to their accounts. A scoped view is planned for a future release.
- A reseller's `alloc_*` values are advisory limits enforced at the API level, not at the OS level.
