# Open Issues & Watchlist

## Active Items

| #   | Issue                         | Risk   | Notes                                                                                                                                                                                                                           |
| --- | ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Provider API drift**        | High   | OAuth and cookie-based providers change frequently. See checklist below. No live OAuth cron.                                                                                                                                    |
| 2   | **Route auth sync**           | Low    | No middleware. Dashboard `/api/*` uses `checkDashboardApiAuth` / `checkStrictDashboardAuth`. Remaining unguarded routes are intentional (health, login, shutdown secret, `/v1/*`). `GET /api/settings/require-login` is public. |
| 3   | **Relay behavior**            | Medium | Cold starts, timeout races (relay timeout = pod timeout - 5s). First request after idle may be slow.                                                                                                                            |
| 4   | **Multi-instance readiness**  | Low    | **Replicas: 1.** Canary ≠ replica (separate service + volume). Redis is rate-limit only (`pod:` / `pod-canary:`). SQLite is not horizontally shared.                                                                            |
| 5   | **Offline queue correctness** | Medium | Enqueue allowlist: `PATCH /api/settings`, `PUT /api/providers/:id` only. Re-verify after any store change.                                                                                                                      |
| 6   | **SSRF protection**           | Medium | `validateFetchUrl` blocks `0.0.0.0` (tests in `tests/unit/url-guardrails.test.ts`). Re-verify after proxy changes.                                                                                                              |
| 7   | **Fork divergence**           | Low    | Last reviewed: 9router **v0.4.62**. No direct merges. Selective port only. See `.agents/reports/9router-*`.                                                                                                                     |

## Provider drift checklist

High-churn providers. Re-verify after upstream/OAuth changes. Existing unit tests only — no live OAuth cron.

| Provider       | What to re-check                   | Existing tests                                                                     |
| -------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| cursor         | OAuth + cookie auto-import         | `tests/unit/oauth-cursor-auto-import.test.ts`                                      |
| kiro           | refresh + transient overload retry | `tests/unit/oauth-refresh-kiro.test.ts`, `tests/unit/kiro-transient-retry.test.ts` |
| iflow          | cookie/OAuth refresh               | `tests/unit/oauth-refresh-iflow.test.ts`                                           |
| grok-web       | cookie web session                 | `tests/unit/grok-web.test.ts`                                                      |
| perplexity-web | cookie web session                 | `tests/unit/perplexity-web.test.ts`                                                |

Also run the dashboard test-models / test-batch flow after provider-side API changes.

## Historical Context

- Security hardening phases (v0.0.77-v0.0.79) addressed sanitizeError, parseJsonBody, upstream leak cleanup, SSE crash hardening
- Memory leak fix (v0.0.13) reduced RSS from 1.2GB to 200-400MB
- Cache hit rate fixes (v0.0.19-v0.0.22) resolved temperature normalization and memory injection signature mismatches
- CodeQL alerts (v0.0.18-v0.0.51) were systematically resolved

See `CHANGELOG.md` for full history. See `.agents/issues/` for historical audit files (verify against live code).
