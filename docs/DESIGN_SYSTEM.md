# Design System

Owner: ui-ux-design agent. This is the **initial specification**. Token values are starting points; contrast ratios must be measured when the tokens are implemented (T-017), and any pair that fails is changed here.

## Principles

1. Content first: products, prices, and actions are the loudest things on the page.
2. One system across storefront, seller dashboard, and admin dashboard. Dashboards are denser, not differently styled.
3. Calm: light neutral surfaces, one primary colour, minimal motion.
4. Honest: no placeholder ratings, sales counts, or testimonials. Sample and simulated data are labelled.
5. Thai-first typography and copy.

## Colour tokens

Defined as CSS variables and mapped into the Tailwind theme. Light theme only in the MVP.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#FAFAFB` | Page background |
| `--surface` | `#FFFFFF` | Cards, panels, inputs |
| `--surface-muted` | `#F4F4F6` | Table headers, subtle fills |
| `--border` | `#E4E4E9` | Dividers, input borders |
| `--border-strong` | `#8A8A99` | Input borders that must meet 3:1 |
| `--text` | `#18181F` | Primary text |
| `--text-muted` | `#5B5B6B` | Secondary text |
| `--primary` | `#4F46E5` | Primary actions, links, active states |
| `--primary-hover` | `#4338CA` | |
| `--primary-soft` | `#EEF0FF` | Selected rows, badges, highlights |
| `--on-primary` | `#FFFFFF` | Text on primary |
| `--success` | `#15803D` | Text and icons |
| `--success-soft` | `#E8F6EC` | Background |
| `--warning` | `#B45309` | |
| `--warning-soft` | `#FDF3E1` | |
| `--danger` | `#B91C1C` | Errors, destructive actions |
| `--danger-soft` | `#FDECEC` | |
| `--info` | `#1D4ED8` | |
| `--info-soft` | `#E8F0FE` | |
| `--focus-ring` | `#4F46E5` | 2px ring with 2px offset |

Pairs to verify at implementation: text on background and surface, muted text on surface and muted surface, on-primary on primary and primary-hover, each semantic colour on its soft background, primary on surface as link text.

## Typography

- Family: `"Noto Sans Thai", "Noto Sans", system-ui, sans-serif`, loaded through `next/font` with the Thai subset. Alternative if a more geometric look is wanted: IBM Plex Sans Thai.
- Numerals in prices use tabular figures.

| Style | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | 30 / 40 | 700 | Page hero (rare) |
| H1 | 24 / 34 | 700 | Page title |
| H2 | 20 / 30 | 600 | Section title |
| H3 | 17 / 26 | 600 | Card and panel title |
| Body | 15 / 24 | 400 | Default |
| Small | 13 / 20 | 400 | Meta, helper text |
| Label | 14 / 20 | 500 | Form labels, buttons |
| Price | 18 / 26 | 700 | Product card price |

Thai text needs generous line height for stacked vowel and tone marks. Never set body line height under 1.6, and never clip overflow vertically on text containers.

## Spacing, radius, elevation

- Spacing scale (px): 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: 6 (inputs, buttons), 10 (cards), 16 (modals), full (pills, avatars).
- Shadow: `sm` for cards on hover and dropdowns, `md` for popovers, `lg` for modals. Cards at rest use a border, not a shadow.
- Container: max width 1200px, page gutters 16 (mobile), 24 (tablet), 32 (desktop).

## Breakpoints and grids

| Name | Min width | Product grid columns |
| --- | --- | --- |
| base | 0 | 2 |
| `sm` | 640 | 3 |
| `md` | 768 | 3 |
| `lg` | 1024 | 4 |
| `xl` | 1280 | 5 |

Dashboards: sidebar navigation from `lg` up; a top bar with a drawer below `lg`. Tables become stacked cards below `md`.

## Motion

Transitions of 120 to 160 ms on colour, border, and shadow only. No entrance animations, parallax, or auto-playing carousels. Respect `prefers-reduced-motion`.

## Components

Each component defines default, hover, focus-visible, active, disabled, and where relevant loading, error, and success.

| Component | Notes |
| --- | --- |
| Button | Variants: primary, secondary (outline), ghost, danger. Sizes: sm 32, md 40, lg 48 px height. Loading shows a spinner, keeps width, and is disabled. |
| Input, Textarea, Select | Label above, helper below, error text replaces helper and is linked with `aria-describedby`. Height 40. |
| Checkbox, Radio, Switch | Native inputs, 44 px touch area. |
| QuantityStepper | Minus, numeric input, plus. Clamps to 1 and available stock. Buttons have Thai accessible names. |
| Badge | Neutral, primary, success, warning, danger, info. Used for statuses. |
| Card | Border, radius 10, padding 16. |
| ProductCard | Square image, two-line title clamp, price, store name, stock badge when low or out. Rating row only when review count is above zero. Whole card is one link; no nested interactive elements. |
| Price | Formats satang to THB. |
| Table | Sticky header, zebra off, row hover, sortable headers as buttons. |
| Pagination | Previous, next, page numbers; current page marked with `aria-current`. |
| Tabs | Arrow-key navigation. |
| Dialog, Drawer | Focus trapped, Escape closes, focus returns to trigger. |
| Toast | Polite live region; errors that need action are inline, not toast-only. |
| Alert | Inline banner: info, success, warning, danger. |
| Skeleton | Matches the shape of the content it replaces. |
| EmptyState | Icon, one-line title, one-line explanation, one primary action. |
| ErrorState | Message and a retry button. |
| Breadcrumb | Storefront category and product pages. |
| StatCard | Dashboard metric: label, value, optional period note. No trend arrows without real comparison data. |
| FileUpload | Drop zone and button, per-file progress, per-file error, shows limits (type, 5 MB, 8 files). |
| NoticeLabel | Small persistent label for "ข้อมูลตัวอย่าง", "การชำระเงินจำลอง", "การจัดส่งจำลอง". |

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

**Storefront header:** logo, search field (full width on its own row on mobile), category menu, cart with item count, account menu. Sticky on scroll.

**Product page:** gallery left and purchase panel right from `lg`; stacked on mobile with a sticky bottom bar holding price and the add-to-cart button.

**Cart:** line items grouped under each store name, per-store subtotal, order summary panel (sticky on desktop, bottom on mobile).

**Checkout:** single column on mobile, two columns from `lg`: steps (address, shipping, payment) left, summary right. The mock payment option carries a NoticeLabel and a one-sentence explanation that no real money moves.

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
