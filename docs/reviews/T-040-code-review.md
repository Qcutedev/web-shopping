# T-040 code review (sellers module)

Commits: `6c2112c`, `fafd73d`, `10373b7`. Reviewer: code-review agent, 2026-10-15. Verdict: **APPROVED WITH FOLLOW-UPS**. No blocking items.

Confirmed correct: approval lock order (application, then user, then store insert; no inversion), D-040 point 1 under concurrency, store `FOR SHARE` lock, store write mechanism, contract 2.3 / 5.7.1.1 / 5.9.2 against code, actor and storeId scoping.

| ID | Severity | Area | Finding | Resolve |
| --- | --- | --- | --- | --- |
| CR-T040-01 | Low | Tests | Commit `fafd73d` claims a concurrent submit-and-approve test; none exists. Nothing races a submission against an approval of the same user (`repository.ts:125-128`). | Add the integration test (403 or 409, never a second PENDING next to APPROVED), or correct the claim. |
| CR-T040-02 | Low | Correctness | `repository.ts:453` retries any P2002 as a slug collision. A `Store_ownerId_key` violation is retried 3 times, then 500. | Retry only on `Store_slug_key`; map owner-key violation to `applicantNotCustomer()`. |
| CR-T040-03 | Low | Tests | Slug-collision retry and final rethrow (`repository.ts:394-456`) untested. | Integration test with a `newSlug` stub: one collision then fresh; all 3 collide, no rows written. |
| CR-T040-04 | Low | Follow-up T-041/T-042 | `lockStoreIfApproved` takes `FOR SHARE`; a later UPDATE of the Store row in the same transaction can deadlock. | Add to the doc comment of `requireApprovedStoreForWrite` (`service.ts:195-201`) and to T-041/T-042 briefs. |
| CR-T040-05 | Low | Types | `lockApplication` (`repository.ts:310-315`) types raw `status::text` as `ApplicationStatusValue` without a check. | Optional: type as `string`. |
| CR-T040-06 | Info | Gate | `tests/security/t020-t018-catalog-shell.test.ts` red until security lists the two seller routes. | Security task, running. |
| CR-T040-07 | Info | Tests | `decisions.test.ts:149-182` uses a 200 ms sleep; still fails if the lock is removed. | None. |

Checks by the reviewer: lint, typecheck exit 0; sellers unit scope 141 passed; `tests/integration/sellers` 37 passed. Not run: full `pnpm verify`, full integration, security side of the routes.
