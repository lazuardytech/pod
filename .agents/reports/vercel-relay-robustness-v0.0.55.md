# Report: Vercel Relay Robustness v0.0.55

## Scope

Stabilize relay behavior under cold starts and timeout races.

## Main Outcome

- Deterministic timeout ordering (relay times out before pod).
- One retry for relay `502/504` to reduce cold-start failures.
- Reliable relay health-check target.

## Lasting Rules

- Keep 5s timeout safety margin.
- Keep one-shot retry policy for relay `502/504`.
- Keep `google.com/generate_204` as relay test target.
