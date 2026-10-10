# Design System

Owner: ui-ux-design agent. The visual direction in this document was **approved by the project owner on 2026-10-11** (see [DECISIONS.md](DECISIONS.md), D-018), with refinements to come later. It supersedes the earlier indigo starting values. The tokens are implemented in `src/app/globals.css` and the primitives in `src/components/ui/` (T-017). Contrast ratios below are **computed from the implemented token values**: `src/components/ui/tokens.test.ts` reads `globals.css`, recomputes every pair in the contrast tables, and fails when a ratio differs from this document or drops under its threshold.

Three questions are waiting for the owner. Each is implemented as a single value that can be changed in one line; none is decided here.

| Id | Question | Value in use until the owner answers | Where to change |
| --- | --- | --- | --- |
| OQ-01 | Border of form controls and outline buttons: approved `--border-strong` (1.59:1, fails 3:1) or `--border-contrast` (3.63:1)? | `--border-strong` | `--control-border` in `src/app/globals.css` |
| OQ-02 | Colour of the fulfilment `SHIPPED` status badge | primary (the mapping below) | `SHIPPED_TONE` in `src/components/ui/badge.tsx` |
| OQ-03 | Colour of the selected page, tab, and navigation item | `--ink`, as the selected chip in the approved mockups | `--selected` in `src/app/globals.css` |

How to read the values in this document:

- **Approved** means the value appears in the mockups the owner signed off.
- **Derived, not yet shown to the owner** means the mockups do not show it; it was chosen to fit the approved palette and to pass contrast. Derived values may change when the owner reviews them.

## Principles

1. Content first: products, prices, and actions are the loudest things on the page.
2. One system across storefront, seller dashboard, and admin dashboard. Dashboards are denser, not differently styled.
3. Calm: white and light neutral surfaces, near-black ink, one accent colour, minimal motion.
4. Honest: no placeholder ratings, sales counts, or testimonials. Sample and simulated data are labelled.
5. Thai-first typography and copy.

## Colour tokens

Defined as CSS variables and mapped into the Tailwind theme. Light theme only in the MVP.

### Approved tokens

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#FFFFFF` | Page background |
| `--surface` | `#FFFFFF` | Cards, panels, inputs |
| `--surface-muted` | `#F4F5F3` | Muted section fill, table headers, subtle fills |
| `--border` | `#E6E8EA` | Dividers, card and panel borders |
| `--border-strong` | `#C9CDD1` | Stronger control border (inputs, outline buttons, chips) |
| `--text` | `#14171A` | Primary text (ink) |
| `--text-secondary` | `#4A5158` | Secondary text: descriptions, supporting paragraphs |
| `--text-muted` | `#5C636B` | Meta text: store name, helper text, captions |
| `--text-nav` | `#3D444B` | Header and category navigation links at rest |
| `--primary` | `#0E7C66` | Accent. See the usage rule below |
| `--on-primary` | `#FFFFFF` | Text and icons on `--primary` |
| `--ink` | `#14171A` | Dark action surface: search button, seller call-to-action band, selected chip |
| `--on-ink` | `#FFFFFF` | Text and icons on `--ink` |
| `--success` | `#15803D` | Success text and icons |
| `--warning` | `#8A4B0A` | Warning text and the sample/simulated data label text |
| `--warning-soft` | `#FDF3E1` | Background for warning and for the sample/simulated data label |
| `--placeholder-1` | `#E6EEE9` | Product image placeholder tint |
| `--placeholder-2` | `#EEF0F6` | Product image placeholder tint |
| `--placeholder-3` | `#F3ECE3` | Product image placeholder tint |
| `--placeholder-4` | `#F1EAF0` | Product image placeholder tint |
| `--placeholder-5` | `#E8F0F2` | Product image placeholder tint |

`--text` and `--ink` share one value on purpose. They are separate tokens because one is a text colour and the other is a surface colour.

### Derived tokens (derived, not yet shown to the owner)

Every row in this table is **derived, not yet shown to the owner**.

| Token | Value | Use |
| --- | --- | --- |
| `--primary-hover` | `#0B6654` | Hover on primary buttons and links. Derived |
| `--primary-active` | `#095446` | Pressed primary button. Derived |
| `--primary-soft` | `#EDF7F4` | Selected rows, primary badge background, highlights. Derived |
| `--ink-hover` | `#2B3036` | Hover on dark action surfaces. Derived |
| `--ink-active` | `#3D444B` | Pressed dark button. Derived, added in T-017 |
| `--success-soft` | `#F0F9F2` | Success badge and alert background. Derived |
| `--danger` | `#B42318` | Error text, destructive actions. Derived |
| `--danger-hover` | `#912018` | Hover on danger buttons. Derived |
| `--danger-active` | `#7A1B14` | Pressed danger button. Derived, added in T-017 |
| `--on-danger` | `#FFFFFF` | Text on `--danger`. Derived |
| `--danger-soft` | `#FDECEA` | Danger badge and alert background. Derived |
| `--info` | `#1D5A96` | Informational text and icons. Derived |
| `--info-soft` | `#E7F0F8` | Info badge and alert background. Derived |
| `--text-disabled` | `#8B9198` | Text of disabled controls only. Derived |
| `--border-contrast` | `#7F8790` | Proposed control border that meets 3:1. Not applied by default; see the note under the contrast table. Derived |
| `--focus-ring` | `#0E7C66` | 2px ring with a 2px offset in the colour of the surface behind the control. Derived |
| `--focus-ring-on-ink` | `#FFFFFF` | Focus ring for controls that sit on an `--ink` surface. Derived |

### Alias tokens for the open questions

These tokens hold no colour of their own. Each points at another token so that the owner's answer is a one-line change.

| Token | Points at | Use |
| --- | --- | --- |
| `--control-border` | `--border-strong` (OQ-01) | Border of inputs, textareas, selects, checkboxes, radios, the quantity stepper, the search field, chips at rest, and outline buttons |
| `--selected` | `--ink` (OQ-03) | Fill of the current page in Pagination; later the selected tab and navigation item |
| `--on-selected` | `--on-ink` (OQ-03) | Text on `--selected`. Changes with `--selected` only if the new fill is not dark |

The selected chip is not routed through `--selected`: the approved mockups show it in `--ink`, so it uses `--ink` directly.

### Tailwind class names

Tailwind v4 is configured in `src/app/globals.css` (`@theme`); there is no `tailwind.config` file. The default Tailwind palette, radius scale, shadow scale, and font-size scale are removed, so only the values in this document exist as class names (`bg-red-500` and `rounded-2xl` do not compile to anything).

| Token | Colour name in classes | Example |
| --- | --- | --- |
| `--background`, `--surface`, `--surface-muted` | `background`, `surface`, `surface-muted` | `bg-surface-muted` |
| `--border`, `--border-strong`, `--border-contrast`, `--control-border` | `border`, `border-strong`, `border-contrast`, `control-border` | `border-border`, `border-control-border` |
| `--text`, `--text-secondary`, `--text-muted`, `--text-nav`, `--text-disabled` | `foreground`, `foreground-secondary`, `foreground-muted`, `foreground-nav`, `foreground-disabled` | `text-foreground-muted` |
| `--primary`, `--primary-hover`, `--primary-active`, `--primary-soft`, `--on-primary` | same names | `bg-primary text-on-primary` |
| `--ink`, `--ink-hover`, `--ink-active`, `--on-ink` | same names | `bg-ink text-on-ink` |
| `--selected`, `--on-selected` | same names | `bg-selected text-on-selected` |
| `--success`, `--warning`, `--danger`, `--info` and their `-soft`, `-hover`, `-active`, `on-` forms | same names | `bg-danger-soft text-danger` |
| `--placeholder-1` to `--placeholder-5` | `placeholder-1` to `placeholder-5` | `bg-placeholder-3` |
| `--focus-ring`, `--focus-ring-on-ink` | used through the `focus-ring` utility | `focus-ring` |

The text tokens are named `foreground*` in classes because Tailwind reserves the `text-` prefix for both colour and font size (`text-text-muted` would be the alternative).

Custom utilities defined in `globals.css`:

| Utility | Effect |
| --- | --- |
| `type-hero`, `type-page-title`, `type-section-title`, `type-panel-title`, `type-card-title`, `type-body`, `type-small`, `type-caption`, `type-label`, `type-price-card`, `type-price-page` | The named type styles of the Typography table (size, line height, weight; the price styles add tabular numerals) |
| `focus-ring` | On `:focus-visible`: 2px outline in `--focus-ring` with a 2px offset |
| `focus-ring-within` | The same ring on a wrapper while an `input` inside it has keyboard focus (SearchField) |
| `on-ink` | Put it on a container with an `--ink` background: every `focus-ring` inside switches to `--focus-ring-on-ink` |
| `container-page` | Page container: max width 1200px, gutters `clamp(16px, 4vw, 32px)` |

### Accent usage rule

`--primary` is used only for primary buttons, links, the cart count badge, and active states. It is not used for decoration, headings, section fills, icons at rest, or prices. Prices are `--text`.

The selected chip uses `--ink` with `--on-ink`, as in the mockups, not `--primary`.

### Placeholder tints

Until real product photos exist, the product image area is filled with one of the five placeholder tints. The tint is picked deterministically from the product id (for example index modulo 5) so a product keeps its tint across pages and reloads. The picking rule is derived, not yet shown to the owner. Placeholder tints are decorative and carry no meaning.

### Contrast

Ratios are WCAG 2.1 relative-luminance contrast, **computed from the implemented token values in `src/app/globals.css`** by `src/components/ui/tokens.test.ts` (run with `pnpm test`) and rounded down to two decimals. They are calculated from the token values, not measured from rendered pixels in a browser. Requirement: 4.5:1 for body text, 3:1 for large text and control boundaries.

T-017 changed no existing token value; every ratio that was already in these tables was recomputed from `globals.css` and is unchanged. Rows marked "T-017" are new pairs that the primitives use.

Text pairs:

| Foreground | Background | Ratio | Needs | Result |
| --- | --- | --- | --- | --- |
| `--text` `#14171A` | `--background` `#FFFFFF` | 17.99 | 4.5 | Pass |
| `--text` `#14171A` | `--surface-muted` `#F4F5F3` | 16.45 | 4.5 | Pass |
| `--text-secondary` `#4A5158` | `#FFFFFF` | 8.04 | 4.5 | Pass |
| `--text-secondary` `#4A5158` | `--surface-muted` `#F4F5F3` | 7.35 | 4.5 | Pass |
| `--text-muted` `#5C636B` | `#FFFFFF` | 6.08 | 4.5 | Pass |
| `--text-muted` `#5C636B` | `--surface-muted` `#F4F5F3` | 5.56 | 4.5 | Pass |
| `--text-nav` `#3D444B` | `#FFFFFF` | 9.87 | 4.5 | Pass |
| `--text-nav` `#3D444B` | `--surface-muted` `#F4F5F3` | 9.02 | 4.5 | Pass |
| `--on-primary` `#FFFFFF` | `--primary` `#0E7C66` | 5.12 | 4.5 | Pass |
| `--on-primary` `#FFFFFF` | `--primary-hover` `#0B6654` | 6.90 | 4.5 | Pass |
| `--on-primary` `#FFFFFF` | `--primary-active` `#095446` | 8.86 | 4.5 | Pass |
| `--primary` `#0E7C66` (link) | `#FFFFFF` | 5.12 | 4.5 | Pass |
| `--primary` `#0E7C66` (link) | `--surface-muted` `#F4F5F3` | 4.69 | 4.5 | Pass |
| `--primary` `#0E7C66` | `--primary-soft` `#EDF7F4` | 4.69 | 4.5 | Pass |
| `--on-ink` `#FFFFFF` | `--ink` `#14171A` | 17.99 | 4.5 | Pass |
| `--on-ink` `#FFFFFF` | `--ink-hover` `#2B3036` | 13.30 | 4.5 | Pass |
| `--success` `#15803D` | `#FFFFFF` | 5.01 | 4.5 | Pass |
| `--success` `#15803D` | `--surface-muted` `#F4F5F3` | 4.58 | 4.5 | Pass |
| `--success` `#15803D` | `--success-soft` `#F0F9F2` | 4.66 | 4.5 | Pass |
| `--warning` `#8A4B0A` | `--warning-soft` `#FDF3E1` | 6.17 | 4.5 | Pass |
| `--warning` `#8A4B0A` | `#FFFFFF` | 6.79 | 4.5 | Pass |
| `--warning` `#8A4B0A` | `--surface-muted` `#F4F5F3` | 6.21 | 4.5 | Pass |
| `--danger` `#B42318` | `#FFFFFF` | 6.57 | 4.5 | Pass |
| `--danger` `#B42318` | `--surface-muted` `#F4F5F3` | 6.01 | 4.5 | Pass |
| `--danger` `#B42318` | `--danger-soft` `#FDECEA` | 5.74 | 4.5 | Pass |
| `--on-danger` `#FFFFFF` | `--danger` `#B42318` | 6.57 | 4.5 | Pass |
| `--on-danger` `#FFFFFF` | `--danger-hover` `#912018` | 8.66 | 4.5 | Pass |
| `--info` `#1D5A96` | `#FFFFFF` | 7.10 | 4.5 | Pass |
| `--info` `#1D5A96` | `--surface-muted` `#F4F5F3` | 6.49 | 4.5 | Pass |
| `--info` `#1D5A96` | `--info-soft` `#E7F0F8` | 6.16 | 4.5 | Pass |
| `--text` `#14171A` | placeholder tints (lowest of the five) | 15.22 | 4.5 | Pass |
| `--text-muted` `#5C636B` | placeholder tints (lowest of the five) | 5.14 | 4.5 | Pass |
| `--on-ink` `#FFFFFF` | `--ink-active` `#3D444B` (T-017) | 9.87 | 4.5 | Pass |
| `--on-selected` (`--on-ink`) | `--selected` (`--ink`) (T-017, OQ-03) | 17.99 | 4.5 | Pass |
| `--on-danger` `#FFFFFF` | `--danger-active` `#7A1B14` (T-017) | 10.52 | 4.5 | Pass |
| `--text` `#14171A` | `--primary-soft` `#EDF7F4` (T-017) | 16.45 | 4.5 | Pass |
| `--text` `#14171A` | `--success-soft` `#F0F9F2` (T-017, alert body) | 16.73 | 4.5 | Pass |
| `--text` `#14171A` | `--warning-soft` `#FDF3E1` (T-017, alert body) | 16.34 | 4.5 | Pass |
| `--text` `#14171A` | `--danger-soft` `#FDECEA` (T-017, alert body) | 15.73 | 4.5 | Pass |
| `--text` `#14171A` | `--info-soft` `#E7F0F8` (T-017, alert body) | 15.60 | 4.5 | Pass |
| `--text` `#14171A` | `--border` `#E6E8EA` (T-017, pressed outline and ghost button) | 14.64 | 4.5 | Pass |
| `--text-disabled` `#8B9198` | `#FFFFFF` | 3.18 | none | Exempt: disabled controls |
| `--text-disabled` `#8B9198` | `--surface-muted` `#F4F5F3` (T-017, disabled button and input) | 2.90 | none | Exempt: disabled controls |

Boundaries and non-text pairs:

| Element | Against | Ratio | Needs | Result |
| --- | --- | --- | --- | --- |
| `--primary` `#0E7C66` button fill | `#FFFFFF` | 5.12 | 3 | Pass |
| `--ink` `#14171A` surface | `#FFFFFF` | 17.99 | 3 | Pass |
| `--selected` (`--ink`) current-page fill (T-017, OQ-03) | `#FFFFFF` | 17.99 | 3 | Pass |
| `--danger` `#B42318` error border of a control (T-017) | `#FFFFFF` | 6.57 | 3 | Pass |
| Alert border in its tone colour (T-017) | its `-soft` background | 4.66 (success) to 6.17 (warning) | 3 | Pass |
| `--focus-ring` `#0E7C66` | `#FFFFFF` | 5.12 | 3 | Pass |
| `--focus-ring` `#0E7C66` | `--surface-muted` `#F4F5F3` | 4.69 | 3 | Pass |
| `--focus-ring` `#0E7C66` | placeholder tints (lowest of the five) | 4.34 | 3 | Pass |
| `--focus-ring-on-ink` `#FFFFFF` | `--ink` `#14171A` | 17.99 | 3 | Pass |
| `--border-contrast` `#7F8790` | `#FFFFFF` | 3.63 | 3 | Pass |
| `--border-contrast` `#7F8790` | `--surface-muted` `#F4F5F3` | 3.32 | 3 | Pass |
| `--border-strong` `#C9CDD1` (approved) | `#FFFFFF` | 1.59 | 3 | **Fails as a control boundary** |
| `--border-strong` `#C9CDD1` (approved) | `--surface-muted` `#F4F5F3` | 1.46 | 3 | **Fails as a control boundary** |
| `--border` `#E6E8EA` (approved) | `#FFFFFF` | 1.22 | none | Decorative divider, no requirement |
| `--surface-muted` `#F4F5F3` | `#FFFFFF` | 1.09 | none | Decorative fill, no requirement |

Values adjusted during derivation because the first candidate failed: `--primary-soft` was lightened from `#E3F2EE` (4.44 with `--primary`) to `#EDF7F4` (4.69), and `--success-soft` from `#E8F6EC` (4.49 with `--success`) to `#F0F9F2` (4.66). No approved value was changed.

**Open issue, approved value (OQ-01):** `--border-strong` `#C9CDD1` does not reach 3:1 against white or the muted surface. WCAG 1.4.11 applies where the border is the only thing that identifies a control, which is the case for a text input on a white panel. The approved value is kept as specified. `--border-contrast` is defined as a ready alternative; every form control and outline button reads its border from `--control-border`, which points at `--border-strong` until the owner decides. As implemented, the unchecked checkbox, the unchecked radio, the text input, the select, the textarea, the quantity stepper, the search field, the chip at rest, and the outline button therefore do not meet 1.4.11 at rest. Their hover border is `--border-contrast` (derived), and their focus ring passes. Controls must not rely on a lighter border than `--border-strong` in any case.

Margins to watch: `--primary` on `--surface-muted` (4.69), `--primary` on `--primary-soft` (4.69), `--success` on `--surface-muted` (4.58), and `--success` on `--success-soft` (4.66) pass with little room. Do not place these foregrounds on any darker fill.

## Typography

- Family: `"IBM Plex Sans Thai", "Noto Sans Thai", system-ui, sans-serif`. IBM Plex Sans Thai is the primary family (approved); Noto Sans Thai is a fallback only.
- Weights loaded: 400, 500, 600, 700. No other weights and no italics.
- Loaded through `next/font/google` in `src/app/layout.tsx` with the Thai and Latin subsets and `display: swap`. The font files are downloaded at build time and served from the application's own origin; the browser makes no request to Google. The font is exposed as the CSS variable `--font-ibm-plex-sans-thai`, which `--font-sans` in `globals.css` puts first.
- Prices use tabular numerals (`font-variant-numeric: tabular-nums`).
- Each row of the table below is a `type-*` utility (`type-body`, `type-label`, `type-price-card`, and so on). Use these in components.
- The Tailwind size classes are redefined with Thai-safe line heights and are the only sizes that exist: `text-xs` 13 / 1.6, `text-sm` 14 / 1.6, `text-base` 15 / 1.65, `text-lg` 17 / 1.5, `text-xl` 20 / 1.5, `text-2xl` 24 / 1.4, `text-3xl` 30 / 1.4. Sizes are set in `rem`, so they follow the reader's browser font-size setting.

| Style | Size / line height | Weight | Use | Source |
| --- | --- | --- | --- | --- |
| Hero | `clamp(32px, 4.4vw, 52px)` / 1.3 | 700 | Home hero `h1` | Approved |
| Page title | 30 / 1.4 | 700 | Page `h1` | Approved |
| Section title | 24 / 1.4 | 700 | Section heading | Approved |
| Panel title | 20 / 1.5 | 600 | Panel and dialog heading | Approved |
| Card title | 17 / 1.5 | 600 | Card heading, product card title | Approved |
| Body | 15 / 1.65 | 400 | Default | Approved |
| Small | 14 / 1.6 | 400 | Secondary lines, store name | Size approved (13 to 14); line height derived |
| Caption | 13 / 1.6 | 400 | Meta, helper text, badges | Size approved (13 to 14); line height derived |
| Label | 14 / 1.5 | 500 | Form labels, buttons, chips (single-line UI text) | Derived, not yet shown to the owner |
| Price (card) | 18 / 1.5 | 700 | Product card price, tabular numerals | Size and weight approved; line height derived |
| Price (product page) | 32 / 1.3 | 700 | Product page price, tabular numerals | Size and weight approved; line height derived |

Thai text needs generous line height for stacked vowel and tone marks. Never set body line height under 1.6, and never clip overflow vertically on text containers. Multi-line clamps (for example the two-line product title) use `-webkit-line-clamp` on a container whose height is a whole number of lines, never a fixed pixel height with `overflow: hidden` that could cut through marks.

Dashboards use the same scale. Density comes from spacing and table row height, not from smaller type.

## Spacing, radius, elevation

- Spacing scale (px): 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64, 72.
- Section spacing: 56 to 72 px between page sections (approved range). 56 below `lg` and 72 from `lg` up; the breakpoint split is derived, not yet shown to the owner.
- Container: max width 1200px, page gutters `clamp(16px, 4vw, 32px)`.
- Shadow: `sm` for cards on hover and dropdowns, `md` for popovers, `lg` for modals. Cards at rest use a border, not a shadow. Values (derived, not yet shown to the owner; no primitive of T-017 uses a shadow yet): `shadow-sm` `0 1px 2px rgb(20 23 26 / 0.06), 0 1px 3px rgb(20 23 26 / 0.08)`; `shadow-md` `0 4px 12px rgb(20 23 26 / 0.1)`; `shadow-lg` `0 12px 32px rgb(20 23 26 / 0.16)`.

Radius (approved values; token names are new):

| Token | Value | Use |
| --- | --- | --- |
| `--radius-sm` | 10px | 44 px controls: medium buttons, inputs, selects |
| `--radius-md` | 12px | Large buttons (50 to 52 px high) |
| `--radius-lg` | 16px | Cards, panels, product image area, dialogs |
| `--radius-xl` | 24px | Hero and feature tiles |
| `--radius-full` | 9999px | Search field, chips, badges, cart button, avatars |

## Breakpoints and grids

Mobile first. Breakpoints: base 0, `sm` 640, `md` 768, `lg` 1024, `xl` 1280.

Product grid (approved behaviour): 2 columns on phones; on desktop `grid-template-columns: repeat(auto-fill, minmax(190px, 1fr))`.

| Range | Product grid columns | Gap |
| --- | --- | --- |
| base (below `sm`) | 2 fixed | 12 |
| `sm` and up | auto-fill, 190 px minimum | 16 below `lg`, 24 from `lg` |

Switching to auto-fill at `sm` and the gap values are derived, not yet shown to the owner. At the 1200 px container with a 24 px gap, auto-fill yields 5 columns.

Dashboards: sidebar navigation from `lg` up; a top bar with a drawer below `lg`. Tables become stacked cards below `md`.

## Motion

Transitions of 120 to 160 ms on colour, border, and shadow only. No entrance animations, parallax, or auto-playing carousels. Respect `prefers-reduced-motion`.

As implemented: primitives use a 150 ms colour transition. The only animation is the spinner of a loading button. Skeletons are static (no shimmer or pulse). Under `prefers-reduced-motion: reduce` a global rule in `globals.css` removes every transition and stops every animation, including the spinner, which then shows as a still arc; the loading state is still exposed through `aria-busy` and the disabled state.

## Components

Each component defines default, hover, focus-visible, active, disabled, and where relevant loading, error, and success.

| Component | Notes |
| --- | --- |
| Button | Variants: primary (`--primary`), dark (`--ink`, for the search button and call-to-action band), secondary (outline, `--border-strong`), ghost, danger. Sizes: `lg` 52 px high with radius 12, `md` 44 px with radius 10, `sm` 36 px with radius 10 for dense dashboard rows only (its touch area is still 44 px on mobile). Hover uses the `-hover` token of the variant. Loading shows a spinner, keeps width, and is disabled. The mockups show large buttons at 50 to 52 px; 52 as the single value and the `sm` size are derived, not yet shown to the owner. |
| Input, Textarea, Select | Label above, helper below, error text replaces helper and is linked with `aria-describedby`. Height 44, radius 10, border `--border-strong`. Error state: `--danger` border plus error text. |
| SearchField | Pill-shaped field with a dark (`--ink`) submit button labelled "ค้นหา" inside the right end. A `form` with `role="search"`; the input has an accessible label. |
| Checkbox, Radio, Switch | Native inputs, 44 px touch area. |
| QuantityStepper | Minus, numeric input, plus. Clamps to 1 and available stock. Buttons have Thai accessible names. |
| Badge | Pill-shaped. Neutral (`--text-secondary` on `--surface-muted`), primary, success, warning, danger, info (each semantic colour on its soft background). Used for statuses. |
| Chip | Pill-shaped filter or option. At rest: `--border-strong` border, `--text` label. Selected: `--ink` fill with `--on-ink` label and `aria-pressed="true"` (or a radio group when exactly one may be chosen). Height 44 on mobile. |
| Card | Border `--border`, radius 16, padding 16 (24 for panels from `md`). |
| ProductCard | Square image area with radius 16, filled with a placeholder tint until a real photo exists. Optional low-stock pill at the top-left of the image. Then a two-line title clamp, store name (`--text-muted`), and price (18 / 700, tabular numerals, `--text`). Rating row only when review count is above zero; no sales counts. Whole card is one link; no nested interactive elements. The low-stock pill uses the warning badge colours (derived, not yet shown to the owner). |
| Price | Formats satang to THB. Tabular numerals. |
| CartButton | Pill-shaped header button with a count badge (`--primary` fill, `--on-primary` text). The badge is hidden when the cart is empty. The accessible name includes the count. |
| Table | Sticky header, zebra off, row hover, sortable headers as buttons. |
| Pagination | Previous, next, page numbers; current page marked with `aria-current`. |
| Tabs | Arrow-key navigation. |
| Dialog, Drawer | Radius 16. Focus trapped, Escape closes, focus returns to trigger. |
| Toast | Polite live region; errors that need action are inline, not toast-only. |
| Alert | Inline banner: info, success, warning, danger. |
| Skeleton | Matches the shape of the content it replaces. Fill `--surface-muted`. |
| EmptyState | Icon, one-line title, one-line explanation, one primary action. |
| ErrorState | Message and a retry button. |
| Breadcrumb | Storefront category and product pages. |
| StatCard | Dashboard metric: label, value, optional period note. No trend arrows without real comparison data. |
| FileUpload | Drop zone and button, per-file progress, per-file error, shows limits (type, 5 MB, 8 files). |
| NoticeLabel | Small persistent pill label, `--warning` text on `--warning-soft`, for "ข้อมูลตัวอย่าง", "การชำระเงินจำลอง", "การจัดส่งจำลอง". Mandatory wherever sample data, mock payment, or simulated shipping is shown. |

Focus-visible on every interactive component: a 2px `--focus-ring` ring with a 2px offset; on `--ink` surfaces use `--focus-ring-on-ink`.

### Implemented primitives (T-017)

Files are in `src/components/ui/`. Import each primitive from its own file, for example `import { Button } from "@/components/ui/button"`. No primitive contains Thai text: every string, including accessible names, is a prop that the caller fills from `src/i18n/th.ts`.

Not implemented yet: Dialog, Drawer, Tabs, Toast, Table, FileUpload, StatCard, Switch, ProductCard, CartButton. Their rows in the table above remain the specification.

Shared rules for every primitive below:

- Disabled: `--surface-muted` fill, `--border` border, `--text-disabled` text, `not-allowed` cursor. Disabled controls use the native `disabled` attribute and leave the tab order.
- Focus-visible: the `focus-ring` utility. Nothing removes the outline without replacing it.
- Only `QuantityStepper` is a Client Component. Everything else renders on the server and can also be used inside Client Components.
- Values marked "derived" were chosen in T-017, are not in the approved mockups, and have not been shown to the owner.

| Primitive (file) | Variants and sizes | States | Breakpoints | Accessibility |
| --- | --- | --- | --- | --- |
| `Button`, `buttonVariants` (`button.tsx`) | Variants `primary`, `dark`, `secondary` (outline, border `--control-border`), `ghost`, `danger`. Sizes `lg` 52 px / radius 12, `md` 44 px / radius 10 (default), `sm` 36 px / radius 10. `fullWidth`. `buttonVariants()` returns the same classes for a link | Hover: the variant's `-hover` token (`--surface-muted` for secondary and ghost). Active: the `-active` token (`--border` for secondary and ghost). Disabled: shared rule. Loading: spinner in place of the label, same width, variant colours kept, native `disabled` plus `aria-busy="true"`; no click and no form submit | Same at every breakpoint. `sm` keeps a 44 px high touch area at every breakpoint through an invisible extension above and below | Native `button`; `type` defaults to `button`. While loading the label stays in the accessibility tree, so the name does not change |
| `Label`, `FormField`, `FieldMessage` (`field.tsx`) | `FormField` lays out label above, control, message below (6 px gaps, derived). `Label` takes an optional `suffix` | Helper text in `--text-muted`. Error text in `--danger` with an error icon; it replaces the helper text | Same at every breakpoint | `label` linked with `htmlFor`. Control gets `aria-describedby` (message id) and, with an error, `aria-invalid="true"`. The message sits in an `aria-live="polite"` region that is always rendered, so an error that appears later is announced. Error is text plus icon plus border, never colour alone |
| `Input`, `InputField` (`input.tsx`) | One size: 44 px high, radius 10, horizontal padding 14 px (derived), body type | Hover: border `--border-contrast` (derived). Focus: ring. Read-only: `--surface-muted` fill (derived). Disabled: shared rule. Error: border `--danger` plus error text. Placeholder text `--text-muted` | Full width of its container at every breakpoint | Native `input`. `InputField` = `FormField` + `Input`; pass `label`, `helperText`, `errorText`. No loading or success state is specified |
| `Textarea`, `TextareaField` (`textarea.tsx`) | Minimum 44 px, 4 rows by default, resizes vertically only | As Input | Full width | Native `textarea`. Text is never clipped: the box grows with `rows` and scrolls |
| `Select`, `SelectField` (`select.tsx`) | Native select, 44 px, radius 10, chevron icon at the right | As Input (no read-only state) | Full width | Native `select` and `option`; the platform picker opens on touch devices |
| `Checkbox` (`checkbox.tsx`) | 20 px box, radius 6 (derived), required `label`, optional `helperText` and `errorText` | Hover: border `--border-contrast`. Checked: `--primary` fill with a white check mark; checked hover `--primary-hover`. Disabled: shared rule (checked and disabled: `--text-disabled` fill). Error: `--danger` border plus error text | The label row is at least 44 px high at every breakpoint and is the touch target | Native `input type="checkbox"` inside its `label`. Space toggles. In forced-colours mode the native control is shown |
| `Radio`, `RadioGroup` (`radio.tsx`) | 20 px circle with a `--primary` dot when checked. `RadioGroup` is a `fieldset` with a `legend`, `helperText`, `errorText` | As Checkbox | Label row at least 44 px high; options stack vertically | Native radios that share a `name`: arrow keys move, Tab enters and leaves the group. Group message linked with `aria-describedby`; `aria-invalid` on the group |
| `Badge` (`badge.tsx`) | `neutral` (default), `primary`, `success`, `warning`, `danger`, `info`, and `shipped` (OQ-02). Pill, caption type at weight 500 | Not interactive | Wraps inside narrow containers; never truncated | A `span`. The label text is the status; colour only supports it |
| `Chip`, `ChipRadio`, `chipVariants` (`chip.tsx`) | `Chip`: toggle button. `ChipRadio`: single choice within a set. `chipVariants()`: the same look for a filter link. Height 44, pill | Rest: `--control-border` border, `--text` label. Hover: `--surface-muted`. Active: `--border`. Selected: `--ink` fill, `--on-ink` label; hover `--ink-hover`. Disabled: shared rule | 44 px high at every breakpoint (see the open question on desktop height) | `Chip`: `button` with `aria-pressed`. `ChipRadio`: native radio drawn as a chip; wrap the set in a `fieldset` with a `legend`. A filter link uses `aria-current="true"` when selected |
| `Card`, `CardTitle` (`card.tsx`) | `padding`: `card` 16 px (default), `panel` 16 px and 24 px from `md`, `none`. `as`: `div`, `section`, `article`, `li`. `CardTitle` sizes `card` 17 / 600 and `panel` 20 / 600 with a required heading level | Not interactive. A card that is a link is built by the frontend (ProductCard) | `panel` padding grows at `md` | Choose `as` and the heading level so the page outline stays in order |
| `Alert` (`alert.tsx`) | Tones `info` (default), `success`, `warning`, `danger`. Optional `title` and `action`. Radius 10 and a 1 px border in the tone colour (derived) | Not interactive itself | Full width; the icon stays at the top-left and text wraps | `role="alert"` for danger, `role="status"` for the others; override with `role`. Each tone has a different icon shape; body text is `--text` |
| `Skeleton`, `SkeletonText` (`skeleton.tsx`) | `Skeleton`: a `--surface-muted` block sized by the caller to the shape it replaces. `SkeletonText`: `lines` bars, each occupying one body line | Static | The caller sizes it per breakpoint with the same classes as the real content | `aria-hidden`. The loading region carries `aria-busy="true"` and a visually hidden loading text (see the strings table) |
| `EmptyState` (`empty-state.tsx`) | Optional `icon`, `title`, `description`, one `action` | Not interactive apart from its action | Centred; vertical padding 40 px, 56 px from `md` (derived) | The title is a heading (`titleAs`, default `h2`). The icon is decorative |
| `ErrorState` (`error-state.tsx`) | `message`, optional `title`, and either `retryLabel` + `onRetry` (+ `retrying`) or a custom `action` | The retry button is a secondary Button; `retrying` shows its loading state | As EmptyState | `role="alert"`. Icon and text carry the meaning. `onRetry` needs a Client Component parent |
| `Price`, `formatSatang` (`price.tsx`, `format-price.ts`) | Sizes `inline` (inherits the surrounding type; default), `card` 18 / 700, `page` 32 / 700. Always tabular numerals, `--text`, never wraps | Not interactive | Same at every breakpoint | Plain text such as `฿290.00`. Input is integer satang; a value that is not an integer throws `RangeError` (see below) |
| `NoticeLabel` (`notice-label.tsx`) | One style: pill, `--warning` on `--warning-soft`, caption type at weight 500 | Not interactive | Wraps if the container is narrower than the text | A `span`; its text is the notice |
| `QuantityStepper` (`quantity-stepper.tsx`) | One size: 44 px high, radius 10; 44 px wide minus and plus buttons around a 48 px wide number input | Minus is disabled at 1, plus at `max`. Typing is free while the input has focus and is clamped to 1 and `max` on blur or Enter; an empty input restores the previous value; non-digits are ignored. `max` under 1 disables the whole control | Same at every breakpoint | Group with an accessible name. Buttons take required `decreaseLabel` and `increaseLabel`; the input takes `inputLabel`. Arrow up and down step by one. Numeric keyboard on touch devices (`inputMode="numeric"`) |
| `Pagination` (`pagination.tsx`) | Previous, page numbers, next, all links, each 44 by 44 px. Current page: `--selected` fill, `--on-selected` text, weight 700 (OQ-03) | Hover `--surface-muted`, active `--border`. Previous on the first page and next on the last page are shown disabled and are not links. Renders nothing when there is one page | From `sm`: first, last, current, and one neighbour each side, with "…" for gaps. Below `sm`: first, last, and current only, so the row fits a 360 px screen; it wraps on narrower screens | `nav` with a required `label`. Current page has `aria-current="page"`. Required `previousLabel`, `nextLabel`, and `pageLabel(page)`. Ellipses are hidden from assistive technology |
| `Breadcrumb` (`breadcrumb.tsx`) | Small type, `--text-muted` links, current page in `--text` at weight 500, chevron separators | Link hover: `--text` and underline | Wraps onto more lines; long Thai names are never truncated. Links are 44 px high | `nav` with a required `label`, ordered list, last item has `aria-current="page"` and is not a link |
| `SearchField` (`search-field.tsx`) | Pill, 52 px high (derived: the height that lets a 44 px button sit inside), with a `dark` pill button at the right end | Hover: border `--border-contrast`. Focus in the input: ring around the whole pill. The button has its own ring | Full width of its container; the header gives it its own row on mobile | `form` with `role="search"`; a visually hidden `label` (required prop); works without JavaScript as a GET form. Required `name`, `label`, `submitLabel` |

**Price formatting.** `formatSatang(satang)` formats with `Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })`: `0` gives `฿0.00`, `1` gives `฿0.01`, `29000` gives `฿290.00`, `2147483647` gives `฿21,474,836.47`, `-4000` gives `-฿40.00`. The satang integer is split into baht and satang with integer operations and passed to `Intl` as an exact decimal string, so no floating-point arithmetic touches the amount. A fraction, `NaN`, `Infinity`, or a value beyond `Number.MAX_SAFE_INTEGER` throws `RangeError` rather than showing a rounded price.

**Strings the primitives need.** The frontend agent owns `src/i18n/th.ts`; these key names and Thai texts are proposals written by the design agent in T-017 and **have not been approved by the owner**.

| Proposed key | Thai text | Used as |
| --- | --- | --- |
| `quantity.decrease` | ลดจำนวน | `QuantityStepper` `decreaseLabel` |
| `quantity.increase` | เพิ่มจำนวน | `QuantityStepper` `increaseLabel` |
| `quantity.label` | จำนวน | `QuantityStepper` `inputLabel` |
| `pagination.label` | การแบ่งหน้า | `Pagination` `label` |
| `pagination.previous` | หน้าก่อนหน้า | `Pagination` `previousLabel` |
| `pagination.next` | หน้าถัดไป | `Pagination` `nextLabel` |
| `pagination.page` | หน้า {page} | `Pagination` `pageLabel` |
| `breadcrumb.label` | เส้นทางนำทาง | `Breadcrumb` `label` |
| `header.search.label` | ค้นหาสินค้า | `SearchField` `label` |
| `header.search.submit` | ค้นหา | `SearchField` `submitLabel` (approved text) |
| `common.loading` | กำลังโหลด | Visually hidden text of a region that shows skeletons |
| `common.retry` | ลองอีกครั้ง | `ErrorState` `retryLabel` |

### Status badge mapping

| Status | Badge | Thai label |
| --- | --- | --- |
| Payment `PENDING` | warning | รอชำระเงิน |
| Payment `PAID` | success | ชำระเงินแล้ว |
| Payment `FAILED` | danger | ชำระเงินไม่สำเร็จ |
| Fulfilment `PENDING` | neutral | รอร้านค้ายืนยัน |
| Fulfilment `PROCESSING` | info | กำลังเตรียมสินค้า |
| Fulfilment `SHIPPED` | `shipped` variant, currently primary (OQ-02) | จัดส่งแล้ว |
| Fulfilment `DELIVERED` | success | จัดส่งสำเร็จ |
| Fulfilment `CANCELLED` | danger | ยกเลิกแล้ว |
| Store `PENDING` | warning | รอการอนุมัติ |
| Store `APPROVED` | success | อนุมัติแล้ว |
| Store `REJECTED` | danger | ไม่ผ่านการอนุมัติ |
| Store `SUSPENDED` | danger | ถูกระงับ |
| Product `DRAFT` | neutral | ฉบับร่าง |
| Product `PUBLISHED` | success | เผยแพร่แล้ว |
| Moderation `PENDING` | warning | รอตรวจสอบ |

Status is never conveyed by colour alone; the label is always present.

## Layout patterns

**Storefront header (approved):** two rows. First row: brand wordmark, pill search field with the dark "ค้นหา" button, the links "เปิดร้านค้า" and "เข้าสู่ระบบ", and the pill cart button with its count badge. Second row: category links in `--text-nav`. On mobile the search field takes the full width on its own row.

**Product page:** gallery left and purchase panel right from `lg`; stacked on mobile with a sticky bottom bar holding price and the add-to-cart button. Price uses the 32 / 700 style.

**Cart:** line items grouped under each store name, per-store subtotal, order summary panel (sticky on desktop, bottom on mobile).

**Checkout:** single column on mobile, two columns from `lg`: steps (address, shipping, payment) left, summary right. The mock payment option carries a NoticeLabel and a one-sentence explanation that no real money moves.

**Seller call-to-action band:** full-width band inside the container on `--ink` with `--on-ink` text, radius 24.

**Dashboards:** sidebar, page title with primary action on the right, filter bar, table, pagination.

## Accessibility checklist

- Contrast: 4.5:1 body text, 3:1 large text and control boundaries.
- All functionality available by keyboard; visible focus ring on every interactive element.
- Landmarks: `header`, `nav`, `main`, `footer`; one `h1` per page; headings in order.
- Form fields have visible labels; errors are text and are announced.
- Images have meaningful `alt` (product title) or empty `alt` when decorative.
- Touch targets at least 44 by 44 px.
- `lang="th"` on the document.

## Copy guidelines

- Polite, plain Thai. Short sentences. No slang, no exclamation marks in errors.
- Buttons are verbs: "เพิ่มลงตะกร้า", "ชำระเงิน", "บันทึก".
- Errors say what happened and what to do: "สินค้ามีไม่เพียงพอ กรุณาลดจำนวนหรือลบสินค้าออกจากตะกร้า".
- Empty states suggest the next step: "ยังไม่มีสินค้าในตะกร้า" with a "เลือกซื้อสินค้า" button.
- All strings live in `src/i18n/th.ts`.

Strings fixed by the approved direction. The Thai text is approved; the key names are proposals for the frontend agent, who owns `src/i18n/th.ts`.

| Proposed key | Thai text |
| --- | --- |
| `header.search.submit` | ค้นหา |
| `header.openStore` | เปิดร้านค้า |
| `header.signIn` | เข้าสู่ระบบ |
| `notice.sampleData` | ข้อมูลตัวอย่าง |
| `notice.mockPayment` | การชำระเงินจำลอง |
| `notice.simulatedShipping` | การจัดส่งจำลอง |
