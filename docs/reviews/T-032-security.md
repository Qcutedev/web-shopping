# T-032 checkout, orders, and mock payment security review

Date: 2026-10-14. Reviewer: security agent. Commits reviewed: `0838158` (modules), `1ba14f7` (contract), `26c7449` (Idempotency-Key header), plus the uncommitted route files `src/app/api/v1/checkout/route.ts`, `src/app/api/v1/orders/route.ts`, `src/app/api/v1/orders/[id]/route.ts` and `tests/integration/checkout/` as they stood in the working tree on top of `2b2e748`. Findings register: [SECURITY.md](../SECURITY.md).

Verdict: **no Critical or High finding.** Two new Medium findings (SEC-055, SEC-056). Two existing Medium findings now apply to shipped code: SEC-052 (the `checkout` rule can be filled by 10,000 cheap accounts; the route consumes it) and SEC-053 (no cap on cart lines; checkout takes stock for every line in one transaction). None of the four blocks committing the routes. In security's view all four must be closed or accepted in writing before any deployment that real customers or sellers can reach. Ownership, server-computed amounts, the guarded stock decrement, idempotency, and the payment state guards hold against the tests below, on real PostgreSQL. Passing tests are not proof that checkout is secure. They show that these particular attacks fail.

The three route files were added to `REVIEWED_NON_CATALOG_ROUTES` in `tests/security/t020-t018-catalog-shell.test.ts`, because nothing blocking was found.

## Scope

- `src/modules/checkout/` (`schema.ts`, `service.ts`, `repository.ts`, `pricing.ts`, `errors.ts`, `index.ts`)
- `src/modules/orders/` (`state.ts`, `schema.ts`, `service.ts`, `repository.ts`, `mapping.ts`, `timeout-sweep.ts`, `errors.ts`, `index.ts`)
- `src/modules/payments/` (`provider.ts`, `index.ts`)
- The commit's changes to `src/modules/catalog/visibility.ts` (`VISIBLE_PRODUCT_SQL`), `src/server/errors.ts` (`CART_EMPTY`), `src/modules/cart/index.ts`
- Routes (uncommitted): `checkout/route.ts`, `orders/route.ts`, `orders/[id]/route.ts`
- `tests/integration/checkout/` (read, and run)
- Supporting code read: `src/server/rate-limit.ts` (`CHECKOUT` rule), `src/server/http.ts` (`no-store`), `src/instrumentation.ts`, the `Order`, `Product`, `CartItem`, `OrderItem` constraints in `prisma/schema.prisma` and `prisma/migrations/20261011121529_init_schema_v1/migration.sql`
- Contract: `docs/API_CONTRACTS.md` sections 1.3, 5.5.1 to 5.5.5

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Route order of checks | `POST /checkout`: origin, content type, session, `checkout` rate limit on the session user id, body read, `Idempotency-Key`, schema, service. Matches contract section 1.8 and SR-05 item 5. GET routes: session before any parse. No route imports the database or reads identity from the request | `t032-checkout.test.ts` part 1 (static) |
| Order ownership (TM-05, BR-37) | `findOwnedOrder` and `findOrdersOfUser` filter by `actor.userId` in the `WHERE`. A foreign order id, its order number, and an unknown id give the same 404 with `details: {}`. The list ignores `?userId=`. A key another user used returns nothing of theirs | itest "orders are the caller's only" (2 cases) |
| Address ownership | `findOwnedAddress` filters by `{ id, userId }`; a foreign address is 404 `resource: "address"` | `tests/integration/checkout` (run) |
| Server-computed amounts (TM-08) | The body is `z.strictObject` with `addressId`, `paymentMethod`, `mockOutcome` only. Prices come from `RETURNING p."priceSatang"` of the guarded `UPDATE`, which locks the row. Fee and commission come from the settings row inside the transaction. A price changed after the add is the one charged. `Payment.amountSatang` equals the grand total | unit part 3 (20 extra keys, `__proto__`, `constructor`, 11 bad values); itest "the client cannot choose" (2 cases) |
| Quantities (TM-09) | Checkout reads the stored line quantity only. The database limits it to 1 to 99 (`CartItem_quantity_check`, `OrderItem_quantity_check`). `priceOrder` refuses non-positive or unsafe values. BR-04 cap checked before any insert, and refusing it rolls back the stock taken | Read; `tests/integration/checkout` 422 case |
| Overselling (TM-10) | One `UPDATE ... WHERE stock >= q AND visible AND ownerId <> buyer` per line, in product id order, inside a savepoint. `Product_stock_check` is a second layer | itest: 4 buyers, 3 units: 3 sold, stock 0. Mutant without `stock >= q`: that case fails |
| Visibility and BR-16 in the statement | Suspended store, deactivated owner, inactive category, draft, and pending moderation are each `NOT_AVAILABLE`, with no stock taken and no order. Own store is `OWN_STORE` | itest 5 cases. Mutant without `VISIBLE_PRODUCT_SQL` in `takeStock`: all 5 fail |
| Deactivated buyer (TM-26) | 401; nothing read | itest |
| Idempotency and double submit (TM-11) | Unique `(userId, idempotencyKey)`. Lookup runs under the cart row lock. Keys are lower-cased; the header has one accepted form and is never echoed. 5 parallel requests with one key: one order, one payment row, one decrement. 3 parallel requests with 3 keys: one order, two `CART_EMPTY` | unit part 3 (14 header cases); itest 2 cases |
| Savepoint integrity | A refused attempt rolls back every decrement. Only the lowered quantities are stored | `tests/integration/checkout` (run: "stock taken for an earlier line is given back") |
| Payment transitions (TM-12, TM-13) | No route imports a transition function. No file outside the orders and checkout modules calls one. `PENDING -> PAID` and `PENDING -> FAILED` are guarded by source state; the stock restore is claimed through `stockRestoredAt IS NULL`. A repeat of a paid order's key with `mockOutcome: "FAIL"` changes no row. Three declines in a row never raise the stock | unit part 2; itest 2 cases |
| Mock labelling | Labelled on the record: `Payment.provider = 'MOCK'`, reference `MOCK-<uuid>`, `payment.isSimulated` derived from the provider, `shippingFeeIsSimulated: true`. Not built, so not checked: seller and admin views and the UI. With the mock, the client chooses the outcome (SEC-056) | Read; itest |
| SQL injection (TM-14) | Every raw statement in the three modules is a tagged template, checked by a guard that confirms it sees at least 14 of them. No `Unsafe` call, no `Prisma.raw`. `orderBy` is fixed | unit part 2 |
| Logging (SR-04) | The only new log line is the `warn` written when the provider does not answer: `{ component, provider, errorClass }`. Text from the error (a phone and an email in the test) does not reach it. The repositories log nothing. 5xx errors go through `errorResponse` (class, status, code only; SEC-048) | itest "a provider that does not answer" |
| Rate limit | `checkout`: 10 a minute per user, consumed before the body is read, so invalid requests count too. The 11th request is 429 with `Retry-After`. SEC-052 now applies to this rule | itest |
| Caching | `ok`, `created`, `paginated` send `Cache-Control: no-store`. Order bodies hold the address and phone | Read (`src/server/http.ts`, SEC-006) |
| Unpaid orders | If the provider throws, if the payment transaction fails after the order committed, or if the process stops in between, the order stays `PENDING` with its stock taken. Nothing starts the sweep (SEC-055) | unit `it.fails`; itest |
| Transaction size | One checkout takes stock for every line of an unbounded cart (SEC-053). A 120-line cart is bought in one request | itest `it.fails` |
| Dependencies | The three commits change no manifest or lockfile. Ran `pnpm audit --prod`: no known vulnerabilities. Ran `pnpm audit`: 2 high, both development-only (SEC-010, known) | Commands below |
| Secrets | No scanner installed (`Get-Command gitleaks, trufflehog` empty). A pattern search of the new module, route, and integration-test files for password, secret, token, key, private-key, and connection-string shapes found nothing | Grep |

## Findings

- **SEC-055 (Medium, OPEN): nothing fails an unpaid order.** The sweep exists, but `src/instrumentation.ts` does not start it. An order left `PENDING` keeps its stock forever. If the payment transaction fails after the order committed, the client also gets a 500 for an order that exists. Owner: devops (wiring), backend-api (the 500).
- **SEC-056 (Medium, OPEN, owner decision): with the mock, any account gets PAID orders for any stock, and nothing refuses the mock in production.** This follows from D-011 and is labelled on every record. In a public deployment, one free account can take every seller's stock as paid orders that tell sellers to ship. Owner: owner (deployment), backend-api, devops.
- SEC-052 (Medium, OPEN): no longer theoretical for `checkout`. The route consumes the rule, so once it is deployed, 10,000 cheap accounts renewed by one client refuse checkout site-wide.
- SEC-053 (Medium, OPEN): checkout is now the second consumer of an unbounded cart. Every line's product row is locked for the length of the transaction, a refusal can retry up to 3 times, and a failed payment returns items to the cart without any cap on lines.

Observations, not findings:

- The idempotency lookup comes before the address check, so a reused key returns the caller's own order whatever `addressId` it carries. This is the contract (section 1.3), and nothing of another user can be reached.
- A repeat with the same key is not compared with the original body (contract section 1.3). No security effect: the answer is the caller's own order and no second payment happens.
- The blind resend of a refused checkout (item 8.2-1) is still kept by the client only. This has not changed since the 2026-10-11 position.
- `GET /orders` has no rate limit (contract). A page is at most 50 orders with nested items, which bounds each request but not the number of requests.
- `findPrimaryUploadId` reads without a lock. If a picture is deleted at the same moment, the checkout gets a foreign-key error, answers 500, and stores nothing. This is about integrity, and it fails closed.
- The 15 s transaction timeout bounds one checkout, but not under load. It was not measured (T-033).

## Tests added

- `tests/security/t032-checkout.test.ts` (unit project, no database): 79 cases, 77 pass and 2 are `it.fails` (SEC-055, SEC-056). The 2 `it.fails` cases were flipped to `it` in a scratch copy, and each failed on its flaw assertion. The copy was deleted.
- `tests/security/t032-checkout.itest.ts` (integration project, real PostgreSQL): 19 cases, 18 pass and 1 is `it.fails` (SEC-053 in checkout). Flipped, it fails with `expected 201 to be greater than or equal to 400`. Two mutants of `src/modules/checkout/repository.ts` were swapped in through `vi.mock` from `tests/security/_scratch`, which was deleted afterwards; `src/` was not changed. Mutant 1, without `p."stock" >= q`, failed the race case. Mutant 2, without `VISIBLE_PRODUCT_SQL` in `takeStock`, failed the 5 visibility cases.

## Commands run

- `pnpm exec vitest run --config vitest.integration.config.mts tests/integration/checkout`: 2 files, 18 passed
- `pnpm exec vitest run tests/security/t032-checkout.test.ts`: 77 passed, 2 expected fail
- `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t032-checkout.itest.ts`: 18 passed, 1 expected fail
- Flipped copies and the two mutants, as above
- `pnpm exec vitest run --project security`: 22 files, 819 passed, 6 expected fail, exit 0
- `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t032-checkout.itest.ts tests/integration/checkout tests/integration/cart`: 5 files, 100 passed, 1 expected fail
- `pnpm exec prettier --check` and `pnpm exec eslint` on the three changed test files: exit 0
- `pnpm typecheck`: exit 0
- `pnpm audit --prod`: no known vulnerabilities, exit 0. `pnpm audit`: 2 high (SEC-010), exit 1

## Not run

- The full `pnpm test:integration`. Only the checkout, cart, and new security files were run, to avoid holding the run lock while the code-review agent might need it.
- `pnpm verify` and `pnpm build`. The build is not in this agent's brief.
- Any HTTP request against a running `next dev` or `next start`. Handlers were called in process.
- Load or timing measurements of the transaction limits and of lock hold time under a long cart (T-033).
- A secret scanner: none is installed.
- Seller and admin order views, and the UI labelling of simulated payment: they do not exist yet.
