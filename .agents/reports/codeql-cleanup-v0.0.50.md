# CodeQL Cleanup — v0.0.50

Date: 2026-05-27  
Baseline: v0.0.49 (9eaf47c)  
Target: v0.0.50  
Result: All 14 open alerts resolved (10 dismissed, 4 fixed)

---

## Per-Alert Breakdown

### Fixed (4 alerts)

| # | Severity | Rule | File:Line | Fix |
|---|----------|------|-----------|-----|
| 32 | critical | js/request-forgery | `src/app/api/models/availability/route.js:122` | Replaced `requestBase` (derived from request Host header) with `http://localhost:{port}` fallback. Removes Host-header SSRF vector for internal callback. |
| 33 | critical | js/request-forgery | `src/app/api/models/test/route.js:42` | Same fix: use `http://localhost:{port}` instead of trusting request URL hostname. |
| 34 | critical | js/request-forgery | `src/app/api/models/test/route.js:80` | Same fix (second fetch in the same handler). |
| 35 | critical | js/request-forgery | `src/app/api/oauth/gitlab/pat/route.js:34` | Added hostname allowlist: `gitlab.com`, `www.gitlab.com`, `*.gitlab.com`, plus any existing GitLab provider connection's hostname. |

Commit refs: `models/test/route.js`, `models/availability/route.js`, `oauth/gitlab/pat/route.js`

### Dismissed (10 alerts)

| # | Rule | File:Line | Justification |
|---|------|-----------|---------------|
| 3 | js/insufficient-password-hash | `src/shared/utils/apiKey.js:33` | HMAC-SHA256 used as CRC for high-entropy random API keys (`crypto.getRandomValues`), not a password hash. Keys are 128+ bit random tokens. |
| 14 | js/request-forgery | `src/app/api/provider-nodes/validate/route.js:7` | URL validated by `validateFetchUrl()` (http/https only, no private IPs). BY-DESIGN endpoint for provider node validation. |
| 17 | js/request-forgery | `src/app/api/providers/validate/route.js:231` | Hardcoded host `api.cloudflare.com` — `accountId` is a path segment only, cannot change host. |
| 28 | js/xss-through-dom | `MediaProviderDetailClient.js:1374` | `<img src>` in React JSX. `toImagePreviewSrc()` sanitizer restricts to `https://` and `data:image/` only. React auto-escapes JSX. |
| 29 | js/xss-through-dom | `MediaProviderDetailClient.js:1411` | Same as #28 for `maskImagePreviewSrc`. |
| 30 | js/xss-through-dom | `GitLabAuthModal.js:163` | `<a href>` in React JSX. `sanitizeGitLabUrl()` restricts to http/https only. React auto-escapes. |
| 31 | js/xss-through-dom | `GitLabAuthModal.js:215` | Same as #30 for PAT URL. |
| 36 | js/request-forgery | `src/app/api/providers/suggested-models/route.js:38` | URL validated by `validateFetchUrl()` before fetch. BY-DESIGN endpoint. |
| 37 | js/request-forgery | `src/app/api/proxy-pools/vercel-deploy/route.js:116` | Hardcoded `VERCEL_API` constant (`https://api.vercel.com`) — projectId from Vercel response, not user input. |
| 38 | js/request-forgery | `src/app/api/providers/validate/route.js:268` | `baseUrl` from DB-stored node, validated by `validateFetchUrl()` every use. |

---

## Tests

- `bun run check` — clean (Biome format + lint, ESLint)
- `bun run test:run` — 1188 passed, 19 skipped, 0 failed (baseline match)

## Version

- `package.json`: 0.0.50
- `src/shared/constants/config.js` `displayVersion`: `"0.0.50"`
- `AGENTS.md` baseline: updated

## CI Status

Tag `v0.0.50` pushed → Docker workflow + CI triggered.
