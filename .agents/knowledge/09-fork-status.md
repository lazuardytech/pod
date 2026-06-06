# Fork Status

## Identity

- Repo: `lazuardytech/pod`
- Branch: `main`
- Current baseline: `v0.0.79`
- Canary branch: active for formatting + security hardening
- Origin lineage: `simple-llm-proxy` → `9router` → `pod`

## Key Divergence

- bun-first runtime and workflows (Bun.RedisClient native, bun:sqlite)
- Local `open-sse` integration — never from npm, resolved via `jsconfig.json`
- Strong dashboard focus with full operational tooling
- Security hardening: error sanitization, safe JSON parsing, SSE crash guards
- Redis rate limiting with duck-type backend dispatch (not constructor.name/instanceof)
- Connection-level lockout with exponential cooldown
- SSRF guardrails (block 0.0.0.0 + DNS rebinding patterns)
- PWA + offline-first dashboard support (service worker, mutation queue)
- Cloudflare Worker proxy (cloud/) for edge deployment
- Docker compose: pod + redis + searxng
- Zeabur deployment support (root Dockerfile)

## Docker Release Track

- Image: `lazuardytech/pod`
- Tags: semantic versions + `latest`
