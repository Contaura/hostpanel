# Production Readiness Log

This document tracks production-readiness work performed on HostPanel. Every entry should include the risk addressed, files changed, validation performed, and any follow-up work.

## 2026-05-25 — SSRF hardening for webhook targets

### Risk addressed

HostPanel allows administrators to configure outbound webhook targets. Those URLs are validated by `server/src/utils/safe-target.ts` to reduce Server-Side Request Forgery (SSRF) risk. Node.js keeps brackets in `URL.hostname` for IPv6 literals, for example `[::1]`. The previous validation passed that bracketed string directly to `net.isIP()`, which returns `0` for bracketed IPv6 values. As a result, bracketed IPv6 loopback, unique-local, and IPv4-mapped literals could bypass the private-address blocklist.

### Changes made

- Added a server-side Vitest test script: `npm run test --workspace=server`.
- Added regression coverage in `server/src/utils/safe-target.test.ts` for:
  - IPv4 loopback targets.
  - Bracketed IPv6 loopback targets.
  - Bracketed IPv6 unique-local targets.
  - IPv4-mapped IPv6 literals.
- Updated `server/src/utils/safe-target.ts` to normalize hostnames before IP checks by:
  - Lowercasing host names.
  - Removing URL IPv6 brackets.
  - Removing IPv6 zone IDs.
  - Checking normalized hostnames with `net.isIP()`.
  - Treating IPv4-mapped IPv6 literals as blocked.

### Validation performed

```bash
npm run test --workspace=server -- safe-target
npm run build
```

Both commands passed. The frontend build still reports existing Vite warnings about the CJS Node API, PostCSS module type, and large bundle size; no build failure was introduced.

### Follow-up

- Add broader route-level tests for webhook senders that call `assertHttpTargetAllowed()`.
- Continue reviewing all routes that execute shell commands or write system configuration as `root`.
- Add CI so tests and builds run automatically before merge/deploy.

## 2026-05-25 — CI and dependency audit baseline

### Risk addressed

HostPanel did not have a repository-level CI workflow, so production-readiness checks depended on manual execution on the server. The dependency audit also reported moderate vulnerabilities in production and development dependency trees.

### Changes made

- Added `.github/workflows/ci.yml` to run on pushes and pull requests to `master`.
- CI now installs dependencies with `npm ci`, runs server tests, builds the server/client, and fails on moderate-or-higher production or development dependency vulnerabilities.
- Ran `npm audit fix --omit=dev` to update the vulnerable transitive `qs` dependency.
- Removed the direct `uuid` server dependency because it was unused in `server/src` and its advisory required a semver-major upgrade.
- Upgraded client Vite to `^6.4.2`, clearing the dev dependency advisories without jumping to Vite 8.

### Validation performed

```bash
npm audit --omit=dev
npm audit
npm run test --workspace=server
npm run build
```

All audit, test, and build checks passed with zero reported npm vulnerabilities. The frontend build still reports the existing large bundle warning.

### Follow-up

- Consider adding branch protection once GitHub Actions is confirmed green on GitHub.
- Add linting once an ESLint/Prettier policy is selected.
- Add targeted integration tests for authenticated routes and dangerous root-level operations.
