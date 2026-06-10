# Open Issues

## Current Status

Repository-wide Codex Security scan on `2026-06-08` has been remediated and revalidated on the current codebase.

Current tracked security status:
- `15` reportable findings closed
- `0` critical open
- `0` high open
- `0` medium open

Active execution queue:
- none

Documentation audit status:
- `DOCS_PRD_AUDIT_2026-06-06` closed on `2026-06-07`
- All tracked gaps (`GAP-001` through `GAP-007`) are resolved or marked stale after repo verification

Stability audit status:
- `STABILITY_AUDIT_2026-06-06` closed on `2026-06-07`
- Resolved items: hardcoded OAuth secrets, runtime secret enforcement, weak example secrets, cursor auto-import SQL interpolation, `document.write()` usage, and `usageDb` timer/logging hardening

Security audit status:
- `SECURITY_AUDIT_LOG_ERR_2026-06-06` closed on `2026-06-07`
- Resolved items: Cline refresh debug log exposure, raw provider test error returns, audited provider/memory/pricing route sanitization, sensitive Cloudflare worker/request-path logging, adjacent settings-route fallback cleanup, the 7-item follow-up logging pass from `REMAINING_ISSUES_2026-06-07`, and the later 14-item external-agent logging follow-up from `NEW_SECURITY_ISSUES_2026-06-07`

Latest Codex Security findings closed:
- cloud credential export and overwrite routes now require strict dashboard auth
- Cursor auto-import now requires strict dashboard auth
- generic `/api/oauth/*` provider-auth routes and sibling Cursor/Kiro/GitLab/iFlow helper routes now require strict dashboard auth
- provider, usage, memory, pricing, proxy-pools, combos, and tunnel control families are now covered by strict matcher auth where needed
- `/api/providers/validate` now requires auth and keeps `ollama-local` on localhost-only URLs
- Cloudflare worker forwarders now block redirect-follow SSRF and rebinding-style hostnames
- `/v1/web/fetch` is now authenticated-by-default
- generated Vercel relay now requires a per-deployment relay auth token and the token is redacted from proxy-pool API responses

Current verification note:
- latest full Pod gate on the remediated state passed:
- `bun run check`
- `bun run test:run`
- `bun run build`
- result: `70` files passed, `3` skipped; `1338` tests passed, `19` skipped; production build succeeded

## Recently Fixed (pre-2026-06-08 backlog)

- Error message leak sanitization across 18+ API routes
- Safe JSON body parsing across 45+ mutation routes
- SSE/streaming crash hardening (3 vectors)
- Upstream API body forwarding (13 additional leaks)
- RPM slot leak when concurrent check fails after RPM passes
- Redis dispatch: constructor.name replaced with duck-type checks
- Variable shadowing bugs in 3 OAuth routes
- Documentation drift fixed on 2026-06-07: tests branding + bun-only commands, `.env.example` contract, internal API reference, supported provider list, stale docs audit findings
- Stability hardening fixed on 2026-06-07: env-backed OAuth secrets, fail-fast `JWT_SECRET` and `API_KEY_SECRET`, safer `.env.example`, parameterized Cursor auto-import fallback, `document.write()` removal, `usageDb` timer cleanup
- Logging hardening follow-up fixed on 2026-06-07: removed provider-specific token-refresh logging, genericized Antigravity and Cloudflare forwarder errors, sanitized audited `chatCore` error lines, and added log-regression test coverage
- Second logging hardening follow-up fixed on 2026-06-07: removed raw proxy fallback errors, sanitized non-streaming parse logs, removed provider/model identifiers from stream logs, sanitized provider-limit and auth lock logs, cleaned usage route warnings, and extended `tests/unit/log-sanitization-audit.test.js`

## Previously Closed Themes

- Codex: tool call response cut-off, reasoning effort normalization, output_index remap, assistant role continuation
- Memory leak and stream cleanup regressions
- Semantic-cache miss root causes
- Model lock minimum lockout edge cases

## Watchlist

- Provider API behavior drift (especially Codex, Kiro, Gemini CLI)
- Relay behavior under cold starts (Vercel 502/504 retry)
- Offline queue UX clarity on high-latency reconnection
- Multi-instance: LiteFS FUSE compatibility on Zeabur
- matcher drift between `src/proxy.js` and `src/dashboardGuard.js`
- DNS-rebinding-safe SSRF validation across server and worker fetch surfaces
