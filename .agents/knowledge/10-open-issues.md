# Open Issues

## Current Status

No critical open issues tracked as of `v0.0.79`.

## Recently Fixed (v0.0.79)

- Error message leak sanitization across 18+ API routes
- Safe JSON body parsing across 45+ mutation routes
- SSE/streaming crash hardening (3 vectors)
- Upstream API body forwarding (13 additional leaks)
- RPM slot leak when concurrent check fails after RPM passes
- Redis dispatch: constructor.name replaced with duck-type checks
- Variable shadowing bugs in 3 OAuth routes

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
