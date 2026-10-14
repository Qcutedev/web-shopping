# Security re-check: SEC-033 rendering layer in the storefront

Reviewer: security agent, 2026-10-14. Independent re-check; the frontend commits, their messages, and the frontend's own tests were read but not relied on. No file under `src/` was changed by this review.

Findings are registered in [SECURITY.md](../SECURITY.md) ("Findings register") with the same ids. This file records the scope, the method, the evidence, and the verdict.

## Which code was reviewed

A frontend agent was editing `src/components/catalog` and `src/app/(storefront)` for CR-T021-07 while this re-check ran. Three states were seen:

| When | State | What was read |
| --- | --- | --- |
| Start | `HEAD` = `35fa421` (storefront code as of `506646b`, T-021); working tree clean apart from the owner's deletion of `run-agents.ps1` | Every file listed under "Scope" |
| Middle | Frontend working tree on `35fa421`: search heading rewritten (prefix, `<UserName>{query.q}</UserName>`, suffix), `StoreView` split out of `StoreSection`, `th.catalog.search.resultsFor` replaced by `resultsForPrefix` and `resultsForSuffix` | The diff (`git diff`) |
| End | Frontend commit `4fa4352` ("CR-T021-01,02,03,06,07"), which adds `src/components/catalog/search-heading.tsx`; `git diff --stat HEAD -- src/i18n src/components "src/app/(storefront)"` is empty, so the working tree of those paths equals `4fa4352` | `search-heading.tsx`, `search/page.tsx`, `store-section.tsx` at `4fa4352` |

The verdicts below are for `4fa4352`. The search-query cases were also run against the search page of `506646b` (see "Commands and results").

Not part of this review: the backend-api agent's `GET /api/v1/categories/{slug}` (CR-T021-05). It was untracked during the review and was committed as `b829f77` before this review's commit. It makes one existing security case fail; see "Side effect seen".

## Verdict

| Item | Verdict | Short reason |
| --- | --- | --- |
| SEC-033 rendering part: store names | FIXED | Product card, product detail store link, and store page `h1` each render `store.name` as the only content of one `<bdi>`. |
| SEC-033 rendering part: the user's display name, address recipient and address lines (account pages) | FIXED | `profile-card.tsx` and `address-book.tsx` render each field alone in `<UserName>`. The schema also refuses bidi controls in these fields (`NAME_ALLOWED_TEXT`). |
| SEC-033 rendering part: search query (CR-T021-07) | FIXED at `4fa4352` | `SearchHeading` renders the Thai prefix, then `<bdi>` holding only `q`, then the suffix. At `506646b` the whole sentence `ผลการค้นหา “{q}”` was inside one `<bdi>`, built with `fill()`, so an override in `q` reordered the closing quote. |
| SEC-033 rendering part: review author | Not applicable | No author name is read or shown. `REVIEW_SELECT` holds `id`, `rating`, `comment`, `createdAt` only. |
| Nothing user-controlled inside a sentence in a `<bdi>` | Holds at `4fa4352` | Static scan of every `.tsx` under `src/app/(storefront)` and `src/components` (except `ui/` and tests): every `<UserName>` holds exactly one plain member expression. At `506646b` the search page failed this scan. |
| Product titles | **New finding SEC-057 (Low, OPEN)** | Product titles are seller-written, but the card, the detail `h1`, the breadcrumb, and the image `alt` text render them without isolation. No schema refuses bidi controls in titles. |

So the SEC-033 rendering part is FIXED for every name field that the finding and its remediation name (user, store, address) and for the search query. Product titles are registered separately as SEC-057, because titles also lack the first layer (the schema) and need their own remediation.

No Critical or High finding.

A passing test suite only shows that these tests found nothing. It does not prove that the code is secure.

## Scope

| Area | Files read |
| --- | --- |
| Isolation component | `src/components/user-name.tsx` |
| Storefront pages | `src/app/(storefront)/page.tsx`, `layout.tsx`, `search/page.tsx`, `categories/[slug]/page.tsx`, `products/[slug]/page.tsx`, `stores/[slug]/page.tsx`, `account/page.tsx`, `account/addresses/page.tsx` |
| Catalog components | every non-test file in `src/components/catalog/`, including `search-heading.tsx` (new in `4fa4352`) |
| Account components | every non-test file in `src/components/account/` |
| Shell and UI used by the storefront | `src/components/shell/*`, `src/components/ui/breadcrumb.tsx` |
| Text helpers | `src/i18n/fill.ts`; the `th.catalog.*` and `th.account.addresses.*` templates that take a placeholder |
| Data sources | `src/modules/catalog/schema.ts` (DTOs, `searchTextSchema`, `isStorableText`), `src/modules/catalog/repository.ts` (`REVIEW_SELECT`), `src/modules/auth/schema.ts` (`NAME_ALLOWED_TEXT`, email), `src/modules/profile/schema.ts` (`displayText`, phone and postal code patterns) |

## Every user-controlled value the storefront shows

| Value | Who writes it | Where shown (at `4fa4352`) | Isolated | Schema refuses bidi controls |
| --- | --- | --- | --- | --- |
| Store name | Seller (no write path yet) | `product-card.tsx:47`, `product-detail-view.tsx:82`, `store-section.tsx:50` (`h1`) | Yes, alone in `<bdi>` | No write path exists yet. The remediation of SEC-037 says store names must reuse `NAME_ALLOWED_TEXT`. |
| Search query `q` | Anyone, through the URL (can be sent to a victim as a link) | `search-heading.tsx` (`h1`) | Yes, alone in `<bdi>` | No: `searchTextSchema` refuses only U+0000 and lone surrogates |
| Display name | The user | `profile-card.tsx:165` | Yes | Yes (`displayText`, `NAME_ALLOWED_TEXT`) |
| Address recipient and lines | The user | `address-book.tsx:143`, `:151-152` | Yes, one `<bdi>` per field | Yes |
| Address recipient in `aria-label` | The user | `address-book.tsx:190`, `:206`, `:218` through `fill()` | No (an attribute cannot hold `<bdi>`) | Yes, so no control can reach the label |
| Email | The user | `profile-card.tsx:140`, `:169` | No | Yes in effect: `z.email()` accepts ASCII only (tested with seven controls in the local part and in the domain) |
| Phone, postal code | The user | `profile-card.tsx:179`, `address-book.tsx:149`, `:153` | No | Yes: digits and `+66` only |
| Product title | Seller (no write path yet) | `product-card.tsx:44` (`h3`), `product-detail-view.tsx:59` (`h1`), `:28` (breadcrumb, current item), `:44-48` (`alt` through `fill(th.catalog.product.imageAlt)`) | **No**: SEC-057 | No write path yet; the database has no check |
| Product and store description, review comment | Seller, customer | `product-detail-view.tsx:107`, `store-section.tsx` (description), `reviews-view.tsx:25` | No; each is the only content of its own `<p>` | No |
| Category name | Admin | `category-chips-view.tsx:27`, `product-detail-view.tsx:27`, `:97` | No | No write path yet |
| Review author | Customer | Not shown | Not applicable | Not applicable |

Descriptions and comments are free text, not names. Each is the only content of its own block element. A block element is a bidi paragraph boundary, so an override that is not closed cannot reorder text outside that block. No finding.

Category names are written by an admin, a trusted role, so they are outside the rule. CR-T021-05 is about to show the category name in the category page `h1`. Isolating it there costs nothing and is recommended. This is not registered as a finding.

## SEC-057: how the bare title behaves today

Where the title is the only content of a block, an override in it reorders only the title. The seller controls the title anyway. This holds for:

- the card `h3`;
- the detail `h1`;
- the breadcrumb item, because each `li` is `inline-flex`, which makes its children flex items, and each flex item is its own block.

The `alt` text is different. `th.catalog.product.imageAlt` is `"{title} รูปที่ {index} จาก {count}"`, so an override that is not closed in the title reorders the shop's own words "รูปที่ 1 จาก 3". This text is shown when the image does not load, and some tools read it. The risk grows when titles appear inline in a sentence. Cart lines, order lines, confirmations such as "ลบ {title}", notifications, and `generateMetadata` page titles will all do this. No product write path exists yet (seller product management comes later), so today only seed data and direct database writes can set a title.

## Commands and results

| Command | Result |
| --- | --- |
| `git status --porcelain`; `git log --oneline`; `git diff` (several times) | States as in the table at the top |
| `pnpm exec vitest run tests/security/sec033-rendering-recheck.test.ts` (final) | 1 file, 48 passed, 3 expected fail (SEC-057), exit 0 |
| Scratch copy `tests/security/zz-old.test.ts` of the new file, with `it.fails(` changed to `it(` and the search page import pointed at `zz-old-search-page.tsx` (the `506646b` search page, with the removed `th` key replaced by its old literal text). Both scratch files were deleted afterwards | 5 failed, 45 passed. Each failure is on its flaw assertion: search `bdiContents` was `['ผลการค้นหา “<text>”']` and not `['<text>']` (2 cases); card title `{isolated: 0, bare: 1}`; detail title `{isolated: 0, bare: 2}`; `alt` does not start with FSI, title, PDI |
| `node -e` on the `506646b` search page with the scan's pattern | The `<UserName>` body `{fill("ผลการค้นหา “{q}”", { q: query.q })}` does not match the pattern, so the static scan catches the old code |
| `pnpm exec prettier --write`, `pnpm exec eslint` on the new file | Formatted; ESLint exit 0 |
| `pnpm typecheck` | exit 0 |
| `node -e` scan of the new file for `Cf`, `Zl`, `Zp` characters | 0 (every control is built with `String.fromCodePoint`, SEC-040) |
| `pnpm exec vitest run --project security`, route untracked | 24 files; 880 passed, 8 expected fail, **1 failed**: see "Side effect seen" |
| `pnpm exec vitest run --project security`, at `b829f77` plus this review's files | 24 files; 881 passed, 8 expected fail, **1 failed** (the same case) |
| `pnpm exec vitest run tests/security/sec033-rendering-recheck.test.ts`, at `b829f77` | 48 passed, 3 expected fail |

## Side effect seen (not a finding of this review)

`tests/security/t020-t018-catalog-shell.test.ts`, case "every other non-auth route file is one that a review has listed", fails at `b829f77`. That commit (backend-api, CR-T021-05) adds `src/app/api/v1/categories/[slug]/route.ts`. The case is a tripwire: a new route file must get a security read before it is added to the list. The list was not changed here, because adding the route needs that read, and the route is outside this review. So `pnpm test` and `pnpm verify` are red at `b829f77` until that happens. Action for the orchestrator: have security review `GET /api/v1/categories/{slug}` (commit `b829f77`), and then add the route to the list in `t020-t018-catalog-shell.test.ts`.

## Not covered

- No browser. Bidi isolation was checked in the markup (`<bdi>`), not on the rendered page. Browser support for `<bdi>` and `unicode-bidi: isolate` was taken as given.
- The search page's product list and the store page's list were not rendered. They are async server components, and the static scan stands in for them. Each product card inside them is the `ProductCard` that was tested.
- Screen-reader behaviour with controls in `aria-label` and `alt`.
- The SEC-042 display part (clipping containers) was not re-checked. Only the presence of `USER_NAME_CONTAINER_CLASS` was noticed: on the search heading, store `h1`, card store line, detail store `dd`, and account fields, and not on product titles.
- No dependency audit or secret scan. The commits reviewed change no manifest or lockfile.
- Pages that do not exist yet: cart, checkout, orders, seller and admin dashboards. Every name and title on them must follow the same rule.
