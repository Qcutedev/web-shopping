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
  - Resolution (security, 2026-10-21): scan replaced by a syntax-tree scan, `unsafeTitleReads` in the same file. It reports every `title`/`productTitle` read under any variable name, and every use of a destructured `title` binding, unless the read is the sole child of `<UserName>` or sits in `${FSI}${stripIsolateControls(...)}${PDI}`. Remaining reads must match `TITLE_READ_EXCLUSIONS` exactly, per file, each with a reason. That includes `product-form-model.ts` (renders nothing; reads pinned one by one, so a rename or a new read fails closed). Bypass cases include the real `product-card.tsx` with `UserName` removed and the receiver renamed to `stored`: the old pattern finds nothing, the new scan reports it. Evidence in `docs/SECURITY.md` tool-run table, row 2026-10-21 "CR-107". Note: 10ef332's commit message says the rename was made to keep reads out of the scan. Change the code or ask security; do not rename to get past a scan.
- **CR-108 (Info, frontend)** Suspended store reads `getOwnStore` twice in sequence (`with-seller.tsx:78`, `dashboard-section.tsx:13`, `store-section.tsx:12`).

## Checked and correct

Money only through `<Price>`/`formatSatang`, integer math in `parsePriceInput`. User text in `UserName`. Copy from `th.seller`. Pages thin; no Prisma import. API client: JSON content type on bodyless mutations, encoded path ids, `apiUploadFile` sets none, `reason` read from `details`. Every page has loading, empty, filtered-empty, past-last-page, error-with-retry, one not-found for foreign/unknown/unpaid. One request at a time per mutation.

## Not verified

Build, browser, E2E, integration, CR-106 database behaviour. Approval here does not replace a security review.


## Re-review of fix commits e52dae7, b21a1bf, d67809c, a5f72a6 (eighty-sixth session)

Verdict: CHANGES REQUIRED. CR-97 to CR-99 and CR-101 to CR-106 are fixed (each new test fails without its fix), BOM strip confirmed. Checks by reviewer: `pnpm lint`, `typecheck`, `format:check` exit 0; seller + stat-card tests 8 files, 118 passed on a clean worktree. Not run: build, browser, e2e, integration.

- **CR-109 (Medium, frontend)** `product-form.tsx:58-65`: re-seed key is `JSON.stringify(product)` (whole DTO). A stock change or product action calls `router.refresh()`, the new prop replaces all unsaved form values and orphans uploaded images (the CR-103 harm). Reproduced by probe: typed title lost after stock-only rerender. `store-form.tsx:69-80` same design, lower risk. Fix: key on editable fields only, or re-seed `values` only when not dirty; always update `saved`. Add the probe as a test.
- **CR-110 (Low, frontend)** `order-detail-view.tsx:79-80`, `orders-list-view.tsx:71-73`: JSX drops the spaces around `{timesSign}` / `{dotSeparator}`; text reads "฿259.00 ×2 ชิ้น". Add `{" "}`; tighten the loose RegExp test.
- **CR-111 (Info, qa)** `dashboard-store.test.tsx:333-346` passes against the old `Tile`; assert something only `StatCard` gives or label it a regression guard.
- **CR-112 (Info, frontend)** `order-detail-view.tsx:80` raw `item.quantity` not through `formatCount`.
- **CR-113 (Info, frontend)** `image-set-editor.tsx:65-77` a later `wrongType`/`tooBig` message hides the `skipped` message from the same pick.

## Review of ccf1787 (Table stacked) and b8574f0 (CR-109 re-seed) (eighty-eighth session)

Verdict: CHANGES REQUIRED (CR-114 blocking). Checks by reviewer: vitest on table, products, dashboard-store tests 77 passed; eslint, prettier, `pnpm typecheck` exit 0. Not run: browser at 360/768/1280 px, screen readers; "tests fail without the fix" for CR-109 was checked by reasoning, not by reverting.

- **CR-114 (Medium, blocking, ui-ux-design)** `src/components/ui/table.tsx:336`: `TableStateRow` td has `max-md:block` unconditionally. With `stacked` off, below md the cell becomes display:block in a table-row and `colSpan` no longer spans. Contradicts "off by default, unchanged". Fix: `cn("p-0", stacked && "max-md:block")`; render a `TableStateRow` in the stacked-off test and assert no `max-md:` class.
- **CR-115 (Low, ui-ux-design)** `table.test.tsx:178-184`: the explicit-roles test passes on native elements without `role`. Assert the attributes directly.
- **CR-116 (Low, ui-ux-design)** `table.tsx:79-88`: stacked region below md keeps `tabIndex=0` and focus ring but cannot scroll. Drop the stop when `stacked` or record "accepted" in DESIGN_SYSTEM.md.
- **CR-117 (Low, ui-ux-design)** `table.tsx:157`, `:177-178`: stacked `TableFooter` draws a border inside a border. Drop card styling on footer rows or document unsupported.
- **CR-118 (Low, ui-ux-design, qa)** `table.test.tsx:186-191`: header-hidden test only checks the substring `sr-only`. Assert the exact token `max-md:[&:not(:focus-within)]:sr-only`; qa adds a Playwright check at 360 px (tab to sort button, header visible).
- **CR-119 (Low, frontend)** `product-form.tsx:151-156`, `store-form.tsx:130-137`: after save, `seenEditableKey` keeps the pre-save key, so the following `router.refresh()` re-seeds and wipes text typed in between. Fix: on success set the key from `response.data` via one shared helper; add a test.
- **CR-120 (Low, product decision)** `store-form.tsx:86-92`, `dashboard-store.test.tsx:313-323`: a form locked by a refresh (SUSPENDED, archived) keeps unsaved typed values in disabled fields. Decide: re-seed to stored values on lock, or keep and record why. Owner question if unsure.

Checked and correct: re-seed logic follows the editable fields only; excluded fields are right; image keys are stable; default Table path unchanged apart from CR-114; per-cell label is aria-hidden so no double announcement; tailwind-merge resolves fine.

## Re-review of 41dda4e and c829e6c (ninetieth session)

Verdict: APPROVE. CR-114 to CR-119 hold. No blocking finding. Checks by reviewer: vitest on table, products, dashboard-store tests 83 passed; eslint on the 5 changed sources and `pnpm typecheck` exit 0. Not run: browser, `pnpm format:check`, `pnpm verify`; "test fails without the fix" checked by reading, not by reverting.

- **CR-121 (Low, ui-ux-design)** `src/components/ui/table.tsx:34`: `BELOW_MD_QUERY` is `(max-width: 767.98px)`; Tailwind `max-md:` is `48rem`. With a smaller default font the table scrolls but has lost its tab stop (WCAG 2.1.1). Fix: `(width < 48rem)`.
- **CR-122 (Low, frontend)** `src/components/seller/editable-key.ts:9`: docstring says "unit tested", no `editable-key.test.ts` exists. Add one or drop the claim.
- **CR-123 (Low, ui-ux-design)** `table.test.tsx:241,245`: the footer-row `max-md:block` assertion passes with or without the CR-117 fix. Remove or replace.
- **CR-124 (Low, frontend/qa)** `products.test.tsx:562`, `dashboard-store.test.tsx:326`: no case for save to K1, type, refresh with K2 (must re-seed).
- **CR-125 (Info, ui-ux-design)** `table.tsx:97`: `useBelowMd()` adds a matchMedia listener for every Table, also unstacked ones.
- **CR-126 (Info, frontend)** `product-form.tsx:66-80`, `store-form.tsx`: `seenEditableKey` and `ownKey` overlap; could merge. Behaviour correct.
- **CR-127 (Info)** CR-118 Playwright half (qa) and CR-120 (product decision) remain open.

## Review of 9489c3a (Playwright stacked Table check, CR-118 Playwright half), 2026-10-22

Verdict: CHANGES REQUIRED. Reviewer re-ran lint, typecheck, format:check, `playwright test --list` (19 tests): all exit 0. Not run: `pnpm test:e2e` (Docker Desktop was down), so the 19-pass result and mutation checks are unreproduced.

- **CR-128 (Medium, qa, blocking)** `e2e/support/environment.ts:19-33`: `e2eDatabaseUrl()` checks only the hostname. None of the `tests/helpers/test-database-url.ts` rules run (CR-34 server differs from `DATABASE_URL`, required port/user/password, normal form, `assertNoDriverEnvironmentOverride`, removal of inherited `PG*` before child processes, CR-41). `prisma migrate deploy` could create and migrate `marketplace_e2e` on the dev server if `DATABASE_URL_TEST` is mistyped. TRUNCATE is guarded by the name check, so no dev data is lost. Current `.env` is fine (dev 5432, test 5433). Fix: build the URL with `resolveTestDatabase` and replace only the database name; check the server before migrate; update TEST_STRATEGY.md.
- **CR-129 (Low, qa)** `tests/e2e-support/database.ts:20-29` duplicates `resetDatabase` (hardcoded settings `4000, 500`, no single transaction). Share `INITIAL_SETTINGS`, `quoteIdentifier`, table and sequence listing from `reset.ts`.
- **CR-130 (Low, qa)** `e2e/global-setup.ts:21-27`: `execFileSync` has no timeout, raw Prisma stderr is not sanitised (CR-29), `shell: true` triggers DEP0190.
- **CR-131 (Low, qa)** `e2e/stacked-table.spec.ts:87-108`: uses `focus()`, not Tab, so keyboard reachability is not tested; layout read once with no retry.
- **CR-132 (Low, qa)** `:44-54`: `tabbingReachesRegion` returns false after 80 Tabs without proving focus wrapped; the below-md case can pass vacuously.
- **CR-133 (Low, qa)** `:145-152`: `toBeHidden()` passes when nothing matches; assert `toHaveCount(1)` first. Line 110 checks one label in one cell only.
- **CR-134 (Low, qa)** `environment.ts:37-42` `adminDatabaseUrl()` is dead code with a wrong comment; line 11 loads `.env` into worker processes, parse it instead.
- **CR-135 (Low, qa or devops)** `e2e/.auth/` is git-ignored but not in `.prettierignore`.
- **CR-136 (Low, devops or frontend)** e2e `next dev` shares `.next/` with `pnpm dev` and typegen; use a separate `distDir` or document it.
- **CR-137 (Info, qa)** TEST_STRATEGY.md says "only the database name replaced"; the query is stripped too.

Security: note CR-128 for the next harness pass. `pnpm verify` and CI are not affected (they do not run e2e).

## Review of 125558b and d398e4e (ninety-second session)

Verdict: APPROVED, no blocking finding. CR-121 to CR-125 fixed; CR-126 not merged, justified (`seenEditableKey` and `ownKey` are different state; one key re-seeds to the old record after a save).

- **CR-138 (Low, ui-ux-design)** `src/components/ui/table.tsx:1` and `table.test.tsx:1` have a UTF-8 BOM added by 125558b. Save without BOM; optionally add `.editorconfig` `charset = utf-8`.
- **CR-139 (Low, frontend)** `src/components/seller/editable-key.test.ts:52` fixture has `alt` (not in `ImageRef`) and `as never` casts at 52 and 74. Type literals as `ImageRef`.
- **CR-140 (Info, ui-ux-design)** `table.tsx:56` docstring line about 125 characters; re-wrap to 100.
- **CR-141 (Info, ui-ux-design)** `table.test.tsx:229-246` lacks cases: `stacked={false}` to `stacked` subscribes; unmount calls `removeEventListener`.
- **CR-142 (Info, frontend)** put the CR-126 reason in a comment at `product-form.tsx:66-69` and `store-form.tsx:77-80`.

Not verified by the reviewer: tests against the old code (traced by reading), real browser, `pnpm verify`, `pnpm build`.

## Review of 96ed30e and 25bbbf4 (e2e setup, distDir), ninety-third session

Verdict: CHANGES REQUIRED. Validation reuse is correct; no path reaches a non-test database. Docker was down: `pnpm test:e2e` not run; CR-143 comes from reading Next source, not observed.

- **CR-143 (Medium, blocking, devops)** `tsconfig.json`, `next.config.ts:7`: `next dev` with distDir `.next-e2e` appends `.next-e2e/dev/types/**/*.ts` and `.next-e2e/types/**/*.ts` to `include`, so each `pnpm test:e2e` dirties tracked `tsconfig.json`; if committed, `tsc` checks stale e2e types. Fix: commit both entries in `include` and add `.next-e2e` to `exclude`, or use a separate tsconfig; run e2e once and confirm clean `git status`; update `docs/DEPLOYMENT.md:71`.
- **CR-144 (Low, devops)** e2e server rewrites ignored `next-env.d.ts`; with `pnpm dev` at the same time they flip it. "Does not share with pnpm dev" in `DEPLOYMENT.md:71` is partly true. Say so.
- **CR-145 (Low, docs)** `TEST_STRATEGY.md:147`: "no DATABASE_URL_TEST" holds for setup steps only; webServer child inherits parent env and `next dev` loads `.env*`. Limit sentence or strip those variables from `webServer.env`.
- **CR-146 (Low, qa)** `e2e/support/environment.ts:536-537`: `PGOPTIONS`, `NODE_PG_FORCE_NATIVE` refused only in `process.env` and `.env`, not `.env.local`, `.env.development*`. Run the check on those files; do not set to `""` (`pg` treats defined `NODE_PG_FORCE_NATIVE` as on).
- **CR-147 (Low, qa)** `e2e/global-setup.ts:231`, `environment.ts:508`: paths use `process.cwd()`. Base on `import.meta.dirname`.
- **CR-148 (Low, qa)** `global-setup.ts:253-254`: hardcoded `node_modules/prisma/build/index.js`, `tsx/dist/cli.mjs`. Resolve with `createRequire`.
- **CR-149 (Low, qa)** `stacked-table.spec.ts:313-325`: shadow host with several Tab stops (`nextjs-portal`) ends the walk early; `TEST_STRATEGY.md:144` overstates. Follow `shadowRoot.activeElement` or `devIndicators: false` for e2e.
- **CR-150 (Low, qa)** `stacked-table.spec.ts:300-301`: `blur()` does not reset Tab start; write the one-call-per-fresh-`goto` limit in the docstring.
- **CR-151 (Nit, qa)** spec imports `SELLER_STORAGE_STATE` from `./support/environment`; import from `./support/constants`.
- **CR-152 (Low, qa)** no global teardown; `e2e/.auth/seller.json`, `marketplace_e2e`, `.next-e2e/` remain (git-ignored, local). Document or add teardown.

Security-sensitive parts (database targeting, session cookie file) still need the security agent.

## Review of a781e29 and 3a03656 (CR-143 to CR-152 fixes), ninety-fifth session

Verdict: APPROVE. CR-143 to CR-152 all fixed (CR-144 and CR-152 by documentation, CR-147 uses `__dirname` because Playwright loads these files as CommonJS). `pnpm test:e2e` was run by the orchestrator: 19 passed, `git status` clean afterwards, so CR-143 is observed closed. Reviewer re-ran `pnpm format:check`, `pnpm lint`, `pnpm typecheck`: clean. Security not covered.

- **CR-153 (Low, devops)** `docs/DEPLOYMENT.md:399` says `tsc` "does not check its stale types". True only while `next-env.d.ts` points at `.next`. After an e2e run it imports `./.next-e2e/dev/types/routes.d.ts`, and `exclude` does not stop imported files, so a bare `tsc` or the IDE checks them. `pnpm typecheck` is safe (`next typegen` rewrites `next-env.d.ts` first). Reword.
- **CR-154 (Nit, qa)** `e2e/stacked-table.spec.ts:56`: docstring `*/` shares a line with `async function tabbingReaches(`. Split the line.
- **CR-155 (Nit, qa)** `e2e/support/environment.ts:62`: source label "the .env file" is used for `.env.local` etc. and the message says "integration run". Widen the `source` parameter in `tests/helpers/test-database-url.ts:360` or give the e2e check its own message.
- **CR-156 (Low, qa)** `e2e/support/environment.ts:83`: `otherUrls` holds `DATABASE_URL` only from process env and `.env`; a dev URL only in `.env.local` or `.env.development*` is never compared with `DATABASE_URL_TEST`. Add those files' values or narrow the doc sentence.

Not verified by the reviewer: the shadow-root walk (CR-149) against a real `nextjs-portal`, `pnpm test`.
