# Report: Cookie/Web Provider Verification

## Scope

Canary-style verification for cookie/web providers (notably grok-web and perplexity-web paths).

## Main Outcome

- Parsing and stream behavior were validated across representative cases.
- Fragility points were documented for ongoing monitoring.

## Operational Notes

- Web/cookie integrations are high-drift; re-verify after upstream behavior changes.
- Keep parser guardrails and fallback behavior explicit.
