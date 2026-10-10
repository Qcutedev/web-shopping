# Test Strategy

Owner: qa agent. **No tests exist and none have been run as of 2026-10-10.** The results section stays empty until a real run produces numbers.

## Goals

Prove, with tests that can fail, that money, stock, and permissions behave correctly, and that the main journeys work for each role. Coverage percentage is not a goal in itself.

## Levels and tools

| Level | Tool | Location | Needs | Command |
| --- | --- | --- | --- | --- |
| Unit | Vitest | `*.test.ts` next to source | nothing | `pnpm test` |
| Integration and API | Vitest | `tests/integration/**` | PostgreSQL test database | `pnpm test:integration` |
| Security | Vitest | `tests/security/**` | PostgreSQL test database | `pnpm test:integration` |
| End-to-end | Playwright | `e2e/**` | running app, seeded database, browsers | `pnpm test:e2e` |
| Static | ESLint, `tsc`, Prettier | | | `pnpm lint`, `pnpm typecheck`, `pnpm format:check` |
| Build | Next.js | | | `pnpm build` |
| Supply chain | `pnpm audit`, secret scanner | | | defined in CI |

Tool choices are confirmed at scaffold time.

## Principles

- Integration tests use a real database. Prisma is not mocked, because the constraints and transactions are what is under test.
- Each test creates its own data through factories and does not depend on seed content or test order.
- A new test must be shown to fail when the behaviour is broken.
- Tests are never skipped, deleted, or loosened to obtain a pass. A known failure is reported as a failure.
- Every fixed defect gains a regression test.
- Mock payment is exercised through the same provider interface a real provider will use.

## Risk-based priorities

| Priority | Area | Why |
| --- | --- | --- |
| P0 | Checkout totals, stock decrement, idempotency | Money and inventory corruption |
| P0 | Authorization: cross-customer, cross-seller, admin-only | Data exposure, takeover |
| P1 | Order and payment state machines, snapshots | Wrong order history |
| P1 | Seller onboarding and suspension, product visibility | Unapproved selling |
| P1 | Uploads | Server compromise |
| P2 | Catalog search, filters, pagination | Usability |
| P2 | Responsive layout, accessibility basics | Usability |

## Unit test scope

- Money: satang arithmetic, line totals, per-store subtotals, shipping, grand total, order cap, formatting to THB.
- Inventory rules: set and adjust never go below zero.
- State machines: every allowed transition passes; every other pair is rejected (table-driven).
- Permission helpers: each guard against each role and ownership combination.
- Validation schemas: boundaries for price, quantity, postal code, rating, pagination; unknown keys rejected.
- Purchasable rule (BR-05): each condition failing independently.
- Upload validation: type, size, magic bytes, filename handling.
- Environment validation: missing and malformed variables.

## Integration test matrix

For every protected endpoint, the same five cases: success as the right actor, validation failure, anonymous (401), wrong role (403), wrong owner (404).

| Area | Additional cases |
| --- | --- |
| Auth | Duplicate email, weak password, role field ignored or rejected, logout invalidates session, rate limit |
| Addresses | One default at a time |
| Catalog | Hidden when draft, unapproved, archived, store not approved, category inactive |
| Cart | Add same product twice merges; quantity above stock; unavailable item flagged; own-store product rejected |
| Checkout | Two-store cart creates two seller orders; totals match recomputation; tampered amounts ignored; snapshot persisted; cart cleared; stock decremented |
| Checkout failure | Insufficient stock on one item leaves no order and no stock change; mock failure sets `FAILED` and restores stock |
| Idempotency | Same key sequentially and in parallel yields one order |
| Concurrency | N parallel buyers, stock 1: exactly one success, stock ends at 0 |
| Orders | Price or title edit after purchase does not change the order |
| Seller products | Unapproved seller blocked; SKU unique per store; archive when referenced by orders |
| Seller orders | Sees only own portion of a multi-store order; invalid transitions rejected; cancel restores stock |
| Reviews | Not delivered, not the buyer, and second review all rejected |
| Admin | Each action writes an audit row; cannot deactivate self or last admin; suspension hides products |
| Database | `CHECK` constraints reject negative stock, negative price, zero quantity when written directly |

## End-to-end journeys

1. Customer registers and logs in.
2. Product discovery: browse, category, search, filter, sort, paginate.
3. Add products from two stores to the cart.
4. Checkout with mock payment.
5. Order history shows the persisted order.
6. Seller applies; admin approves.
7. Seller creates a product and updates inventory.
8. Seller updates fulfilment; customer sees the change.
9. Admin takes down a listing; it disappears from the storefront.
10. Journeys 2 to 5 at a 390-pixel-wide mobile viewport.

## Test data

- Factories in `tests/helpers/factories.ts` for user, admin, approved store, product, cart, paid order.
- A separate test database, reset between test files.
- No production data, ever.

## Environment requirements and current gaps

| Need | State |
| --- | --- |
| Node.js and package manager | not installed (B-01) |
| PostgreSQL test database | not available (B-02) |
| Playwright browsers | not installed |

Until these exist, no suite can run, and no task depending on a test can be marked `VERIFIED`.

## Traceability

Filled in as tests are written.

| Requirement | Test file | Status |
| --- | --- | --- |
| | | |

## Results

| Date | Command | Total | Passed | Failed | Skipped | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | no runs yet | | | | | |
