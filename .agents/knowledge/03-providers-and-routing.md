# Providers and Routing

Pod routes one client-facing API surface to many upstream providers.

## Routing Building Blocks

- Provider config
- Model catalog and aliases
- Connection selection
- Retry and fallback
- Format translation
- Stream normalization

## Important Behaviors

1. Provider aliases and model IDs must stay consistent across listing, routing, and UI.
2. Account lockout and model cooldown are part of correctness.
3. Combos are ordered fallback chains, not just UI groupings.
4. Compatible/custom nodes are first-class but follow different rename and validation rules.
5. Provider behavior can drift; verify live behavior when changing adapter logic.
