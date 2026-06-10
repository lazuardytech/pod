# Release Rollup: v0.0.79

## Summary

`v0.0.79` was a hardening release. The main themes were:

- sanitized API errors
- safe JSON parsing for mutation routes
- upstream error-body leak cleanup
- SSE crash containment
- Redis-backed rate limiting
- production-safe backend dispatch

## Lasting Impact

This release defines many of the current security and runtime invariants reflected in `AGENTS.md`.
