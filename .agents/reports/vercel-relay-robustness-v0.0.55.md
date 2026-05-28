# Vercel Relay Robustness — v0.0.55

Release: v0.0.55 | Date: 2026-05-28 | Tests: +17 (1210 pass / 19 skip / 0 fail)

## Problem

The Vercel relay path (`Client → Pod → Vercel Edge Function → Upstream`) had four reliability gaps that could cause non-deterministic failures, confusing error messages, and slow recovery after cold starts:

1. **Deterministic timeout race** — pod and relay both enforced the same 45s timeout. Whichever's AbortController fired first was random; error messages flipped unpredictably.
2. **Platform 504 ambiguity** — Vercel free-tier hard-kills functions at 10s with a generic 504. Pod treated this as an upstream provider failure, giving no indication of the real cause.
3. **Unreliable healthcheck** — `httpbin.org/get` was slow, rate-limited, and occasionally returned Cloudflare challenges, causing fake healthcheck failures.
4. **Cold start failures** — first request after deploy or idle period often returned 502/504 from Vercel's cold-start window with no automatic recovery.

## Fixes

### Fix 1: Pod timeout > relay timeout (deterministic race)

**File**: `open-sse/utils/proxyFetch.js` (line ~124)

Before: `x-relay-timeout` was set to the full pod timeout (e.g. 45000ms), creating a non-deterministic race.

After: `relayTimeoutMs = max(1000, upstreamTimeoutMs - 5000)`. The relay always times out 5s before pod, emitting a controlled 504 with a recognisable JSON error body before pod's outer AbortController triggers.

| upstreamTimeoutMs | x-relay-timeout sent |
|---|---|
| 45000 | 40000 |
| 10000 | 5000 |
| 3000 | 1000 (clamped) |
| undefined | omitted |

### Fix 2: Detect Vercel platform 504

**File**: `open-sse/handlers/chatCore.js` (line ~609, after retry exhaustion)

When `proxyOptions.vercelRelayUrl` is set and the upstream response is 504, pod now returns a clear error: `"Vercel relay timeout — function exceeded platform limit"` (HTTP 504) and logs `[VERCEL-RELAY-TIMEOUT]`.

This runs BEFORE the 401/403 token-refresh path. Non-relay 504 responses are unaffected.

### Fix 3: Reliable healthcheck endpoint

**File**: `src/app/api/proxy-pools/[id]/test/route.js` (line ~12)

Changed from `httpbin.org/get` to `https://www.google.com/generate_204`:
- Returns 204 No Content in <100ms globally
- Used by Android/Chrome for connectivity checks — proven reliability
- Added `Accept: */*` and `User-Agent: pod-relay-healthcheck/1.0` headers
- Validation: `res.ok` covers both 200 and 204 (no logic change needed)

### Fix 4: One-shot retry on Vercel 502/504

**File**: `open-sse/handlers/chatCore.js` (line ~547, inside try block)

When `proxyOptions.vercelRelayUrl` is set and the executor returns 502 or 504, pod retries once with a 2s delay before falling through to error handling. Logs `[VERCEL-RELAY-RETRY]` with provider/model and attempt count.

The retry is inside the try block: if it throws (timeout, network error), the existing catch block handles it normally. Non-relay paths are unaffected.

## Test Coverage

**File**: `tests/unit/vercel-relay-timeout.test.js` — 17 tests

| Area | Test | Count |
|---|---|---|
| Fix 1 | Timeout margin (45000→40000, 10000→5000, 3000→1000 clamp, undefined omitted, header shape) | 5 |
| Fix 2 | 504 detection source code verification, guard clause check | 2 |
| Fix 3 | Healthcheck endpoint + headers, res.ok for 204, timeout/AbortController retained | 3 |
| Fix 4 | Retry condition source check, 2s delay with fake timers, guard clause truth table, 502→200 path, 504×2 exhaustion | 5 |
| Smoke | clearTimeout in RELAY_FUNCTION_CODE, pollDeployment bounded retries | 2 |

## Smoke Audit Findings

1. **`pollDeployment` bounded retries** — 120s budget, 3s polling interval = max 40 iterations. No unbounded loop. ✓
2. **Headers vs plain object** — All `proxyAwareFetch` callers in the relay path (via `base.js` executor → `buildHeaders`) return plain objects. Headers instances never reach the `relayHeaders` spread. No bug. ✓
3. **`clearTimeout` in RELAY_FUNCTION_CODE** — Called on both success path (before `return new Response`) and error path (in catch block). No timer leak. ✓
4. **`pollDeployment` try/catch** — Called from `POST` route which is wrapped in outer try/catch. Error surfaces as HTTP 500. ✓

**No real bugs found.** All four smoke checks passed.

## AGENTS.md Rules Added

- **Rule 22**: Vercel relay timeout has 5s safety margin
- **Rule 23**: Vercel relay 502/504 gets one retry with 2s delay
- **Rule 24**: Vercel relay test uses `google.com/generate_204`

## Verification Commands

```bash
bun run check                          # biome format + lint + eslint
bun run test:run                       # 1210 pass / 19 skip / 0 fail
bun x vitest run tests/unit/vercel-relay-timeout.test.js  # all 17 pass
```
