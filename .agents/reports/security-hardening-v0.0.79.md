# Security Hardening Audit — v0.0.79

Date: 2026-06-04
Scope: Four-phase security hardening across the entire API surface and streaming pipeline.

## Phase 1 — Error Message Leak Sanitization

**Problem**: 18 API route files returned raw `error.message` in `NextResponse.json()` bodies, leaking internal stack details to clients.

**Fix**: Added `sanitizeError(error)` from `@/lib/sanitizeError.js` to all catch blocks. Production returns `"Internal server error"`; dev returns `error.message`.

**Files fixed**: 18 routes across `src/app/api/`.

## Phase 2 — Safe JSON Body Parsing

**Problem**: 45+ API routes used raw `await request.json()` without try/catch, causing unhandled 500 errors on malformed JSON.

**Fix**: Migrated all mutation routes to `parseJsonBody(request)` from `@/lib/parseJsonBody.js`. Returns `400 Invalid JSON body` instead of crashing.

**Bug found + fixed**: 3 files (`oauth/[provider]/[action]`, `oauth/gitlab/pat`, `pricing/sync`) had variable shadowing — inner `const [body, ...]` shadowing outer `let body`, making outer `body = undefined`. Fixed by renaming to `parsed`.

## Phase 3 — Remaining Leak Patches

**Fix**: `src/app/api/monitoring/health/_health.js` and `src/app/api/models/test/route.js` — last two API routes with raw `error.message`.

## Phase 4 — SSE/Streaming Crash Hardening

**Problem**: Three crash vectors in the streaming pipeline — none had crash containment.

**Fixes**:
1. `src/sse/handlers/chat.js`: Wrapped entire `while(true)` fallback loop in `try/catch` with `MAX_FALLBACK_ITERATIONS=50` guard. `credentials` hoisted to `let` scope above try.
2. `open-sse/utils/stream.js`: Wrapped `transform()` body in `try/catch` with graceful SSE error terminator + `controller.terminate()`.
3. `open-sse/handlers/chatCore.js`: Wrapped `getReader()` and `reader.read()` in `try/catch`/`.catch()` with `{ value: null, done: true }` fallback.

## Auditor-Reported Leaks (post-initial fix)

Four subagent auditors found 13 additional leaks missed in the initial sweep:

| Severity | Count | Type |
|----------|-------|------|
| Raw `error.message` | 4 | `migrate-sqlite` (×2), `proxy-test`, `proxy-pools/[id]/test` |
| Upstream API body | 8 | `gitlab/pat`, `iflow/cookie` (×4), `deepgram/voices`, `inworld/voices`, `[id]/models` |
| Vercel API error | 1 | `vercel-deploy` |

All 13 fixed. Upstream bodies now return generic status-only messages. Plus 5 lint warnings found and resolved (undeclared vars, unused imports).

## Redis Rate Limiting Integration

**Verified**:
- `releaseRpm()` properly integrated at `src/lib/rateLimit/index.js` lines 140 and 196
- Called when Redis concurrent check fails after RPM passes — prevents slot leak
- Backend auto-selection: Redis if `REDIS_URL` is set, in-memory fallback otherwise
- 15+ v1 API routes wrapped with `withApiKeyRateLimit`

## Final Verification

- **Lint**: 0 warnings
- **Tests**: 1305 passed, 19 skipped
- **Build**: `.next/standalone/` intact
- **Format**: All 593 files clean
