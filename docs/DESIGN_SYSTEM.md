# Design System

Owner: ui-ux-design agent. The visual direction in this document was **approved by the project owner on 2026-10-11** (see [DECISIONS.md](DECISIONS.md), D-018), with refinements to come later. It supersedes the earlier indigo starting values. The tokens are implemented in `src/app/globals.css` and the primitives in `src/components/ui/` (T-017). Contrast ratios below are **computed from the implemented token values**: `src/components/ui/tokens.test.ts` reads `globals.css`, recomputes every pair in the contrast tables, and fails when a ratio differs from this document or drops under its threshold.

The owner decided the following on 2026-10-11 ([DECISIONS.md](DECISIONS.md), D-025). These are rules, not placeholders. Each is still held in one place in the code.

| Rule | Decided value | Where it lives |
| --- | --- | --- |
| Border of form controls and outline buttons | `--border-contrast` `#7F8790`: 3.63:1 on white, 3.32:1 on the muted surface. The lighter `--border-strong` `#C9CDD1` and `--border` stay for cards and dividers | `--control-border` in `src/app/globals.css` |
| Colour of the fulfilment `SHIPPED` ("จัดส่งแล้ว") status badge | Blue: the info tone. Not the accent green | `SHIPPED_TONE` in `src/components/ui/badge.tsx` |
| Colour of the selected tab, page number, and menu item | Dark ink (`--ink`), as the selected chip. Not the accent green | `--selected` in `src/app/globals.css` |
| Stock drops below a quantity the customer already chose | The quantity is lowered automatically to what is available and the customer is told | `QuantityStepper`; see the QuantityStepper contract |
| Arrow keys of the quantity stepper outside the allowed range | Up does nothing at or above the available stock, the same as the disabled plus button; Down does nothing at or below 1 | `QuantityStepper`; see the QuantityStepper contract |

The owner decided the following on 2026-10-11 ([DECISIONS.md](DECISIONS.md), D-026 and D-028). These are rules as well.

| Rule | Decided value | Where it lives |
| --- | --- | --- |
| Hover border of form controls and outline buttons (OQ-45) | Darker on hover, in the main text (ink) colour: `--ink` `#14171A`, 17.99:1 on white and 16.45:1 on the muted surface. Not the accent green. The owner looks at it on real pages at milestone 1 | `--control-border-hover` in `src/app/globals.css` |
| The "quantity was lowered" message (OQ-46) | "สินค้าเหลือ {available} ชิ้น ระบบปรับจำนวนเป็น {available} ชิ้นให้แล้ว" | `th.quantity.lowered` in `src/i18n/th.ts` |
| Three Thai texts (D-028; REQUIREMENTS Q35) | Order mark "ชำระเงินไม่สำเร็จ"; adding a sold-out product "สินค้าหมด ไม่สามารถเพิ่มลงตะกร้าได้"; returned quantity cut "ปรับจำนวนในตะกร้าเป็น {quantity} ชิ้น" | `th.order.paymentFailed`, `th.cart.soldOutRefused`, `th.cart.returnedQuantityCut` in `src/i18n/th.ts`; see "Approved message texts" |

Still open, to be decided when the owner can look at real pages at milestone 1 (D-025, OQ-20): input text size, chip height, search box height, required-field marking, the quantity selector of a sold-out product, negative amounts, and the error summary. The values in this document for those items are placeholders and were not changed.

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
| `--border-strong` | `#C9CDD1` | Stronger border for cards and dividers that need more weight than `--border`. Never the boundary of a control (it does not reach 3:1) |
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

Every row in this table is **derived, not yet shown to the owner**, except `--border-contrast`, which the owner chose as the control border (D-025).

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
| `--border-contrast` | `#7F8790` | Border of form controls and outline buttons, through `--control-border`. Meets 3:1. Chosen by the owner (D-025) |
| `--focus-ring` | `#0E7C66` | 2px ring with a 2px offset in the colour of the surface behind the control. Derived |
| `--focus-ring-on-ink` | `#FFFFFF` | Focus ring for controls that sit on an `--ink` surface. Derived |

### Alias tokens

These tokens hold no colour of their own. Each points at another token, so each rule is defined in one line. The values were decided by the owner (D-025; `--control-border-hover` D-026).

| Token | Points at | Use |
| --- | --- | --- |
| `--control-border` | `--border-contrast` | Border of inputs, textareas, selects, checkboxes, radios, the quantity stepper, the search field, chips at rest, and outline buttons |
| `--control-border-hover` | `--ink` | Border of inputs, textareas, selects, unchecked checkboxes and radios, the quantity stepper, the search field, and outline buttons while the pointer is over them (D-026, OQ-45). Not used by chips |
| `--selected` | `--ink` | Fill of the current page in Pagination, and of the selected tab and the selected menu or navigation item when those primitives are built |
| `--on-selected` | `--on-ink` | Text on `--selected` |

The selected chip is not routed through `--selected`: the approved mockups show it in `--ink`, so it uses `--ink` directly. Both resolve to the same colour.

### Tailwind class names

Tailwind v4 is configured in `src/app/globals.css` (`@theme`); there is no `tailwind.config` file. The default Tailwind palette, radius scale, shadow scale, and font-size scale are removed, so only the values in this document exist as class names (`bg-red-500` and `rounded-2xl` do not compile to anything).

| Token | Colour name in classes | Example |
| --- | --- | --- |
| `--background`, `--surface`, `--surface-muted` | `background`, `surface`, `surface-muted` | `bg-surface-muted` |
| `--border`, `--border-strong`, `--border-contrast`, `--control-border`, `--control-border-hover` | `border`, `border-strong`, `border-contrast`, `control-border`, `control-border-hover` | `border-border`, `border-control-border`, `hover:border-control-border-hover` |
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

`--primary` is used only for primary buttons, links, the cart count badge, and active states. It is not used for decoration, headings, section fills, icons at rest, or prices. Prices are `--text`. Since D-025 it is also not the colour of a selected item or of the shipped status badge.

Selection is shown in dark ink, not in `--primary`: the selected chip uses `--ink` with `--on-ink`, as in the mockups, and the selected tab, page number, and menu item use `--selected` with `--on-selected`, which point at the same colours (D-025).

### Placeholder tints

Until real product photos exist, the product image area is filled with one of the five placeholder tints. The tint is picked deterministically from the product id (for example index modulo 5) so a product keeps its tint across pages and reloads. The picking rule is derived, not yet shown to the owner. Placeholder tints are decorative and carry no meaning.

### Contrast

Ratios are WCAG 2.1 relative-luminance contrast, **computed from the implemented token values in `src/app/globals.css`** by `src/components/ui/tokens.test.ts` (run with `pnpm test`) and rounded down to two decimals. They are calculated from the token values, not measured from rendered pixels in a browser. Requirement: 4.5:1 for body text, 3:1 for large text and control boundaries.

T-017 changed no existing colour value; every ratio that was already in these tables was recomputed from `globals.css` and is unchanged. Rows marked "T-017" are new pairs that the primitives use. The D-025 follow-up changed one alias: `--control-border` now points at `--border-contrast` instead of `--border-strong`. The D-026 follow-up added one alias, `--control-border-hover`, which points at `--ink`; no colour value was added or changed.

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
| `--on-selected` (`--on-ink`) | `--selected` (`--ink`) (T-017, D-025) | 17.99 | 4.5 | Pass |
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
| `--selected` (`--ink`) current-page fill (T-017, D-025) | `#FFFFFF` | 17.99 | 3 | Pass |
| `--danger` `#B42318` error border of a control (T-017) | `#FFFFFF` | 6.57 | 3 | Pass |
| Alert border in its tone colour (T-017) | its `-soft` background | 4.66 (success) to 6.17 (warning) | 3 | Pass |
| `--focus-ring` `#0E7C66` | `#FFFFFF` | 5.12 | 3 | Pass |
| `--focus-ring` `#0E7C66` | `--surface-muted` `#F4F5F3` | 4.69 | 3 | Pass |
| `--focus-ring` `#0E7C66` | placeholder tints (lowest of the five) | 4.34 | 3 | Pass |
| `--focus-ring-on-ink` `#FFFFFF` | `--ink` `#14171A` | 17.99 | 3 | Pass |
| `--border-contrast` `#7F8790` | `#FFFFFF` | 3.63 | 3 | Pass |
| `--border-contrast` `#7F8790` | `--surface-muted` `#F4F5F3` | 3.32 | 3 | Pass |
| `--control-border` (`--border-contrast`) border of form controls and outline buttons (D-025) | `#FFFFFF` | 3.63 | 3 | Pass |
| `--control-border` (`--border-contrast`) border of form controls and outline buttons (D-025) | `--surface-muted` `#F4F5F3` | 3.32 | 3 | Pass |
| `--control-border-hover` (`--ink`) hover border of form controls and outline buttons (D-026) | `#FFFFFF` | 17.99 | 3 | Pass |
| `--control-border-hover` (`--ink`) hover border of form controls and outline buttons (D-026) | `--surface-muted` `#F4F5F3` | 16.45 | 3 | Pass |
| `--border-strong` `#C9CDD1` (approved) | `#FFFFFF` | 1.59 | none | Card and divider border only, no requirement. Not used as a control boundary |
| `--border-strong` `#C9CDD1` (approved) | `--surface-muted` `#F4F5F3` | 1.46 | none | Card and divider border only, no requirement. Not used as a control boundary |
| `--border` `#E6E8EA` (approved) | `#FFFFFF` | 1.22 | none | Decorative divider, no requirement |
| `--surface-muted` `#F4F5F3` | `#FFFFFF` | 1.09 | none | Decorative fill, no requirement |

Values adjusted during derivation because the first candidate failed: `--primary-soft` was lightened from `#E3F2EE` (4.44 with `--primary`) to `#EDF7F4` (4.69), and `--success-soft` from `#E8F6EC` (4.49 with `--success`) to `#F0F9F2` (4.66). No approved value was changed.

**Control border (decided, D-025).** Form controls and outline buttons use `--border-contrast` `#7F8790` through `--control-border`: **3.63:1 against white and 3.32:1 against the muted surface**, both above the 3:1 that WCAG 1.4.11 requires where the border is the only thing that identifies a control. This covers the unchecked checkbox, the unchecked radio, the text input, the select, the textarea, the quantity stepper, the search field, the chip at rest, and the outline button. `--border-strong` `#C9CDD1` (1.59:1 on white, 1.46:1 on the muted surface) and `--border` stay for cards and dividers and must not be the only boundary of a control. The margin on the muted surface is small (3.32): do not place a control on a fill darker than `--surface-muted` without checking the pair.

**Hover border (decided, D-026, OQ-45).** Form controls and outline buttons get a darker border while the pointer is over them, in the main text (ink) colour: `--control-border-hover`, which points at `--ink` `#14171A`. It is **17.99:1 against white and 16.45:1 against the muted surface** (the fill of a hovered outline button), both above 3:1. It is not the accent green. The owner looks at it on real pages at milestone 1.

- Applies to: the text input, the textarea, the select, the unchecked checkbox, the unchecked radio, the search field (the whole pill), the quantity stepper (its outer border; the two dividers inside it keep `--control-border`), and the outline (`secondary`) button, which also keeps its `--surface-muted` hover fill.
- Does not apply to: a disabled control (border `--border`, no hover style); a control in the error state, whose `--danger` border stays on hover so the error signal is not lost; a checked checkbox or radio, whose hover border stays `--primary-hover`; a loading button, which ignores the pointer.
- Chips are not changed: D-026 names form controls and outline buttons, and a chip is neither by name. They keep `--control-border` and change only their fill on hover. Whether chips should follow is a question for the owner at milestone 1.
- Hover is not a required state for accessibility and the focus ring is unchanged. The change is a colour transition of 150 ms like the other states; the border width does not change, so nothing moves.

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
| Button | Variants: primary (`--primary`), dark (`--ink`, for the search button and call-to-action band), secondary (outline, `--control-border`, hover border `--control-border-hover`), ghost, danger. Sizes: `lg` 52 px high with radius 12, `md` 44 px with radius 10, `sm` 36 px with radius 10 for dense dashboard rows only (its touch area is still 44 px on mobile). Hover uses the `-hover` token of the variant. Loading shows a spinner, keeps width, and is disabled. The mockups show large buttons at 50 to 52 px; 52 as the single value and the `sm` size are derived, not yet shown to the owner. |
| Input, Textarea, Select | Label above, helper below, error text replaces helper and is linked with `aria-describedby`. Height 44, radius 10, border `--control-border`, hover border `--control-border-hover` (ink). Error state: `--danger` border plus error text. |
| SearchField | Pill-shaped field with a dark (`--ink`) submit button labelled "ค้นหา" inside the right end. A `form` with `role="search"`; the input has an accessible label. |
| Checkbox, Radio, Switch | Native inputs, 44 px touch area. |
| QuantityStepper | Minus, numeric input, plus. Every change the customer makes is clamped to 1 and available stock. When stock drops below the chosen quantity, the quantity is lowered automatically to what is available and the customer is told (see the QuantityStepper contract below). Buttons have Thai accessible names. |
| Badge | Pill-shaped. Neutral (`--text-secondary` on `--surface-muted`), primary, success, warning, danger, info (each semantic colour on its soft background). Used for statuses. The shipped status is info (blue). |
| Chip | Pill-shaped filter or option. At rest: `--control-border` border, `--text` label. Selected: `--ink` fill with `--on-ink` label and `aria-pressed="true"` (or a radio group when exactly one may be chosen). Height 44 on mobile. |
| Card | Border `--border`, radius 16, padding 16 (24 for panels from `md`). |
| ProductCard | Square image area with radius 16, filled with a placeholder tint until a real photo exists. Optional low-stock pill at the top-left of the image. Then a two-line title clamp, store name (`--text-muted`), and price (18 / 700, tabular numerals, `--text`). Rating row only when review count is above zero; no sales counts. Whole card is one link; no nested interactive elements. The low-stock pill uses the warning badge colours (derived, not yet shown to the owner). |
| Price | Formats satang to THB. Tabular numerals. |
| CartButton | Pill-shaped header button with a count badge (`--primary` fill, `--on-primary` text). The badge is hidden when the cart is empty. The accessible name includes the count. Implemented as `CartLink` in `src/components/shell/cart-link.tsx` (CR-77): it is a link to the cart, not a `button`, and it reads Thai copy and the route from `src/i18n/th.ts` and `src/lib/routes.ts`, so it lives in the shell and not in `src/components/ui` (primitives there hold no Thai text). It composes `buttonVariants({ variant: "secondary" })` plus `rounded-full`. |
| Table | Sticky header, zebra off, row hover, sortable headers as buttons. |
| Pagination | Previous, next, page numbers; current page marked with `aria-current` and filled with `--selected` (dark ink) with `--on-selected` text. |
| Tabs | Arrow-key navigation. The selected tab is shown in dark ink (`--selected`), not in `--primary`, and is marked with `aria-selected`; colour is not the only signal. |
| Menu and navigation items | The selected or current item is shown in dark ink (`--selected`), not in `--primary`, and is marked with `aria-current` (or `aria-checked` in a menu of choices). |
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

Not implemented yet: Drawer, Tabs, Toast, Switch, ProductCard. Their rows in the table above remain the specification. CartButton is built as `CartLink` in `src/components/shell/` (see its row above).

Shared rules for every primitive below:

- Disabled: `--surface-muted` fill, `--border` border, `--text-disabled` text, `not-allowed` cursor. Disabled controls use the native `disabled` attribute and leave the tab order. One exception: a `QuantityStepper` step button that is at its limit while the control is enabled uses `aria-disabled="true"` instead, stays in the tab order, and does nothing when pressed, so that a keyboard user who has just reached the limit does not lose focus (CR-12).
- Border precedence of form controls: the hover border is emitted before the disabled border and the error border, so those win over it. The error border applies to an enabled control only (`aria-invalid:enabled`), so a control that is both disabled and invalid shows the disabled `--border` border (CR-07). `src/components/ui/style-order.test.ts` compiles `globals.css` with Tailwind and fails if the emitted rule order changes (CR-01).
- Focus-visible: the `focus-ring` utility. Nothing removes the outline without replacing it.
- Only `QuantityStepper` is a Client Component. Everything else renders on the server and can also be used inside Client Components.
- Values marked "derived" were chosen in T-017, are not in the approved mockups, and have not been shown to the owner.

| Primitive (file) | Variants and sizes | States | Breakpoints | Accessibility |
| --- | --- | --- | --- | --- |
| `Button`, `buttonVariants` (`button.tsx`) | Variants `primary`, `dark`, `secondary` (outline, border `--control-border`), `ghost`, `danger`. Sizes `lg` 52 px / radius 12, `md` 44 px / radius 10 (default), `sm` 36 px / radius 10. `fullWidth`. `buttonVariants()` returns the same classes for a link | Hover: the variant's `-hover` token (`--surface-muted` for secondary and ghost); secondary also gets the `--control-border-hover` (ink) border (D-026). Active: the `-active` token (`--border` for secondary and ghost). Disabled: shared rule. Loading: spinner in place of the label, same width, variant colours kept, native `disabled` plus `aria-busy="true"`; no click and no form submit | Same at every breakpoint. `sm` keeps a 44 px high touch area at every breakpoint through an invisible extension above and below | Native `button`; `type` defaults to `button`. While loading the label stays in the accessibility tree, so the name does not change |
| `Label`, `FormField`, `FieldMessage` (`field.tsx`) | `FormField` lays out label above, control, message below (6 px gaps, derived). `Label` takes an optional `suffix` | Helper text in `--text-muted`. Error text in `--danger` with an error icon; it replaces the helper text | Same at every breakpoint | `label` linked with `htmlFor`. Control gets `aria-describedby` (message id) and, with an error, `aria-invalid="true"`. The message sits in an `aria-live="polite"` region that is always rendered, so an error that appears later is announced. Error is text plus icon plus border, never colour alone |
| `Input`, `InputField` (`input.tsx`) | One size: 44 px high, radius 10, horizontal padding 14 px (derived), body type | Hover: border `--control-border-hover` (ink; D-026), except disabled and error. Focus: ring. Read-only: `--surface-muted` fill (derived). Disabled: shared rule. Error: border `--danger` plus error text. Placeholder text `--text-muted` | Full width of its container at every breakpoint | Native `input`. `InputField` = `FormField` + `Input`; pass `label`, `helperText`, `errorText`. No loading or success state is specified |
| `Textarea`, `TextareaField` (`textarea.tsx`) | Minimum 44 px, 4 rows by default, resizes vertically only | As Input | Full width | Native `textarea`. Text is never clipped: the box grows with `rows` and scrolls |
| `Select`, `SelectField` (`select.tsx`) | Native select, 44 px, radius 10, chevron icon at the right | As Input (no read-only state) | Full width | Native `select` and `option`; the platform picker opens on touch devices |
| `Checkbox` (`checkbox.tsx`) | 20 px box, radius 6 (derived), required `label`, optional `helperText` and `errorText` | Hover: border `--control-border-hover` (ink; D-026) while unchecked. Checked: `--primary` fill with a white check mark; checked hover `--primary-hover`. Disabled: shared rule (checked and disabled: `--text-disabled` fill). Error: `--danger` border plus error text | The label row is at least 44 px high at every breakpoint and is the touch target | Native `input type="checkbox"` inside its `label`. Space toggles. In forced-colours mode the native control is shown |
| `Radio`, `RadioGroup` (`radio.tsx`) | 20 px circle with a `--primary` dot when checked. `RadioGroup` is a `fieldset` with a `legend`, `helperText`, `errorText` | As Checkbox | Label row at least 44 px high; options stack vertically | Native radios that share a `name`: arrow keys move, Tab enters and leaves the group. Group message linked with `aria-describedby`; `aria-invalid` on the group |
| `Badge` (`badge.tsx`) | `neutral` (default), `primary`, `success`, `warning`, `danger`, `info`, and `shipped`, which is the info tone (blue; D-025). Pill, caption type at weight 500 | Not interactive | Wraps inside narrow containers; never truncated | A `span`. The label text is the status; colour only supports it |
| `Chip`, `ChipRadio`, `chipVariants` (`chip.tsx`) | `Chip`: toggle button. `ChipRadio`: single choice within a set. `chipVariants()`: the same look for a filter link. Height 44, pill | Rest: `--control-border` border, `--text` label. Hover: `--surface-muted` fill; the border does not change (D-026 does not name chips). Active: `--border`. Selected: `--ink` fill, `--on-ink` label; hover `--ink-hover`. Disabled: shared rule | 44 px high at every breakpoint (see the open question on desktop height) | `Chip`: `button` with `aria-pressed`. `ChipRadio`: native radio drawn as a chip; wrap the set in a `fieldset` with a `legend`. A filter link uses `aria-current="true"` when selected |
| `Card`, `CardTitle` (`card.tsx`) | `padding`: `card` 16 px (default), `panel` 16 px and 24 px from `md`, `none`. `as`: `div`, `section`, `article`, `li`. `CardTitle` sizes `card` 17 / 600 and `panel` 20 / 600 with a required heading level | Not interactive. A card that is a link is built by the frontend (ProductCard) | `panel` padding grows at `md` | Choose `as` and the heading level so the page outline stays in order |
| `Alert` (`alert.tsx`) | Tones `info` (default), `success`, `warning`, `danger`. Optional `title` and `action`. Radius 10 and a 1 px border in the tone colour (derived) | Not interactive itself | Full width; the icon stays at the top-left and text wraps | `role="alert"` for danger, `role="status"` for the others; override with `role`. Each tone has a different icon shape; body text is `--text` |
| `Skeleton`, `SkeletonText` (`skeleton.tsx`) | `Skeleton`: a `--surface-muted` block sized by the caller to the shape it replaces. `SkeletonText`: `lines` bars, each occupying one body line | Static | The caller sizes it per breakpoint with the same classes as the real content | `aria-hidden`. The loading region carries `aria-busy="true"` and a visually hidden loading text (see the strings table) |
| `EmptyState` (`empty-state.tsx`) | Optional `icon`, `title`, `description`, one `action` | Not interactive apart from its action | Centred; vertical padding 40 px, 56 px from `md` (derived) | The title is a heading (`titleAs`, default `h2`). The icon is decorative |
| `ErrorState` (`error-state.tsx`) | `message`, optional `title`, and either `retryLabel` + `onRetry` (+ `retrying`) or a custom `action` | The retry button is a secondary Button; `retrying` shows its loading state | As EmptyState | `role="alert"`. Icon and text carry the meaning. `onRetry` needs a Client Component parent |
| `Price` (`price.tsx`), `formatSatang` (`src/lib/format.ts`) | Sizes `inline` (inherits the surrounding type; default), `card` 18 / 700, `page` 32 / 700. Always tabular numerals, `--text`, never wraps | Not interactive | Same at every breakpoint | Plain text such as `฿290.00`. Input is integer satang; a value that is not an integer throws `RangeError` (see below) |
| `NoticeLabel` (`notice-label.tsx`) | One style: pill, `--warning` on `--warning-soft`, caption type at weight 500 | Not interactive | Wraps if the container is narrower than the text | A `span`; its text is the notice |
| `QuantityStepper` (`quantity-stepper.tsx`) | One size: 44 px high, radius 10; 44 px wide minus and plus buttons around a 48 px wide number input | Hover: outer border `--control-border-hover` (ink; D-026), except disabled and error. Minus is inert at 1 and below, plus at `max` and above (`aria-disabled`, not native `disabled`, so focus stays; CR-12). Typing is free while the input has focus and is clamped to 1 and `max` on blur or Enter (a number of any length above `max` becomes `max`); Enter does not submit a surrounding form; an empty input restores the parent's value; non-digits are ignored. `disabled`, or `max` under 1, disables the input and both buttons (shared rule) and discards text that was being typed, so the committed value shows when the control is enabled again. Error (`invalid`): `--danger` border and `aria-invalid="true"`; the error text is rendered by the parent and linked with `aria-describedby`. `value` above `max`: lowered automatically, see the contract below. No loading or success state is specified | Same at every breakpoint | The input has one accessible name: `inputLabel`, or a visible `<label htmlFor>` pointing at `id` (then omit `inputLabel`); the types require one of the two. Optional `groupLabel` names the wrapper as a group (`role="group"`); without it the wrapper has no role and no name. Buttons take required `decreaseLabel` and `increaseLabel`. Arrow up and down step by one; Up does nothing at or above `max` and Down does nothing at or below 1, the same as the disabled buttons. Numeric keyboard on touch devices (`inputMode="numeric"`). The input has `role="spinbutton"` with `aria-valuemin` 1, `aria-valuemax` the available stock, and `aria-valuenow` the current value, so assistive technology announces the range; they are left out while no quantity is allowed or the value is not a number (CR-12) |
| `Pagination` (`pagination.tsx`) | Previous, page numbers, next, all links, each 44 by 44 px. Current page: `--selected` fill (dark ink), `--on-selected` text, weight 700 | Hover `--surface-muted`, active `--border`. Previous on the first page and next on the last page are shown disabled and are not links. Renders nothing when there is one page or when `totalPages` is not a valid page count (see the Pagination input rules below) | From `sm`: first, last, current, and one neighbour each side, with "…" for gaps. Below `sm`: first, last, and current only, so the row fits a 360 px screen; it wraps on narrower screens | `nav` with a required `label`. Current page has `aria-current="page"`. Required `previousLabel`, `nextLabel`, and `pageLabel(page)`. Ellipses are hidden from assistive technology |
| `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableStateRow`, `TableSkeletonRows` (`table.tsx`) | `density`: `comfortable` (cells 16 x 12 px, default) or `dense` (12 x 8 px, dashboards). `stickyHeader`. Cell and head `align`: `start`, `end` (right, tabular numerals, for money and counts), `center`. `TableCell rowHeader` renders `th scope="row"` | Row hover: `--surface-muted` fill (body rows; off for state rows). Sortable head: ghost-style button, chevron faded when unsorted, flipped when ascending. Focus: ring on the scroll region and on each sort button. Loading: `TableSkeletonRows` inside the body plus `aria-busy="true"` on the table. Empty and error: `TableStateRow` holding an `EmptyState` or `ErrorState`. No selected or error state per row | The table scrolls sideways inside its own bordered wrapper (`overflow-auto`), never the page; text wraps and is never truncated. `stickyHeader` sticks inside the wrapper, so give `wrapperClassName` a `max-h-*`. Below `md` a dashboard may use a card list instead (frontend decision); the table itself does not collapse | Native `table`. `caption` is required (`captionHidden` for visually hidden); it names the table and the wrapper (`role="region"`, `tabindex="0"`, so the keyboard can scroll it). Column heads are `th scope="col"`. A sortable head holds a `button` (Enter or Space) and the `th` carries `aria-sort` (`ascending`, `descending`, or `none`); `sortLabel` adds hidden text saying what the press does. Sort buttons are 44 px high. `onSort` needs a Client Component parent |
| `Breadcrumb` (`breadcrumb.tsx`) | Small type, `--text-muted` links, current page in `--text` at weight 500, chevron separators | Link hover: `--text` and underline | Wraps onto more lines; long Thai names are never truncated. Links are 44 px high | `nav` with a required `label`, ordered list, last item has `aria-current="page"` and is not a link |
| `SearchField` (`search-field.tsx`) | Pill, 52 px high (derived: the height that lets a 44 px button sit inside), with a `dark` pill button at the right end | Hover: border `--control-border-hover` (ink; D-026). Focus in the input: ring around the whole pill. The button has its own ring | Full width of its container; the header gives it its own row on mobile | `form` with `role="search"`; a visually hidden `label` (required prop); works without JavaScript as a GET form. Required `name`, `label`, `submitLabel` |

**Price formatting.** `formatSatang(satang)` (in `src/lib/format.ts`; `Price` imports it from there) formats with `Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })`: `0` gives `฿0.00`, `1` gives `฿0.01`, `29000` gives `฿290.00`, `2147483647` gives `฿21,474,836.47`, `-4000` gives `-฿40.00`. The satang integer is split into baht and satang with integer operations and passed to `Intl` as an exact decimal string, so no floating-point arithmetic touches the amount. A fraction, `NaN`, `Infinity`, or a value beyond `Number.MAX_SAFE_INTEGER` throws `RangeError` rather than showing a rounded price.

**QuantityStepper contract.** `QuantityStepper` is a controlled component: the parent holds the quantity and passes it as `value`.

- The input shows the `value` prop exactly. With `name` set, a native form submits that same number. The stepper never shows a number that differs from the parent's state. A `value` that is not a finite number shows as an empty input.
- Every change the customer makes (buttons, arrow keys, typing) is passed to `onChange` as a whole number from 1 to `max`. `onChange` is not called when the quantity does not change. A typed number is clamped on blur or Enter; a number too long for JavaScript to hold (for example 400 digits) is above `max` like any other and commits as `max`.
- **Stock below the chosen quantity (decided, D-025).** When `value` is above `max` (for example a cart line holds 9 and a stock refetch sets `max` to 4), the stepper lowers the quantity automatically: after render it calls `onChange(max)` and then the optional `onLowered(previous, lowered)`, where `previous` is the quantity the customer had chosen and `lowered` is the largest quantity allowed. The parent stores the new quantity from `onChange` exactly as it does for a click, so a parent that passes no `onLowered` still gets the lowered quantity. This happens on mount as well as when `max` changes later, and also while the `disabled` prop is set.
- **Telling the customer.** The stepper renders no text. The page uses `onLowered` to show the message (`th.quantity.lowered`, wording approved in D-026, OQ-46; see "Approved message texts") and is responsible for the announcement: put the text in a polite live region that is already on the page before the text appears, for example `FieldMessage` under the stepper (as `helperText`, with its id passed to the stepper as `aria-describedby`) or an `Alert` with the `info` tone, whose `role="status"` wrapper stays mounted. The message is information, not an error: do not set `invalid` and do not use the danger tone. It stays visible until the customer changes the quantity again or leaves the page; it is not a toast-only message.
- `onChange` plus `onLowered` are called once for each distinct pair of `previous` and `lowered`; re-renders do not repeat them. If the parent does not store the lowered quantity, the stepper keeps showing the parent's `value` and does not call again until `max` changes.
- **Other values outside the range.** A `value` below 1, a fraction that is not above `max`, or a value that is not a finite number is a mistake of the calling code, not something the customer did. The stepper keeps showing it and calls the optional `onOutOfRange(value, clamped)`, where `clamped` is the nearest allowed quantity, once for each distinct pair, after render. It does not call `onChange` for these. The parent decides: adopt `clamped`, or keep the value and show an error (render the text, pass its id as `aria-describedby`, set `invalid`). `onOutOfRange` is not called for a value above `max`.
- **Keys and buttons outside the range (decided, D-025).** At or above `max` the plus button is inert (`aria-disabled="true"`, still focusable; pressing it does nothing) and the Up arrow key does nothing. At or below 1 the minus button is inert in the same way and the Down arrow key does nothing. Only when the whole control is disabled do the buttons carry the native `disabled` attribute. The first step in the other direction calls `onChange` with the nearest allowed quantity (9 with `max` 4 that the parent kept: minus or Down gives 4). The same applies to a number that is being typed and not yet committed: Up does nothing while the typed number is at or above `max`, Down does nothing while it is 1 or less, and the typed text stays as it is until blur or Enter clamps it. An emptied input restores `value` without calling `onChange`.
- `max` under 1 means no quantity is allowed. The whole control is disabled, still shows `value`, takes no part in a form submission (native behaviour of a disabled input), and neither `onChange`, `onLowered`, nor `onOutOfRange` is called; the parent already knows from `max` that the item is unavailable. How the quantity selector of a sold-out product should look is still open (OQ-20); this is the placeholder behaviour.
- **StrictMode (CR-13).** `onChange` plus `onLowered`, and `onOutOfRange`, are called once per pair also when the tree renders under React `StrictMode` (which runs mount effects twice); `quantity-stepper.test.tsx` renders the stepper under `StrictMode` and checks the counts.
- **Disabled.** When the control becomes disabled (the `disabled` prop, or `max` under 1), text that was being typed is discarded. The control shows `value` while disabled and after it is enabled again.
- The server validates quantity against stock in every case (CLAUDE.md, rule 3). An out-of-range quantity that is submitted must be rejected there.

Accessible names: on a product page, where one stepper sits next to a visible "จำนวน" label, pass `id` and render `<label htmlFor>`; omit `inputLabel` and `groupLabel`. In a list of cart lines, pass `inputLabel` ("จำนวน") and set `groupLabel` to the product title, so each stepper is announced as, for example, "เสื้อยืดผ้าฝ้าย, กลุ่ม" then "จำนวน". `groupLabel` and `inputLabel` must not be the same text.

**Pagination input rules.** `normaliseTotalPages` and `normalisePage` in `pagination.tsx` are applied by both `Pagination` and `buildPaginationItems`, so no link text, accessible name, or href is built from an invalid number.

| Input | Value | Result |
| --- | --- | --- |
| `totalPages` | whole number from 2 up | Rendered |
| `totalPages` | 1 | Renders nothing (one page) |
| `totalPages` | 0, negative, a fraction, `NaN`, `Infinity`, `-Infinity`, above `Number.MAX_SAFE_INTEGER` | Renders nothing; `buildPaginationItems` returns an empty list. The count is not rounded or guessed |
| `page` | `NaN`, `Infinity`, `-Infinity` | Treated as page 1 |
| `page` | a fraction | Truncated (2.7 is page 2) |
| `page` | under 1, or above `totalPages` | Page 1, or the last page |

**Helper and error text.** `hasContent` in `field.tsx` is the one check for "is there helper or error text" in `FormField`, `FieldMessage`, `Checkbox`, and `RadioGroup`. `undefined`, `null`, `true`, `false`, and the empty string are no text (React renders nothing for them): no message, no `aria-describedby`, no `aria-invalid`. The number 0 is text: it renders "0", is linked, and as `errorText` marks the control invalid.

**Strings the primitives need.** The frontend agent owns `src/i18n/th.ts`; these key names and Thai texts are proposals written by the design agent in T-017 and **have not been approved by the owner**, except `quantity.lowered`, whose wording the owner approved (D-026, OQ-46) and which is in `src/i18n/th.ts`.

| Proposed key | Thai text | Used as |
| --- | --- | --- |
| `quantity.decrease` | ลดจำนวน | `QuantityStepper` `decreaseLabel` |
| `quantity.increase` | เพิ่มจำนวน | `QuantityStepper` `increaseLabel` |
| `quantity.label` | จำนวน | `QuantityStepper` `inputLabel`, or the visible `<label>` of the stepper. `groupLabel` needs no string: it is the product title |
| `quantity.lowered` | สินค้าเหลือ {available} ชิ้น ระบบปรับจำนวนเป็น {available} ชิ้นให้แล้ว | Message the page shows from `QuantityStepper` `onLowered` (`available` is its `lowered` argument; it appears twice). **Wording approved by the owner (D-026, OQ-46)**; in `src/i18n/th.ts` as `th.quantity.lowered` |
| `pagination.label` | การแบ่งหน้า | `Pagination` `label` |
| `pagination.previous` | หน้าก่อนหน้า | `Pagination` `previousLabel` |
| `pagination.next` | หน้าถัดไป | `Pagination` `nextLabel` |
| `pagination.page` | หน้า {page} | `Pagination` `pageLabel` |
| `breadcrumb.label` | เส้นทางนำทาง | `Breadcrumb` `label` |
| `header.search.label` | ค้นหาสินค้า | `SearchField` `label` |
| `header.search.submit` | ค้นหา | `SearchField` `submitLabel` (approved text) |
| `common.loading` | กำลังโหลด | Visually hidden text of a region that shows skeletons |
| `common.retry` | ลองอีกครั้ง | `ErrorState` `retryLabel` |

### Approved message texts (D-026, D-028)

The Thai wording of these four texts was approved by the owner word for word and must not be reworded. They are in `src/i18n/th.ts` under the keys below. A name in braces is a placeholder that the caller replaces with a whole number; the file holds the text with the braces. No shared helper that fills placeholders exists yet (frontend).

| Key in `th.ts` | Thai text | When it is shown | Presentation |
| --- | --- | --- | --- |
| `th.quantity.lowered` | สินค้าเหลือ {available} ชิ้น ระบบปรับจำนวนเป็น {available} ชิ้นให้แล้ว | Stock is below the quantity the customer chose: on the cart page, at checkout, and when adding to the cart asks for more than is in stock (D-026 OQ-46, OQ-28, OQ-30). `{available}` is the quantity now set, in both places | Information, not an error: `FieldMessage` helper text under the stepper or an `Alert` with the `info` tone, in a polite live region that is on the page before the text appears. Not toast-only. See the QuantityStepper contract |
| `th.cart.soldOutRefused` | สินค้าหมด ไม่สามารถเพิ่มลงตะกร้าได้ | Adding a sold-out product to the cart was refused (D-028, Q35 (b); BR-31) | The action failed: `Alert` with the `danger` tone (`role="alert"`) next to the add-to-cart button, or the field error of that form. Text plus icon, never colour alone |
| `th.cart.returnedQuantityCut` | ปรับจำนวนในตะกร้าเป็น {quantity} ชิ้น | Items returned to the cart after a failed payment were added to an existing line and the limit of 99 or the stock cut the quantity (D-028, Q35 (c); BR-32). `{quantity}` is the quantity the cart line now holds. Not shown later after a timeout failure (D-028, Q34) | Information: `Alert` with the `info` tone, or helper text under the line's stepper, in a polite live region |
| `th.order.paymentFailed` | ชำระเงินไม่สำเร็จ | Mark on an order whose payment failed, for the customer and the admin (D-028, Q35 (a); BR-20). Its per-store parts are shown with this mark and never as "ยกเลิกแล้ว" | `Badge` with the `danger` tone; the label is always present. Same text as Payment `FAILED` in the status badge mapping |

### Status badge mapping

| Status | Badge | Thai label |
| --- | --- | --- |
| Payment `PENDING` | warning | รอชำระเงิน |
| Payment `PAID` | success | ชำระเงินแล้ว |
| Payment `FAILED` | danger | ชำระเงินไม่สำเร็จ |
| Fulfilment `PENDING` | neutral | รอร้านค้ายืนยัน |
| Fulfilment `PROCESSING` | info | กำลังเตรียมสินค้า |
| Fulfilment `SHIPPED` | info (blue), through the `shipped` variant | จัดส่งแล้ว |
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
