# Design

Visual system for the Strong & Hanni Project Documents portal. It follows the
**Strong & Hanni Design System**: calm, authoritative, paper-adjacent. One
accent family (brand blue), restrained semantic colors, and a signature
asymmetric surface curve. Think "quality legal paper," not "tech startup."

Tokens live in `src/app/globals.css` as `--sh-*` custom properties and are
exposed to Tailwind v4 through `@theme inline`. Shared components live in
`src/components/ui.tsx`.

## Color

| Tailwind name | Value | Role |
| --- | --- | --- |
| `navy` / `navy-deep` | `#1e2a6b` / `#151f57` | Authority: the one primary action in a view, the anchor surface. Hover/pressed. |
| `blue` / `blue-soft` | `#4f63c4` / `#7080d0` | Interaction: focus rings, active marks, spinners. De-emphasized marks (folder glyphs). |
| `ice` / `ice-deep` | `#eef1fb` / `#e4e9f8` | Inset fills, row hover, selected tint, progress track. |
| `workspace` | `#edf2fc` | App background (level 0). |
| `paper` | `#f8f9fc` | Quiet section fill (action bars, expanded lists, drop zone). |
| `surface` / `surface-nav` / `solid` | white at 90% / 86% / 100% | Content surface, floating nav, opaque panels (drawer, inputs). |
| `ink` / `secondary` / `tertiary` | `#171a26` / `#737c91` / `#7b849a` | Body and headings / metadata / uppercase labels. |
| `line` / `line-strong` | `#dfe3ed` / `#ced5e4` | Hairlines / control borders. |
| `success`, `info`, `warning`, `error` (+ `-bg`) | muted | **State only, never decoration.** |

At most two backgrounds per screen: workspace behind, translucent white for
content. Navy appears as the anchor and the primary button only.

## Typography

- **Manrope** (400–800) for all UI, headings and body; **Source Serif 4** for
  the one editorial moment (the sign-in tagline); **IBM Plex Mono** for
  identifiers: the project number, archive names, file sizes, counts and
  percentages. Loaded with `next/font/google`. These are placeholders until
  licensed brand faces are supplied.
- Body 15px / 1.6. Scale: `micro` 11, `xs` 13, `sm` 14, `base` 15, `lg` 17,
  `xl` 19 (h3), `2xl` 24, `3xl` 32, `4xl` 40.
- Headings: 600, 1.25, −0.012em. Sentence case, including buttons.
- **Eyebrows** (`.sh-eyebrow` / `<Eyebrow>`): 11px, 600, uppercase, 0.08em,
  tertiary color. Used for section labels and table headings.
- Wordmark: `STRONG & HANNI` over `LAW FIRM`, set as type (`<Wordmark>`). No
  logo file exists.

## Shape and elevation

- **Content surface** (`.sh-content-surface`): translucent white,
  `border-radius: 18px 42px 18px 42px`, soft navy-tinted shadow, backdrop blur.
  This curve is the brand's most distinctive mark.
- **Anchor surface** (`.sh-anchor-surface`): navy, mirrored
  `42px 18px 42px 18px`. Holds the current project.
- **Floating nav** (`.sh-nav-surface`): translucent, 18px radius, 12px inside
  the window edge.
- Buttons, inputs, tabs, tags, tree rows: full pill. Insets and bands 14px,
  panels 16px, checkbox 6px.
- Surface levels: 0 workspace → 1 floating nav → 2 content surface → 3 navy
  anchor → 4 inset status band.

## Layout

- **Shell:** floating nav (wordmark, "Project Documents", sign out) over the
  workspace. Content is capped at 1180px.
- **Sign-in:** the navy anchor (wordmark, serif tagline) beside one content
  surface with the single Microsoft sign-in action.
- **Project entry:** one centered content surface.
- **Folder browser:** the navy anchor names the current project (number in
  mono, folder count, "Open another project") above the folder tree, which
  sits directly on the workspace. Everything else is **one** content surface:
  path and tools, a borderless register listing (uppercase headings, hairline
  rules, ice hover), and the selection/action bar. Big surface, not many
  cards; the optional grid view uses quiet paper tiles.
- **Transfers:** a drawer over a navy-tinted scrim, inset from the window
  edge and carrying the content curve: header (eyebrow, title, mono metadata),
  status, result band, grouped file list, footer actions.
- Below `lg` the tree is hidden and the anchor becomes a strip; the breadcrumb
  and up button drive navigation.

## Components (`src/components/ui.tsx`)

- **Button** — pill; `primary` (navy), `secondary`, `ghost`, `tinted`,
  `danger`; `sm` / `md` / `lg`. **One primary per view**: when a resume or
  retry is offered, the other actions step down to secondary.
- **IconButton** — circular, requires a `label` (accessible name and tooltip).
- **Checkbox** — soft-square, navy fill, tri-state. Selecting a folder
  includes everything beneath it.
- **Switch** — pill toggle for "Convert documents to Markdown".
- **StatusBand** — inset semantic band for results and warnings (download
  finished, files missing, unidentified folders, cancel confirmation).
- **Badge** — small uppercase state pill ("New folder", "Watching").
- **ProgressBar**, **Spinner**, **Eyebrow**.
- **Drawer**, **DrawerHeader**, **CancelConfirm**, **GroupListHeader** — the
  shared frame of the download and upload panels.

Every interactive element has default, hover, focus-visible (2px blue ring),
disabled and, where relevant, selected states. Touch targets are at least
44px: `md`/`lg` buttons outright, small controls through an extended hit area
(`.sh-hit`, `.sh-hit-sm`). Selection is never conveyed by color alone
(checkbox glyph plus tint).

## Motion

- Ease `cubic-bezier(0.2, 0.6, 0.2, 1)`; 120 / 180 / 280 ms. Transitions
  convey state, never decoration.
- The drawer eases in from the right and the scrim fades.
- `prefers-reduced-motion: reduce` makes all of it instant.

## Known substitutions and limits

- Fonts are Google Fonts placeholders; icons are Lucide placeholders; the
  wordmark is type.
- The design system's `secondary` (`#737c91`) and `tertiary` (`#7b849a`) text
  colors measure about 4.2:1 and 3.7:1 on white, under WCAG AA's 4.5:1 for
  small text. They are used here for metadata and labels only; anything a
  person must read to act (consequences, errors, counts of missing files) is
  set in ink.
