# T-044 code review (seller dashboard)

Commits: `fd40b1d`, `c14999b`, `3eea315`, `c6a52ec`, `10ef332`. Reviewer: code-review agent, read-only, 2026-10-21. Recorded by the orchestrator.

Verdict: **CHANGES REQUIRED.** CR-97 and CR-98 block approval. T-044 stays IMPLEMENTED.

IDs: CR-79 to CR-96 were already used, so numbering starts at CR-97. If the newer `CR-T0xx-NN` form is wanted, CR-97 to CR-108 map to CR-T044-01 to CR-T044-12.

Checks re-run by the reviewer: `pnpm lint` exit 0 (111 of 111 probes), `pnpm typecheck` exit 0, `pnpm test` exit 0 (162 files, 4415 passed, 5 expected fail). Not run: `pnpm build`, browser, E2E, integration.

## Blocking

- **CR-97 (High, frontend)** `src/components/seller/products-list-view.tsx:35-58`, `products-query.ts:10-32`. The filter is a GET form; each select has an "all" option with `value=""`, so `status=` and `moderationStatus=` are always sent. `listSellerProductsQuerySchema` uses `z.enum` (`src/modules/inventory/schema.ts:226-227`) and rejects `""`, so `productListQueryFrom` falls back to the unfiltered first page. Any submit with one select on "all" loses every filter, including low-stock and sold-out. Reproduced: `productListQueryFrom({ status: "", moderationStatus: "REJECTED" })` gives `{"query":{"page":1,"pageSize":20},"valid":false}`. `orders-query.ts:12-16` has the same flaw (hidden because a dropped filter equals "all"). Fix: drop empty-string values in `toUrlSearchParams` and its copy; add tests for `{status:"", moderationStatus:"REJECTED"}` and `{status:"", moderationStatus:"", lowStock:"true"}`.
- **CR-98 (Medium, frontend)** `order-status-panel.tsx:60, :98-100`. `useState(initialStatus)` copies the prop once; after 409 `INVALID_STATE_TRANSITION` or 404 the panel calls `router.refresh()` but keeps offering the stale moves. Test `orders.test.tsx:332-346` only asserts `refresh` was called. Fix: derive moves from the prop, reset local state when the prop changes; test with `rerender` after a 409.

## Non-blocking

- **CR-99 (Low, frontend)** Same prop-copy pattern: `stock-panel.tsx:32`, `product-form.tsx:53`, `store-form.tsx:64,75` (stays APPROVED after `SELLER_NOT_APPROVED` refresh, `:130`).
- **CR-100 (Low, frontend/backend-api)** `product-sections.tsx:14-17` `loadCategoryOptions` reads only page 1 (50). Later active categories cannot be chosen. Same pattern in `category-chips.tsx:17`, `search-filters.tsx:27`.
- **CR-101 (Low, frontend)** `th.ts:717-721` `fieldErrors.description.tooLong` says 2,000; product description max is 5,000 (API_CONTRACTS 5.7.2.1). Add separate copy.
- **CR-102 (Low, frontend)** `src/lib/api-client/seller.ts:24-30` redeclares `UploadedImage`; import `UploadDto` from `src/modules/uploads/schema.ts:98-101`.
- **CR-103 (Low, frontend)** Submit stays active during an upload (`product-form.tsx:252`, `store-form.tsx:197`): in-flight picture lost or orphaned (counts toward the 50-unattached cap). `image-set-editor.tsx:57-61` silently drops files beyond `room`.
- **CR-104 (Info, frontend)** `valid` from `productListQueryFrom` is unused; `productsHref`/`ordersHref` drop `pageSize`; `toUrlSearchParams` duplicated in `orders-query.ts:12-16`.
- **CR-105 (Info, frontend)** `dashboard-view.tsx:16-28` `Tile` re-implements `src/components/ui/stat-card.tsx`; counts formatted inconsistently (`stock-panel.tsx:83`, `products-list-view.tsx:131,165` vs `toLocaleString("th-TH")`); separators `" × "`, `" · "` hardcoded in `order-detail-view.tsx:79`, `orders-list-view.tsx:71`.
- **CR-106 (Info, frontend)** `product-sections.tsx:38-45`, `order-section.tsx:14-17` pass the raw path id to the service without the params schema. NUL or over-200-char id may show the load error instead of not-found (not tested).
- **CR-107 (Info, security/qa)** Commit `10ef332` renamed `product` to `stored` in `product-form-model.ts:54-63`, so the name-based scan `tests/security/sec033-rendering-recheck.test.ts:410-427` no longer matches. File renders nothing; not a bypass, but the scan is fragile. Security to decide on an explicit exclusion.
- **CR-108 (Info, frontend)** Suspended store reads `getOwnStore` twice in sequence (`with-seller.tsx:78`, `dashboard-section.tsx:13`, `store-section.tsx:12`).

## Checked and correct

Money only through `<Price>`/`formatSatang`, integer math in `parsePriceInput`. User text in `UserName`. Copy from `th.seller`. Pages thin; no Prisma import. API client: JSON content type on bodyless mutations, encoded path ids, `apiUploadFile` sets none, `reason` read from `details`. Every page has loading, empty, filtered-empty, past-last-page, error-with-retry, one not-found for foreign/unknown/unpaid. One request at a time per mutation.

## Not verified

Build, browser, E2E, integration, CR-106 database behaviour. Approval here does not replace a security review.
