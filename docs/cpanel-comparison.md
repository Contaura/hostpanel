# HostPanel vs. cPanel/WHM Functionality Comparison

This comparison separates cPanel-style end-user features from WHM-style administrator features and reflects the current deployed HostPanel parity work.

## Summary

HostPanel now covers the main shared-hosting control-plane areas: accounts, packages/feature lists, reseller privileges, domains, DNS, files, FTP, databases, phpMyAdmin launch/Signon handoff, email accounts/forwarders/autoresponders, Track Delivery-style mail tracing, SSL, backups/restores, cron, PHP, logs, resource limits, billing, reseller/client portal, security, WAF/Fail2Ban, plugin controls, WebDAV, DNS clustering, and transfer/import tooling.

cPanel/WHM is still broader and older, so the remaining gap is mostly production depth: richer analytics/report exports, extending the centralized background-job/progress subsystem into the remaining scans/app installs/edge operations, field-validating phpMyAdmin Signon after distro package updates, and ongoing hardening/regression coverage.

## End-user / cPanel-side comparison

| Area | cPanel capability | HostPanel status | Notes / gaps |
| --- | --- | --- | --- |
| Files | File Manager, FTP Accounts, Directory Privacy, Disk Usage, Web Disk, Backup Wizard | Strong foundation | File Manager, FTP, htpasswd/directory privacy, disk usage, WebDAV/Web Disk metadata/provisioning, backup creation, restore planning, dry-runs, selective restores, and execution are wired to real APIs. |
| Domains | Domains, Addon Domains, Subdomains, Aliases/Parked Domains, Redirects, Zone Editor | Strong | HostPanel has domain/subdomain/addon/parked/redirect/DNS screens. DNS zone editor depth can keep expanding toward mature cPanel ergonomics. |
| Email | Email Accounts, Forwarders, Autoresponders, Default Address, Spam Filters, Email Deliverability, Mail Routing, Track Delivery, Address Importer | Strong foundation | HostPanel has creation/configuration tools, CSV address importer, DKIM/mail routing/spam tooling, and Track Delivery-style log search. Remaining depth is richer filters, exports, and historical reporting. |
| Databases | MySQL Databases, Database Users, phpMyAdmin | Strong foundation | Database management, phpMyAdmin install/detection, account-scoped links, and short-lived Signon handoff endpoint are implemented. Signon still needs live validation against the exact installed phpMyAdmin package/config. |
| Metrics | Visitors, Errors, Bandwidth, Raw Access, Awstats/Webalizer, resource metrics | Functional foundation | Visitor, error, bandwidth, raw-access, and Awstats/Webalizer-style summaries exist. Remaining depth is charts, exports, retention controls, and more log-format coverage. |
| Security | SSL/TLS, SSH Keys, IP Blocker, Hotlink Protection, Leech Protection, ModSecurity, Two-Factor Authentication | Strong | SSL/TLS, SSH keys, firewall/IP blocking, hotlink protection, WAF/Fail2Ban, scanner, API tokens, audit log, and client 2FA are present. Leech-protection-style UX remains a potential polish item. |
| Software | PHP selector/options, MultiPHP, app installers, WordPress, Node apps, Git deploy | Strong | HostPanel has PHP management, app/script installer, WordPress, Node apps, Git deploy, and cache controls. Ruby/Perl tools remain outside current scope. |
| Preferences | Password/contact info, language/style, user manager/team access | Strong foundation | Profile/settings and team subaccounts are implemented with hashed credentials, permissions, client-portal login, account scoping, and audit attribution. More regression tests should be added as portal modules expand. |

## Administrator / WHM-side comparison

| Area | WHM capability | HostPanel status | Notes / gaps |
| --- | --- | --- | --- |
| Account lifecycle | Create/suspend/terminate accounts, packages, quotas, skeleton dir | Strong foundation | Account and resource-limit tooling exists; WHM-style feature lists and broad reseller feature enforcement are now wired. Skeleton-dir/template depth can be expanded. |
| Reseller management | Reseller ownership, limits, privileges | Strong foundation | Reseller UI/routes and broad fine-grained privilege gates are present. Continue adding regression coverage as new modules are added. |
| Server status | Service status, process manager, server info, system monitor | Strong | HostPanel includes server info, stats, process manager, logs, alerts, and monitor views. |
| DNS | Zone management, DNS clustering, nameserver setup | Strong foundation | DNS management, node registry, health checks, sync dry-runs, authenticated `rndc retransfer`, and nameserver planning are implemented. |
| Mail server admin | Queue manager, routing, DKIM, Rspamd/SpamAssassin, delivery reports | Strong foundation | Queue/routing/DKIM/spam tooling and Track Delivery-style reports exist. Remaining depth is richer Exim-like views and exports. |
| Security center | Firewall, WAF, Fail2Ban, malware scanner, API tokens, audit log | Strong | HostPanel has firewall, WAF, Fail2Ban, scanner, API tokens, audit logging, and admin users. |
| Transfers/backups | Backup config, account restores, transfer tool | Strong foundation | Backup management, restore plans/dry-runs/execution, guarded cPanel archive transfer/import with rollback/progress, and centralized background jobs for backup creation/restores and transfer execution are implemented. |
| Branding/billing/client portal | cPanel branding, packages, billing integrations | Strong for HostPanel's target | HostPanel includes branding/settings, billing, Stripe/PayPal, reseller/client portal, and team access. |
| Updates/extensions | cPanel update channels, EasyApache, plugins | Functional foundation | HostPanel reports git/npm audit status and supports verified `.tgz` plugin install, enable/disable, snapshots, and rollback. WHM-grade update channels/EasyApache remain outside current scope. |

## Remaining priority work

1. Validate phpMyAdmin Signon end-to-end against the live installed phpMyAdmin package/config.
2. Extend centralized background-job/progress/log tracking into the remaining scans, app installs, and smaller edge operations; backup create/restore, transfer execution, DNS sync, WebDAV provision/reload, and plugin install/rollback are already wired.
3. Deepen metrics/mail reports with charts, exports, retention, and more filters.
4. Continue adding account-scope/team-subaccount regression tests as portal modules grow.
5. Keep hardening service-command routes to the safe argv/Node-primitive pattern and avoid shell pipelines.
