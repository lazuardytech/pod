# Codex Security Fix TODO - 2026-06-08

**Status**: Closed
**Priority**: Critical
**Created**: 2026-06-08
**Owner**: Codex
**For**: Agent Execution
**Related**:
- `/tmp/codex-security-scans/pod/cf448e3_20260607T130401/report.md`
- `/tmp/codex-security-scans/pod/cf448e3_20260607T130401/report.html`

## Summary

This was the active remediation queue for the repository-wide Codex Security scan completed on 2026-06-08.

Current scan result:
- `15` reportable findings
- `2` critical
- `11` high
- `2` medium

Resolved themes:
- upstream credential export and overwrite via low-privilege Pod API keys
- dashboard/internal API exposure due to matcher drift in `src/proxy.js`
- host-local token exfiltration via Cursor auto-import
- unauthenticated OAuth helper and generic provider-auth flows under `/api/oauth/*`
- SSRF, relay, and callback-broker surfaces
- remote tunnel/process control when `requireLogin=false`

## Execution Order

1. Closed the two critical findings first.
2. Restored middleware coverage for the affected stateful `/api/*` families.
3. Added route-level auth checks for high-value paths so matcher drift is not a single point of failure.
4. Added regression tests for auth semantics, URL guardrails, and relay auth behavior.
5. Reran the full Pod verification gate on the final state.

## Checklist

### A. Critical: Cloud Credential Boundaries

- [x] `POD-AUTHZ-007` Restrict `src/app/api/cloud/auth/route.js` so ordinary active Pod API keys cannot export all upstream provider credentials
- [x] `POD-AUTHZ-008` Restrict `src/app/api/cloud/credentials/update/route.js` so ordinary active Pod API keys cannot overwrite stored upstream credentials
- [x] Introduce explicit admin/internal auth semantics for cloud sync routes instead of bare `validateApiKey()`
- [x] Add regression coverage for strict-vs-flex dashboard auth semantics in `tests/unit/route-auth.test.js`

### B. Critical: Host-Local Secret Exfiltration

- [x] `POD-FILE-009` Protect `src/app/api/oauth/cursor/auto-import/route.js` behind authenticated dashboard-only access
- [x] Review and harden sibling OAuth auto-import/import/social helper flows for the same protection gap
- [x] Extend strict auth to the generic `/api/oauth/[provider]/[action]` family plus GitLab PAT and iFlow cookie helper routes
- [x] Update `tests/unit/oauth-cursor-auto-import.test.js` for the authenticated route contract and keep extraction behavior covered
- [x] Add `tests/unit/oauth-import-auth.test.js` to prove generic and provider-specific OAuth helper routes short-circuit when unauthorized

### C. High: Restore Missing Internal API Protection

- [x] `POD-AUTH-001` Protect `/api/providers` and `/api/providers/[id]`
- [x] `POD-AUTH-002` Protect provider create/update/delete routes through strict matcher coverage
- [x] `POD-AUTH-003` Protect `/api/providers/[id]/models`, `/test`, `/test-models`, and `/test-batch`
- [x] `POD-AUTH-004` Protect `/api/usage/request-details`
- [x] `POD-AUTH-005` Protect `/api/usage/request-logs`, `/api/usage/request-logs/[id]`, and `/api/usage/request-logs/stream`
- [x] `POD-AUTH-006` Fix `/api/memory` matcher drift and ensure `DELETE /api/memory` cannot wipe all data anonymously
- [x] Audit other stateful `/api/*` families omitted from `src/proxy.js`, especially `pricing`, `proxy-pools`, `combos`, and OAuth helper routes
- [x] Add shared auth helper coverage in `tests/unit/route-auth.test.js`

### D. High: SSRF and Network Egress Controls

- [x] `POD-SSRF-011` Require auth and restrict `ollama-local` validation to localhost URLs in `src/app/api/providers/validate/route.js`
- [x] Review shared `src/lib/validateUrl.js` for rebinding-safe hostname validation
- [x] `POD-SSRF-012` Harden `cloud/src/handlers/forward.js` against redirect-based SSRF by disabling auto-follow
- [x] `POD-SSRF-013` Harden `cloud/src/handlers/forwardRaw.js` with rebinding-domain, metadata, and credentialed-URL blocking
- [x] `POD-SSRF-015` Bind the generated Vercel relay to a per-deployment auth token and strip it before forwarding
- [x] Add tests for rebinding-style hostnames and relay auth behavior

### E. High: Tunnel and Process Control

- [x] `POD-PROC-010` Ensure `/api/tunnel*` control routes always require strong auth even when `settings.requireLogin === false`
- [x] Review tunnel status/check routes to confirm they do not become mutation/control surfaces
- [x] Enforce strict route-level auth on tunnel control handlers

### F. Medium: Public Callback Broker

- [x] `POD-CB-014` Change `/v1/web/fetch` from public-by-default to authenticated-by-default
- [x] Keep existing destination validation path and rate-limit wrapper behind explicit API-key auth
- [x] Add helper-level auth regression coverage for authenticated-by-default behavior

### G. Defense-in-Depth and Cleanup

- [x] Introduce one shared helper and policy coverage for dashboard/API auth semantics
- [x] Prevent relay secret exposure in proxy-pool API responses
- [x] Reconcile the final fix set back into the issue index and knowledge files

## Verification Gate

Final verification completed:

- `bun run check`
- `bun run test:run`
- `bun run build`

Final verification result:
- `bun run check` passed
- `bun run test:run` passed: `70` files passed, `3` skipped; `1338` tests passed, `19` skipped
- `bun run build` passed

## Closure Criteria

Closure criteria satisfied:
- all `15` findings are fixed or revalidated closed against the current code,
- middleware and route-level protections are both in place for the affected families,
- regression tests cover the highest-risk auth and network-hardening paths,
- `bun run check`, `bun run test:run`, and `bun run build` all pass,
- the issue index and knowledge files are updated to reflect the closed state.
