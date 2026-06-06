# Release Rollup: v0.0.79

Date: 2026-06-05
From: v0.0.78
Scope: Security hardening, SSE crash guards, Redis rate limiting, production safety.

## Summary

v0.0.79 is a defense-in-depth release. Four phases of security hardening across the entire API surface, SSE pipeline crash containment, Redis rate limiting integration, and production-build safety fixes. Zero new features — pure hardening and reliability.

## Phase 1 — Error Message Leak Sanitization

**Problem**: 18 API route files returned raw `error.message` in `NextResponse.json()` bodies, leaking internal stack details to clients.

**Fix**: `sanitizeError(error)` from `@/lib/sanitizeError.js` in all catch blocks. Returns `"Internal server error"` in production, `error.message` in development.

**Files**: 18 routes across `src/app/api/`.

## Phase 2 — Safe JSON Body Parsing

**Problem**: 45+ API routes used raw `await request.json()` without try/catch, causing unhandled 500 errors on malformed JSON.

**Fix**: Migrated all mutation routes to `parseJsonBody(request)` from `@/lib/parseJsonBody.js`. Returns `400 Invalid JSON body`.

**Bug found**: 3 files had variable shadowing — inner `const [body, ...]` shadowing outer `let body`. Fixed by renaming to `parsed`.

## Phase 3 — Upstream Body Leak Patches

**Problem**: 13 subagent-reported leaks missed in initial sweep — raw error.message in 4 routes, upstream API bodies forwarded in 9 routes.

**Fix**: All 13 patched. Upstream bodies now return generic status-only messages.

## Phase 4 — SSE/Streaming Crash Hardening

**Problem**: Three crash vectors in the streaming pipeline with no containment.

**Fixes**:
1. `src/sse/handlers/chat.js`: `while(true)` fallback loop wrapped in `try/catch` with `MAX_FALLBACK_ITERATIONS=50`. `credentials` hoisted to `let` scope.
2. `open-sse/utils/stream.js`: `transform()` wrapped in `try/catch` with graceful SSE error terminator +
   `controller.terminate()`.
3. `open-sse/handlers/chatCore.js`: `getReader()` and `reader.read()` wrapped in `try/catch` with `{ value: null, done: true }` fallback.

## Redis Rate Limiting Integration

**What**: Full Redis backend for rate limiting via `src/lib/rateLimit/`.

**Details**:
- `RedisBackend` uses `Bun.RedisClient` native (zero npm dependency)
- RPM: Sorted Set sliding window with unique member IDs (`${timestamp}:${uuid8}`)
- Concurrent: `INCR/DECR` with safety TTL
- RPM slot release when concurrent check fails after RPM passes
- 15+ v1 API routes wrapped with `withApiKeyRateLimit`

## Production Build Safety

**Fix**: `constructor.name` and `instanceof` replaced with duck-type checks (`backend.releaseRpm?.(...)`) for backend dispatch. Constructor-name checks break in minified production builds.

## Additional Fixes

- Service worker lifecycle: registration-only, no auto-update detection
- CLI auth integration for Cline (`clineAuth.js`)
- Version bump in both `package.json` and `config.js`
- Biome format applied to AGENTS.md, sw.js, ServiceWorkerRegistrar

## Verification

- Lint: 0 warnings
- Tests: 1305 passed, 19 skipped
- Build: `.next/standalone/` intact
- Format: All 593 files clean
