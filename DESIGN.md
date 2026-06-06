# Pod Design System

> Reference: [Linear Design System — Refero](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1)
> Theme: **Dark only** — "Midnight Command Center"

---

## Overview

Pod adopts the Linear design language: a deep, layered dark-mode interface with a single vivid accent (Neon Lime `#e4f222`) reserved exclusively for primary actions. The aesthetic is compact, precise, and technical — like a high-performance control panel.

---

## Color Tokens

All tokens are defined in `src/app/globals.css` under `@theme {}` (Tailwind v4).

| Name | Hex | Token | Role |
|---|---|---|---|
| Pitch Black | `#08090a` | `--color-pitch-black` | Page background, deepest surface |
| Graphite | `#0f1011` | `--color-graphite` | Primary card surface |
| Deep Slate | `#161718` | `--color-deep-slate` | Elevated card surface |
| Charcoal Grey | `#23252a` | `--color-charcoal-grey` | Borders, overlays |
| Muted Ash | `#323334` | `--color-muted-ash` | Subtle dividers |
| Gunmetal | `#383b3f` | `--color-gunmetal` | Input backgrounds, tertiary surfaces |
| Porcelain | `#f7f8f8` | `--color-porcelain` | Primary text, important icons |
| Light Steel | `#d0d6e0` | `--color-light-steel` | Secondary text, borders |
| Storm Cloud | `#8a8f98` | `--color-storm-cloud` | Tertiary text, labels, inactive states |
| Fog Grey | `#62666d` | `--color-fog-grey` | Metadata, timestamps, de-emphasized |
| Alabaster | `#e5e5e6` | `--color-alabaster` | Code block borders, subtle fills |
| Neon Lime | `#e4f222` | `--color-neon-lime` | **Primary action only** — CTA, active states |
| Aether Blue | `#5e6ad2` | `--color-aether-blue` | Decorative highlights, info accents |
| Forest Green | `#008d2c` | `--color-forest-green` | Positive status indicators |
| Cyan Spark | `#02b8cc` | `--color-cyan-spark` | Informational highlights |
| Emerald | `#27a644` | `--color-emerald` | Success, completion states |
| Warning Red | `#eb5757` | `--color-warning-red` | Error, destructive actions |
| Deep Violet | `#6366f1` | `--color-deep-violet` | Background accents |
| Amethyst | `#8b5cf6` | `--color-amethyst` | Variant violet accents |

### Semantic Aliases (used in components)

| Token | Maps To | Usage |
|---|---|---|
| `--color-bg` | Pitch Black `#08090a` | Page background |
| `--color-surface` | Graphite `#0f1011` | Card background |
| `--color-surface-2` | Deep Slate `#161718` | Elevated card |
| `--color-surface-3` | Charcoal Grey `#23252a` | Overlay, hover |
| `--color-border` | Charcoal Grey `#23252a` | Primary borders |
| `--color-border-subtle` | Muted Ash `#323334` | Subtle dividers |
| `--color-text` | Porcelain `#f7f8f8` | Primary text |
| `--color-text-muted` | Storm Cloud `#8a8f98` | Secondary text |
| `--color-text-subtle` | Fog Grey `#62666d` | Tertiary text |
| `--color-primary` | Neon Lime `#e4f222` | Primary action bg |
| `--color-primary-fg` | Pitch Black `#08090a` | Text on primary |

---

## Typography

### Fonts

| Role | Family | Fallback | Weights |
|---|---|---|---|
| UI / Body | Inter Variable | Inter, system-ui | 300, 400, 510, 590 |
| Code / Mono | Berkeley Mono | IBM Plex Mono, monospace | 400 |

Loaded via `next/font` (local or Google). OpenType features: `"cv01", "ss03"`.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|---|---|---|---|---|
| caption | 10px | 1.4 | -0.1px | `text-caption` |
| body | 14px | 1.4 | -0.13px | `text-body` |
| label | 13px | 1.47 | -0.12px | `text-label` |
| heading-sm | 17px | 1.6 | -0.13px | `text-heading-sm` |
| heading | 24px | 1.33 | -0.22px | `text-heading` |
| heading-lg | 48px | 1.2 | -0.22px | `text-heading-lg` |
| display | 72px | 1.0 | -0.22px | `text-display` |

### Font Weights

| Name | Value |
|---|---|
| light | 300 |
| regular | 400 |
| medium | 510 |
| semibold | 590 |

---

## Spacing

Base unit: **4px**. Density: **compact**.

| Token | Value |
|---|---|
| `--spacing-1` | 4px |
| `--spacing-2` | 8px |
| `--spacing-3` | 12px |
| `--spacing-4` | 16px |
| `--spacing-5` | 20px |
| `--spacing-6` | 24px |
| `--spacing-8` | 32px |
| `--spacing-10` | 40px |
| `--spacing-12` | 48px |
| `--spacing-16` | 64px |

Layout constants:
- Section gap: `24px`
- Card padding: `12px`
- Element gap: `8px`

---

## Border Radius

| Element | Value | Tailwind |
|---|---|---|
| tags | 2px | `rounded-[2px]` |
| badges | 4px | `rounded-[4px]` |
| buttons | 6px | `rounded-[6px]` |
| inputs | 6px | `rounded-[6px]` |
| cards | 6px | `rounded-[6px]` |
| default | 6px | `rounded-[6px]` |
| pill | 9999px | `rounded-full` |

---

## Shadows & Elevation

| Name | Value | Token |
|---|---|---|
| sm | `rgba(0,0,0,0.4) 0px 2px 4px 0px` | `--shadow-sm` |
| md (inset) | `rgba(0,0,0,0.2) 0px 0px 12px 0px inset` | `--shadow-md` |
| subtle | `rgb(35,37,42) 0px 0px 0px 1px inset` | `--shadow-subtle` |
| subtle-2 | `rgba(0,0,0,0.2) 0px 0px 0px 1px` | `--shadow-subtle-2` |
| xl | `rgba(8,9,10,0.6) 0px 4px 32px 0px` | `--shadow-xl` |
| subtle-6 | `rgba(255,255,255,0.03) 0px 0px 0px 1px inset, rgba(255,255,255,0.04) 0px 1px 0px 0px inset, rgba(0,0,0,0.6) 0px 0px 0px 1px, rgba(0,0,0,0.1) 0px 4px 4px 0px` | `--shadow-subtle-6` |

### Surface Layers

| Level | Name | Color | Purpose |
|---|---|---|---|
| 0 | Canvas | `#08090a` | Page background |
| 1 | Card | `#0f1011` | Default card |
| 2 | Elevated | `#161718` | Focused sections, lists |
| 3 | Overlay | `#23252a` | Borders, hover states |

---

## Components

### Button

| Variant | Background | Text | Border Radius | Notes |
|---|---|---|---|---|
| primary | Neon Lime `#e4f222` | Pitch Black `#08090a` | 6px | Only CTA usage |
| secondary | Gunmetal `#383b3f` | Porcelain `#f7f8f8` | 6px | General actions |
| ghost | transparent | Storm Cloud `#8a8f98` | 6px | Nav, tertiary |
| danger | Warning Red `#eb5757` | Porcelain | 6px | Destructive |
| outline | transparent | Light Steel `#d0d6e0` | 6px | Subtle links |

Sizes: `sm` (h-7), `md` (h-8), `lg` (h-9). Padding: 12px vertical, 24px horizontal for primary.

### Card

| Variant | Background | Border Radius | Shadow |
|---|---|---|---|
| default | Graphite `#0f1011` | 6px | `--shadow-sm` |
| elevated | Deep Slate `#161718` | 6px | `--shadow-subtle` (inset) |
| nested | Pitch Black `#08090a` | 6px | none |

Padding: 8px (compact), 12px (default).

### Input

- Background: transparent with Gunmetal `#383b3f` fill
- Text: Porcelain `#f7f8f8`
- Border: 1px Charcoal Grey `#23252a`
- Border radius: 6px
- Padding: 12px vertical, 14px horizontal
- Focus: 1px Neon Lime border

### Badge

- Background: Gunmetal `#383b3f`
- Text: Storm Cloud `#8a8f98`
- Border radius: 4px
- Padding: 0px vertical, 6px horizontal

### Sidebar Navigation Item

- Background: transparent (active: `rgba(228,242,34,0.08)`)
- Text: Storm Cloud `#8a8f98` (active: Neon Lime `#e4f222`)
- Border radius: 2px
- Font: 13px, weight 400

---

## Do's and Don'ts

### Do
- Use Pitch Black `#08090a` for all page backgrounds
- Use Porcelain `#f7f8f8` for primary text and icons
- Reserve Neon Lime `#e4f222` exclusively for primary CTA buttons and active states
- Layer surfaces: Pitch Black → Graphite → Deep Slate → Charcoal Grey
- Use Inter Variable with tight letter-spacing (-0.22px display, -0.13px body)
- Use 6px border-radius for buttons, cards, inputs
- Keep layout compact — 8px element gap, 24px section gap

### Don't
- Don't use light backgrounds or light-mode patterns anywhere
- Don't use Neon Lime for decorative purposes — only primary actions
- Don't deviate from Inter Variable and Berkeley Mono
- Don't use diffuse or decorative shadows — elevation is subtle and contained
- Don't apply broad background gradients — keep them minimal and functional
- Don't use generic border-radii — 6px for components, 2px for tags
- Don't add excessive whitespace — the design is intentionally dense

---

## Implementation Status

All four phases are complete as of v0.0.79. The entire UI — tokens, components, layouts, pages, landing — uses the Midnight Command Center design system.

### Phase 1 — Foundation ✅
Token migration in `globals.css`: Linear tokens under `@theme {}`, semantic aliases, Inter Variable + Berkeley Mono font stack.

### Phase 2 — Core Components ✅
`Button` (5 variants), `Card` (3 variants), `Input`, `Badge`, `Modal`, `ConfirmModal`, `Select`, `Toggle`, `SegmentedControl`, `Tooltip`, `Loading`, `Pagination` — all using Linear tokens and specs.

### Phase 3 — Layout & Navigation ✅
`Sidebar`, `Header`, `DashboardLayout`, `AuthLayout` with Linear sidebar patterns: compact nav items, Neon Lime active states, layered surface hierarchy.

### Phase 4 — Pages & Landing ✅
All dashboard pages, landing page, charts (Recharts), tables, forms match the Linear aesthetic.
