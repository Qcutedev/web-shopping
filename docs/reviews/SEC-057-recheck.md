# SEC-057 re-check: product titles in the storefront

Date: 2026-10-14. Reviewer: security agent. Commit under review: 004c213 (frontend). Register: [../SECURITY.md](../SECURITY.md), SEC-057.

Result: **PARTIAL**. The `<bdi>` part is fixed. The image `alt` wrap is in place but a title that holds U+2069 or an unmatched isolate opener breaks it. The title rule (remediation 3) waits for a write path.

## What changed in 004c213

| File | Change | Judged |
| --- | --- | --- |
| `src/components/catalog/product-card.tsx:44` | Title `h3` holds `<UserName>{product.title}</UserName>` | Fixed |
| `src/components/catalog/product-detail-view.tsx:32` | Breadcrumb current item label is `<UserName>{product.title}</UserName>` | Fixed |
| `src/components/catalog/product-detail-view.tsx:63` | Detail `h1` holds `<UserName>{product.title}</UserName>` | Fixed |
| `src/components/catalog/product-detail-view.tsx:49` | `alt` title is `${FSI}${product.title}${PDI}` (code points built with `String.fromCodePoint`) | Wrap present; bypassable (below) |
| `tests/security/sec033-rendering-recheck.test.ts` | Three `it.fails(` changed to `it(`; bodies unchanged | Not weakened |

`git show 004c213 -- tests/security` shows only the three `it.fails(` to `it(` changes.

## The three flipped cases fail against the old code

The `004c213^` versions of `product-card.tsx` and `product-detail-view.tsx` were copied into a scratch folder under `tests/security`. A copy of the test file imported them. Both were deleted afterwards.

Command: `pnpm exec vitest run tests/security/zz-sec057-oldcode.test.ts -t "SEC-057"`. Result: 3 failed, 51 skipped.

- Card: `expected { isolated: +0, bare: 1 } to deeply equal { isolated: 1, bare: +0 }`
- Detail `h1` and breadcrumb: `expected { isolated: +0, bare: 2 } to deeply equal { isolated: 2, bare: +0 }`
- `alt`: `expected false to be true`

## Gap: the `alt` wrap is text-level

`<bdi>` isolates through CSS (`unicode-bidi: isolate`). Characters inside the text cannot end it. The FSI ... PDI wrap in the `alt` attribute is made of characters. Under UAX #9 (BD9) the first unmatched U+2069 inside the title closes the FSI. The rest of the title, and the wrapper's own PDI, then lie outside the isolate.

- Title `Title` + U+2069 + U+202E + `Admin`: the override starts outside the isolate. The wrapper's PDI is unmatched and does nothing, so the override runs over "รูปที่ 1 จาก 1". Flipped case result: `expected '<U+202E>Admin<U+2069> รูปที่ 1 จาก 1' to be ' รูปที่ 1 จาก 1'`.
- Title `Title` + U+2066 + `Admin`: the wrapper's PDI closes the LRI. The FSI never closes, so the shop's words stay inside the title's isolate. Flipped case result: `expected -1 to be greater than 0`.
- Control: title `Title` + U+202E + `Admin` + U+202C stays inside the isolate (passes). Embeddings and overrides inside an isolate end at its PDI.

Impact is Low. The `alt` text is shown when an image fails to load and is read by assistive tools. Titles have no write path today: seed data and direct database writes are the only sources.

Remediation is added to the register: strip U+202A to U+202E and U+2066 to U+2069 from the title before `fill()`, or drop the title from the gallery `alt`. Remediation 3 (schema rule) then closes it at the source.

## Search for missed spots

Searched under `src` with `Grep` for `title`, `productTitle`, `generateMetadata`, and `groupLabel`, and read every `src/app/(storefront)` page.

| Place | Finding |
| --- | --- |
| Document title (`generateMetadata`) | None exists. The product page's `<title>` is the site default from `src/app/layout.tsx`. |
| Breadcrumb | Current item isolated. The category item is admin-written, outside the rule (SEC-033 review). |
| Image `alt` | Card: empty. Detail gallery: wrapped, gap above. Every image of a 3-image gallery checked. |
| `aria-label` | No product title in any. `QuantityStepper` `groupLabel` is meant for a title but is used only in its tests. |
| Search, home, category, store pages | Titles only through `ProductCard`. |
| Cart, checkout, orders | No page exists. The APIs return `title` and `productTitle` as JSON only. |
| Product description | Seller text, own `<p>`, not isolated. By design (SEC-033 review); not a SEC-057 location. |

## Not applied: container class

Remediation 1 also asked for `USER_NAME_CONTAINER_CLASS` on the title container. The card `h3` has `line-clamp-2` (clips) but not the class. The detail `h1` has `[overflow-wrap:anywhere]` only. The breadcrumb `span` has neither. This is the SEC-042 display part (open) and is recorded there, not as a SEC-057 blocker.

## New tests

`tests/security/sec033-rendering-recheck.test.ts`, describe "SEC-057 re-check: product titles in attributes and new places":

- Every gallery `alt` wraps the title and its isolate closes before the shop's words (plain).
- Two `it.fails` for the gap above.
- Control case with RLO ... PDF (plain).
- Static scan: every `product.title`, `item.title`, `line.title`, or `*.productTitle` under `src/app` and `src/components` (non-test) is inside `<UserName>` or a `${FSI}...${PDI}` wrap (plain). A title read through another variable name is not seen.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/security/sec033-rendering-recheck.test.ts` (at 004c213, before new cases) | 54 passed, exit 0 |
| Same, after new cases | 57 passed, 2 expected fail, exit 0 |
| Scratch copy with the two new `it.fails` flipped (deleted) | 2 failed on their assertions |
| `pnpm exec prettier --check`, `pnpm exec eslint` on the test file; `pnpm exec tsc --noEmit` | exit 0, exit 0, exit 0 |
| `pnpm exec vitest run --project security` | 24 files, 900 passed, 7 expected fail, exit 0 |

The config `tests/security/vitest.security.config.mts` named in older rows of the register no longer exists; the security project of the root `vitest.config.mts` was used.

## Not done

Browser or screen-reader check, `pnpm test`, `pnpm verify`, `pnpm build`, integration tests, dependency audit, and secret scan (004c213 changes no manifest). A clean run shows only that these specific cases hold, not that the storefront is secure.

---

## Second re-check: commit b411e34

Date: 2026-10-14. Reviewer: security agent. Commit under review: b411e34 (frontend).

Result: **PARTIAL**. The isolate-control bypass is fixed. A paragraph separator in the title still ends the `alt` isolate (new case, Low). The title rule still waits for a write path.

### What changed in b411e34

| File | Change | Judged |
| --- | --- | --- |
| `src/lib/bidi.ts` | `stripIsolateControls` removes U+2066 to U+2069 with a global regex built from `String.fromCodePoint` | Correct for all four isolate controls |
| `src/components/catalog/product-detail-view.tsx:50` | `alt` title is `${FSI}${stripIsolateControls(title)}${PDI}` | Fixes the two reported cases |
| `src/lib/bidi.test.ts` | Two unit cases | Pass |
| `tests/security/sec033-rendering-recheck.test.ts` | Two `it.fails(` changed to `it(`; bodies unchanged | Not weakened |

U+202A to U+202E are kept, although the written remediation named them. Under UAX #9 rule X6a, the PDI that matches the FSI pops every embedding and override opened inside it, and with no isolate control left in the title the wrapper's PDI is always the match. The reviewer judges this enough. It is not an accepted deviation; no approver was asked.

### The two flipped cases fail against the old code

The `b411e34^` version of `product-detail-view.tsx` was copied to `tests/security/zz-sec057-old/`, and a copy of the test file imported it. Both were deleted afterwards.

Command: `pnpm exec vitest run tests/security/zz-sec057-oldcode.test.ts -t "cannot"`. Result: 2 failed, 1 passed, 56 skipped.

- PDI then RLO: `expected '<U+202E>Admin<U+2069> รูปที่ 1 จาก 1' to be ' รูปที่ 1 จาก 1'`
- Unmatched LRI: `expected -1 to be greater than 0`

At b411e34, `pnpm exec vitest run tests/security/sec033-rendering-recheck.test.ts -t "cannot"`: 3 passed, 56 skipped.

### Bypass search

- **Other isolate controls and mixes.** Nine hostile titles, each on 1 and 3 images: every isolate control alone, PDI then RLO, two PDIs then RLO, a closed isolate then a stray PDI, a title that is itself an FSI ... PDI wrap, three unclosed openers, and unclosed LRE, RLE, LRO, RLO. All pass at b411e34. Against `b411e34^`, 7 of the 9 fail (the self-wrapped title and the embeddings-only title pass there too, as expected).
- **Nested wraps.** Since the title can hold no isolate control, the only isolate in the `alt` is the wrapper's. A new case checks that the `alt` holds exactly the wrapper's FSI and PDI.
- **Paragraph separators (gap).** UAX #9 rule P1 splits text into paragraphs at each Bidi_Class B character, and no isolate crosses that split. A title `Title` + U+2029 + U+202E + `Admin` ends the FSI at the separator. In the next paragraph the wrapper's PDI matches nothing, so the override runs over "รูปที่ 1 จาก 1". The same holds for U+000A, U+000D, U+001C, U+001D, U+001E, and U+0085. This is shown with a UAX #9 model, not in a browser. In rendered fallback text, CSS turns a line feed into a space before bidi, so U+000A may not matter there; U+2029 is not collapsed.
- **Strong marks (U+200E, U+200F, U+061C).** They only set the direction inside the isolate. Not a bypass.
- **Other places a title lands in an attribute.** `Grep` under `src` for `.title`, `{ title`, `alt={`, `aria-label={`, `title={`, `productTitle`, `generateMetadata`, `QuantityStepper`. The gallery `alt` is still the only one. No `generateMetadata`; `QuantityStepper` is used only in its tests; the card `alt` is empty; `ProductImage` passes `alt` through only. The `aria-label`s in `address-book.tsx` carry `recipientName`, whose schema refuses controls (SEC-039). No product write path exists.
- **Static scan blind spot.** The earlier static case looks for `product.title` and similar names. b411e34 reads the title through a destructured `title`, which that case does not see. A new static case checks every `${FSI}${...}${PDI}` in `src/app` and `src/components`: each must wrap `stripIsolateControls(...)`. On the `b411e34^` source it flags `product.title` (checked with a Node regex run on `git show b411e34^:...`).

### New tests

`tests/security/sec033-rendering-recheck.test.ts`, describe "SEC-057 second re-check: the alt wrap after stripIsolateControls (b411e34)":

- 9 hostile titles (`it.each`), plain.
- No isolate control from the title is left in the `alt`, plain.
- Every FSI ... PDI wrap strips isolate controls first, plain.
- `it.fails` "a paragraph separator in the title cannot end the alt isolate". Flipped in a scratch copy (deleted), it fails with all seven: `U+000A`, `U+000D`, `U+001C`, `U+001D`, `U+001E`, `U+0085`, `U+2029`.

### Remediation added

Before the wrap, also replace each Bidi_Class B character in the title with a space, or drop the title from the gallery `alt`. Then flip the new `it.fails` to `it` without changing its body. Item 3 (refuse these characters at the write path) closes it at the source.

### Commands and results

| Command | Result |
| --- | --- |
| Old-code scratch run, `-t "cannot"` | 2 failed on their assertions |
| Old-code scratch run, `-t "second re-check"` (paragraph case flipped in that copy) | 9 failed (7 hostile titles, the no-control case, the paragraph case), 3 passed |
| `pnpm exec vitest run tests/security/sec033-rendering-recheck.test.ts` | 70 passed, 1 expected fail |
| Scratch copy with the new `it.fails` flipped | 1 failed, all 7 B characters escape |
| `pnpm exec prettier --check`, `pnpm exec eslint` on the test file; `pnpm exec tsc --noEmit` | exit 0, exit 0, exit 0 |
| `pnpm exec vitest run src/lib/bidi.test.ts` | 2 passed |
| `pnpm exec vitest run --project security` | 24 files, 913 passed, 6 expected fail, exit 0 |

### Not done

Browser or screen-reader check, `pnpm test`, `pnpm verify`, `pnpm build`, integration tests, dependency audit, and secret scan (b411e34 changes no manifest). A clean run shows only that these specific cases hold, not that the storefront is secure.
