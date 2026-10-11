# T-004 review findings

Register of what the 2026-10-11 planning review found (product-requirements and code-review agents). Owner: orchestrator. Status of each item is tracked here until it is `FIXED` (the owning document changed) or `WAITING` (needs an owner answer, see "Questions for the owner" in [STATUS.md](../STATUS.md)).

"To validate" items are not defects; the named owner checks them against the installed versions during the task shown.

Statuses were brought up to date on 2026-10-11 from the code-review cross-document check 2026-10-11 (per-id verdicts, each with the section that resolves it). Its own findings X-01 to X-16 and the rulings on them are in DECISIONS.md D-031 and STATUS.md.

## Blocking before the affected task

| Id | Finding | Owner | Affects | Status |
| --- | --- | --- | --- | --- |
| B1 | CLAUDE.md rule 7 (only `src/modules` imports `src/server/db`) cannot hold: the auth layer, health check, seed, admin bootstrap script, and test factories all need the database | orchestrator | T-011, T-013 to T-016 | FIXED (D-021, D-025; CLAUDE.md and the lint allow-list updated, probes 55 of 55) |
| B2 | Layering table contradicts the auth design: services need the `Actor` type and role helpers; pages need guards; no stated home for them, risk of a modules/auth import cycle | orchestrator | T-015 | FIXED (D-022) |
| B3 | `StoreStatus` has `PENDING` and `REJECTED` but a Store is created only on approval, so they are unreachable; "seller (any status)" endpoints describe users whose role is still `CUSTOMER` | database, backend-api, product-requirements | T-013 | FIXED (DATA_MODEL 3, 4.1; API_CONTRACTS 1.8, 3; REQ-A-03) |
| B4 | API requires an approved store on `/seller/orders*`, which blocks what BR-14 requires (a suspended store still fulfils existing orders) | backend-api | T-043 | FIXED (API_CONTRACTS 5.7.3; DATA_MODEL 7.7) |
| B5 | Stock can be restored twice: once on payment `FAILED`, again when the still-`PENDING` seller order is cancelled. No rule says what happens to seller orders when payment fails | product-requirements, backend-api, database | T-032 | FIXED (D-023, D-025 OQ-07; DATA_MODEL 7.2, 7.3; API_CONTRACTS 5.5.4) |
| B6 | An order can stay payment `PENDING` forever if the process stops between commit and charge; the PAID/FAILED write is outside any documented transaction and unguarded | orchestrator, backend-api | T-032 | FIXED (D-023) |
| B7 | Two checkouts of one cart with different idempotency keys create two orders: nothing serialises checkout per cart | orchestrator, backend-api | T-032 | FIXED (D-023) |
| B8 | A concurrent duplicate with the same key can get 409 `INSUFFICIENT_STOCK` for an order that succeeded, because the idempotency lookup happens before the transaction | orchestrator, backend-api | T-032 | FIXED (D-023) |
| B9 | Plan dependencies that cannot work: T-001/T-012 circular; T-011 needs a database; T-014 needs auth hashing; T-015 needs T-019; T-031 and T-041 need auth; no task builds the integration-test harness | orchestrator | Phase 4 | FIXED (PROJECT_PLAN.md) |

## Should fix before the affected task

| Id | Finding | Owner | Affects | Status |
| --- | --- | --- | --- | --- |
| S1 | Paths with two owners or none: `src/server/env.ts`, `src/app/api/health`, `tests/security`, `scripts/bootstrap-admin.ts`, `src/app/api/auth`, `src/lib`, `src/app/layout.tsx`, root error pages, `public`, `.env.example`, test and framework configs | orchestrator | all | FIXED (AGENT_WORKFLOW.md) |
| S2 | Price and purchasability are read without a lock; the stock update checks only stock, so an order can use a stale price or a store suspended a moment earlier | orchestrator, backend-api | T-032 | FIXED (D-023) |
| S3 | No concurrency rule for status transitions (seller ships while admin cancels; two admins deactivate each other) | orchestrator, backend-api | T-032, T-043, T-050 | FIXED (D-024) |
| S4 | Three versions of "unavailable item at checkout": excluded, whole checkout fails, partial purchase | product-requirements, backend-api | T-031, T-032 | FIXED (D-025 OQ-09; BR-22; API_CONTRACTS 5.5.3). Open edges: mechanism and blind resend, D-031 points 5 and 6 |
| S5 | Moderation gaps: takedown has no target state; no way out of `REJECTED`; "materially edited" undefined; behaviour when approval is switched off undefined | database, backend-api, product-requirements | T-013, T-042, T-050 | FIXED (D-025 OQ-04 to OQ-06, D-026, D-028; DATA_MODEL 4.2; BR-17 to BR-19; `contentRevision` ruled in D-031 point 2) |
| S6 | Tests expect products hidden when the category is inactive, BR-05 does not say so; nothing covers a deactivated store owner | product-requirements, qa | T-020 | FIXED (D-025 OQ-10, OQ-14; BR-05, BR-23, BR-27) |
| S7 | An order's snapshot image can be deleted from storage when the product is edited or deleted | database, backend-api | T-041, T-042 | FIXED (DATA_MODEL 6.12, 8, 14; API_CONTRACTS 5.5.2, 5.8) |
| S8 | Uploads have no table: no owner of a key, no rule for attaching keys to a product, no check on a client-sent logo key, no orphan cleanup | backend-api, database | T-013, T-041 | FIXED (DATA_MODEL 6.7, 6.8, 8; API_CONTRACTS 5.8) |
| S9 | Admin promotion is allowed by requirements but has no endpoint; bootstrap "does nothing if the admin already exists" is ambiguous | product-requirements, backend-api, devops | T-016, T-050 | FIXED (D-025 OQ-13, D-026 OQ-37, D-028; BR-26; PROJECT_PLAN T-016) |
| S10 | Hard-deleting a product will fail on `CartItem` and `Review` foreign keys; no delete action stated | database | T-013 | FIXED (DATA_MODEL 14) |
| S11 | Slug scheme unspecified for Thai titles, duplicates, and store renames | database, backend-api | T-013, T-020 | FIXED (DATA_MODEL 9; API_CONTRACTS 1.4) |
| S12 | Order number generation unspecified; must be unique under concurrent checkouts | database | T-013 | FIXED (DATA_MODEL 10; API_CONTRACTS 1.4; D-026 OQ-44) |
| S13 | Catalog `minPrice` and `maxPrice` have no unit, breaking the "money fields end in `Satang`" convention | backend-api | T-020 | FIXED (API_CONTRACTS 1.5, 5.2) |
| S14 | D-015 (404 for foreign resources) is annotated on some endpoints only; BR-16 has no error code | backend-api | T-020 onward | FIXED (API_CONTRACTS 1.8, 2.3, 5.4) |
| S15 | Sums of satang in summaries and reports can exceed 32-bit `Int` | database, backend-api | T-043, T-050 | FIXED (DATA_MODEL 11; API_CONTRACTS 1.5, 5.7.4, 5.9.7) |
| S16 | REQ-S-03 had no backend task | orchestrator | T-043 | FIXED (PROJECT_PLAN.md) |
| S17 | T-040 acceptance referred to endpoints built later; unclear who owns the approve and reject service | orchestrator | T-040 | FIXED (PROJECT_PLAN.md) |
| S18 | Security review ran before security headers existed | orchestrator | T-062, T-072 | FIXED (PROJECT_PLAN.md) |
| S19 | Auth section of the data model omits the auth library's required user columns; id format for library-created rows; `role`, `isActive`, `phone` must not be client-settable; D-004 says sessions are revoked on suspension while BR-14 implies a suspended seller stays logged in | database, auth | T-013, T-015 | Sessions on suspension SUPERSEDED by D-027; auth table columns come from Better Auth 1.7.7 in T-013 (D-031 point 1); the rest OPEN for T-015 |
| S20 | Rate-limit key unspecified: "per IP" behind a proxy needs a trusted-proxy rule; "per email" needs the body before the auth handler | security, backend-api | T-015, T-019 | "Per IP" decided (SECURITY.md SR-01), code pending; "per email" OPEN for T-015 |

## Minor

| Id | Finding | Owner | Status |
| --- | --- | --- | --- |
| M1 | Checkout response has `payment.isSimulated` and `paymentMethod`; the model has `provider` and no such column. State that they are derived | backend-api | FIXED (API_CONTRACTS 1.9, 5.5.1; DATA_MODEL 6.13) |
| M2 | Payment status is on both `Order` and `Payment` with no sync rule | database | FIXED (DATA_MODEL 6.10, 6.13) |
| M3 | `/api/files/{key}` missing from the architecture directory layout | orchestrator | FIXED |
| M4 | SECURITY.md TM-16 says "JSON bodies only" but uploads are multipart | security | FIXED |
| M5 | REQ-N-06 says every list is paginated; five list endpoints are not marked so | backend-api | FIXED (API_CONTRACTS 1.7 and every table) |
| M6 | No bounds on shipping fee, commission, or stock upper limit; no CHECK for the BR-04 cap; archived products keep their SKU and slug forever | database | FIXED (D-025 OQ-16, D-026 OQ-40; DATA_MODEL 6.6, 11, 13) |
| M7 | Stale statements in STATUS.md, TEST_STRATEGY.md, DEPLOYMENT.md about missing tools and commits | orchestrator, qa, devops | STATUS FIXED; TEST_STRATEGY and DEPLOYMENT rewritten 2026-10-11 but not re-read end to end by the reviewer: NOT RE-CHECKED |
| M8 | "Same five cases for every protected endpoint" does not fit endpoints with no wrong role or wrong owner; test database reset needs a parallelism rule | qa | FIXED (TEST_STRATEGY kinds K1 to K7 and the reset rule) |
| M9 | DEPLOYMENT.md uses a migrate-deploy command with no script; report date range has no timezone; some acceptance checks are not runnable commands | devops, backend-api, orchestrator | Timezone FIXED (API_CONTRACTS 1.6); `db:migrate:deploy` script added 2026-10-11; "acceptance checks not runnable" NOT RE-CHECKED |
| M10 | TEST_STRATEGY.md uses a 390 px viewport; REQ-N-02 says 360, 768, 1280. Missing cases: uploads, BR-04 cap, admin settings and categories, escaped review text, session revocation on deactivation, suspended seller fulfilling, accessibility, payment-failure and review journeys | qa | FIXED (TEST_STRATEGY) |
| M11 | API gaps against requirements: no category delete endpoint (REQ-A-06), no explicit "set default address", add-to-cart above stock undefined, empty-cart checkout has no code, mock-failure response shape undefined, `/admin/summary` contents and admin list filters undefined | backend-api | FIXED (API_CONTRACTS 5.9.4, 5.3, 5.4, 2.3, 5.5.4, 5.9.7) |
| M12 | Sample-data marker exists for stores only (name prefix); products and categories have none. Simulated shipping fee on `SellerOrder` has no marker | database | FIXED (DATA_MODEL 16, 6.11) |

## Tests the reviewers say are missing for the blockers

Two keys on one cart; the same key twice on the last item; cancel after a failed payment; a stop between commit and charge. Owner: qa, in T-033.

## To validate against installed versions

| # | Item | Owner | During |
| --- | --- | --- | --- |
| V1 | Whether `src/middleware.ts` is still the file convention in Next.js 16 | auth | T-015 |
| V2 | Async request APIs (`params`, `searchParams`, `cookies()`, `headers()`); whether guards can run under Vitest without a request scope (decides whether integration tests go over HTTP) | auth, qa | T-015, T-023 |
| V3 | Server Components that read the database may be prerendered at build, needing a database at build time in CI and Docker | frontend, devops | T-021, T-070 |
| V4 | Environment validation at module load may also run during `next build`; an instrumentation hook may be needed | devops | T-011 |
| V5 | Route handlers buffer multipart bodies; the 5 MB limit must apply before buffering | backend-api | T-041 |
| V6 | In-process rate limiter and Prisma singleton across dev reloads and separate module instances | backend-api, database | T-013, T-019 |
| V7 | CSP set in Next.js config cannot carry per-request nonces | devops, security | T-072 |
| V8 | Prisma current major: generator and output path, driver adapter, config file, seed wiring | database | T-013 |
| V9 | Prisma: whether later `migrate dev` drops hand-written partial indexes; interactive transaction timeout under the race test; a unique violation aborts the transaction; whether conditional updates can return rows | database | T-013, T-032 |
| V10 | Better Auth: env variable names, its own origin check and rate limiter, session cookie caching off, blocking sign-in for inactive users, exposing password hashing to seed and bootstrap | auth | T-015 |
| V11 | Thai characters in `[slug]` segments may arrive percent-encoded | frontend | T-021 |
