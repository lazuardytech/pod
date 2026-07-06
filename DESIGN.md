# Pod Design

Pod uses a compact, dark-only control-panel UI inspired by Linear — technical, dense, calm, and high-signal.

## Design Direction

- **Tone**: technical, dense, calm, high-signal
- **Theme**: dark only (no light mode)
- **Accent**: a single neon-lime primary highlight for important actions
- **Default feel**: operational dashboard, not marketing site

## Core Rules

1. Keep the darkest surface as the page background.
2. Reserve the primary accent for CTAs and active states.
3. Prefer compact spacing and small control density.
4. Use subtle elevation; avoid decorative shadows.
5. Favor strong contrast for text and status clarity.
6. Keep interactive components visually consistent across dashboard pages.

## Color Model

| Token            | Role                        |
| ---------------- | --------------------------- |
| Background       | Near-black                  |
| Surface          | Dark graphite               |
| Elevated surface | Slightly lighter dark slate |
| Border           | Muted charcoal              |
| Primary text     | Near-white                  |
| Secondary text   | Muted gray                  |
| Primary accent   | Neon-lime family            |
| Success          | Green                       |
| Warning / Error  | Red                         |
| Informational    | Blue / cyan, used sparingly |

## Typography

- **UI font**: `Inter` (tight tracking, compact line height, strong hierarchy)
- **Monospace**: `Berkeley Mono`-style fallback stack
- Use mono for model IDs, provider aliases, endpoints, and log output

## Spacing and Shape

- **Base spacing unit**: `4px`
- **Standard component radius**: `6px`
- Compact internal gaps preferred over airy layouts
- Pill shapes reserved for badges, chips, and toggled states

## Component Rules

### Buttons

- Primary buttons use the primary accent with dark foreground (`bg-primary` + `text-primary-fg`)
- Secondary buttons stay neutral and low-noise
- Destructive actions use red
- Ghost buttons read as tertiary controls, not hidden actions

### Cards

- Cards are the default containment pattern
- Use nested dark layers instead of heavy borders
- Keep padding compact and predictable

### Inputs

- Dark and calm by default
- Focus state is obvious but not loud
- Never sacrifice readability for style

### Status & Feedback

- Use explicit success, warning, and error colors
- Health, usage, lockout, and queue states must be easy to scan
- Prefer concise text over decorative UI
- Use `ConfirmModal` — never `window.confirm()`

### Navigation

- Dashboard pages at top-level routes (no `/dashboard` prefix)
- Sidebar navigation feels dense and fast
- Active state immediately visible
- Route header actions go through `headerActionStore`

## Offline & PWA UX

- Offline state must be visible, not implicit
- Pending sync state must be user-visible
- Dashboard reads degrade gracefully (offlineJsonCache)
- Offline mutations queue safely and idempotently
- Avoid flows that depend on silent background refresh assumptions

## Do

- Keep the interface compact
- Use clear visual hierarchy
- Prefer functional contrast over decoration
- Keep dashboards readable on laptop screens

## Do Not

- Add light-mode patterns
- Use the primary accent as decoration
- Introduce large empty sections without strong purpose
- Add visual noise that competes with logs, models, or operational data

## Implementation Pointers

| Resource               | Location                                                             |
| ---------------------- | -------------------------------------------------------------------- |
| Global design tokens   | `src/app/globals.css`                                                |
| Shared UI components   | `src/shared/components`                                              |
| Offline / PWA services | `src/shared/services` + `src/shared/components`                      |
| Dashboard pages        | Reuse existing layout & component patterns before inventing new ones |
