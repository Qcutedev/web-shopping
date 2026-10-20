# T-043 code review

Date: 2026-10-20. Reviewer: code-review agent (read-only). Recorded by the orchestrator.
Commits: `fcd2de8`, `dcae7b9`, `2bcc4d1`, `0938b7e`, `4a2c838`, `957fc7a`.

Verdict: **APPROVED**. No blocking finding. Ids follow the task-scoped scheme of `T-042-code-review.md`.

## Findings (all non-blocking, owner backend-api unless noted)

- **CR-T043-01** (Low, docs drift). `docs/API_CONTRACTS.md:1169` lists "`PENDING` to `PROCESSING` while the payment is not `PAID`" as a `409 INVALID_STATE_TRANSITION` example. Line 1168, 5.7.3.1 Scope, the code (`seller-repository.ts:319-335`, `seller-service.ts:120-121`), and `tests/integration/seller-orders/endpoints.test.ts:564-585` all give `404`. Fix: delete or reword the clause.
- **CR-T043-02** (Low, correctness of a read). `seller-service.ts:101`, `seller-repository.ts:244-273`: `getOwnSellerOrder` runs 4 to 5 statements on the pooled `db`, each in its own snapshot, so a concurrent move can give a torn detail (`PROCESSING` with a non-null `shipment`). Fix: run it in `db.$transaction(..., READ_TRANSACTION_OPTIONS)` read-only, as the list does.
- **CR-T043-03** (Info). `seller-repository.ts:257-269`: `findOwnPaidSellerOrder` reads the `Order` row twice (`hydrate`, then `findUnique`). Fix: let `hydrate` also select `paidAt` and the `ship*` columns, or accept.
- **CR-T043-04** (Info, test adequacy). `endpoints.test.ts:650-681`: the two race tests still pass if only the `FOR UPDATE OF so` lock or only the guarded `UPDATE` is removed. Optional: an integration case calling `moveSellerOrderStatus` with a stale source list, asserting `false` and no row change. Owner backend-api or qa (T-045).
- **CR-T043-05** (Info). `seller-service.test.ts:189-193`: "SELLER without a store is a fault" only asserts `not.toBeInstanceOf(AppError)`. Fix: assert the exact message and that no repository mock was called.
- **CR-T043-06** (Info, scope). Commit `4a2c838` also rewrote the lock-order comment in `src/modules/inventory/repository.ts:17-24`. Comment only, agrees with DATA_MODEL 7.5. No action.
- Housekeeping: `API_CONTRACTS.md:1199` says "Not code-reviewed"; update after this record.

## Checks run by the reviewer

- `pnpm typecheck` exit 0.
- `pnpm exec eslint` on the T-043 paths exit 0.
- `pnpm exec vitest run src/modules/orders src/app/api/v1/seller/orders` 9 files, 241 passed.
- Integration `tests/integration/seller-orders/endpoints.test.ts` 35 passed.

Not run: full `pnpm verify`, full `pnpm test:integration`, mutants for the race tests (CR-T043-04 is reasoned, not shown), `next start`, load.

## Acceptance (PROJECT_PLAN T-043)

Transition table, cross-store 404, suspended store can read and fulfil, summary from real rows: all met by reading and by the tests above.

SEC-072 stays open in the security register.
