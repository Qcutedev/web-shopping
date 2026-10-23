# T-050 code review: admin module

- Task: T-050, admin module and `/api/v1/admin/**`
- Commits: e57e3c7 (module and routes), 961e568 (API_CONTRACTS 5.9.8), c25a89e (integration tests)
- Reviewer: code-review agent
- Date: 2026-10-23
- Verdict: **CHANGES REQUIRED** (one blocking item)

## Summary

The service checks role `ADMIN` before any query in every function, and unit tests assert that no repository call happens for customers or sellers. Every mutation runs in one transaction with a guarded status update and writes exactly one `AuditLog` row in that transaction; refusals write none. The admin fulfilment move locks `SellerOrder`, `OrderItem`, `Product` and never `Order`, which cannot deadlock with `failOrder` (Cart, Order, SellerOrder, OrderItem, Product). Deactivation deletes sessions in the same transaction; `cookieCache` is disabled and the session guard re-reads `isActive`, so revocation is immediate. Money stays integer satang; aggregates are 64-bit and converted with `aggregateSatang`. The implementation matches API_CONTRACTS 5.9.8.

## Findings

| ID | Severity | Blocking | Location | Problem | Fix |
| --- | --- | --- | --- | --- | --- |
| CR-T050-01 | High | Yes | tests/integration/admin/support.ts:186 | `pnpm lint` fails: unused `_id`, `_query` with `--max-warnings 0` | Destructure `const { id = "unknown-id", query, ...rest } = options;` and use both; do not weaken the rule |
| CR-T050-02 | Medium | No (process) | tests/security/t020-t018-catalog-shell.test.ts:741 | `pnpm test` red: 23 admin routes not on the reviewed-route list (intended gate) | Security agent adds them after review; T-050 not VERIFIED before |
| CR-T050-03 | Low | No | src/modules/admin/state.ts:95-120; repository.ts:347-349, 384-386 | `assertModerationDecision`, `USER_ACTIVATION_TRANSITIONS`, `activationMove` used only by tests; repository hardcodes the flag values | Use `activationMove` in the repository or delete the three and their tests |
| CR-T050-04 | Low | No | src/modules/admin/repository.ts:883-884; service.ts:345-346 | `has-products` unreachable for `updateCategory` | Separate outcome type for update; remove the branch |
| CR-T050-05 | Low | No | src/modules/admin/repository.ts:109-116 | `isForeignKeyViolation` duplicated in sellers and cart repositories | One helper in `src/server/db` (database owner) |
| CR-T050-06 | Low | No | src/modules/admin/repository.ts:991-993 | Any P2003 becomes `CATEGORY_HAS_PRODUCTS` | Match only the `Product.categoryId` constraint via `error.meta` |
| CR-T050-07 | Low | No | docs/API_CONTRACTS.md:1450, 1423 | Says 8.2-6 is OPEN and suspend/reinstate not built | Align with 5.9.8 |
| CR-T050-08 | Low | No | src/modules/admin/service.ts (mutations) | Acting admin's `isActive` not re-checked inside the write transaction | Security agent to decide whether to lock and re-check the actor row |
| CR-T050-09 | Medium | No | tests/integration/admin/endpoints.test.ts | No concurrency tests (mutual deactivation, double cancel, cancel vs payment failure, decision vs seller edit); line 228 lacks audit assertion; cancel-before-payment then success not covered | Add `Promise.all` race tests; assert the audit row |
| CR-T050-10 | Info | No | src/modules/admin/repository.ts:855-858 | Concurrent creates without `sortOrder` can share a value | Document or ignore (ties ordered by `id`) |

## Checks re-run

- `pnpm lint`: FAIL (CR-T050-01)
- `pnpm typecheck`: PASS
- `pnpm test`: FAIL, 1 failed / 5306 passed / 32 expected fail; only the t020 route guard (CR-T050-02)
- `pnpm test:integration tests/integration/admin`: PASS, 30/30
- `pnpm format:check`: FAIL on `src/i18n/th.ts`, an uncommitted working-tree change outside T-050 (T-051 in progress)

## Not verified

- 16 of 23 route handlers were checked by structure only; `admin-routes.test.ts` and some unit test files were not read in full.
- Full integration suite, `pnpm build`, and E2E were not run.
- Concurrency behaviour was reasoned from SQL, not observed.
- Security review is still required.

## To close

Fix CR-T050-01, re-run `pnpm lint`, then send T-050 to security review (CR-T050-02, CR-T050-08). The non-blocking items can be fixed in the same pass or tracked.
