# Conventions

## Code Style

- JavaScript only (ESM)
- `PascalCase` for components, `camelCase` for utilities
- Route folders use Next.js app-router conventions

## Platform Rules

- Use `bun` for all workflows
- Use storage facades, avoid ad-hoc DB access
- Keep top-level dashboard routes (no `/dashboard` prefix)

## UI Rules

- Use `ConfirmModal` instead of `confirm()`
- Register page header actions via `headerActionStore`
- For `bg-primary`, always use `text-primary-fg`

## PWA / Offline Rules

- Read fallback uses `offlineJsonCache`
- Safe write fallback uses mutation queue helpers
- Preserve queue visibility/status UI for users
