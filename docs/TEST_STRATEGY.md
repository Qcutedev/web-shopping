# Test Strategy

Owner: qa agent. This document says what is tested, at which level, and by which rule. It does not record task status or run history for the whole project: those are in [STATUS.md](STATUS.md).

**State of the qa-owned suites on 2026-10-11:** no integration test and no end-to-end test exists, and neither suite can run yet (see [Environment requirements](#environment-requirements)). Every case below is a plan, not a result. Product rules cited as OQ-nn are the owner's answers in [DECISIONS.md](DECISIONS.md) D-025; where REQUIREMENTS.md still differs, D-025 wins.

## Goals

Prove, with tests that can fail, that money, stock, and permissions behave correctly, and that the main journeys work for each role. Coverage percentage is not a goal in itself.

## Levels and tools

| Level | Tool | Location | Needs | Command |
| --- | --- | --- | --- | --- |
| Unit | Vitest, Node | `src/**/*.test.ts` next to source | nothing | `pnpm test` |
| Component | Vitest, jsdom, Testing Library | `src/**/*.test.tsx` next to source | nothing | `pnpm test` |
| Security, no database | Vitest, Node | `tests/security/**` | nothing | `pnpm test` |
| Integration and API | Vitest | `tests/integration/**` | PostgreSQL test database, harness from T-023 | `pnpm test:integration` |
| Security, with database | Vitest | `tests/security/**` (owner: security) | PostgreSQL test database, harness from T-023 | to settle in T-023 (see [To validate in T-023](#to-validate-in-t-023)) |
| End-to-end | Playwright | `e2e/**` | running app, prepared database, browsers (T-060) | `pnpm test:e2e` |
| Static | ESLint, `tsc`, Prettier | | | `pnpm lint`, `pnpm typecheck`, `pnpm format:check` |
| Build | Next.js | | | `pnpm build` |
| Supply chain | `pnpm audit`, secret scanner | | | defined in CI (T-070) |

Tool versions are pinned in DECISIONS.md D-020. Colocated unit and component tests belong to the owner of the source file; qa owns `tests/**` (except `tests/security`) and `e2e/**`.

## Principles

- Integration tests use a real database. Prisma is not mocked, because the constraints and transactions are what is under test.
- Each test creates its own data through factories and does not depend on seed content or test order.
- A new test must be shown to fail when the behaviour is broken.
- Tests are never skipped, deleted, or loosened to obtain a pass. A known failure is reported as a failure.
- Every fixed defect gains a regression test.
- Mock payment is exercised through the same provider interface a real provider will use.
- A test asserts only behaviour that a requirement, a decision, or a contract states. Where none states it, the case is listed under [Risks and open concerns](#risks-and-open-concerns) and is not written on a guess.

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
- Validation schemas: boundaries for price, quantity, postal code, rating, pagination, settings; unknown keys rejected.
- Purchasable rule (BR-05 as extended by OQ-10 and OQ-14): each condition failing independently.
- Upload validation: type, size, magic bytes, filename handling.
- Environment validation: missing and malformed variables.

## Integration test matrix

### Baseline cases by kind of endpoint

Not every endpoint has a wrong role or a wrong owner. Each endpoint in [API_CONTRACTS.md](API_CONTRACTS.md) is assigned one kind, and gets exactly the baseline cases marked for that kind. A case that is marked "no" is not written, because it could not fail for a meaningful reason.

| Kind | Examples | Success | Validation failure | Anonymous 401 | Wrong role 403 | Wrong owner 404 |
| --- | --- | --- | --- | --- | --- | --- |
| K1 Public read | catalog lists, product page, store page, health, file serving | yes | if it takes input | no | no | no; instead: hidden or unknown resource gives 404 |
| K2 Auth library | register, login, logout | yes | yes | logout only | no | no |
| K3 Any logged-in user, own data without an id | profile, cart read, add to cart, checkout, own order list, seller application | yes | if it takes input | yes | no | no; instead: an id in the body that belongs to someone else (for example `addressId` at checkout) gives 404 and changes nothing |
| K4 Any logged-in user, resource by id | address, cart line, order detail, review | yes | if it takes input | yes | no | yes |
| K5 Seller, own store without an id | create product, product list, seller order list, dashboard summary, upload | yes | if it takes input | yes | yes (customer) | no; instead: the response contains only the caller's store's rows, and a `storeId` sent in the body or query is ignored |
| K6 Seller, resource by id | product, inventory, seller order, fulfilment update | yes | if it takes input | yes | yes (customer) | yes (another store's id) |
| K7 Admin | every `/admin` endpoint | yes | if it takes input | yes | yes (customer and seller, both) | no; instead: unknown id gives 404 |

Rules that apply across kinds:

- "Validation failure" is written only for an endpoint that takes a body, a query parameter, or a path parameter with a format.
- Wrong role is 403 and a foreign resource is 404, per D-015. A wrong-owner test also asserts that the foreign row is unchanged afterwards.
- K5 and K6 add a store-state case: a seller whose store is not approved is blocked from creating, publishing, and selling (REQ-S-09). Seller-order endpoints are the exception, see [Seller orders](#additional-cases-by-area).
- K7 adds two cases per mutating endpoint: an audit row is written on success, and none is written on any rejected call.
- An endpoint that fits no kind is reported to backend-api before its tests are written, not forced into one.

### Additional cases by area

| Area | Additional cases |
| --- | --- |
| Auth | Duplicate email, weak password, role field ignored or rejected, logout invalidates the session server-side, rate limit, deactivated user cannot log in |
| Addresses | One default at a time; postal code not exactly 5 digits rejected |
| Catalog | Hidden when draft, unapproved, archived, store not approved; the D-025 visibility cases in [the next table](#owner-decided-behaviours-d-025) |
| Cart | Add same product twice merges; quantity zero, negative, fractional, above 99; quantity above stock; unavailable item flagged; own-store product rejected (BR-16) |
| Checkout | Two-store cart creates two seller orders; totals match recomputation; tampered amounts ignored; snapshot persisted; cart cleared; stock decremented; empty cart is a defined error and creates no order (D-023) |
| Order cap (BR-04) | Grand total (items plus shipping) of exactly 20,000,000.00 THB is accepted; one satang more is rejected with no order, no payment row, and no stock change; the cap is checked on the server total, so a small client-sent total does not get past it |
| Checkout failure | Insufficient stock on one item leaves no order and no stock change; mock failure sets `FAILED` and restores stock (see OQ-07 below) |
| Idempotency and concurrency | See [Concurrency tests](#concurrency-tests-t-033) |
| Orders | Price or title edit after purchase does not change the order; store rename does not change it (OQ-18) |
| Seller products | Unapproved seller blocked; SKU unique per store; price outside BR-02, negative, or fractional rejected; archive when referenced by orders (BR-12) |
| Seller orders | Sees only own portion of a multi-store order; invalid transitions rejected and change nothing; `PENDING` to `PROCESSING` rejected unless payment is `PAID`; cancel restores stock once |
| Suspended seller (BR-14, REQ-S-09) | After suspension the seller still lists and reads existing seller orders and can move them through the fulfilment table; cannot create or publish a product; the store's products are hidden and cannot be added to a cart or checked out. Depends on review findings B4 and S19 being fixed in the contract first |
| Uploads (REQ-S-05) | See [Uploads](#uploads) |
| Reviews | Not delivered, not the buyer, second review for the same order item, and rating outside 1 to 5 are all rejected with no review created; text containing markup (`<script>`, an `<img>` with an event handler, an unclosed tag) is stored and returned unchanged as data, never interpreted |
| Admin users | Cannot deactivate self or the last admin; deactivation cases below |
| Session revocation on deactivation (REQ-A-02) | A user holds a valid session; an admin deactivates the user; the very next request with the old cookie gets 401; no session row for that user remains; login is rejected; after reactivation login works again and the old cookie is still rejected |
| Admin settings (REQ-A-09, OQ-16) | Shipping fee: 0 and 1,000.00 THB accepted; minus one satang, one satang above 1,000.00 THB, and a fractional satang rejected. Commission: 0 and 100 percent accepted; below 0 and above 100 rejected. A rejected value leaves the stored setting unchanged and writes no audit row. A change applies to the next order and never alters an existing seller order's snapshot. No moderation switch exists (OQ-04 below) |
| Admin categories (REQ-A-06) | Create, rename, reorder, deactivate, each with an audit row; a category with products cannot be hard-deleted; an inactive category gives 404 on its page; effect on its products per OQ-10 below |
| Admin moderation and stores | Approve, reject with reason, take down with reason; rejection or suspension without a reason is rejected; suspension hides products; acting on a row that is not in the expected state is a conflict (D-024) |
| Database | `CHECK` constraints reject negative stock, negative price, zero quantity when written directly |
| Environment | Missing or malformed configuration fails at startup with a message naming the variable and not its value |

### Owner-decided behaviours (D-025)

Each row is one or more integration tests. "Hidden everywhere" always means the same five places: home listing, search, category page, store page, and product page (404), plus a rejected add-to-cart.

| Rule | Cases |
| --- | --- |
| OQ-04 No approval switch | A new product from an approved seller is always `PENDING` and hidden, whatever the settings row holds. The settings read has no moderation field. A settings update that sends one is rejected as an unknown key and changes nothing |
| OQ-05 Re-approval after an edit | For an approved, visible product, one test per field: changing the title, the description, the category, or the pictures returns it to moderation and it is hidden everywhere until approved again. Changing only the price or only the stock leaves it visible and approved, and the new value is what the storefront shows and what the next checkout charges. One request that changes both the title and the price hides the product and still stores the new price |
| OQ-06 Resubmission | A rejected product, and a taken-down product, can each be edited by its seller and submitted again; it then waits in the moderation queue, stays hidden, and becomes visible only after approval. Another store's seller gets 404 |
| OQ-07 Failed mock payment | Order is `FAILED`; stock is back to its starting value; the cart again holds the same products and quantities; sending the same idempotency key again returns the same failed order, creates nothing, and does not call the provider again; a checkout with a new key creates a different order and the failed one stays `FAILED`. The seller's order list, order detail (404), and dashboard counts do not include the failed order |
| OQ-08 Cancelling a paid order | A seller, and an admin, can cancel a seller order whose payment is `PAID` while fulfilment is `PENDING` or `PROCESSING`. Stock is restored once. The payment stays `PAID` and no refund record or `REFUNDED` status appears. The customer's order detail carries the state shown as "ยกเลิกแล้ว คืนเงินนอกระบบ". The cancelled seller order is absent from the seller's paid sales total and from the admin revenue figure, while the other store's portion of the same order is still counted |
| OQ-09 Whole checkout stops | Two-store cart where one line cannot be bought, one test per reason (not enough stock, unpublished, awaiting approval, archived, store suspended, category inactive, store owner deactivated): the response is a conflict that identifies the line; no order, seller order, item, or payment row exists; stock of every other product is unchanged; the cart is unchanged. After the customer removes that line, the same checkout succeeds |
| OQ-10 Inactive category | Products of a category that was switched off are hidden everywhere, are flagged in carts that already hold them, and stop checkout per OQ-09. Products in other categories of the same store are unaffected |
| OQ-11 Sold out | A product with stock 0 that is otherwise visible appears in every listing and on its page, with a sold-out state in the response; adding it to a cart and checking it out are rejected |
| OQ-12 Low stock | Seller dashboard low-stock count: stock 5 is counted, stock 6 is not; another store's products never change the count |
| OQ-13 No admin promotion | No request changes a user's role to `ADMIN`: a `role` field sent to register, profile update, and every admin user endpoint is rejected or ignored, and the user's stored role is unchanged. At the end of the T-052 suite the only admins in the database are the ones the factories created |
| OQ-14 Deactivated store owner | Deactivating a user who owns a store hides the store page (404) and its products everywhere, and stops checkout of its products per OQ-09. Other stores are unaffected |
| OQ-17 Shipped is nearly final | From `SHIPPED`, the only accepted move is to `DELIVERED`. Cancel, and any move back, is rejected for the seller and for the admin, changes nothing, and restores no stock. `DELIVERED` and `CANCELLED` accept no further move |
| OQ-18 Store name on orders | After a store renames itself, an existing order shows the old name to the customer, the seller, and the admin; the store page and new orders show the new name |
| OQ-23 Quantity lowered | A cart line holds quantity 5; stock falls to 3; the next cart read returns quantity 3, stores 3, and marks that line as lowered so the customer can be told. The line total uses the lowered quantity. Stock falling to zero, and what happens at checkout, wait on R4 and R5 |

### Uploads

For `POST /seller/uploads` (kind K5) and the file-serving route (kind K1). Fixture files are generated by the test, not committed binaries of unknown origin.

| Case | Expected |
| --- | --- |
| Valid JPEG, PNG, WebP | Accepted; stored under a generated name, not the client's filename |
| Wrong type (GIF, SVG, PDF, HTML) | Rejected with the unsupported-type error; nothing stored |
| Mismatched content (HTML or script bytes named `.jpg` with an image content type) | Rejected on content, not extension; nothing stored |
| Oversize (one byte over 5 MB) and a file of exactly 5 MB | Over: rejected, nothing stored. Exact: accepted |
| Path-traversal and odd filenames (`../../x.jpg`, absolute path, backslashes, null byte, very long name) | Never used as a path; no file appears outside the storage directory |
| Ninth image on one product | Rejected; the product keeps eight |
| Anonymous, customer, seller of a non-approved store | 401, 403, blocked |
| Served file | Correct content type and `nosniff`; unknown key gives 404; a traversal key gives 404 and reads nothing outside the storage directory |
| Rate limit | Requests over the documented limit get 429 |

Attaching another store's storage key to a product cannot be specified until review finding S8 (ownership of upload keys) is resolved in DATA_MODEL.md and API_CONTRACTS.md.

## Concurrency tests (T-033)

These run against the real database with real parallel connections and committed transactions; nothing is mocked except the payment provider, which is replaced through the provider interface. Each parallel test is repeated enough times (count fixed in T-033 and reported) to make a lost race likely to show, and each asserts on database rows afterwards, not only on responses.

| Id | Scenario | Must hold | Source |
| --- | --- | --- | --- |
| CC-01 | N customers check out the last unit (stock 1) in parallel | Exactly one order; the others get the insufficient-stock conflict and leave no order, item, or payment row; stock is 0, never negative | REQ-N-05, D-006 |
| CC-02 | The same idempotency key sent twice, one after the other | One order; the second response is that order | D-023 |
| CC-03 | The same idempotency key sent twice in parallel | One order; both responses carry it; stock decremented once | D-023 |
| CC-04 | The same key sent twice in parallel when the cart holds the last unit | One order; **both** responses are that order and neither is an insufficient-stock conflict; stock is 0 | Finding B8, D-023 |
| CC-05 | Two different idempotency keys on one cart, in parallel and one after the other | One order; the other request gets the empty-cart error; stock decremented once; one payment | Finding B7, D-023 |
| CC-06 | Cancel after a failed payment: the payment fails, then a seller cancel and an admin cancel are attempted on the same order's seller orders, one after the other and in parallel with the failure | Stock for every item ends exactly at its starting value, never above; the restore is recorded once | Finding B5, D-023 |
| CC-07 | Stop between commit and charge: the provider never answers, leaving an order with payment `PENDING` | The order exists with stock decremented; a replay with the same key returns it and does not charge again; once older than the timeout, the timeout path fails it and restores stock once; running the timeout path twice, or in parallel with a late success, changes the order exactly once | Finding B6, D-023 |
| CC-08 | Seller marks a `PROCESSING` seller order shipped while an admin cancels it | Exactly one of the two succeeds and the other gets a conflict; the final state is `SHIPPED` with no stock restored, or `CANCELLED` with stock restored once; never both effects | Finding S3, D-024 |
| CC-09 | Two admins deactivate each other in parallel, with exactly two active admins | At most one succeeds; at least one active admin remains; the audit log has a row only for the one that succeeded | Finding S3, D-024 |
| CC-10 | Parallel inventory adjustments and a checkout on one product | Final stock equals the starting stock plus the accepted changes; never negative | REQ-S-06, D-024 |
| CC-11 | Price changes while a checkout is in flight | The order's unit price is one of the two prices and its totals are consistent with that price | Finding S2, D-023 |

## End-to-end journeys

1. Customer registers and logs in.
2. Product discovery: browse, category, search, filter, sort, paginate. Sold-out products are shown and marked "สินค้าหมด" (OQ-11).
3. Add products from two stores to the cart.
4. Checkout with mock payment, labelled as a test payment.
5. Order history shows the persisted order.
6. Seller applies; admin approves.
7. Seller creates a product and updates inventory.
8. Seller updates fulfilment; customer sees the change.
9. Admin takes down a listing; it disappears from the storefront.
10. Journeys 2 to 5 at each width in [Viewports](#viewports).
11. Payment failure: the customer chooses the simulated failure, sees a failure message, finds the items back in the cart, and completes a new checkout (OQ-07).
12. Review: after the seller marks the order delivered, the customer reviews the item once; the review appears on the product page; a second attempt is not offered or is rejected. The review text contains markup, which is displayed as literal text: no element is created from it and no dialog opens.
13. Suspended seller: an admin suspends a store; its products leave the storefront; the seller still completes an existing order (BR-14).

### Viewports

REQ-N-02 names three widths, and all three are used: **360, 768, and 1280 pixels**. Journeys 1 to 9 and 11 to 13 run at 1280. Journey 10 repeats journeys 2 to 5 at 360 and at 768. At every width the journey also asserts that the page does not scroll sideways and that the controls it uses are reachable without zooming.

### Accessibility checks

REQ-N-03 asks for WCAG 2.1 AA contrast, keyboard operability, and labelled forms. What the suite checks, and what it does not:

| Check | How | Level |
| --- | --- | --- |
| Labelled forms | End-to-end tests find every form field by its label and every button by its accessible name, so an unlabelled control fails the journey that uses it | E2E |
| Keyboard operability | Journeys 3 and 4 have a keyboard-only variant at 1280: reach the product, add to cart, fill the checkout form, and submit without a pointer; focus is visible at each stop and is never trapped | E2E |
| Automated rule scan | An accessibility rule engine scans home, search results, product page, cart, checkout, order detail, login, and register at 360 and 1280; any violation of a WCAG 2.1 A or AA rule fails the test | E2E; needs a scanner dependency, requested for T-060 |
| Primitive behaviour | Roles, names, and keyboard handling of each design-system primitive | Component tests, owned by ui-ux-design |

An automated scan finds only part of what WCAG covers. Passing it is not a claim of AA conformance; contrast on images and reading order still need a manual pass, recorded as not done until someone does it.

## Test data

- Factories in `tests/helpers/factories.ts` for user, admin, approved store, product, cart, paid order.
- No dependence on seed data. No production data, ever.

### Test database reset under parallel files

Chosen rule: **one database per Vitest worker; files inside a worker run one at a time; every test file empties all tables before its first test.**

- Global setup applies the migrations once to a template database on the test PostgreSQL instance. Each worker creates its own database from that template and points the database layer at it before any module that opens a connection is loaded.
- A file starts by truncating every application table in its worker's database. It does not clean up afterwards, so a failed file leaves its rows for inspection until the next file starts.
- Tests within one file run in order and share that file's data only through what the file itself creates.

Why this rule and not the alternatives:

- A single shared database with truncation between files is wrong once files run in parallel: one file's reset deletes another file's rows mid-test.
- Wrapping each test in a transaction that is rolled back cannot be used, because the checkout and concurrency tests need several real connections and committed transactions.
- Some rules are about the whole table (the last admin, the single settings row, "the only admins are the ones the factories created"). They need a database nobody else is writing to, which a per-worker database gives and unique ids alone do not.
- Running every file serially against one database is correct and simpler, but its run time grows with every file. It is the fallback: if per-worker databases cannot be made reliable in T-023, the integration config disables file parallelism and uses one database, and this section is updated to say so.

The test PostgreSQL instance keeps its data in memory and is empty after every container start, so global setup always creates the template and never assumes it exists.

### To validate in T-023

The rule above is a design, not yet run. T-023 confirms or revises each point against the installed versions:

- That the installed Vitest gives each worker a stable identifier usable in a database name, and runs a worker's files one at a time.
- That the database layer can be pointed at the worker's database before its client is created.
- That creating a database from the template works with the pinned PostgreSQL and Prisma versions, including the hand-written constraints and partial indexes.
- That the reset leaves no rows between files (the T-023 acceptance check), proven by a test that fails if a row survives.
- Review item V2: whether guards and services can be called in-process under Vitest, or whether integration tests must go over HTTP. If over HTTP, each worker also needs its own application server bound to its own database.
- Where the security tests that need a database run, so that `tests/security/**` is not picked up twice or missed.

End-to-end tests use their own database, separate from every integration database. Whether Playwright runs with one worker or isolates data per worker is decided in T-060.

## Environment requirements

| Suite | Needs | Provided by |
| --- | --- | --- |
| Unit, component, security without database | Node.js, pnpm, installed dependencies | T-010 |
| Integration and API | The test PostgreSQL container from `docker compose` (127.0.0.1:5433), the schema, and the harness | T-012, T-013, T-023 |
| End-to-end | The above, a built or running application, Playwright and its browsers | T-060 |

Whether each of these is in place is recorded in [STATUS.md](STATUS.md), not here. On 2026-10-11 the first row is satisfied; the schema, the harness, and Playwright are not installed, so `pnpm test:integration` and `pnpm test:e2e` cannot run and no task that depends on them can be marked `VERIFIED`.

## Risks and open concerns

### Cases that wait for an owner decision

D-025 settles the rule in each case but not the detail below. No test is written for the detail until the owner answers; the orchestrator records the questions in STATUS.md.

| # | Question for the owner | Blocks |
| --- | --- | --- |
| R1 | After a failed test payment the items go back into the cart. If the customer has meanwhile put the same product in the cart again, are the two quantities added together, and what happens if that goes over the limit of 99 or over the stock left? | OQ-07 cases, journey 11 |
| R2 | Does the customer see the failed order in their own order history, or does it disappear for them as it does for sellers? | OQ-07 cases, journey 11 |
| R3 | When an order is failed because the payment never answered (the timeout), do the items go back into the cart in the same way? | CC-07 |
| R4 | When stock drops to zero for a product already in a cart, the quantity cannot be lowered to zero. Does the line stay in the cart marked sold out, or is it removed? | OQ-23 cases |
| R5 | When is the customer told that a quantity was lowered: only on the cart page, or also at checkout? And if the quantity is found to be too high only at the moment of checkout, does checkout stop so the customer can look at the new quantity first? | OQ-23 cases, journey 4 |
| R6 | When a deactivated store owner is reactivated, or a switched-off category is switched on again, do the store and the products come back by themselves? | OQ-10, OQ-14 cases |
| R7 | While a store owner is deactivated they cannot log in. Who handles that store's orders that are already paid: nobody until reactivation, or the admin? | OQ-14 cases |
| R8 | Does a sold-out product (stock 0) count as "low stock" on the seller dashboard, and do products that are not on sale (draft, archived, rejected) count? | OQ-12 cases |
| R9 | In sales and revenue figures: is the shipping fee part of the amount, and does an order with one store's part cancelled still count as one order in the "number of orders" figure? | OQ-08 cases |
| R10 | Does changing only the order of a product's pictures count as a picture change that needs approval again? | OQ-05 cases |

### Cases that wait for another document

- Suspended seller fulfilling orders: API_CONTRACTS.md still requires an approved store on seller-order endpoints (finding B4), and D-004 and BR-14 disagree on whether suspension ends the seller's sessions (finding S19). The tests follow BR-14.
- Upload key ownership (finding S8), the mock-failure response shape, and the empty-cart error code (finding M11) are needed before the matching assertions can name a status and code.
- Commission bounds are tested at 0 and 100 percent; the stored unit (whole percent or finer) comes from DATA_MODEL.md (finding M6).
- CC-07 needs a way for a test to make an order older than the timeout and to make the provider not answer; CC-06 needs the contract to say what an admin cancel on a failed order returns.
- CC-09 with three or more admins: whether a request already in flight from an admin who has just been deactivated is still honoured is not stated in D-024. Only the two-admin invariant is asserted until it is.

### Limits of this strategy

- Concurrency tests show that a race was not lost in the runs made; they do not prove it cannot be lost. The repeat count is reported with the result.
- Rate limits are tested in one process only (D-012).
- No load, performance, or cross-browser matrix is planned for the MVP; Playwright projects are decided in T-060.
- The accessibility scan is partial, as stated above.

## Traceability

Filled in as tests are written. No qa-owned test file exists yet.

| Requirement | Test file | Status |
| --- | --- | --- |
| | | |

## Results

Runs of `pnpm verify` and of the unit, component, and security projects are recorded in [STATUS.md](STATUS.md). This table records runs of the qa-owned suites only.

| Date | Command | Total | Passed | Failed | Skipped | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | no integration or end-to-end run yet | | | | | |
