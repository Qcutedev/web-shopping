# T-032 code review (checkout, orders, mock payment)

Reviewer: code-review agent, read-only, 2026-10-14. Scope: commits `0838158`, `1ba14f7`, `26c7449`, plus uncommitted `src/app/api/v1/checkout/`, `src/app/api/v1/orders/`, `tests/integration/checkout/`.

Verdict: **APPROVED WITH FOLLOW-UPS.** Nothing blocking. T-032 stays IMPLEMENTED until security has reviewed the routes and routes plus integration tests are committed.

## Holds

- One transaction under the cart lock: key lookup, address, empty-cart check, guarded per-line stock UPDATE in a savepoint, BR-04 cap before any write, order and copies, payment row, cart emptied.
- Idempotency serialised by cart `FOR UPDATE`; no lock-order cycle found (checkout: Cart, Product by id, new rows; `failOrder`: Cart, Order, SellerOrder, OrderItem, Product by id, CartItem).
- Money integer satang; handlers thin; reads scoped by `actor.userId`; PAID/FAILED guarded by source state; stock restored once.

## Findings

| ID | Sev | Where | Problem | Fix | Owner |
| --- | --- | --- | --- | --- | --- |
| CR-T032-01 | Medium | `src/modules/orders/service.ts:98-100` | `failOverdueOrders` has no per-order try/catch; one throwing order stops the sweep, oldest first, so later orders are never failed | catch per order, count, log class only, continue; unit test. Before devops wires the schedule | backend-api |
| CR-T032-02 | Medium | `src/modules/orders/repository.ts:159, :245` | `markOrderPaid`/`failOrder` use default tx limits (2 s / 5 s) but wait on cart lock held up to 15 s; decline can P2028 -> 500, order PENDING until sweep | own named options >= checkout's; record in DATA_MODEL 21.5 | backend-api |
| CR-T032-03 | Low | `src/modules/checkout/service.ts:118, :223-227` | payment completion throwing after commit gives 500 for an existing order | one sentence in 5.5.5, or catch and answer PENDING | backend-api |
| CR-T032-04 | Low | `src/modules/checkout/service.ts:226` | decline always writes `SIMULATED_DECLINE`, ignores `result.failureReason` | pass it through, type narrowed | backend-api |
| CR-T032-05 | Low | `checkout/service.ts:136-158`, `repository.ts:119-130` | retries reuse savepoint name `checkout_attempt`; correct in PostgreSQL but undocumented | RELEASE after ROLLBACK TO, or comment; integration case succeeding on attempt 2 | backend-api |
| CR-T032-06 | Low | `orders/repository.ts:265-267`, `checkout/repository.ts:109` | SQL order by `productId` (en_US.utf8) vs JS code-unit sort; ids outside cuid alphabet could deadlock | same ordering both sides (`COLLATE "C"`) | backend-api |
| CR-T032-07 | Low | `checkout/pricing.ts:178-181` | `availableStock` may differ from stored quantity after a race; buyable line may be lowered but unlisted | take reasons from lowering `RETURNING` or re-read | backend-api |
| CR-T032-08 | Low | `checkout/pricing.ts:201-223` | refusal `totals` include OWN_STORE lines; tied to open decision on GET /cart own-store line | decide together | owner |
| CR-T032-09 | Low | `docs/API_CONTRACTS.md:936, :747` | stale "unit tests only" line; `mockOutcome` rejection not enforced | update on commit | documentation |
| CR-T032-10 | Low | `src/modules/orders/index.ts:11-12` | `completeOrderPayment`/`failOrderPayment` on public surface; TM-12 rests on convention | import-guard probe limiting importers | security, backend-api |
| CR-T032-11 | Low | `tests/integration/checkout/endpoints.test.ts:233, :442` | "no cart" case untested; weak assertion; missing cases (attempt exhaustion and retry success, capped cart return via checkout, paid-vs-sweep race, decline while second checkout holds lock) | add | qa (T-033) |
| CR-T032-12 | Low | `checkout/service.ts:186-188` | per-line `findPrimaryUploadId` and `takeStock` sequential inside locked tx; grows with cart (SEC-053 open) | one `DISTINCT ON` query; line cap | backend-api |

## Follow-up status

- CR-T032-12 resolved 2026-10-22 (backend-api, with SEC-053): the primary pictures were already read in one statement (`findPrimaryUploadIds`); the line cap now bounds the rest. A cart holds at most 50 lines (`MAX_CART_LINES`), and checkout refuses a cart above 50 with `409 CONFLICT` `CART_LINE_LIMIT` before the savepoint, so at most 50 stock statements and 50 `Product` locks per attempt. The stock statements stay one per line, sequential. `docs/API_CONTRACTS.md` 5.4 and 5.5.5.
- CR-T032-09 resolved 2026-10-14 (documentation): `docs/API_CONTRACTS.md` 5.5.1 now says nothing refuses `mockOutcome` as built (SEC-056 open); 5.5.5 states the integration runs and that the sweep is wired in `src/instrumentation.ts` (`35903a1`).

## Checks re-run by reviewer

`pnpm typecheck` 0; `pnpm format:check` 0; `pnpm lint` exit 1 (one warning `tests/integration/cart/support.ts:111`, qa, T-031); 14 T-032 unit and route files 303 passed; `pnpm test` 105 files, 3012 passed, 1 failed (review gate, by design), 4 expected fail; `tests/integration/checkout` 18 of 18 passed.

## Not verified

Full `pnpm test:integration`, `pnpm build`, `pnpm verify`; DATA_MODEL 7.1/7.2/7.5/21.6 line by line; load deadlock behaviour (T-033); Prisma 7.10 raw SAVEPOINT beyond tests; a real HTTP request; the agent's mutation checks; security-specific points (SEC-052, 8.2-1).
