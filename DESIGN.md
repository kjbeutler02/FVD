# Design

Visual system for the Strong & Hanni Project Documents portal. Derived from the firm Brand Guide (`002_BRAND_GUIDE.md`). Register: **product** — design serves the task. Strategy: **Restrained** — one brand color, tinted neutrals, color reserved for primary actions and current selection.

## Color

Defined as hex CSS variables in `src/app/globals.css` and exposed to Tailwind v4 via `@theme inline`.

| Token | Value | Role |
| --- | --- | --- |
| `--brand` | `#1E2A6B` | Brand deep blue. Header band, primary buttons, current selection, focus. |
| `--brand-dark` | `#161F54` | Primary button / interactive hover. |
| `--brand-light` | `#2A3A8A` | Focus ring, accent hovers. |
| `--brand-tint` | `#EAECF4` | Selected row/card background (deep blue at low strength). |
| `--ink` | `#0A0A0A` | Body text, headings. |
| `--muted` | `#6B7280` | Captions, helper text, secondary labels. |
| `--canvas` | `#F5F6F8` | App background / main content area. |
| `--surface` | `#FFFFFF` | Sidebar, cards, panels, inputs, drawer. |
| `--line` | `#E5E7EB` | Hairline borders, dividers. |
| success `#15803D` / error `#B91C1C` | semantic states only. |

Two-layer neutral: white `--surface` sidebar/panels sit on the `--canvas` content area. Accent (`--brand`) is never decorative — primary action, current selection, and state only. Gray text only on white/canvas, never on the blue band (use white / white at reduced opacity there).

## Typography

- **Montserrat** (`next/font/google`, weights 300–800), CSS var `--font-montserrat` → `--font-sans`. One family throughout (product register — no display/body pairing).
- Fixed rem scale, ratio ~1.2: page title `text-xl`/`text-2xl` 600–700; section headings `text-base`/`text-lg` 600; body `text-sm` 400; captions/helper `text-xs` 300–400.
- **Small labels / button text / eyebrows:** 500–600, `uppercase`, `tracking-wide`/`tracking-wider`. Used deliberately (sign-in label, "PROJECT" sidebar label, button text), not stamped on every section.
- Wordmark lockup: `STRONG & HANNI` (bold, `tracking-[0.08em]`) over `LAW FIRM` (medium, `tracking-[0.32em]`), both uppercase. Reusable `<Wordmark>` component, `on-blue` (white) and `on-light` (blue/black) variants.
- Headings use `text-wrap: balance`.

## Layout

- **App shell:** deep-blue top band (`--brand`) — wordmark left, account control (sign out) right — above a `--canvas` working area.
- **Drive view:** white left sidebar (project meta + folder navigation tree, `lg:` and up) + main area (breadcrumb bar → toolbar with list/grid toggle + select-all + filter → folder grid/list → sticky selection/download bar). Sidebar collapses below `lg`; breadcrumb + up-button drive navigation on mobile.
- **Entry / sign-in:** centered branded panel; sign-in is a split — deep-blue brand panel (stacked wordmark, tagline) + white form, stacking on mobile.
- **Download:** right side **drawer** (slide-over) over a dimmed backdrop — not a modal-first reflex; mirrors a drive's transfer panel.
- Radii: cards/panels `rounded-md`, buttons/inputs/checkbox `rounded-sm`. Shadows: `shadow-sm` ceiling. No glass, no gradients, no heavy shadow.
- Content max width is generous (drive feel) but inputs/entry stay focused (`max-w-md`–`max-w-lg`).

## Components

Each interactive element ships default / hover / focus / active / disabled / selected; loading and error where they apply.

- **Buttons** — Primary: solid `--brand`, white, uppercase tracked, `rounded-sm`, hover `--brand-dark`, disabled 50%. Secondary: white, `--line` border, ink text. Ghost: transparent, hover canvas tint (toolbar/icon actions).
- **Checkbox** — tri-state (checked / indeterminate / unchecked) `rounded-sm`; brand fill + white glyph when active; selecting a folder includes all descendants.
- **Folder card (grid)** & **folder row (list)** — folder icon (brand), name, sub-count; checkbox to select, body click to open; selected = `--brand-tint` bg + brand border + checked.
- **Breadcrumb** — clickable segments, `ChevronRight` separators, root = "All Folders".
- **Sidebar tree** — indented expand/collapse nav; current folder highlighted with brand tint; navigation only (selection lives in the main area).
- **Drawer** — phase-driven (scanning → downloading → zipping → complete / error), brand progress bar, scrollable per-file status list.
- **States** — scan uses a spinner with live count; empty folder explains documents still download when selected; partial-failure download reports counts; errors are branded, never dead ends.

## Motion

- 150–250 ms, ease-out. Transitions convey state, not decoration; no orchestrated page-load sequence.
- Drawer slides in from right; backdrop fades. List/grid selection and hover are quick tints.
- `@media (prefers-reduced-motion: reduce)`: drawer + reveals become instant/crossfade.
