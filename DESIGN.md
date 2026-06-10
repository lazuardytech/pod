# Pod Design

Pod uses a compact, dark-only control-panel UI inspired by Linear.

## Design Direction

- Tone: technical, dense, calm, high-signal
- Theme: dark only
- Accent: a single primary highlight for important actions
- Default feel: operational dashboard, not marketing site

## Core Rules

1. Keep the darkest surface as the page background.
2. Reserve the primary accent for CTA and active states.
3. Prefer compact spacing and small control density.
4. Use subtle elevation; avoid decorative shadows.
5. Favor strong contrast for text and status clarity.
6. Keep interactive components visually consistent across dashboard pages.

## Color Model

- Background: near-black
- Surface: dark graphite
- Elevated surface: slightly lighter dark slate
- Border: muted charcoal
- Primary text: near-white
- Secondary text: muted gray
- Primary accent: neon-lime family
- Success: green
- Warning/Error: red
- Informational accents: blue/cyan, used sparingly

## Typography

- Primary UI font: `Inter`
- Monospace: `Berkeley Mono`-style fallback stack
- General style: tight tracking, compact line height, strong hierarchy
- Use mono for model IDs, provider aliases, endpoints, and logs

## Spacing and Shape

- Base spacing unit: `4px`
- Standard component radius: `6px`
- Compact internal gaps are preferred over airy layouts
- Use pill shapes only for badges, chips, or toggled states

## Component Rules

### Buttons

- Primary buttons use the primary accent with dark foreground
- Secondary buttons stay neutral and low-noise
- Destructive actions use red
- Ghost buttons should read as tertiary controls, not hidden actions

### Cards

- Cards are the default containment pattern
- Use nested dark layers instead of heavy borders
- Keep padding compact and predictable

### Inputs

- Inputs should stay dark and calm by default
- Focus state should be obvious but not loud
- Never sacrifice readability for style

### Status and Feedback

- Use explicit success, warning, and error colors
- Health, usage, lockout, and queue states must be easy to scan
- Prefer concise text over decorative UI

## Navigation

- Sidebar and dashboard navigation should feel dense and fast
- Active state should be immediately visible
- Route grouping should stay simple and operational

## Offline and PWA UX

- Offline state should be visible, not implicit
- Pending sync state must be user-visible
- Dashboard reads should degrade gracefully
- Avoid flows that depend on silent background refresh assumptions

## Do

- Keep the interface compact
- Use clear visual hierarchy
- Prefer functional contrast over decoration
- Keep dashboards readable on laptop screens

## Do Not

- Do not add light-mode patterns
- Do not use the primary accent as decoration
- Do not introduce large empty sections without strong purpose
- Do not add visual noise that competes with logs, models, or operational data

## Implementation Pointers

- Global tokens live in `src/app/globals.css`
- Shared UI components live in `src/shared/components`
- Offline/PWA UI lives in `src/shared/services` and `src/shared/components`
- Dashboard pages should reuse existing layout and component patterns before inventing new ones
