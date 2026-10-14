# T-021 code review (storefront pages, commit 506646b)

Reviewer: code-review agent, 2026-10-14. Verdict: **CHANGES REQUIRED**.

Boundaries hold (no Prisma import, pages delegate, Thai strings in `th.catalog.*`, money through `formatSatang`). Cache Components use is correct; every storefront route builds as Partial Prerender.

## Blocking

- **CR-T021-01 (Medium)**: filter state is lost and there is no filter UI. `ListHrefParams` (`src/components/catalog/list-href.ts:3-6`) carries only `q` and `sort`, so sort and page links drop `category`, `minPriceSatang`, `maxPriceSatang` (search, category and store pages). No price or category control exists. REQ-C-06 and REQ-C-07 not met. Fix: carry every `ListProductsQuery` filter in every href; add a GET filter form (price in baht converted server side, category select on search) or record an owner-approved deferral; add `listHref` tests.
- **CR-T021-02 (Medium)**: store page misses REQ-C-09 logo (`StoreDto.logo` never rendered) and has no `SortLinks`. Fix: render logo (alt `""`, tint placeholder when null), add `SortLinks`, add view tests.
- **CR-T021-03 (Low)**: async server sections untested (`product-list-section`, `product-detail-section`, `store-section`, `reviews-section`, `category-chips`). Removing `notFound()` fails no test. Fix: mock `@/modules/catalog` and `next/navigation`; assert NOT_FOUND calls `notFound`, generic error renders `role="alert"` with `th.errors.loadFailed` and no message, framework signal rethrown, failed categories renders `null`, failed reviews shows `reviewsFailed`.

## Non-blocking

- **CR-T021-04 (Low)**: hidden or missing product, store, category answers HTTP 200 (`notFound()` inside Suspense, per Next docs). Decision: record in DECISIONS.md or move the check to Proxy; align E2E.
- **CR-T021-05 (Low, a11y)**: category h1 is generic (`th.catalog.category.title` unused; needs name from `listCategories` or `getCategory`); home h2 precedes h1.
- **CR-T021-06 (Low)**: unused strings (`categories.all`, `categories.empty`, `category.title`, `store.title`), unused `heading` prop, past-last-page strings misnamed under `category.*`.
- **CR-T021-07 (Low, SEC-033)**: search heading wraps the whole sentence in `<UserName>`, not only `q`; catalog schema does not refuse bidi controls. Isolate `q` only; test `<bdi>` on search heading and product-detail store link. Security re-check of SEC-033 rendering part.
- **CR-T021-08 (Low)**: quantity selector and BR-30 message absent; plan and traceability still map BR-30/OQ-46 to T-021. Update the plan.
- **CR-T021-09 (Low)**: DESIGN_SYSTEM.md:315 low-stock pill and rating row cannot be met (`ProductListItemDto` has neither); :339 stale "Not implemented yet".
- **CR-T021-10 (Low)**: only first 10 reviews, no link to more; search page has no own pre-filled field; chips capped at 50 (add comment).

## Checks run by reviewer

`pnpm lint` exit 0 (111 probes); `pnpm typecheck` exit 0; `pnpm format:check` exit 0; `vitest run src/components/catalog` 3 files, 25 passed; `pnpm build` exit 0.

## Not verified

Full `pnpm test`/`verify`; real `next dev`/`next start` with data; browser at 360/768/1280, keyboard, contrast; Thai wording approval.
