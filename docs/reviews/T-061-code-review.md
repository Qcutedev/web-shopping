# Code review: T-061, whole repository

Reviewer: code reviewer (read-only except this file). Date: 2026-10-28. Base: `76fb1cd`.

## Verdict: APPROVE

No blocking finding. Six Low or Info findings, all non-blocking. Closed findings in `docs/reviews/` were not repeated.

## Scope and method

- Read in full: checkout (service, repository, pricing), reviews service, inventory service (update, status, delete, stock), payment timeout sweep, orders repository (reads, payment transactions), `GET /api/files/{key}`, sign-in route.
- Searched all of `src/` for: Prisma or `@/server/db` imports outside the allowed paths, `any`, `@ts-ignore`, non-null assertions, floating-point operations on money, hardcoded Thai strings, `dangerouslySetInnerHTML`, `eval`, `error.message` or `stack` in responses, TODO or FIXME.
- Compared the route files with the endpoint tables of `docs/API_CONTRACTS.md` (sections 5.1 to 5.9): path and HTTP method sets match, none missing, none extra.
- Not repeated: findings already closed in the files of `docs/reviews/`.

## CLAUDE.md rules 1 to 8

| Rule | Result |
| --- | --- |
| 1 No logic in handlers or pages | Holds in the routes read. Auth handlers delegate to `src/server/auth/routes.ts`. Route tests assert that the sources do not import `@/server/db`, `@prisma`, or `$transaction`. |
| 2 Explicit actor, role and ownership | Holds: `checkout`, `createReview`, inventory, orders take `actor`. Reads are scoped by `actor.userId` inside the `WHERE`. A foreign id gives the same 404 as an unknown one. |
| 3 Server-side money | Holds: checkout takes the price from the guarded `UPDATE ... RETURNING`; the request names only an address and the mock outcome (strict body). |
| 4 Integer satang | Holds: no `toFixed`, `parseFloat`, or float arithmetic on money in `src/modules` or `src/server`. The `Math.round` in `catalog/service.ts:79` is a rating, not money. `components/admin/order-section.tsx:40` divides basis points by 100 for display of a rate, labelled "not money". |
| 5 Transactions | Holds: checkout, stock, payment, review, product status each run in one transaction with a guarded statement. Lock order (cart, order, seller order, item, product in `COLLATE "C"` id order) is the same in checkout and in the failure transaction. |
| 6 Seller scope by session store | Holds in the inventory service: `storeId` comes from `requireApprovedStoreForWrite(tx, actor)`, never from the body or URL. |
| 7 Prisma import | `scripts/check-import-guards.mjs` passes 215 of 215 probes. No file under `src/app` or `src/components` imports the Prisma client or `@/server/db`. |
| 8 No secrets | No secret found in the files read. Logging goes through the masking logger. |

## Findings

| ID | Severity | Where | Problem | Fix | Owner |
| --- | --- | --- | --- | --- | --- |
| CR-T061-01 | Low | `src/modules/inventory/service.ts:280,341,435,467,499`; `src/modules/reviews/service.ts:46`; `src/modules/uploads/service.ts:114`; `src/modules/orders/seller-service.ts:123` | Four services import `db` and open `db.$transaction` themselves, while `checkout`, `cart`, `sellers` keep the transaction in the repository (`inCheckoutTransaction`). Rule 7 allows `src/modules/**` to import `db`, so this is not a violation. It does drift from "Prisma only behind module repositories" and makes the module style inconsistent, and a service test must mock `db`. | Optional: add `inTransaction` helpers to those repositories as checkout does. Or record in ARCHITECTURE.md that services may own the transaction boundary. | backend-api |
| CR-T061-02 | Low | `src/modules/checkout/service.ts:117-130`, `docs/API_CONTRACTS.md:74` | A repeat with the same `Idempotency-Key` and a different `addressId` or `mockOutcome` silently returns the first order. This is documented ("the body is not compared"), so it is not drift, but a client that reuses a key by mistake gets an order shipped to the old address with a 200. | Optional hardening: store a request hash with the key and answer 409 on mismatch. Needs an owner decision (D-023 point 2). | orchestrator |
| CR-T061-03 | Low | `src/server/rate-limit.ts:26`, `src/modules/orders/timeout-sweep.ts` (schedule on `globalThis`) | The rate limiter store and the sweep schedule are per process. With more than one instance the limits multiply and the sweep runs once per instance. The sweep is safe (guarded transaction), the limiter is weaker. Documented in the file header, but I could not find it in DEPLOYMENT.md as a hard limit of "one instance". | State "single instance only" in `docs/DEPLOYMENT.md`, or list the shared store as a post-MVP item. | devops |
| CR-T061-04 | Info | `src/modules/checkout/repository.ts:121-130` | The savepoint statements rely on undocumented Prisma 7.10 behaviour (the file says so, and T-013 validated it). A Prisma upgrade can break checkout without a type error. | Keep the integration test that covers a refused checkout as a gate in any Prisma upgrade. | qa |
| CR-T061-05 | Info | `src/modules/checkout/service.ts:140-150` | After commit, `pay` can fail and the order stays `PENDING` for up to the sweep timeout, while its stock is held. Designed and logged (SEC-055). Noted only so T-081 acceptance does not read a PENDING order after a provider fault as a bug. | None. | none |
| CR-T061-06 | Info | `src/modules/checkout/repository.ts:34-36` | The checkout `timeout` is 15 s and the payment transactions allow 20 s (CR-T032-02). Values are "measured under the race tests of T-033" per the comment; I did not re-measure them. | None. | qa |

## Tests (adequacy by inspection, not by execution)

- Every module under `src/modules` and `src/server` has a test file next to it, or a suite in `tests/integration`, `tests/security`, or `tests/unit`. A scripted check found no source file without any test near it.
- Route tests assert the layering by reading the route source, so a Prisma import in a handler fails them.
- The checkout race and idempotency paths have integration tests in `tests/integration/checkout` (7 files). I did not run them: another agent is using the database.

## Checks re-run

- `pnpm typecheck` -> `next typegen && tsc --noEmit` exit 0, no errors.
- `pnpm lint` -> eslint with `--max-warnings 0` exit 0; `scripts/check-import-guards.mjs`: 215 of 215 probes behaved as expected.

## Not verified

- Unit, integration, and e2e suites: not run, as instructed. Test pass claims in STATUS.md are not re-checked here.
- Full read of `src/modules/admin/repository.ts` (1413 lines), `src/server/logger.ts`, `src/server/env.ts`, `src/server/rate-limit.ts`, and the component tree: searched by pattern only, not read line by line.
- Race behaviour under concurrent load: read the locking design only.
- Security review of the same code: belongs to T-062; nothing here replaces it.
