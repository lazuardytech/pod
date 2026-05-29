# Open Issues (Historical)

All three tracked issues are **fully resolved** as of v0.0.31. Documented here for regression awareness.

---

## Issue 1 — Performance After Memory Leak Fix (Resolved v0.0.23)

**Problem**: v0.0.13 fixed 1.2GB RSS leak (SSE abort, LRUCache, SQLite pragmas, `--smol`) but caused slowdown from conservative cache sizes.

**Root causes**:
- Cache env vars too small: `SEMANTIC_CACHE_MAX_SIZE=50`, `PROMPT_CACHE_MAX_SIZE=25`
- `--smol` removed without addressing GC pressure
- `PRAGMA integrity_check` ran on every health poll (O(n-pages) scan)
- Health stream polled at 2s (unnecessary CPU for 5 DB queries per call)

**Fixes** (v0.0.13–v0.0.23):
- `integrity_check` cached for 5min
- Health stream interval 2s → 10s
- Request-logs stream fixed 2s poll (removed 1s fast-poll for PENDING entries)
- 23 SSE hotpath tests added

**Status: ✅ Fixed. No residual symptoms.**

---

## Issue 2 — Semantic Cache 0% Hit Rate (Resolved v0.0.22/v0.0.31)

**Four root causes**:

1. **Signature mismatch** (v0.0.20): `generateSignature()` called pre-`injectMemory()` at read time, but recomputed post-mutation at write time → hashes never matched.
2. **Temperature threshold `!== 0`** (v0.0.13): Clients send `temperature: 1` by default → every request excluded.
3. **Temperature/top_p normalization** (v0.0.22): `null`/`undefined` defaulted to 0 while explicit `1` stayed 1 → permanent miss between client styles.
4. **`approxRequestBytes` false positives** (v0.0.22): Content-block arrays over-counted as 512 bytes flat → normal requests bypassed cache.

**Fixes**:
- Pre-compute signature once, reuse on all write paths
- Threshold changed to `> 1`
- Normalize `null` → `1` inside `generateSignature`
- Properly sum text lengths in content blocks

**Additional fixes (v0.0.31)**:
- SQLite TTL comparison: `strftime()` not `datetime('now')`
- `memoryOwnerId` in signature prevents cross-key cache bleed
- `clearInFlight` unconditional in all 3 response paths
- `MAX_SEMANTIC_CACHE_BYTES` raised to 512KB

**Diagnostic checklist if hit rate is 0%**:
1. Verify `semanticCacheEnabled = true` in Settings → Cache
2. Check `SEMANTIC_CACHE_MAX_SIZE` env var (Dockerfile default 50 fills quickly)
3. Confirm requests not sending `x-pod-no-cache: true`
4. Check `MAX_REQUEST_BYTES_FOR_CACHE_CHECK` in `chatCore.js`

**Status: ✅ All known root causes fixed.**

---

## Issue 3 — Model Lock Minimum Lockout Not Applied (Resolved v0.0.21)

**Problem**: Configurable `minimumLockoutMinutes` silently ignored on already-locked models.

**Root causes**:
1. **Read-before-write guard too aggressive**: `existingExpiry > Date.now()` skipped update even when new cooldown was longer. Changed to `existingExpiry >= newExpiry - 5000`.
2. **`resetsAtMs` path skipped minimum**: Provider-specific cooldown returned early before minimum lockout block ran.

**Fix**: Both paths now apply `Math.max(minimumLockoutMs * backoffLevel, cooldownMs)`.

**Note**: Existing locks written before fix retain old expiry. Clear manually via /health "Clear lockout" button.

**Status: ✅ Fixed. Existing stale locks must be cleared manually.**

---

## Fix History

| Commit | Version | Area |
|---|---|---|
| `be7cbe2` | v0.0.13 | Issue 1: SSE abort, LRUCache, SQLite pragmas, `--smol` |
| `b498bb4` | v0.0.13 | Issue 2: Temperature threshold `!=0` → `>1` |
| `f591bc8` | v0.0.20 | Issue 2: Reuse pre-injection signature |
| `b292560` | v0.0.20 | Issue 3: Configurable minimum lockout time |
| `b64176b` | v0.0.21 | Issue 3: Guard + resetsAtMs path fixes |
| `3942978` | v0.0.22 | Issue 2: Temp/top_p normalization + approxRequestBytes |
| `43a67cb` | v0.0.23 | Issue 1: Cache integrity_check, health stream interval |
| `4a881dd` | v0.0.23 | Issue 1: 23 SSE hotpath tests |
| `ba1a53d` | v0.0.23 | Issue 3: Backoff multiplier on recheckAndClear |
| v0.0.31 | — | Issue 2: SQLite TTL, memoryOwnerId, clearInFlight, 512KB limit |

**Status: ✅ No known open issues as of v0.0.75.**
