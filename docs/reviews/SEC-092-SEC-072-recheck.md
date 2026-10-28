# SEC-092 and SEC-072 re-check: admin review hide, and the 24 h seller delivery rule

Reviewer: security agent. Date: 2026-10-29 (session 129). Tree at re-check: `329ae95` (main, local).

Commits under review:

- SEC-092 step 2: `e6701e3` (admin hide and unhide endpoints, public reads skip hidden), `0698551` (API_CONTRACTS 5.9.9, D-048). Also read: `fbddcd3` (frontend admin reviews page, committed during this review). Columns from session 128: `1ee583a`, `bd40679` (not re-read line by line; only the columns the code uses).
- SEC-072: `65d5960` (fix), `1995cd7` (contract), `b35ae6d` (e2e aging helper).

Findings: [../SECURITY.md SEC-092](../SECURITY.md#sec-092-review-text-is-published-at-once-and-nothing-can-hide-or-remove-it), [../SECURITY.md SEC-072](../SECURITY.md#sec-072-a-seller-marks-an-order-delivered-in-seconds-which-unlocks-reviews-for-orders-it-placed-through-a-second-account).

Result:

- **SEC-092: FIXED** (remediation (1), the minimum the owner chose). An admin can hide and un-hide a review. Hidden reviews leave the public list, its total, and the rating summary. Remediations (2) report button and (3) hold before publishing were not built; see residual risks.
- **SEC-072: FIXED** (remediation (1)). A seller can set `DELIVERED` only 24 hours after `Shipment.shippedAt`, by the database clock, checked under the row lock and repeated in the guarded statement. Residual: a seller with a second account can still fake a delivery after 24 hours.
- **No new finding.**

A passing test shows only that the tested attacks fail. It does not show that reviews or fulfilment are secure in a deployment. No scanner was run on these commits apart from a secret pattern search; a clean scanner run would show only that the scanner found nothing.

## SEC-092: what was checked

### Role and session before any query

| Layer | Evidence |
| --- | --- |
| Route files | `src/app/api/v1/admin/reviews/route.ts`, `[id]/hide/route.ts`, `[id]/unhide/route.ts`. Mutations: `assertSameOrigin`, then `assertContentType`, then `requireActor`, then `requireRole(actor, "ADMIN")`, then the body and the path parameter. The GET: session, role, then the query. No database import. Pinned in `tests/security/t050-admin.test.ts` (route table now 26 files, 29 handlers). |
| Service | `listReviews`, `hideReview`, `unhideReview` (`src/modules/admin/service.ts:486`, `:512`, `:525`) start with `adminId(actor)`, which calls `requireRole(actor, "ADMIN")`. `t050-admin.test.ts` calls each one as a customer and as a seller with the repository and database replaced by traps: 403 `FORBIDDEN`, no repository call. |
| Admin page | `src/app/admin/reviews/page.tsx` imports only `ReviewsSection`; the section calls `listReviews` inside `renderForAdmin`. `reviews-table.tsx` is a client component with no runtime path to server code. Pinned in `tests/security/t051-admin-ui.test.ts`. |
| CSRF | Real database: a cross-site `Origin` with the admin's cookie is 403, a missing `Origin` is 403, `text/plain` is 415, nothing written (`tests/security/sec092-review-moderation.itest.ts`). |

### IDOR and mass assignment

An admin may act on any review, so there is no ownership scope to break. What must not come from the request: the hider, the time, the rating, the comment. `reviewModerationBodySchema` is a `z.strictObject` with only `reason`. `t050-admin.test.ts` now also sends `hiddenAt` and `hiddenByUserId` against every admin body schema: each is refused. The hide statement sets `"hiddenByUserId" = ${adminId}` (from the session) and `"hiddenAt" = now()` (database clock). `rating` and `comment` are never in a `SET`. The review id is bound in tagged templates only (no `$queryRawUnsafe`, no `Prisma.raw`).

### One transaction, audit row, no comment in the audit

`moveReviewVisibility` (`src/modules/admin/repository.ts:1527`): inside `db.$transaction`, (1) `SELECT ... FROM "Review" WHERE "id" = $1 FOR NO KEY UPDATE` (line 1536); (2) the visibility table check; (3) the guarded `UPDATE` (`AND "hiddenAt" IS NULL` for hide, line 1548; `IS NOT NULL` for un-hide); `count !== 1` returns `invalid-state` before any audit; (4) one `writeAudit(tx, ...)` (line 1555) with `metadata` `{ reason, productId, before, after }`. A static case in `t050-admin.test.ts` pins this order, the `count !== 1` refusal, the session admin and database clock, and checks that the metadata block names no `comment`, `rating`, `userId`, or `author`. Against the real database, `sec092-review-moderation.itest.ts` lists the audit rows through `GET /admin/audit-logs` and finds no trace of a comment canary.

### Every public reader of `Review`

`git grep` of `.review.` and `"Review"` in `src` (non-test) finds these readers:

| Reader | Audience | Hidden reviews |
| --- | --- | --- |
| `src/modules/catalog/repository.ts:218` rating aggregate (`reviewSummary`) | public | excluded (`hiddenAt: null`) |
| `src/modules/catalog/repository.ts:260` list and its `count` | public | excluded (`hiddenAt: null`) |
| `src/modules/orders/repository.ts:79` item `review` on `GET /orders`, `GET /orders/{id}` | the buyer, scoped by `userId` | included, but only `id, rating, comment, createdAt`: no hide field. The author sees their own text, as D-048 point 6 and 5.9.9 state. Real database: the author's order answer carries no `hiddenReason`, `hiddenByUserId`, or `hiddenAt`; another customer gets 404 |
| `src/modules/admin/repository.ts:1093` admin order detail | admin | included (intended) |
| `src/modules/admin/repository.ts` `listReviews`, `moveReviewVisibility` | admin | included (intended) |
| `src/modules/reviews/repository.ts:57,81` duplicate check and insert | the buyer | a hidden review still blocks a second review of the item (intended; author's test "a hidden review still occupies its order item") |

No seller module reads `Review` (`src/modules/orders/seller-repository.ts`: no match). The product list, store pages, and search carry no rating. There is no sitemap, feed, or Open Graph route under `src/app`. No page uses `"use cache"`, `unstable_cache`, or `revalidate*`, so no cached page can keep showing a hidden review.

The public pin in `tests/security/t020-t018-catalog-shell.test.ts` now requires every `review` query of the public routes to be exactly `{ productId: <looked-up id>, hiddenAt: null }`, and `hiddenByUserId`, `hiddenBy`, `hiddenReason` are now forbidden select keys on public reads.

### Races

Every move locks the row first, so moves on one review run one after another. Real database, 8 interleaved hides and un-hides of one review in parallel (`sec092-review-moderation.itest.ts`, run 5 times): every answer is 200 or 409; the number of audit rows equals the number of 200 answers; the successful hides equal the successful un-hides or exceed them by one; the final `hiddenAt` matches that count; the comment and rating are unchanged. The author's test covers two concurrent hides (one 200, one 409, one audit row).

Observation, not a finding: `AuditLog.createdAt` is a clock reading per row. Under concurrent moves, the audit list order can differ from the order the moves were applied. Use the before/after visibility in each row, not the time order, to rebuild a history.

### Frontend page (fbddcd3)

Read `reviews-table.tsx`, `reviews-section.tsx`, `action-button.tsx` (review kinds), `queries.ts` (`REVIEW_KEYS`), and `src/lib/api-client/admin.ts` (`hideReview`, `unhideReview`). The comment, product title, author name, and hide reason are rendered as React text inside `UserName`; there is no `dangerouslySetInnerHTML`. The product link uses `adminProductHref(review.product.id)`, an internal path. The two client calls put the id in one encoded path segment, send JSON, `same-origin`, `no-store` (pinned in `t051-admin-ui.test.ts`). The optional reason is checked on the client with the same `reviewReasonSchema` as the server, and the server checks it again. Not done: a browser check of the page.

## SEC-072: what was checked

### Database clock and guarded statement

`changeSellerOrderStatus` (`src/modules/orders/seller-service.ts:135`): after `lockOwnPaidSellerOrder` (row lock scoped by the session's store and owner) and the table check, `readSellerDeliveryEligibility` (`seller-repository.ts:432`) compares `"shippedAt" <= now() - 24 * interval '1 hour'` in SQL. Too early is `409 CONFLICT` `DELIVERY_TOO_EARLY` before any write. The write, `markShipmentDeliveredBySeller` (`seller-repository.ts:452`, called at `seller-service.ts:170`), repeats the same condition in its `WHERE`; zero rows throws and rolls the whole move back. `now()` is the transaction's start time, which can only make the shipment look younger, so a lock wait never makes the check looser. `shippedAt` is written once, from `now()`, by `insertShipment` (`seller-repository.ts:392-403`).

### Bypass attempts (real database, `tests/security/sec072-recheck.itest.ts`)

| Attempt | Result |
| --- | --- |
| `{ to: "DELIVERED", shippedAt \| deliveredAt \| now: "2020-..." }` and `{ to: "SHIPPED", shippedAt: ... }` | 400 each (strict body); shipment and status unchanged |
| `SHIPPED` again on a `SHIPPED` order, to rewrite `shippedAt` | 409; unchanged. `SHIPPED` to `CANCELLED` is also refused (BR-29), so the order cannot be re-shipped. |
| Seller session on `POST /admin/seller-orders/{id}/status` | 403; still `SHIPPED` |
| 6 concurrent `DELIVERED` one minute short of 24 h | all 409; `deliveredAt` null |
| 6 concurrent `DELIVERED` after 24 h | exactly one 200, five 409; `deliveredAt >= shippedAt + 24 h` |

Other status paths: `state.ts` lets only `SELLER` and `ADMIN` set `DELIVERED`. The admin path (`src/modules/admin/repository.ts:1236`, `markShipmentDelivered` without the age rule) is admin-only by design (5.7.3). No payment or sweep path sets `DELIVERED` (`git grep '"DELIVERED"' -- src` lists only the table, schemas, the reviews eligibility read, and UI). The e2e helper `tests/e2e-support/age-shipment.ts` writes `shippedAt` directly. It refuses any database but `marketplace_e2e` and is not part of the application.

The author's `tests/security/sec072-delivery-delay.itest.ts` (seconds-apart reproduction now 409; 23 h 59 min refused; 24 h allowed) and `tests/integration/seller-orders/delivery-delay.test.ts` were run and pass.

## Pin tests changed (no check weakened)

| File | Change | Why |
| --- | --- | --- |
| `tests/security/t020-t018-catalog-shell.test.ts` | public `review` where `{ productId }` becomes `{ productId, hiddenAt: null }`; three hide fields added to the forbidden public select keys; three admin review routes added to the reviewed list | The code now filters hidden reviews. The pin is stricter: a public read without the filter now fails. |
| `tests/security/t050-admin.test.ts` | 26 files / 29 handlers; three routes in the route table (session, role, CSRF order); three services in the refuse-non-admin table; `reviewModerationBodySchema` in the strict-body table; `listReviewsQuerySchema` in the 50-row cap; `moveReviewVisibility` in the one-audit-row table; `hiddenAt`, `hiddenByUserId` added to the privileged keys; a new static case for the lock, guard, clock, and audit metadata | New code reviewed and added to every existing check. |
| `tests/security/t051-admin-ui.test.ts` | `src/app/admin/reviews/page.tsx` and `reviews-table.tsx` added to the reviewed lists; the API client count goes from 14 to 16, with the two new URLs asserted | Frontend commit `fbddcd3` landed during this review. |

New: `tests/security/sec092-review-moderation.itest.ts` (4 cases), `tests/security/sec072-recheck.itest.ts` (5 cases).

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/security/t020-t018-catalog-shell.test.ts tests/security/t050-admin.test.ts` (before the pin change) | 5 failed, 232 passed: the 5 failures the task named |
| same, after | 2 files, 252 passed |
| `pnpm exec vitest run --config vitest.integration.config.mts tests/security/sec092-review-moderation.itest.ts` | 4 passed; run 5 times, the same each time |
| `pnpm exec vitest run --config vitest.integration.config.mts tests/security tests/integration/admin/reviews.test.ts tests/integration/seller-orders tests/integration/catalog tests/integration/reviews` | 26 files, 371 passed, 8 expected fail, exit 0 |
| `pnpm exec vitest run tests/security` | 51 files, 1764 passed, 32 expected fail, exit 0 (the 32 are the reproductions of open findings, as in T-062) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 ("215 of 215 import-guard probes behaved as expected") |
| `pnpm format:check` | exit 0 ("All matched files use Prettier code style!") |
| `git show --stat 65d5960 1995cd7 b35ae6d e6701e3 0698551 fbddcd3 -- package.json pnpm-lock.yaml` | no manifest changed, so no dependency audit was run |
| `Get-Command gitleaks` | not found. A regex search of the six diffs for key, secret, password, token assignments, private keys, AWS keys, and credentialed database URLs found no match |

Not done: a mutation run against the pre-fix code (the reviewer does not edit `src`), `pnpm build`, e2e, a browser check of the admin page, `next start`.

## Residual risks

- SEC-092: reviews are still public the moment they are posted. There is no report button and no hold (remediations (2) and (3) not built). An admin finds abuse only by browsing `GET /admin/reviews`. A hidden review stays in the database and in the author's own order view (by design, D-048).
- SEC-072: a seller with a second customer account can still produce a fake delivered order and a review, now after 24 hours instead of seconds. With the mock provider the order costs nothing (SEC-056 deployment control). A real fix needs buyer confirmation or review signals (SEC-072 remediations (2) and (3)), for the owner.
- D-048 is PROPOSED. If the owner changes points 1 to 4 (for example removes un-hide), the pins in `t050-admin.test.ts` must change with it.
- Not rate-limited: the admin review endpoints (admin only, as every admin endpoint).
