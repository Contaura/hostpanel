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

## 2026-05-25 — File manager symlink escape hardening

### Risk addressed

The file manager already normalized paths under `FILES_BASE_DIR`, but filesystem operations can still escape a base directory through symlinks that live inside the base. For example, a symlink under `/var/www` could point to `/etc/passwd` or another sensitive location. Because HostPanel runs as root, file-manager reads, writes, downloads, archive operations, deletes, and chmod operations must validate the real filesystem target, not just the lexical path string.

### Changes made

- Added `server/src/utils/file-path.ts` with shared file-manager path helpers:
  - `resolveInsideBase()` for lexical base-directory containment and shell-metacharacter rejection.
  - `assertSafeFileTarget()` for realpath validation of existing targets and nearest existing parents for new files.
- Added `server/src/utils/file-path.test.ts` regression coverage for:
  - `../` traversal rejection.
  - Normal in-base paths.
  - Existing symlinks that resolve outside the base.
  - New files under a symlinked parent outside the base.
  - New files under a real in-base directory.
- Added `server/src/utils/archive-path.ts` and tests to reject unsafe archive entry names before extraction, including absolute paths, parent-directory traversal, Windows drive paths, empty names, and NUL-containing names.
- Updated `server/src/routes/files.ts` so file-manager operations validate real targets before list, read, write, mkdir, delete, rename, upload, download, compress, extract, move, bulk-delete, and chmod operations.
- Hardened archive extraction by listing archive entries before extraction, rejecting symlink/hardlink entries from verbose listings, and adding `tar --no-same-owner --no-same-permissions` for tar extraction.

### Validation performed

```bash
npm run test --workspace=server -- archive-path file-path
npm run build --workspace=server
```

Both checks passed during the TDD cycle. Full audit, full server test run, and full build were run before commit.

### Follow-up

- Replace remaining archive/chmod shell commands with argv-based `spawn()` helpers.
- Use `lstat()` in directory listings so listing a directory does not follow symlinks for metadata.
- Add authenticated route integration tests for `/api/files/*` endpoints.
- For the strongest race resistance, move high-risk file operations toward descriptor-based/openat-style primitives where Node support allows it.
