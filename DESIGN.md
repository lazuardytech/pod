# Pod Design

Last reviewed: 2026-08-25 · Pod v0.0.86

Pod uses a compact, dark-only control-panel UI inspired by Linear — technical, dense, calm, and high-signal.

Dashboard interactive controls are **shadcn/ui (base-nova, `@base-ui/react`)** behind Pod adapters. Tokens stay Pod-native; shadcn CSS variables alias those tokens. This file matches `src/app/globals.css`, not an older palette sketch.

## Design Direction

- **Tone**: technical, dense, calm, high-signal
- **Theme**: dark only (dashboard defaults to `html.dark`)
- **Primary CTA**: alabaster on pitch-black (`bg-primary` + `text-primary-fg` / `text-primary-foreground`)
- **Default feel**: operational dashboard, not marketing site

## Core Rules

1. Keep the darkest surface as the page background.
2. Reserve `bg-primary` for CTAs and selected states; pair with `text-primary-fg`.
3. Prefer compact spacing and small control density (not default shadcn marketing sizes).
4. Use subtle elevation; avoid decorative shadows.
5. Favor strong contrast for text and status clarity.
6. Keep interactive components visually consistent across dashboard pages.
7. Import public adapters from `@/shared/components`. Do not import `@/shared/components/ui/*` from pages.

## Component Architecture

Two layers, one public API:

| Layer             | Path                             | Role                                                                               |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Public adapters   | `src/shared/components/*.tsx`    | Stable props (`icon="add"`, `ConfirmModal`, `padding` on Card). Pages import here. |
| shadcn primitives | `src/shared/components/ui/*.tsx` | CLI output. Adapters only.                                                         |
| Registry          | `components.json`                | Aliases: `ui` → `@/shared/components/ui`, `utils` → `@/shared/utils/cn`            |

`cn()` is `clsx` + `tailwind-merge` (`src/shared/utils/cn.ts`). Later Tailwind classes win (`p-3` + `pt-0` → no top padding).

Add new primitives with `bunx --bun shadcn@latest add <name>`. Wrap them in an adapter before using on a page.

### Public adapter → shadcn primitive

| Public (`@/shared/components`)                      | Primitive (`ui/`)         | Notes                                                                                                                                                  |
| --------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`                                            | `Button`                  | Variants: `primary` / `secondary` / `outline` / `ghost` / `danger` / `success`. `icon` / `iconRight` via `LucideIcon`. `loading` = spinner + disabled. |
| `IconButton`                                        | `Button` `size="icon-sm"` | Square toolbar/row actions. Prefer this over raw `<button>`.                                                                                           |
| `SegmentedControl`                                  | `ToggleGroup` (single)    | Exclusive options (Caveman/Ponytail Off/Lite/Full/Ultra, Cost/Tokens).                                                                                 |
| `Toggle`                                            | `Switch`                  | Settings on/off. Keep the `Toggle` name.                                                                                                               |
| `Input`                                             | `Input` + `Label`         | Optional `icon`, `error`, `hint`.                                                                                                                      |
| `Select` / `ShadcnSelect`                           | `Select`                  | One Radix select. `ShadcnSelect` is a thin alias.                                                                                                      |
| `Badge`                                             | `Badge`                   | Compact radius `4px`; status colors via Pod tokens.                                                                                                    |
| `Card`                                              | `Card`                    | `padding="none"` when the header must flush to the top edge. Keep `Card.Section` / `Row` / `ListItem`.                                                 |
| `Modal`                                             | `Dialog`                  | Overlay dialogs.                                                                                                                                       |
| `ConfirmModal`                                      | `AlertDialog`             | **Keep this name.** Never `window.confirm()`.                                                                                                          |
| `Tooltip`                                           | `Tooltip`                 | App is wrapped in `TooltipProvider` (`src/app/layout.tsx`).                                                                                            |
| `Pagination`                                        | `Button`                  | Compact prev/next + page numbers.                                                                                                                      |
| `Drawer`                                            | `Drawer`                  | Side panels.                                                                                                                                           |
| `DatePicker`                                        | `Popover` + `Calendar`    | `react-day-picker`.                                                                                                                                    |
| `Loading` / `CardSkeleton` / `Skeleton` / `Spinner` | `Skeleton`                |                                                                                                                                                        |

Also installed for chrome/adapters: `DropdownMenu`, `Tabs`, `Separator`, `Textarea`. Use `Tabs` for panel switchers (Logs Request/Console/Proxy); use `SegmentedControl` for exclusive options that do not change page structure.

`LucideIcon` stays — string icon names (`"add"`, `"close"`) map to `lucide-react`. Do not pass raw Lucide components from pages.

## Color Model

Pod named tokens (`@theme` in `globals.css`) are canonical. shadcn semantic vars in `.dark` alias them:

| Pod token / CSS var                | Hex       | shadcn var (`.dark`)                 | Role                        |
| ---------------------------------- | --------- | ------------------------------------ | --------------------------- |
| `--color-bg` / pitch-black         | `#08090a` | `--background`                       | Page background             |
| `--color-surface` / graphite       | `#0f1011` | `--card`, `--popover`, `--sidebar`   | Cards, sidebar              |
| `--color-surface-2` / deep-slate   | `#161718` | `--secondary`, `--muted`, `--accent` | Elevated surface            |
| `--color-border` / charcoal-grey   | `#23252a` | `--border`, `--input`                | Default border              |
| `--color-text` / porcelain         | `#f7f8f8` | `--foreground`                       | Primary text                |
| `--color-text-muted` / storm-cloud | `#8a8f98` | `--muted-foreground`, `--ring`       | Secondary text              |
| `--color-primary` / alabaster      | `#e5e5e6` | `--primary`                          | CTA / selected              |
| `--color-primary-fg`               | `#08090a` | `--primary-foreground`               | Text on primary             |
| `--color-success` / emerald        | `#27a644` | `--chart-2`                          | Success                     |
| `--color-danger` / warning-red     | `#eb5757` | `--destructive`                      | Error / destructive         |
| `--color-warning`                  | `#f59e0b` | `--chart-3`                          | Warning                     |
| `--color-info` / aether-blue       | `#5e6ad2` | `--chart-1`                          | Informational, sparingly    |
| `--color-neon-lime`                | `#e4f222` | —                                    | Palette only (unused in UI) |

`--radius` in `.dark` is `0.375rem` (6px), matching `--radius-default`.

## Typography

- **UI font**: Geist (`next/font/google`, `--font-geist-sans` → `--font-sans`)
- **Monospace**: IBM Plex Mono (`--font-mono`) — model IDs, aliases, endpoints, logs
- **Brand**: DM Sans (`--font-brand`)

## Spacing and Shape

- **Base spacing unit**: `4px`
- **Standard radius**: `--radius-default` `6px` (cards, inputs, buttons)
- Compact internal gaps preferred over airy layouts
- Pill shapes (`--radius-pill`) reserved for badges, chips, and toggled states
- Control density: text buttons `h-8` / `h-9`; icon buttons `size-7` (md) / `size-5` (sm)

## Component Rules

### Buttons

- Primary: `bg-primary` + `text-primary-fg` (`variant="primary"`)
- Secondary stays neutral and low-noise (`variant="secondary"` / `outline`)
- Destructive uses `--color-danger` (`variant="danger"`)
- Ghost reads as tertiary, not hidden (`variant="ghost"`)
- Icon-only toolbar/row actions: `IconButton`, not a styled `<button>`
- Header route actions still go through `src/store/headerActionStore.ts` — render them with `Button` / `IconButton`

### Button groups

- Exclusive modes: `SegmentedControl`
- Content panel switchers: `Tabs` (or `SegmentedControl` where already used)
- Do not loop `Button` with manual active state for 2–7 options

### Cards

- Default containment pattern
- Nested dark layers (`surface` / `surface-2`) instead of heavy borders
- Flush header to the card edge: `padding="none"` + `pt-0` (Usage Details, Recent Requests)

### Inputs and selects

- Dark and calm by default; focus obvious but not loud
- Use shared `Input` / `Select` — no native `<select>` / raw `<input>` on dashboard forms
- Never sacrifice readability for style

### Status & Feedback

- Explicit success, warning, and error colors
- Health, usage, lockout, and queue states must be easy to scan
- Concise text over decorative UI
- Toasts via `sonner`
- `ConfirmModal` for destructive confirms — never `window.confirm()`

### Navigation

- Dashboard pages at top-level routes (no `/dashboard` prefix)
- Sidebar navigation feels dense and fast; active state immediately visible
- Header chrome: `IconButton` + `DropdownMenu` (`HeaderMenu`)

## Dashboard Routes

15 dashboard pages under `src/app/(dashboard)/` (route group; URLs have no `/dashboard` prefix). `/` renders the Endpoint page.

Endpoint Token Saver uses `Toggle` (RTK, Headroom) and `SegmentedControl` (Caveman + Ponytail Off/Lite/Full/Ultra). Combos Vision Adapter is a same-density card (vision + audio pools), not extra chrome.

| Page            | Route               |
| --------------- | ------------------- |
| Endpoint        | `/` and `/endpoint` |
| LLM Providers   | `/providers`        |
| Media Providers | `/media-providers`  |
| Combos          | `/combos`           |
| Quota           | `/quota`            |
| Usage           | `/usage`            |
| Memory          | `/memory`           |
| Cache           | `/cache`            |
| Health          | `/health`           |
| Logs            | `/logs`             |
| Proxy Pools     | `/proxy-pools`      |
| Settings        | `/settings`         |
| Translator      | `/translator`       |
| Basic Chat      | `/basic-chat`       |
| Pricing         | `/settings/pricing` |

Auth / system pages: `/login`, `/landing`, `/callback`, `/offline`.

**Out of this kit:** `/landing` (marketing chrome) and `/basic-chat` (custom chat UI). Monaco, Recharts, xyflow, and `@dnd-kit` drag handles stay as-is.

## Offline & PWA UX

- Offline state must be visible, not implicit
- Pending sync state must be user-visible
- Dashboard reads degrade gracefully (`offlineJsonCache`)
- Offline mutations queue safely and idempotently
- Avoid flows that depend on silent background refresh assumptions

## Do

- Keep the interface compact
- Use shared adapters, not one-off controls
- Use clear visual hierarchy
- Prefer functional contrast over decoration
- Keep dashboards readable on laptop screens

## Do Not

- Add light-mode patterns as the dashboard default
- Use primary as decoration (it is the CTA color)
- Introduce large empty sections without strong purpose
- Add visual noise that competes with logs, models, or operational data
- Import `@/shared/components/ui/*` from page files
- Scaffold a second `src/components/ui` tree

## Implementation Pointers

| Resource               | Location                                               |
| ---------------------- | ------------------------------------------------------ |
| Global design tokens   | `src/app/globals.css` (`@theme` + `.dark` shadcn vars) |
| shadcn registry        | `components.json`                                      |
| Public UI adapters     | `src/shared/components`                                |
| shadcn primitives      | `src/shared/components/ui`                             |
| `cn()`                 | `src/shared/utils/cn.ts`                               |
| Zustand stores         | `src/store/`                                           |
| Offline / PWA services | `src/shared/services` + `src/shared/components`        |
| Dashboard pages        | `src/app/(dashboard)/`                                 |
