# T-043 security review: seller orders, fulfilment, dashboard summary

Reviewer: security agent. Date: 2026-10-20. Commits reviewed: `fcd2de8` (module, routes, unit tests), `dcae7b9` (integration tests), `2bcc4d1` (API_CONTRACTS 5.7.3.1), `0938b7e` (test value built from its code point). Tree at review: `6ebbe02`, with backend-api's uncommitted change in progress (the seller order LIST drops `paidAt` and the address, owner ruling on Q42; read, not reviewed as final). Register: [../SECURITY.md](../SECURITY.md).

Result: **no Critical, High, or Medium finding.** Store scoping from the session, the cross-store and unpaid 404, the transition table, the guarded updates, the paid-order condition (OQ-41), and the suspended-store access (BR-14) hold in the code and in every static check. One new finding: **SEC-072** (Low: a seller can take an order to `DELIVERED` in seconds with no buyer or carrier confirmation, which unlocks a review under BR-11; with a second account and the mock provider this is free review farming).

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Neither shows that the seller order endpoints are secure.

## Scope

- `src/modules/orders/seller-schema.ts`, `seller-service.ts`, `seller-repository.ts`, `seller-mapping.ts`, `errors.ts` (`sellerOrderNotFound`), `state.ts` (the fulfilment table), `index.ts`
- `src/app/api/v1/seller/orders/route.ts`, `orders/[id]/route.ts`, `orders/[id]/status/route.ts`, `seller/summary/route.ts`
- `src/server/auth/actor.ts` (`requireRole`), `src/server/auth/session.ts` (where `storeId` and `storeStatus` come from), `src/server/errors.ts` (`invalidStateTransition`)
- `src/modules/checkout/repository.ts` (BR-16 own-store condition, read for SEC-072)
- REQUIREMENTS BR-11, BR-14, BR-16, BR-29, BR-35, the fulfilment table; API_CONTRACTS 5.7.3 and 5.7.3.1 as committed
- The author's tests `tests/integration/seller-orders/endpoints.test.ts` (case list read, not changed)

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Store id from the session only | Holds. No route reads a store id; the service builds its scope only from `actor.storeId` and `actor.userId`, which `session.ts` loads from the database per request. The list query strips `storeId`, `ownerId`, `paymentStatus`. | `t043-seller-orders.test.ts`: route files (no `storeId` in code), `sellerScope`, list query case |
| Role check in the service | Holds. Every exported service function starts with `sellerScope(actor)`, which calls `requireRole(actor, "SELLER")`; the routes' `requireRole` is the earlier refusal, not the control. | Static case per function; mutant below |
| Cross-store and unpaid 404 | Holds. The detail read filters by id, `storeId`, `store.ownerId`, and `order.paymentStatus = PAID`; the lock statement has the same four conditions. Unknown, foreign, `PENDING`, and `FAILED` take one path and give the same 404. A 409 can only follow a successful scoped lock, so the transition error is no oracle for another store's ids. | Static cases on `ownPaidSellerOrderWhere`, `lockOwnPaidSellerOrder`; author's integration cases "same 404, nothing changes" (run by this review, see Commands) |
| Transition table | Holds. The seller's moves are exactly PENDING to PROCESSING, PROCESSING to SHIPPED, SHIPPED to DELIVERED, PENDING or PROCESSING to CANCELLED. Every other pair, SHIPPED to CANCELLED included (BR-29), throws `AppError` 409 `INVALID_STATE_TRANSITION`. `PENDING` is not an accepted target. | Static cases over all 25 pairs |
| Conditional update | Holds. `moveSellerOrderStatus` repeats the id, the store, the source states taken from the same table (`fulfilmentSourceStates(body.to, "SELLER")`, bound with `Prisma.join`), and `EXISTS (... paymentStatus = 'PAID')`; zero rows is a 409, never a success. The row is locked `FOR UPDATE OF so` first, so two concurrent moves serialise. | Static cases; author's race cases (two cancels; cancel and ship) |
| Paid-order condition (OQ-41, BR-35) | Holds in every statement: the two Prisma reads, the lock, the move, and both order figures of the summary. The mapping throws for a row of an order that is not `PAID` or has no paid time, so such a row cannot become a 200. | Static cases; mapping case |
| Suspended store allowed (BR-14) | Holds as specified. No route or service calls `requireApprovedSeller` or `requireApprovedStoreForWrite`, reads `storeStatus`, or puts a store-status condition in SQL. | Static cases |
| Stock restore on cancel | Holds. The claim `UPDATE "OrderItem" ... WHERE "stockRestoredAt" IS NULL RETURNING` marks each item once, then adds back exactly the claimed quantities in product-id order, inside the same transaction. A second cancel is 409 before any restore. | Code read; author's "stock is restored once" race case |
| Mass assignment | Holds. The status body is a strict object; `storeId`, `from`, `status`, `fulfilmentStatus`, `paymentStatus`, timestamps, amounts, `reason`, `role`, `__proto__`, `constructor`, `prototype` as own JSON keys are refused. | 24 key cases |
| Input validation | Holds. `to` is an enum without `PENDING`; carrier and tracking are accepted only with `SHIPPED`, trimmed 1 to 100 characters, the name rule (no C0 controls, no bidi controls, no U+2028, no U+FEFF). The id is 1 to 200 characters, no U+0000, no lone surrogate. A repeated or unknown filter, page 0, and page size 51 are 400. | Schema cases |
| Injection | Holds. Raw statements are tagged templates with bound values; the one `Prisma.sql` fragment is the source-state list via `Prisma.join`; no `Unsafe` call or `Prisma.raw`. Order by is fixed. | Static case |
| Leaks | Holds for the detail: built key by key; extra row fields (store id, order id, buyer user id, email, a grand total, a payment reference) are not copied. The detail carries the buyer's recipient name, phone, and address (needed to ship, BR-09) and `commissionRateBps`; never the order total or another store's items. No seller file imports the logger. Error bodies: 404 and 409 have fixed shapes; unexpected `Error`s go to the frame's 500 (public text fixed, reviewed under SEC-017). | Mapping case; static logging case; code read |
| List fields (Q42) | At the reviewed commits the list returned `paidAt` and the full shipping address of every entry. Not a security finding (the same seller may read each detail), but data minimisation; the owner ruled on 2026-10-20 that the list drops both. backend-api's uncommitted change does that (`toSellerOrderListItemDto`, list hydrate no longer selects them). | `git diff src/modules/orders/` read; to be re-checked when committed |
| CSRF | Holds. The only mutation checks `Origin`, then `Content-Type: application/json`, before the session; reads change nothing. | Route source-order case |
| Summary | Holds. All four statements are scoped by `storeId` and `ownerId`; order figures by a `PAID` order; the sales sum excludes `CANCELLED` and the shipping fee; read-only snapshot. | Static case |
| Rate limits | None on these endpoints, by contract (section 6). A seller can only act on its own paid orders, so the gain of flooding is its own load. | Contract read |
| Secrets | Pattern search of the four commits for passwords, keys, tokens, connection strings: nothing found. No manifest or lockfile changed, so no dependency audit was run. gitleaks and trufflehog are not installed. | `git show` of the four commits; `Get-Command gitleaks` |

### Commands

- `pnpm exec vitest run tests/security/t043-seller-orders.test.ts tests/security/t020-t018-catalog-shell.test.ts` -> 2 files, 142 passed (new file 63 passed).
- `pnpm test` -> 151 files, 4239 passed, 5 expected fail, exit 0.
- `pnpm typecheck` -> exit 0.
- `pnpm exec eslint` and `pnpm exec prettier --check` on the two test files -> exit 0; byte scan of the new file: 0 bytes above 126, no backslash-u.
- `pnpm exec vitest run --config vitest.integration.config.mts tests/integration/seller-orders/endpoints.test.ts` -> twice `ConcurrentRunError` (lock held by another run), then 1 file, 35 passed, exit 0.

### Negative control

The new static test was copied into a scratch folder under `tests/security` (deleted afterwards) with its source paths pointed at copies of the route and module files carrying five mutants: (1) the guarded move without `so."storeId" = ${scope.storeId}`; (2) the lock without `o."paymentStatus" = 'PAID'`; (3) `requireApprovedSeller(actor)` added to the status route; (4) `parseInput` before `requireActor` in the list route; (5) `getOwnSellerOrder` building its scope without `sellerScope`. Result: 5 failed, 58 passed; each failure is the case for its mutant (`expected 140 to be greater than 236`; `not to match /requireApprovedSeller|.../`; `expected false to be true`; `to match /o\."paymentStatus" = 'PAID'/`; `to match /so\."storeId" = \$\{scope\.storeId\}/`).

## Observations (no finding)

1. The guarded move repeats the store but not `Store.ownerId`; the lock in the same transaction checks the owner, and the store's owner cannot change, so this is not exploitable.
2. A seller's cancel of a paid order writes no `AuditLog` row and carries no reason (owner accepted for the MVP, seventy-ninth session). A dispute about who cancelled cannot be answered from the database beyond `updatedAt`. Recorded in Residual risks.
3. `carrierName` and `trackingNumber` accept markup and `javascript:` text. Safe as long as every page renders them as escaped text and never as `href`, `src`, or raw HTML (T-044 seller pages, customer order pages).
4. The seller of a suspended store keeps reading buyers' names, phones, and addresses of its paid orders and can cancel them (BR-14 by design).

## Findings

- **SEC-072** (Low, OPEN). A seller can move its own seller order from `PENDING` to `DELIVERED` in three requests within a second; nothing requires a carrier or buyer confirmation or a minimum time. Under BR-11 `DELIVERED` unlocks a review, so a seller with a second customer account (sign-up is free; with the mock provider every order is `PAID` at no cost, SEC-056) can buy its own product, mark it delivered at once, and post reviews. BR-16 stops only a purchase from the seller's own account.

## Not reviewed

- No reviewer-written integration test: the database behaviour (cross-store and unpaid 404, suspended store, races) rests on the author's `tests/integration/seller-orders/endpoints.test.ts`, which this review ran (35 passed, see below) but did not write or mutate. The first two attempts were refused with `ConcurrentRunError` (another agent's run held the test database lock); the third ran against the working tree, which then held backend-api's uncommitted list change.
- backend-api's uncommitted list change (Q42), as final code; to be re-checked once committed.
- Pages or components that will render seller order data (none exist yet; T-044).
- The admin side of fulfilment (T-050), which shares the state table.
- Requests through a running `next start`; behaviour across several processes or under load.
- Code review of the four commits (code-review agent's task).
