# Design System

Owner: ui-ux-design agent. The visual direction in this document was **approved by the project owner on 2026-10-11** (see [DECISIONS.md](DECISIONS.md), D-018), with refinements to come later. It supersedes the earlier indigo starting values. Contrast ratios below are computed from the hex values; they are **re-measured against the rendered tokens in T-017**, and any pair that fails there is changed here.

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
| `--success-soft` | `#F0F9F2` | Success badge and alert background. Derived |
| `--danger` | `#B42318` | Error text, destructive actions. Derived |
| `--danger-hover` | `#912018` | Hover on danger buttons. Derived |
| `--on-danger` | `#FFFFFF` | Text on `--danger`. Derived |
| `--danger-soft` | `#FDECEA` | Danger badge and alert background. Derived |
| `--info` | `#1D5A96` | Informational text and icons. Derived |
| `--info-soft` | `#E7F0F8` | Info badge and alert background. Derived |
| `--text-disabled` | `#8B9198` | Text of disabled controls only. Derived |
| `--border-contrast` | `#7F8790` | Proposed control border that meets 3:1. Not applied by default; see the note under the contrast table. Derived |
| `--focus-ring` | `#0E7C66` | 2px ring with a 2px offset in the colour of the surface behind the control. Derived |
| `--focus-ring-on-ink` | `#FFFFFF` | Focus ring for controls that sit on an `--ink` surface. Derived |

### Accent usage rule

`--primary` is used only for primary buttons, links, the cart count badge, and active states. It is not used for decoration, headings, section fills, icons at rest, or prices. Prices are `--text`.

The selected chip uses `--ink` with `--on-ink`, as in the mockups, not `--primary`.

### Placeholder tints

Until real product photos exist, the product image area is filled with one of the five placeholder tints. The tint is picked deterministically from the product id (for example index modulo 5) so a product keeps its tint across pages and reloads. The picking rule is derived, not yet shown to the owner. Placeholder tints are decorative and carry no meaning.

### Contrast

Ratios are WCAG 2.1 relative-luminance contrast, computed from the hex values and rounded down to two decimals. Requirement: 4.5:1 for body text, 3:1 for large text and control boundaries.

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
| `--text-disabled` `#8B9198` | `#FFFFFF` | 3.18 | none | Exempt: disabled controls |

Boundaries and non-text pairs:

| Element | Against | Ratio | Needs | Result |
| --- | --- | --- | --- | --- |
| `--primary` `#0E7C66` button fill | `#FFFFFF` | 5.12 | 3 | Pass |
| `--ink` `#14171A` surface | `#FFFFFF` | 17.99 | 3 | Pass |
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

**Open issue, approved value:** `--border-strong` `#C9CDD1` does not reach 3:1 against white or the muted surface. WCAG 1.4.11 applies where the border is the only thing that identifies a control, which is the case for a text input on a white panel. The approved value is kept as specified. `--border-contrast` is defined as a ready alternative for inputs, selects, checkboxes, radios, and outline buttons, but it is not applied until the owner decides. Controls must not rely on a lighter border than `--border-strong` in any case.

Margins to watch in T-017: `--primary` on `--surface-muted` (4.69), `--primary` on `--primary-soft` (4.69), `--success` on `--surface-muted` (4.58), and `--success` on `--success-soft` (4.66) pass with little room. Do not place these foregrounds on any darker fill.

## Typography

- Family: `"IBM Plex Sans Thai", "Noto Sans Thai", system-ui, sans-serif`. IBM Plex Sans Thai is the primary family (approved); Noto Sans Thai is a fallback only.
- Weights loaded: 400, 500, 600, 700. No other weights and no italics.
- Loaded through `next/font` with the Thai and Latin subsets and `display: swap`.
- Prices use tabular numerals (`font-variant-numeric: tabular-nums`).

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
- Shadow: `sm` for cards on hover and dropdowns, `md` for popovers, `lg` for modals. Cards at rest use a border, not a shadow.

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

### Status badge mapping

| Status | Badge | Thai label |
| --- | --- | --- |
| Payment `PENDING` | warning | รอชำระเงิน |
| Payment `PAID` | success | ชำระเงินแล้ว |
| Payment `FAILED` | danger | ชำระเงินไม่สำเร็จ |
| Fulfilment `PENDING` | neutral | รอร้านค้ายืนยัน |
| Fulfilment `PROCESSING` | info | กำลังเตรียมสินค้า |
| Fulfilment `SHIPPED` | primary | จัดส่งแล้ว |
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
