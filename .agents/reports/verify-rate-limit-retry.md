# Report: Rate-Limit and Retry Verification

## Scope

Validate 429/5xx handling, retry behavior, and lockout semantics.

## Main Outcome

- Critical invariants around retry and lock state were verified.
- No blocker regressions remained after fixes in that cycle.

## Lasting Guidance

- Keep `clearInFlight` behavior consistent.
- Preserve `modelLockCount_${model}` semantics.
