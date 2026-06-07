# Stability Audit - 2026-06-06

**Status**: Closed  
**Priority**: High  
**Created**: 2026-06-06  
**Revalidated**: 2026-06-07  
**Resolved**: 2026-06-07  
**Owner**: TBD  
**Calibration**: Original audit overstated several findings. This file now reflects repo verification performed on 2026-06-07.

## Summary

The original audit correctly identified some real security and hardening work, but it also labeled several non-exploitable patterns as `Critical`. After verification and remediation, the repo does **not** support the original claim of "5 Critical vulnerabilities blocking deployment" from the evidence currently documented here.

Current assessment:
- The validated secret-management issues were fixed on 2026-06-07.
- The `usageDb.js` lifecycle hardening tasks in scope of this audit were fixed on 2026-06-07.
- The repo still contains many `console.*` calls, but the broad original claim was too coarse to remain an open security finding after revalidation; high-risk startup and audited paths were cleaned up.
- Multiple SQL injection and XSS claims in the original audit are false positives or materially overstated based on current code.
- Test-suite verification is no longer an open question: `bun run test:run` passed on 2026-06-07 with `1313 passed`, `19 skipped`.

## Revalidated Findings

| ID | Title | Location | Updated Severity | Status | Notes |
|---|---|---|---|---|---|
| `CRED-001` | Hardcoded OAuth client secrets | `open-sse/config/providers.js` | High | Closed | `iflow` and `qoder` now require env-backed client secrets; hardcoded fallbacks removed |
| `CRED-002` | Default secret policy incomplete | `src/shared/services/initializeApp.js` | High | Closed | Startup now fails fast when `JWT_SECRET` or `API_KEY_SECRET` is missing or set to insecure defaults |
| `CRED-003` | Example env still uses copy-pasteable weak values | `.env.example` | Medium | Closed | Example secrets are now blank and generation guidance uses Bun |
| `LOG-001` | Broad use of `console.log/error/warn` | Multiple files | Low | Closed | Audited high-risk paths were moved to sanitized logging; remaining `console.*` usage is general logging debt, not a validated secret-exposure finding in this audit |
| `MEM-001` | Timer/signal lifecycle cleanup can be hardened | `src/lib/usageDb.js` | Medium | Closed | Pending-request timers are cleared during shutdown and timer handles are `unref()`'d where available |

## Findings Requiring Reclassification

These items were present in the original audit but are not supported as written after code verification.

| ID | Original Claim | Location | Updated Status | Why |
|---|---|---|---|---|
| `SQL-INJ-001` | Raw SQL interpolation in usage history is exploitable SQLi | `src/lib/usageDb.js:560-580` | False positive | Dynamic `WHERE` is built from fixed clauses; values are still parameterized with `?` |
| `SQL-INJ-002` | `options.query` is direct SQL injection | `src/lib/memory/store.js:228-239` | False positive | FTS `MATCH ?` uses a bound parameter; `String(options.query)` is not by itself SQL injection |
| `SQL-INJ-003` | Cursor auto-import query is user-controlled SQLi | `src/app/api/oauth/cursor/auto-import/route.js:127-145` | Overstated | Interpolation exists, but keys come from constant arrays, not request input; still worth refactoring |
| `SQL-INJ-004` | `ALTER TABLE` interpolation is exploitable SQLi | `src/lib/sqlite/connection.js:100-103` | False positive | `ddl` is sourced from a local static array, not user input |
| `XSS-001` | `document.write()` is exploitable XSS with user content | `src/app/(dashboard)/endpoint/EndpointPageClient.js:1660-1664` | Overstated | `document.write()` is undesirable, but current content is a static string, not user-controlled input |
| `RACE-001` | Multiple signal handlers are repeatedly registered | `src/lib/usageDb.js:443-458` | False positive | Handler registration is guarded by `global._flushHooksRegistered` |
| `ERR-001` | Missing `sanitizeError()` remains broadly unaddressed | Multiple API routes | Closed | The targeted LOG-001 and ERR-001 follow-up audit was completed on 2026-06-07 and the validated route issues were fixed |
| `TEST-001` | Test status not verified / missing usable script | `package.json` | Closed as stale | `bun run test:run` exists and passed on 2026-06-07 |

## Evidence Notes

Verified code points:
- Hardcoded OAuth secrets: `open-sse/config/providers.js`
- Startup secret policy: `src/shared/services/initializeApp.js`
- Example env defaults: `.env.example`
- Usage history query construction: `src/lib/usageDb.js`
- Memory FTS query: `src/lib/memory/store.js`
- Cursor auto-import SQLite queries: `src/app/api/oauth/cursor/auto-import/route.js`
- `document.write()` usage: `src/app/(dashboard)/endpoint/EndpointPageClient.js`
- SQLite schema patch DDL: `src/lib/sqlite/connection.js`
- Shutdown hook registration guard: `src/lib/usageDb.js`

Remediation points applied on 2026-06-07:
- Runtime secret validation helper: `src/lib/security/runtimeSecrets.mjs`
- API key signing secret enforcement: `src/shared/utils/apiKey.js`
- OAuth provider/service secret lookups: `open-sse/config/providers.js`, `src/lib/oauth/constants/oauth.js`, `src/lib/oauth/providers.js`, `src/lib/oauth/services/iflow.js`, `src/lib/oauth/services/qoder.js`, `open-sse/services/tokenRefresh.js`, `open-sse/executors/default.js`
- Cursor auto-import CLI parameter binding: `src/app/api/oauth/cursor/auto-import/route.js`
- `document.write()` replacement: `src/app/(dashboard)/endpoint/EndpointPageClient.js`
- `usageDb` timer/logging cleanup: `src/lib/usageDb.js`
- Regression coverage: `tests/unit/runtime-secrets.test.js`, `tests/unit/oauth-refresh-iflow.test.js`, `tests/unit/oauth-cursor-auto-import.test.js`

## Verification

- `bun run check` ✅
- `bun run test:run` ✅ (`65 passed`, `3 skipped` files; `1313 passed`, `19 skipped` tests)
- `bun run build` ✅

## Follow-Up Notes

- A repo-wide `console.*` cleanup is still reasonable as maintainability work, but it is no longer tracked here as an unresolved security finding.
- A separate route-by-route `sanitizeError()` audit can still be done if a new evidence-backed report is needed.

## Deployment Note

This audit no longer supports the blanket statement "do not deploy until 5 critical issues are fixed." The more accurate conclusion is:

- the originally validated issues from this audit are fixed,
- the original severity ratings were materially overstated,
- and any future hardening work should be tracked as new, evidence-backed items rather than carried forward from the original report.

**Last Updated**: 2026-06-07
