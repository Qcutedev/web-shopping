# T-035 security review: review create endpoint and reviews module

Reviewer: security agent. Date: 2026-10-26. Commits reviewed: `589eef4` (module, route, unit tests), `2d9abc9` (integration tests), `3b73244` (API_CONTRACTS 5.6.1). Decisions: D-047 (comment rules, review allowed after the product is hidden or the store suspended). Tree at review: `f8b7987`, with frontend (T-035 review form) and qa (`tests/integration/reviews/**`) working in parallel; none of their files was read for a finding below except `src/components/catalog/reviews-view.tsx` as committed. Register: [../SECURITY.md](../SECURITY.md).

Result: **no Critical or High finding in the review endpoint.** Ownership, one review per item, the delivered-only rule, the transaction, injection, mass assignment, CSRF, and the rate limit hold. One new finding:

- **SEC-092 (Medium):** review text is public the moment it is written, and there is no way for an admin (or anyone but a database operator) to hide or delete a review. Any buyer of a delivered item can put scam contact lines or abuse on a product page; with the mock provider and SEC-072 that costs nothing.

Related open finding, unchanged: **SEC-072 (Low)** a seller can deliver to its own second account in seconds and so unlock reviews for itself. T-035 adds no guard against it (the remediation's option 3 was not taken).

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Neither shows that the endpoint is secure.

## Scope

- `src/app/api/v1/orders/[id]/items/[itemId]/review/route.ts`
- `src/modules/reviews/service.ts`, `repository.ts`, `schema.ts`, `eligibility.ts`, `errors.ts`, `index.ts`
- `src/server/auth/session.ts` (`requireActor`, `loadActor`), `src/server/rate-limit.ts` (`REVIEW_CREATE`), `src/modules/orders/state.ts` (fulfilment table), `prisma/schema.prisma` (`Review`, `OrderItem`), `NAME_ALLOWED_TEXT` and `normaliseMultiLineText`
- `src/components/catalog/reviews-view.tsx` (where the comment is shown)
- REQ-C-14, BR-11, D-047, API_CONTRACTS 5.6
- The author's tests (`src/modules/reviews/*.test.ts`, the route test, `tests/integration/reviews/endpoints.test.ts`): read, not changed

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Route order | Holds. `Origin` (403), content type (415), session (401), `review-create` rate limit on the session's user id (429) all run before the body is read; then path ids and strict body (400), then the service. No database import in the route. | `t035-reviews.test.ts` "the route file" |
| Ownership / IDOR (TM-05) | Holds. One locking statement finds the item only through `oi.id = $1 AND so.orderId = $2 AND o.userId = $3`, all three bound parameters, `$3` the session's user id; no `OR`. Another customer, the seller who sold the item, and an admin all get the same 404 with empty details and nothing is written. Mixing an order id with an item id of another order (own or foreign, in either direction) is 404. | `t035-reviews.test.ts` "found only through the actor's own order"; `t035-reviews.itest.ts` "no IDOR" (real PostgreSQL) |
| Who and what is stored | Holds. The insert takes `productId` from the locked item, `userId` from the session, `orderItemId` from the locked row; the body is a strict object, so `productId`, `userId`, `orderItemId`, `orderId`, `storeId`, `createdAt`, `id`, `role`, `status`, `__proto__` are 400. The answer carries `{ id, rating, comment, createdAt }` only. | Unit and itest cases |
| Delivered only (BR-11) | Holds. Judged on the locked row: anything but the exact string `DELIVERED` is 409 NOT_DELIVERED. Judged per seller order: in one order with two stores, the delivered store's item is accepted and the shipped store's item refused. `DELIVERED` implies the order was `PAID`: the only way in is `SHIPPED`, reachable only from `PROCESSING`, which requires `PAID` (OQ-41). The service does not re-check payment itself; that rests on the fulfilment table. | Unit status matrix; itest "BR-11 is judged per seller order" |
| One review per item | Holds. `FOR UPDATE OF oi` serialises two reviews of one item; the second sees the first and gets 409 DUPLICATE_REVIEW; the unique index `Review_orderItemId_key` is the backstop and is also mapped to 409. Eight parallel requests: exactly one 201, seven 409, one row. | itest "one review per item under concurrency" |
| Transaction (rule 5) | Holds. Lock, check, and insert in one interactive transaction with `maxWait` 5 s and `timeout` 10 s. | Unit "one interactive transaction" |
| Injection | Holds. The one raw statement is a tagged template; a hostile id (`x' OR '1'='1`) appears only in the bound values. No `Unsafe` call or `Prisma.raw` in the module. | Unit cases |
| XSS (TM-15) | Holds. The comment is stored and returned as plain text; markup is kept byte for byte (the author's integration case shows the public list returns it unchanged) and `reviews-view.tsx` renders it as a React text child; no `dangerouslySetInnerHTML`. | Unit "markup is accepted as plain text", static renderer case |
| Comment rules (D-047) | Hold. At most 2000 characters after normalisation; blank and `null` become `null`. Every line under the display-name rule: U+0000, C0 and C1 controls, tab, U+202E, U+2066, U+FEFF, U+2028, a lone surrogate, and a run of four zero-width characters are 400. A single U+200B to U+200D is accepted on purpose (Thai word breaks; SEC-041 decision). | Unit "comment text rules" |
| CSRF (TM-16) | Holds. A foreign `Origin`, no `Origin`, and `Origin: null` with the buyer's cookie are 403 and write nothing. | itest "refusals before any write" |
| Deactivated user (TM-26) | Holds. A deactivated buyer's live cookie is 401 and writes nothing (`loadActor` reads `isActive` on every request). | itest |
| Rate limit | Holds. 10 per user per hour; the eleventh is 429 with `Retry-After`; another user is unaffected. Consumed before validation, so malformed requests also count (self-limiting only). Process-memory limiter: per instance, reset on restart (existing residual). | itest "per user" |
| D-047 (2) | Holds as decided. A review of an archived product is accepted and not listed (`GET /products/{slug}/reviews` is 404 while the product is hidden). | itest "D-047 (2)" |
| Logging | Holds. The module logs nothing; the comment never reaches a log. The rate-limit event carries no comment. | Static case |
| Moderation of review text | **Gap, SEC-092.** No endpoint or admin page hides or deletes a review; no report function. | Code search: no `review.update`/`review.delete` in `src`; REQUIREMENTS has no review moderation item |

## Findings

### SEC-092 Review text is published at once and nothing can hide or remove it

Severity: Medium. Status: OPEN. Full entry in [../SECURITY.md](../SECURITY.md#sec-092-review-text-is-published-at-once-and-nothing-can-hide-or-remove-it).

## Commands run

- `pnpm exec vitest run tests/security/t035-reviews.test.ts tests/security/t020-t018-catalog-shell.test.ts` -> 2 files, 152 passed
- `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t035-reviews.itest.ts` -> 1 file, 9 passed (real PostgreSQL, `marketplace-db-test-1`)
- `pnpm test` -> 215 files, 5796 passed, 33 expected fail, exit 0 (includes the route-list gate with the new route)
- `pnpm exec eslint` and `pnpm exec prettier --check` on the new files -> clean; `pnpm exec tsc --noEmit -p .` -> no error in `tests/security`
- `pnpm audit --prod` (pnpm 12.11.2) -> "No known vulnerabilities found"; T-035 commits change no manifest or lockfile
- Secret pattern search: `git show 9457ac8 589eef4 2d9abc9 3b73244` filtered for AWS, private-key, GitHub, Slack, Stripe, Google, JWT shapes, URL credentials, `password/secret/token/api_key = <12+ chars>` -> 0 matches (`gitleaks` not installed; a pattern search is weaker than a scanner)

## Not covered

- The frontend review form (being written in parallel) and its rendering of the order item's review: not reviewed.
- A browser: no rendering check of a markup or bidi comment on the product page.
- `next start`: route called in process, not through a running server.
- Rating manipulation by repeat purchases (one review per order item, so N orders give N reviews of one product by one user): by BR-11 design; with SEC-056 and SEC-072 it is free under the mock provider.
