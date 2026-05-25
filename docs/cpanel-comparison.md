# HostPanel vs. cPanel/WHM Functionality Comparison

This comparison separates cPanel-style end-user features from WHM-style administrator features and tracks where HostPanel currently matches, partially matches, or still needs work.

## Summary

HostPanel already covers the core shared-hosting control-plane areas: accounts, domains, DNS, files, FTP, databases, email accounts/forwarders/autoresponders, SSL, backups, cron, PHP, logs, resource limits, billing, reseller/client portal, security, WAF/Fail2Ban, and app installers. cPanel/WHM is still broader and deeper in several mature hosting areas: full DNS clustering, package/feature-list enforcement, transfer/migration tooling, per-account analytics depth, mail delivery tracing, web disk, team/subaccount delegation, and a wider set of Apache/site behavior tools.

## End-user / cPanel-side comparison

| Area | cPanel capability | HostPanel status | Notes / gaps |
| --- | --- | --- | --- |
| Files | File Manager, FTP Accounts, Directory Privacy, Disk Usage, Web Disk, Backup Wizard | Partial | File Manager, FTP, htpasswd/directory privacy, backups, and disk usage exist. Web Disk/WebDAV and guided backup wizard remain missing. |
| Domains | Domains, Addon Domains, Subdomains, Aliases/Parked Domains, Redirects, Zone Editor | Strong | HostPanel has domain/subdomain/addon/parked/redirect/DNS screens. DNS zone editor depth should keep expanding toward cPanel parity. |
| Email | Email Accounts, Forwarders, Autoresponders, Default Address, Spam Filters, Email Deliverability, Mail Routing, Track Delivery, Address Importer | Partial/Strong | Most creation/configuration tools exist. This change adds a CSV Address Importer for forwarders. Track Delivery-style per-message tracing is still missing. |
| Databases | MySQL Databases, Database Users, phpMyAdmin | Partial | Database management exists. phpMyAdmin/one-click DB GUI integration and finer privilege workflows should be verified before parity claims. |
| Metrics | Visitors, Errors, Bandwidth, Raw Access, Awstats/Webalizer, resource metrics | Partial | HostPanel has stats, logs, bandwidth, and monitor views. cPanel's visitor/error reports and Awstats/Webalizer depth are not fully matched. |
| Security | SSL/TLS, SSH Keys, IP Blocker, Hotlink Protection, Leech Protection, ModSecurity, Two-Factor Authentication | Partial/Strong | Many security tools exist. User-level 2FA and richer IP blocker workflows should be completed for parity. |
| Software | PHP selector/options, MultiPHP, app installers, WordPress, Node apps, Git deploy | Strong | HostPanel has PHP management, app/script installer, WordPress, Node apps, and Git deploy. Ruby/Perl tools remain outside current scope. |
| Preferences | Password/contact info, language/style, user manager/team access | Partial | Profile/settings exist. cPanel-style User Manager/team delegation is still missing. |

## Administrator / WHM-side comparison

| Area | WHM capability | HostPanel status | Notes / gaps |
| --- | --- | --- | --- |
| Account lifecycle | Create/suspend/terminate accounts, packages, quotas, skeleton dir | Partial/Strong | Account and resource-limit tooling exists. Package/feature-list enforcement needs more WHM-like depth. |
| Reseller management | Reseller ownership, limits, privileges | Partial | Reseller UI/routes exist. Fine-grained privilege enforcement should continue expanding. |
| Server status | Service status, process manager, server info, system monitor | Strong | HostPanel includes server info, stats, process manager, logs, alerts, and monitor views. |
| DNS | Zone management, DNS clustering, nameserver setup | Partial | DNS management exists. DNS clustering/nameserver automation is a major missing WHM feature. |
| Mail server admin | Queue manager, routing, DKIM, Rspamd/SpamAssassin, delivery reports | Partial/Strong | Queue/routing/DKIM/spam tooling exists. Deep delivery tracing and Exim-style reports remain gaps. |
| Security center | Firewall, WAF, Fail2Ban, malware scanner, API tokens, audit log | Strong | HostPanel has firewall, WAF, Fail2Ban, scanner, API tokens, audit logging, and admin users. |
| Transfers/backups | Backup config, account restores, transfer tool | Partial | Backup management exists. Full cPanel account import/transfer tooling remains missing. |
| Branding/billing/client portal | cPanel branding, packages, billing integrations | Strong for HostPanel's target | HostPanel includes branding/settings, billing, Stripe/PayPal, reseller/client portal. |
| Updates/extensions | cPanel update channels, EasyApache, plugins | Partial | HostPanel has install/upgrade docs and app tooling, but not a WHM-grade update/plugin ecosystem yet. |

## Prioritized missing features

1. **Address Importer** — bulk import email forwarders/accounts from CSV. Implemented first for forwarders in this change because it is safe, useful, and maps directly to existing Postfix virtual alias storage.
2. **Track Delivery** — mail delivery trace/search across logs by sender, recipient, status, and queue ID.
3. **User Manager / team delegation** — user-level subaccounts with scoped access to email/FTP/Web Disk.
4. **Web Disk/WebDAV** — cPanel-compatible Web Disk-style access for user file areas.
5. **Metrics depth** — visitor report, 404/error report, raw access downloads, and Awstats/Webalizer-style summaries.
6. **Transfer tool** — import from cPanel backup archives or remote accounts.
7. **WHM feature lists/packages** — enforce feature visibility/permissions per plan/package, not just resource limits.
8. **DNS clustering/nameserver automation** — multi-server DNS sync and nameserver health tooling.

## Implemented in this pass

- Added a cPanel-style **Address Importer** under Email Extras.
- Added `POST /api/email-extras/import/forwarders`.
- Supported CSV headers: `source,destination`, `from,to`, `email,forward_to`, and similar variants.
- Skips duplicate source addresses.
- Reports row-level validation errors without aborting the whole import.
- Added integration tests for successful imports, duplicate skipping, and all-invalid payload rejection.
