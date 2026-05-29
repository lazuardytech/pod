# Fork Status

**Repository**: `github.com/lazuardytech/pod`, branch `main`
**Origin**: Fork of [9Router](https://github.com/9router/9router) (which forked from simple-llm-proxy)
**Current version**: **v0.0.76**
**No upstream remote configured**.

## Release History

| Tag | Highlights |
|---|---|
| v0.0.1 | Rebrand 9router → Pod, bun migration, route restructure, Linear design |
| v0.0.4 | MITM bypass removed, `ConfirmModal` everywhere, `details_id` linking |
| v0.0.6 | SSE live streams, model listing auth, `headerActionStore`, Blackbox + MiniMax |
| v0.0.12 | `renameProviderNode` atomic cascade, `bun run check` script |
| v0.0.13 | **Memory leak fixes** (1.2GB → ~200–400MB): SSE abort, LRUCache, SQLite pragmas |
| v0.0.15 | Remove `--smol`, add cache env vars, CONTRIBUTING/SECURITY docs |
| v0.0.17 | Drag-to-reorder (@dnd-kit), multi-account custom providers |
| v0.0.18 | Fix all 23 CodeQL alerts |
| v0.0.20–22 | **Semantic cache fixes**: signature mismatch, temperature threshold, normalization, `approxRequestBytes` |
| v0.0.23 | Perf: cached `integrity_check` 5min, health stream 10s, SSE hotpath tests |
| v0.0.25 | models.dev pricing sync |
| v0.0.31 | SQLite TTL fix, `memoryOwnerId` in signature, `clearInFlight` unconditional |
| v0.0.46 | Adopt fixes from `decolua/9router` v0.4.40–v0.4.62; remove 9router.com dependency |
| v0.0.47 | Provider smoketest (+80 tests) |
| v0.0.48 | Provider verification sweep (+307 tests, 3 crash fixes) |
| v0.0.49 | Sink-level log sanitizer (CodeQL #39 fix) |
| v0.0.50–51 | 14 CodeQL alerts resolved, 0 open |
| v0.0.52 | Remove paid Perplexity API (keep perplexity-web) |
| v0.0.53 | Web Cookie Providers section visible |
| v0.0.54 | `x-pod-skip-reasoning: true` for perplexity-web |
| v0.0.55–56 | **Vercel relay hardening**: timeout margin, 502/504 retry, `RELAY_FUNCTION_CODE` honours header. **Kiro transient retry**: body-gated 500 retry |
| v0.0.57–75 | Continued stability improvements, UI polish, test expansion |
| v0.0.76 | **Security + race hardening**: `/api/restart` auth, JWT_SECRET warnings, graceful SIGINT, rate limit enforcement, SSE cap, connection lock transaction, SSRF hardening, SSE idle timeout, body size limit, Vertex token dedup. **Upstream adoption**: Codex executor overhaul (+9 functions), Qoder full rewrite (COSY auth), CommandCode executor, reasoning passthrough, debugLog/toolDeduper utils, DeepSeek V4 aliases, connect timeout, Kiro leak fixes |

## Divergence from Upstream

1. **bun-first** build and CI (upstream uses pnpm)
2. **Docker Hub publish** `lazuardytech/pod` (not GHCR)
3. **Memory/cache/rate-limit** features integrated into API + dashboard
4. **Linear design system** (dark-only "Midnight Command Center")
5. **Internal contributor docs** (`AGENTS.md`, `.agents/*`)
6. **Version reset** to v0.0.1 as new identity
7. **Top-level routes** — no `/dashboard` prefix
8. **`open-sse` is local source** — not standalone npm-publishable
9. **MITM bypass removed** entirely (v0.0.4)
10. **9router.com short-URL dependency removed** from Cloudflare tunnel
11. **Codex OAuth** `redirect_uri` hardcoded to `localhost:1455`

## Docker Hub

- Image: `lazuardytech/pod`
- Tags: `v0.0.1`–`v0.0.76`, `latest`
- Platform: `linux/amd64`
