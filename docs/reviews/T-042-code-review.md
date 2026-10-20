# T-042 code review (seller products and inventory)

Commit reviewed: `9c0ff06`. Reviewer: code-review agent, 2026-10-20. Recorded by the orchestrator.

**Verdict: APPROVED WITH FOLLOW-UPS.** No blocking items. 2 should-fix, 6 minor. SEC-068 to SEC-070 are in `T-042-security.md` and not repeated here.

Checks re-run by the reviewer: `pnpm lint` exit 0 (import guards 111 of 111); `pnpm typecheck` exit 0; `pnpm test` exit 0 (146 files, 4040 passed, 5 expected fail); `pnpm test:integration -- tests/integration/inventory` exit 0 (1 file, 36 passed). Not verified: `next start`, multi-process behaviour, deadlocks against a future admin category switch-off, DATA_MODEL 4.2 and 7.6 line by line.

## Should-fix

- **CR-T042-01** Lock order in `updateProduct` contradicts the order stated in `src/modules/inventory/repository.ts:15-19` (store, category, Product, Upload, ProductImage). The service locks Product first (`service.ts:332`), then the category (`service.ts:336`). DATA_MODEL 7.5 does not define Store, Category or Upload positions, so the cited rule does not exist. No live deadlock today (nothing else locks Category); the first admin writer that locks Category then touches products could create one. Fix: (a) share-lock `input.categoryId` before `lockOrNotFound` and throw `categoryNotFound` only after the product lookup (keeps the 5.7.2.1 404 order), or (b) rewrite the header to the real order. Either way database adds Store, Category, Upload positions to DATA_MODEL 7.5 before T-050/T-051.
- **CR-T042-02** No test reads `moderationRequestedAt` (BR-36 queue position). Untested SQL: the `CASE ... now()` in `moveProductStatusIfStoreApproved` (`repository.ts:437-439`) and `updateProductIfStoreApproved` (`repository.ts:400-401`), and the `bumpRevision` branch (`service.ts:384-396`) for a PENDING product whose picture set alone changes. Fix: integration cases that read the column: publish PENDING sets it later; publish APPROVED or REJECTED leaves it; content edit of PENDING keeps it and raises `contentRevision` (including images-only); price change on REJECTED sets it. Admin moderation (T-050) orders its queue by this column.

## Minor

- **CR-T042-03** `service.ts:375-397`: inner `effect.bumpRevision ? update : touch` repeats the outer call with identical arguments. Use one condition: `if (fieldsChanged || status changed || effect.bumpRevision) update; else if (picturesChanged) touch;`.
- **CR-T042-04** `service.ts:349`: `uploadsAttachedElsewhere` runs even when `imageKeys` was not sent. Guard with `input.imageKeys !== undefined`.
- **CR-T042-05** `repository.ts:174-187`: `count` and `findMany` are separate statements, so `total` can disagree with `items`. Use one read-only transaction or document it.
- **CR-T042-06** `service.ts:176-181`: `readScope` returns 404 for `actor.storeId === null` on the list endpoint; the contract lists no such 404. Throw a plain `Error` (500) or 403.
- **CR-T042-07** `repository.ts:104-112`: a missing category row throws, a missing upload row is silently dropped, so a response can show fewer pictures than linked. Treat both the same or comment why dropping is safe.
- **CR-T042-08** No test for two PATCHes giving two products the same SKU at once (`isRawUniqueIndexViolation`, `service.ts:247`). Add a parallel-PATCH case: one 200, one 409 `DUPLICATE_SKU`.

## Owners

backend-api: CR-T042-01 (a or b), 03 to 07. qa: CR-T042-02, 08. database: DATA_MODEL 7.5 lock positions. CR-T042-01 must account for any per-store product limit chosen for SEC-068/069.
