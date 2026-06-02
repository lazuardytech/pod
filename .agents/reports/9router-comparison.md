# Report: 9router vs Pod (Concise)

## Scope

Comparison between `decolua/9router` and local `pod` baseline used during v0.0.44-era planning.

## Main Outcome

- Pod already diverged intentionally in runtime, routing, and operations.
- Some upstream ideas were useful, but direct merge was not safe.

## Key Takeaways

- Keep pod-first invariants (bun-only, top-level routes, local `open-sse`).
- Adopt upstream fixes selectively, not wholesale.
- Validate each adoption against security and provider-compatibility rules.

## Action Status

- This report is historical context only.
- Use newer rollout reports for current implementation state.
