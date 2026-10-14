# T-031 cart code review

Commit reviewed: `7ddfcd1`. Verdict: CHANGES REQUIRED (one blocking item). Reviewer: code-review agent, read-only. Recorded by the orchestrator.

Rules in CLAUDE.md hold: thin handlers, explicit `actor`, queries scoped by `actor.userId` then `cartId`, integer satang, Prisma only in the repository, writes in one transaction under the Cart `FOR UPDATE` lock. Re-run by the reviewer: `pnpm lint` exit 0, `pnpm typecheck` exit 0, cart unit tests 6 files, 68 passed. Not run: integration tests, `pnpm build`, `pnpm format:check`.

## Blocking

- CR-T031-01 (High): `src/modules/cart/service.test.ts:4-5` and `src/app/api/v1/cart/items/[itemId]/route.test.ts:5-7` claim ownership, transaction and lock are tested in `tests/integration/cart`. That directory does not exist. The IDOR control (`WHERE { id, cartId }`, `repository.ts:176, 205, 217`), concurrent first adds, concurrent adds to one line, the 99 cap under race, and GET-writes-nothing are untested. Owner: qa. Needed cases: foreign `itemId` on PATCH and DELETE gives 404 and line unchanged; two concurrent first adds give one cart and one line; two concurrent adds of one product give one summed line; 50+50 gives one 400 and line at or below 99; GET writes nothing. T-031 is not VERIFIED until these run.

## Non-blocking

- CR-T031-02 (Medium): `repository.ts:197-208`, `service.ts:171-174, 229`. Comment "the line still exists" is false: `CartItem.product` is `onDelete: Cascade`, and a product hard delete does not take the Cart lock. P2025 on update or P2003 on insert gives a 500. Fix: `updateMany`, count 0 maps to 404 or NOT_AVAILABLE; map P2003 to 404; correct the comment.
- CR-T031-03 (Low): `service.ts:156-160` OWN_STORE sends `cartItemId: existing?.id ?? null`; API_CONTRACTS 5.4 says `null`. Align one of them.
- CR-T031-04 (Low): `service.ts:159` vs `:167` `requestedQuantity` has two meanings on POST. Use the resulting quantity for both or document.
- CR-T031-05 (Low, contract/UX): add sums the stored quantity, not the lowered quantity the customer saw (stored 95, stock 2, GET shows 2, add 5 gives 400). Matches the contract; product-requirements and T-034 to cover in UI copy.
- CR-T031-06 (Low): `service.ts:122-123` `findFirstImageKey` runs after commit; a throw gives a 500 for a stored write and a retry doubles the quantity. Read the key inside the transaction or document.
- CR-T031-07 (Info): no unit test for the OWN_STORE `existing?.id` branch, nor for a seller adding a hidden own product (expect 404).

Security-agent review of the ownership surface is still required.
