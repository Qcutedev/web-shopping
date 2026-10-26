# Decision Log

Owner: orchestrator. Add an entry whenever a choice constrains future work. Never rewrite an old entry; supersede it with a new one.

Status values: `PROPOSED` (not yet validated against installed versions or the user), `ACCEPTED`, `SUPERSEDED by D-0xx`.

Decisions marked `PROPOSED` are not yet validated against the installed stack; each is confirmed or revised by the task that first exercises it. Decisions marked `ACCEPTED` are settled.

| Id | Date | Decision | Status |
| --- | --- | --- | --- |
| D-001 | 2026-10-10 | Modular monolith in one Next.js application | PROPOSED |
| D-002 | 2026-10-10 | Next.js App Router, TypeScript strict, React, Tailwind, shadcn/ui | PROPOSED |
| D-003 | 2026-10-10 | PostgreSQL with Prisma | PROPOSED |
| D-004 | 2026-10-10 | Better Auth for authentication, database-backed sessions | PROPOSED |
| D-005 | 2026-10-10 | Money as integer satang in `Int` columns | PROPOSED |
| D-006 | 2026-10-10 | Conditional atomic stock decrement inside the checkout transaction | PROPOSED |
| D-007 | 2026-10-10 | Order, SellerOrder, OrderItem aggregate | PROPOSED |
| D-008 | 2026-10-10 | Reads via services in Server Components; mutations via `/api/v1` route handlers | PROPOSED |
| D-009 | 2026-10-10 | Checkout idempotency key | PROPOSED |
| D-010 | 2026-10-10 | Storage abstraction with a local-disk adapter for development | PROPOSED |
| D-011 | 2026-10-10 | Payment and shipping provider interfaces with mock implementations | PROPOSED |
| D-012 | 2026-10-10 | In-memory rate limiter for the MVP | PROPOSED |
| D-013 | 2026-10-10 | Database search with `ILIKE`; no search service | PROPOSED |
| D-014 | 2026-10-10 | pnpm as package manager | PROPOSED |
| D-015 | 2026-10-10 | Foreign resources return 404, not 403 | PROPOSED |
| D-016 | 2026-10-10 | Main session is the orchestrator | ACCEPTED |
| D-017 | 2026-10-11 | Owner confirmed the defaults for open questions Q1 to Q6 | ACCEPTED |
| D-018 | 2026-10-11 | Visual direction approved by the owner: green accent, IBM Plex Sans Thai | ACCEPTED |
| D-019 | 2026-10-11 | Operating rules for the long autonomous run | ACCEPTED |
| D-020 | 2026-10-11 | Toolchain versions on the developer machine | ACCEPTED |
| D-021 | 2026-10-11 | Explicit list of code allowed to import the database layer | ACCEPTED (owner approved 2026-10-11, see D-025) |
| D-022 | 2026-10-11 | `Actor` type and pure permission helpers live in `src/server/auth/actor.ts` | ACCEPTED |
| D-023 | 2026-10-11 | Checkout is serialised per cart; payment completion is one guarded transaction | ACCEPTED (supersedes parts of D-006 and D-009) |
| D-024 | 2026-10-11 | Every status transition is a conditional update | ACCEPTED |
| D-025 | 2026-10-11 | Owner answers to open questions OQ-01 to OQ-19 and OQ-21 to OQ-24 | ACCEPTED |
| D-026 | 2026-10-11 | Owner answers to open questions OQ-25 to OQ-50 | ACCEPTED |
| D-027 | 2026-10-11 | Sessions end on logout and user deactivation, not on store suspension (supersedes part of D-004) | ACCEPTED |
| D-028 | 2026-10-11 | Owner answers to the follow-up questions raised by D-026 (REQUIREMENTS Q31 to Q37 and others) | ACCEPTED |
| D-029 | 2026-10-11 | A `GET` never writes; checkout stores a lowered quantity and stops; `storeId` in a seller body is rejected | ACCEPTED |
| D-030 | 2026-10-11 | Markdown stays excluded from Prettier; `format:check` is not evidence about documents | ACCEPTED |
| D-031 | 2026-10-11 | Technical rulings after the cross-document check: Prisma and Better Auth versions, `contentRevision` on a price correction, amounts in a request body, order of refusals, refused-checkout mechanism | ACCEPTED |
| D-032 | 2026-10-11 | After the security review: store status is judged before the body is read (amends D-031 point 4); every restore deletes all sessions and re-applies restrictions | ACCEPTED |
| D-033 | 2026-10-12 | Owner answers to the parked questions: CR-15, REQUIREMENTS Q38 to Q41, filter chips, DEPLOYMENT DEP-Q1 to DEP-Q3, DEP-Q5, DEP-Q6, DEP-Q8, DEP-Q9 | ACCEPTED |
| D-034 | 2026-10-13 | SEC-036: the unused optional peer `mysql2` is removed from the dependency tree with a pnpm override; no audit exception list | ACCEPTED |
| D-035 | 2026-10-13 | CR-53: the admin bootstrap inserts `User` and `Account` directly in the auth library's formats, in one transaction | ACCEPTED |

## Details

### D-001 Modular monolith
One deployable unit with domain modules under `src/modules`. Microservices add operational cost with no demonstrated need at this scale. Module boundaries are kept clean enough that a domain could be extracted later.

### D-002 Frontend stack
Matches the requested stack. Server Components reduce client JavaScript for catalog pages. shadcn/ui gives accessible primitives that live in the repository and can be restyled. Exact versions are chosen as the current stable releases at scaffold time and recorded here.

### D-003 PostgreSQL and Prisma
Relational integrity, transactions, and `CHECK` constraints are needed for orders and stock. Prisma gives typed queries and migrations. Trade-off: `CHECK` constraints and partial indexes must be written as raw SQL in migrations, and there are no automatic down migrations.

### D-004 Better Auth
A maintained TypeScript auth library with email and password, database sessions, and a Prisma adapter. Database sessions allow server-side revocation on logout, deactivation, and suspension, which stateless tokens do not. Alternative considered: Auth.js. To validate during T-015: compatibility with the installed Next.js version and the Prisma adapter. If it does not fit, revise this entry rather than hand-rolling auth.

### D-005 Integer satang
Avoids floating-point error and avoids decimal-library handling in application code. `Int` is 32-bit, so the limits in BR-02 to BR-04 keep every total under 2,147,483,647 satang. If larger orders are ever required, totals move to `BigInt`.

### D-006 Stock concurrency
`UPDATE product SET stock = stock - :q WHERE id = :id AND stock >= :q`, checking the affected row count, inside the checkout transaction. Zero rows means insufficient stock and the transaction rolls back. A `CHECK (stock >= 0)` constraint backs it up. This avoids explicit row locks and holds under the default isolation level. Products are processed in id order to keep lock ordering consistent and avoid deadlocks.

### D-007 Order aggregate
`Order` is the customer's purchase and owns payment. `SellerOrder` is one store's portion and owns fulfilment status, shipping fee, commission rate snapshot, and shipment. `OrderItem` belongs to a `SellerOrder`. Sellers are authorised against `SellerOrder.storeId` and never see another store's portion.

### D-008 Reads and mutations
Server Components call module services directly, avoiding an internal HTTP hop. Mutations use JSON route handlers under `/api/v1` so they have a documented contract, are testable over HTTP, and can serve a future mobile client. Both paths go through the same service functions and the same authorization.

### D-009 Idempotency
The client sends an `Idempotency-Key` header (UUID) with checkout. A unique constraint on `(userId, idempotencyKey)` makes a repeat return the original order. A concurrent duplicate hits the unique constraint and is resolved by reading the existing order.

### D-010 Storage
A `StorageProvider` interface with `put`, `delete`, and `publicUrl`. The local adapter writes outside the source tree to a git-ignored directory and serves through a route that sets the content type and `nosniff`. An S3-compatible adapter is planned for staging and production. Local disk storage does not work on serverless or multi-instance hosting; recorded in KNOWN_LIMITATIONS.md.

### D-011 Provider abstractions
`PaymentProvider` and `ShippingProvider` interfaces. The MVP ships `MockPaymentProvider` and `ManualShippingProvider` only. Records store the provider name so mock data is distinguishable forever.

### D-012 Rate limiting
In-process fixed-window limiter. Correct for a single instance only. Multi-instance or serverless deployment needs a shared store such as Redis. Recorded in KNOWN_LIMITATIONS.md.

### D-013 Search
Case-insensitive substring match on product name with indexed filters. Thai has no word boundaries, so full-text search needs a Thai-aware tokenizer or trigram indexes; deferred. Acceptable for small catalogs only.

### D-014 pnpm
Strict dependency resolution and a fast, disk-efficient store. Enabled through Corepack with the version pinned in `package.json`. If pnpm proves troublesome inside OneDrive, fall back to npm and update CLAUDE.md.

### D-015 404 for foreign resources
Returning 403 confirms a resource exists. Returning 404 for resources owned by another customer or store avoids id enumeration. 403 is used when the role itself is not permitted for the endpoint.

### D-016 Orchestration
Claude Code subagents cannot spawn subagents, so the main session coordinates and `.claude/agents/orchestrator.md` is its playbook.

### D-017 Open questions confirmed
On 2026-10-11 the owner accepted every default in the "Open questions" table of REQUIREMENTS.md: Q1 flat shipping fee 40.00 THB per seller order; Q2 products need admin approval before going live; Q3 commission 5 percent, recorded only; Q4 customers cannot cancel their own orders in the MVP; Q5 login required to add to cart; Q6 the marketplace has no name or logo yet, so a placeholder name is used and must be a single string that is easy to replace.

### D-018 Visual direction
The owner approved the first design round (home, product, cart, mobile home) on 2026-10-11, with refinements to come later. It supersedes the indigo and Noto Sans Thai starting values in DESIGN_SYSTEM.md: white ground, near-black ink `#14171A`, one accent `#0E7C66` used only for primary actions and links, IBM Plex Sans Thai, 10 to 16 px radii with pill-shaped search and chips, generous whitespace. Product photos are not available yet; a neutral tinted placeholder is used. Reference mockups: https://claude.ai/artifact/CL5ZhTCm2665Ai1oFYuVVk (private to the owner).

### D-019 Operating rules for the long run
Agreed with the owner on 2026-10-11.
- Nothing uncertain is guessed. Product, business, design, and scope questions that the docs do not settle are parked in STATUS.md under "Questions for the owner"; work continues on unblocked tasks and the questions are asked in a batch.
- Choices the docs already settle are followed without asking again.
- The orchestrator commits locally after each task passes its checks. Nothing is pushed until the owner says so.
- Work stops for owner review at five milestones: (1) foundation plus browsable storefront, (2) cart, mock checkout, orders, (3) seller platform, (4) admin platform, (5) full test, security review, and fixes.

### D-020 Toolchain versions
Node.js v24.20.0, npm 11.19.0, pnpm 12.11.2 (Corepack 0.35.0), Docker 29.8.2 with Compose v5.5.1 on WSL 3.0.1.0, git 2.55.0, GitHub CLI 2.102.0. Pinned by T-010 on 2026-10-11 from `create-next-app@16.4.0` defaults: Next.js 16.4.0 (Turbopack, `cacheComponents` and `partialPrefetching` on, as generated), React 19.3.0, TypeScript 5.9.3, Tailwind CSS 4.3.3 via `@tailwindcss/turbopack`, ESLint 9.39.5 with `eslint-config-next` 16.4.0, Prettier 3.9.9, Vitest 5.0.3, Zod 4.6.5 (upgraded 2026-10-26 for SEC-089: Next.js and `eslint-config-next` 16.4.3, Zod 4.6.7). D-002 and D-014 are thereby validated for the scaffold. Prisma, Better Auth, and Playwright versions are pinned when T-013, T-015, and T-060 add them. Local databases (T-012): image `postgres:18-trixie`, resolved to PostgreSQL 18.6.

### D-021 Who may import the database layer (proposed)
Review finding B1: CLAUDE.md rule 7 says only `src/modules/*` imports `src/server/db`, but the auth layer (session storage and loading the actor's role and store), the health check, the seed, the admin bootstrap script, and test factories cannot work without it. Proposed wording for rule 7: "Only `src/server/db` imports the Prisma client. `src/server/db` is imported only by `src/modules/**`, `src/server/auth/**`, `src/server/health.ts`, `prisma/seed.ts`, `scripts/**`, and `tests/**`. Pages, route handlers, and components never import it." CLAUDE.md is not changed until the owner approves (OQ-19). Until then no code outside `src/modules` imports the database layer, which blocks T-011's database check and T-015.

### D-022 Actor and permission helpers
Resolves review finding B2. `src/server/auth/actor.ts` holds the `Actor` type and pure helpers (`requireRole`, ownership assertions) with no database or framework imports; modules, route handlers, and pages may import it. `requireActor` (session to `Actor`, loading role and store) lives in `src/server/auth` and is the only part that reads the database, subject to D-021. Modules never import the rest of `src/server/auth`, so there is no import cycle. Presentation may import guards.

### D-023 Checkout concurrency
Resolves review findings B6, B7, B8, and S2, and fixes the invariant behind B5.
1. Checkout runs in one transaction that first locks the customer's cart row (`SELECT ... FOR UPDATE`). This replaces D-006's "no explicit row locks" for the cart row only; products still use the conditional decrement.
2. The idempotency lookup happens inside that lock, so a concurrent duplicate waits and then returns the existing order instead of an error. This replaces the pre-transaction lookup in D-009; the unique constraint stays as a backstop.
3. An empty cart after the lock is a defined error, not an order.
4. The conditional stock update also requires the product and its store to be purchasable in the same statement and returns the current price, which is the price charged. A price or status change that lands first is therefore either seen or makes the update affect zero rows.
5. Payment completion (to `PAID` or `FAILED`) is one transaction guarded by `WHERE status = 'PENDING'` and a row count check. Stock is restored in that same transaction, in product id order, and only by the request whose guarded update affected a row. Stock for an order item is restored at most once across all paths; the data model records that it happened.
6. Orders left payment `PENDING` longer than a configured timeout are failed through the same guarded path by a service function that a script and the checkout path can call. A replay that finds a `PENDING` order returns it without charging again.
What the customer and seller see after a failed payment (retry, cart contents, visibility to sellers) is an owner decision, OQ-07.

### D-024 Status transitions
Resolves review finding S3. Every status change (payment, fulfilment, store, product, moderation, user activation) is written as `UPDATE ... WHERE id = :id AND status = :expected` and the affected row count is checked; zero rows is a conflict error. "Not the last admin" is enforced inside a transaction that locks the admin rows it counts. Every write that changes stock for several products processes them in id order.

### D-025 Owner answers to the open questions
On 2026-10-11 the owner accepted the orchestrator's recommendation for every open question except OQ-20, which stays open until the owner can look at real pages at milestone 1. The answers are rules from now on. The owning documents (REQUIREMENTS.md, DATA_MODEL.md, API_CONTRACTS.md, DESIGN_SYSTEM.md, SECURITY.md) do not contain them yet; each owner writes them in before the task that depends on them.

| Question | Answer |
| --- | --- |
| OQ-01 | Form controls and outline buttons use the darker border: `--control-border` points to `--border-contrast` (`#7F8790`). The approved light border stays for cards and dividers. |
| OQ-02 | The "จัดส่งแล้ว" (shipped) badge is blue (the info tone), not accent green. |
| OQ-03 | The selected tab, page number, and menu item use dark ink, as the selected chip does. |
| OQ-04 | No switch to turn product approval off. Approval is always required. The moderation on/off setting is removed from the admin settings. |
| OQ-05 | An approved product needs approval again only when its title, description, category, or pictures change. Price and stock changes take effect at once. While it waits for re-approval the product is hidden from the shop. |
| OQ-06 | A rejected or taken-down product can be corrected by the seller and submitted again. |
| OQ-07 | After a failed (mock) payment the items return to the customer's cart and the customer checks out again; the failed order is not retried. Sellers do not see orders whose payment failed. |
| OQ-08 | A seller or admin may cancel an order that is already paid. It is shown as "ยกเลิกแล้ว คืนเงินนอกระบบ" (cancelled, refund handled outside the system); the system records no refund. Cancelled orders are not counted in sales or revenue figures. |
| OQ-09 | If any cart item cannot be bought at checkout, the whole checkout stops until the customer removes or fixes that item. No partial purchase. |
| OQ-10 | Switching a category off removes its products from the whole shop (search, store pages, product pages) and makes them unbuyable. |
| OQ-11 | Sold-out products stay visible, marked "สินค้าหมด". |
| OQ-12 | "Low stock" means 5 or fewer. |
| OQ-13 | In the MVP admins are created only by the bootstrap script. No promotion from the admin screens. |
| OQ-14 | Deactivating a user who owns a store hides the store and its products. |
| OQ-15 | The placeholder marketplace name is "ชื่อแบรนด์". |
| OQ-16 | Admin settings limits: flat shipping fee from 0 to 1,000 THB; commission from 0 to 100 percent. |
| OQ-17 | A shipped order can only become delivered. Cancelling or marking a shipped order lost is not in the MVP. |
| OQ-18 | Orders keep the store name as it was at purchase. A later rename does not change old orders. |
| OQ-19 | Approved: CLAUDE.md rule 7 now carries the D-021 list. This also allows `prisma/seed.ts` to import the database layer. |
| OQ-21 | Server logs are kept 90 days and may be read by system administrators only. |
| OQ-22 | The login's IP address and browser details may be stored with the session and are deleted when the session ends or expires. |
| OQ-23 | When stock drops below a quantity the customer already chose, the quantity is lowered automatically to what is available and the customer is told. |
| OQ-24 | With the quantity above the available stock, the Up arrow key does nothing, the same as the disabled plus button (and Down does nothing below 1). |

### D-026 Owner answers to the second batch of questions
On 2026-10-11 (third session) the owner answered OQ-25 to OQ-50, choosing the recommended option for each. The answers are rules from now on. Where a document was written for a different reading (OQ-35 in DATA_MODEL.md), its owner changes it. The owning documents do not all contain these answers yet; each owner writes them in before the task that depends on them. OQ-20 stays open until milestone 1.

| Question | Answer |
| --- | --- |
| OQ-25 | An order whose payment failed stays visible to the customer in their order history and to the admin, marked as payment failed, with no further action possible on it. (Sellers do not see it, D-025 OQ-07.) |
| OQ-26 | When the items of a failed payment return to the cart and the same product is already there, the quantities are added together, capped at 99 and at the available stock. The customer is told if a cap applied. |
| OQ-27 | An order that fails because the payment system never answered (timeout) returns its items to the cart in the same way as any other failed payment. |
| OQ-28 | Adding a sold-out product to the cart is refused. Asking for more than is in stock lowers the quantity to the available stock and the customer is told. |
| OQ-29 | A product in a cart that sells out stays as a cart line marked "สินค้าหมด". It is not counted in the totals and cannot be bought; the customer removes it. (At checkout D-025 OQ-09 applies.) |
| OQ-30 | The customer is told about a lowered quantity on the cart page and at checkout. If the quantity is found to be too high at the moment the order is placed, checkout stops, shows the new quantity and total, and the customer confirms again. |
| OQ-31 | When a deactivated store owner is reactivated, or a switched-off category is switched on again, the store and its products come back by themselves. |
| OQ-32 | Paid orders of a deactivated store owner are cancelled by the admin by hand. Nothing is automatic. |
| OQ-33 | "Low stock" counts products with 1 to 5 in stock. Sold-out products (0) are shown as a separate figure. Both count only products that are on sale, not drafts, rejected, taken-down, or archived products. |
| OQ-34 | Sales figures add up the price of the goods only, without the shipping fee. The order count includes only paid orders that are not cancelled; an order with only some stores' parts cancelled still counts as one order. |
| OQ-35 | Changing only the order of a product's pictures, or which one is first, does not need approval again. Only adding, removing, or replacing a picture does. |
| OQ-36 | Saving a correction to a rejected or taken-down product sends it back for approval automatically. There is no separate button and no resubmission without a change. |
| OQ-37 | The bootstrap script may be run again to create further admins. |
| OQ-38 | The commission rate is a whole number of percent. No decimals. |
| OQ-39 | A seller cannot create a product in, or move a product to, a switched-off category. The request is refused. |
| OQ-40 | The largest stock quantity a seller may enter for one product is 1,000,000. |
| OQ-41 | A seller sees an order only once it is paid, not while its payment is being processed. |
| OQ-42 | The admin approval queue does not include products the seller has saved but not yet published. |
| OQ-43 | A never-ordered product deleted by its seller disappears from customers' carts without a message. Accepted for the MVP. |
| OQ-44 | Order numbers that count upwards are accepted for the MVP. |
| OQ-45 | Form controls and outline buttons get a darker border on hover, in the main text (ink) colour. Not accent green. The owner sees it on real pages at milestone 1. |
| OQ-46 | The "quantity was lowered" message is "สินค้าเหลือ {available} ชิ้น ระบบปรับจำนวนเป็น {available} ชิ้นให้แล้ว". |
| OQ-47 | "System administrators" who may read server logs are only the named people who operate the servers. The application's `ADMIN` role gives no access to logs. |
| OQ-48 | 90 days is a maximum, not a promise that logs are available that long. It covers every copy, including log backups. Exception: log lines that are evidence in an open security investigation may be kept until the investigation is closed, limited to the relevant lines, with a written record of what is kept and why. |
| OQ-49 | The IP address and browser details of an expired session must be gone within one day of expiry (a daily clean-up is enough). |
| OQ-50 | Database backups are kept 30 days. |

### D-027 When sessions are revoked
Supersedes one phrase of D-004 ("server-side revocation on logout, deactivation, and suspension"); the rest of D-004 stands. Sessions are deleted on logout and when a user is deactivated. Suspending a store does **not** end its owner's sessions: BR-14 requires a suspended store's seller to stay able to log in and fulfil existing orders. The store status is read from the database on every request instead. Detail: DATA_MODEL.md section 6.1.

### D-028 Owner answers to the follow-up questions raised by D-026
On 2026-10-11 (third session) the owner answered the questions the agents raised while writing D-026 into the documents (REQUIREMENTS Q31 to Q37, DATA_MODEL DM-Q8 to DM-Q12, and the open points of API_CONTRACTS section 8.1), choosing the recommended option for each. The answers are rules. Each owner writes them into its document.

| Point | Answer |
| --- | --- |
| What counts as a "correction" that resubmits a rejected or taken-down product (Q31, DM-Q8) | A change to title, description, category, the set of pictures, or the **price** resubmits it. A change only to stock, SKU, or picture order does not. |
| Is a published product still awaiting approval "on sale" for the low-stock and sold-out figures (DM-Q10) | No. It is in neither figure. |
| Is an approved, published product hidden by a suspended store or a switched-off category counted in those figures (Q32, DM-Q11) | Yes, it is still counted. |
| Items of a store's part that was cancelled before the payment failed (Q33, DM-Q9) | They do not return to the cart. Only the parts not already cancelled return. BR-20 "every item" is narrowed accordingly. |
| Telling the customer later that a returned quantity was cut, after a timeout failure (Q34, DM-Q12) | Not required. The cart showing the real quantity is enough. |
| A cart line whose product is hidden (taken down, store suspended, category off) (Q36) | Treated like a sold-out line: it stays, is marked as not buyable now, and is left out of the totals. |
| Bootstrap script given an email that already has an account (Q37) | If the account is already an admin, the script finishes without change. If it is a customer or seller, the script refuses; it never promotes an existing account. |
| What a seller with a suspended store may do besides handling orders | View only: the seller may read their own products, store, and summary. Creating or editing products, adjusting stock, publishing, unpublishing, and archiving are refused until the store is reinstated. |
| Admin dashboard summary figures | All four groups: items waiting for review (pending seller applications, pending products); user count and store count by status; order count; total sales. Order count and sales follow D-026 OQ-34, over all time. |
| May a seller change the store's contact phone | Yes, without approval. |
| Payment timeout | An order still awaiting payment after 15 minutes is failed. |
| Which date the sales report's range uses | The date the order was paid. |
| Thai texts (Q35) | Order mark: "ชำระเงินไม่สำเร็จ". Adding a sold-out product: "สินค้าหมด ไม่สามารถเพิ่มลงตะกร้าได้". Returned quantity cut: "ปรับจำนวนในตะกร้าเป็น {quantity} ชิ้น". |
| May an admin approve or reject a product the seller has not published, by opening it directly | No. Moderation decisions apply only to published products awaiting approval (takedown of a live product is unchanged). |
| Order of the approval queue | Oldest first by the time the product was submitted for approval: publishing a product sets that time, so a long-standing draft does not jump the queue. |
| Session IP address and browser details inside database backups | Accepted: they remain in a backup until that backup is deleted (30 days, D-026 OQ-50). It is stated in the privacy notes, and a restore ends with the expired-session clean-up before the application serves. |

### D-029 Technical rulings on three cross-document disagreements
Made by the orchestrator on 2026-10-11; technical, following the security agent's position, and consistent with the owner's answers.

1. **A `GET` never changes state, with no exception (SECURITY TM-16).** The cart read reports a lowered quantity (derived as stored quantity above stock, stock at least 1) but does not store it. TEST_STRATEGY's "the cart read stores 3" is changed by qa.
2. **Where the lowered quantity is stored.** It is stored by the next mutation. When checkout finds a quantity above stock (stock at least 1), the checkout request itself stores the lowered quantity in the cart and is refused with the new quantities and total; the order is not created. The customer confirms by submitting checkout again (D-026 OQ-30, REQUIREMENTS BR-22 case (b)). API_CONTRACTS section 5.5.3 ("checkout does not lower anything") is changed by backend-api; the transaction shape (savepoint or validate-first) is validated in T-013 and T-032.
3. **`storeId` in a seller request body is rejected as an unknown key** (strict schemas, SECURITY), not ignored. TEST_STRATEGY K5 is changed by qa.

Also confirmed for T-013: the two `OrderItem` columns that record a cart return (`cartQuantityBeforeReturn`, `cartQuantityAfterReturn`) stay in the model; they serve the idempotent replay of a failed checkout even though no later notice is required. The session clean-up needs a scheduled run; choosing it is part of T-015 with devops and supersedes "no scheduled jobs" in the known limitations when it lands.

### D-030 Markdown stays excluded from Prettier
Made by the orchestrator on 2026-10-11; tooling only, no product effect.

`.prettierignore` keeps `*.md`. The documents are hand-formatted, with wide tables and Mermaid blocks, and several agents edit them in parallel: turning Prettier on would rewrite every table in one commit and make each later diff harder to review. The consequence is stated so nobody relies on it: `pnpm format:check` and `pnpm verify` prove nothing about a Markdown file. Documents are checked by review (code-review and the documentation drift audit, T-080), and an agent that edits a document is responsible for well-formed tables and for section references that resolve.

### D-031 Technical rulings after the cross-document check
Made by the orchestrator on 2026-10-11 from the code-review findings X-01 to X-16 and qa's T1 to T12 (TEST_STRATEGY.md "Risks and open concerns"). Technical only; no owner answer is changed. Owner questions found by the same review are parked in STATUS.md.

1. **Versions (X-01).** Prisma is pinned at `7.10.0` for both `prisma` and `@prisma/client` in T-013. The `latest` tag of the `prisma` package pointed at `8.0.0-rc.22` on 2026-10-11; a release candidate is not used, and Better Auth `1.7.7` declares `prisma` and `@prisma/client` `^5 || ^6 || ^7` as peers. T-013 creates the four auth tables from the published schema of Better Auth `1.7.7`; T-015 installs exactly that version. If T-015 has to move to another version, the difference is a corrective migration (DATA_MODEL.md section 6.1). This fills in D-020.
2. **`contentRevision` on a price-only correction (X-02, T2).** Resubmitting a `REJECTED` or `TAKEN_DOWN` product with only the price changed raises `contentRevision` by one, as DATA_MODEL.md section 4.2 says. Reason: an approve sent from a screen opened before the rejection must not put a price the admin never saw on sale. API_CONTRACTS.md sections 3.3 and 5.9.3 and DATA_MODEL.md section 6.6 are corrected to match.
3. **Amounts in a request body (X-09, T6).** A price, total, discount, or fee in a request body is an unknown key: `400 VALIDATION_ERROR`, nothing created or changed, the same as `storeId` (D-029 point 3). This is the strict form of CLAUDE.md rule 3: a client amount is never used. REQ-C-11 keeps its meaning and its wording is changed from "ignored" to "never used; a request that carries one is refused".
4. **Order of refusals (CR-09, T11).** A handler identifies the caller and checks the role before it reads or parses the request body: an anonymous caller gets `401` and a wrong role gets `403` whatever the body contains, and the server does not read a body for a caller it will refuse. Validation (`400`) comes next, then the store-state and ownership checks inside the service (`403 SELLER_NOT_APPROVED`, `404`). CLAUDE.md rule 1 lists what a handler does, not the order. Endpoints that take a body from an anonymous caller (register, login) are limited by rate before the body is read. backend-api writes this into API_CONTRACTS.md section 1.8 and the handler pattern in `src/server/http.ts`; security reviews it.
5. **Mechanism of the refused checkout (X-04, T5).** The outcome in D-029 point 2 is binding. The mechanism is not fixed by the contract: API_CONTRACTS.md describes the outcome only, and DATA_MODEL.md section 7.1's two-transaction shape is an admissible candidate beside the two D-029 names. T-013 validates the candidates; T-032 chooses. If the chosen shape can answer "try again", backend-api gives that answer a code in API_CONTRACTS.md section 2.3 before T-032 starts.
6. **Left to their tasks.** Whether the auth library deleting an expired session during a `GET` is an exception to D-029 point 1 (X-07, T10): auth and security in T-015. The blind resend of a refused checkout (X-05, T1): backend-api and security before T-032; a server-side guard would be an additive migration.
7. **Pinned by T-013 (fills in D-020).** `prisma` 7.10.0 (dev), `@prisma/client` 7.10.0, `@prisma/adapter-pg` 7.10.0, all exact; `pg` 8.23.1 arrives through the adapter and is fixed by the lockfile only. Generator `prisma-client`, output `prisma/generated/prisma` (git-ignored, written by `postinstall`). The CLI configuration file is `prisma7.config.ts`, the first name Prisma 7.10.0 looks for; it loads `.env` with Node's own loader because Prisma 7 does not. Ids are `cuid(2)`; timestamps are `timestamptz(3)`. `pnpm-workspace.yaml` refuses the install scripts of `prisma` and `@prisma/engines`, like the existing entries; the CLI downloads its schema engine on first use. The auth tables keep the names `User`, `Session`, `Account`, `Verification` (not the lower-case names the Better Auth generator emits), which T-015 confirms against the adapter.

### D-032 Rulings after the security review of the order of refusals and the restore procedure
Made by the orchestrator on 2026-10-11, following the security agent's review (SECURITY.md SR-05 item 5 and SR-07 "Restore"). Technical and security only.

1. **Amends D-031 point 4.** On an endpoint whose access level is `seller` (an approved store is required), the store status is judged together with the role, before the rate limit and before the body is read: a suspended seller gets `403 SELLER_NOT_APPROVED` whatever the body contains, and an upload from a suspended store is not read or stored. `requireActor` already loads the store status with the session; the role helper stays role-only and a second pure helper judges store status. The service keeps its own check and the guarded write as the control. Endpoints open to a seller in any store state (orders, reads) judge the role alone. Reason: D-031's own principle, that no body is read for a caller who will be refused.
2. **Accepted as backend-api wrote them, with security's conditions:** origin and content type are checked before identity; the rate limit is consumed after identity and role and before the body is read, and a request that reaches it uses one allowance whatever happens afterwards; `413` comes before `400`; validation makes no database query; `PATCH` on a hidden product's own cart line is `409 PRODUCT_UNAVAILABLE` with reason `NOT_AVAILABLE`. The guarantees for sign-in and sign-up are in SECURITY.md SR-05 item 5 and bind T-015.
3. **Every restore deletes every session, and restrictions are re-applied before the application serves.** A session ended after the backup was taken, and a user deactivated or a store suspended after it, would otherwise be valid again. This is a security requirement (SECURITY.md SR-07), not an owner choice; it closes DEPLOYMENT.md DEP-Q7. Its cost is that everyone signs in once after a restore. Backup encryption and separate storage are also requirements.
4. **New Low findings SEC-022 to SEC-024** (invalid UTF-8 accepted, unbounded JSON nesting, an aborted body logged at error level) are fixed by backend-api in the `src/server` follow-up before the first handler that reads a JSON body is merged; JSON nesting is capped at 32 levels.

### D-033 Owner answers to the parked questions
Answered by the owner on 2026-10-12, one question at a time, in chat. In every case the owner chose the recommended option. The answers are binding; the documents named are updated by their owners and lag until then.

1. **CR-15: the database client is created on first use**, not at import. Importing a module never fails for a missing `DATABASE_URL`, and `next build` and unit tests need no database variable. The missing-variable error appears at the first query, and T-011 env validation reports it at start-up. Owner of the change: database (`src/server/db`). Needed before T-020.
2. **Q38: the mark on a cart line whose product is hidden** is "สินค้านี้ไม่พร้อมจำหน่ายในขณะนี้". It never says why. The string goes into `src/i18n/th.ts`.
3. **Q39: "view only" for a suspended store is confirmed as the documents read it.** A suspended store may not edit the store profile (name, description, logo, contact phone), may not upload, and may not delete a product. No document changes.
4. **Q40: the paid time is shown and can be filtered on.** Order pages for the customer, the seller, and the admin show when an order was paid, and the admin order list can be filtered by paid date, so that it matches the report. `Order.paidAt` already exists.
5. **Q41: the admin dashboard shows one total number of users.** No split into active and deactivated. No document changes.
6. **Filter chips: not decided now.** Chips stay unchanged; the hover border is decided on real pages at milestone 1, with OQ-20.
7. **DEP-Q1: the owner is the only system administrator**, and approves each further person individually.
8. **DEP-Q2: the access list is checked against the real accounts** before every production release and at least every 90 days.
9. **DEP-Q3: the system administrators place and close an investigation hold**, and the owner is told each time.
10. **DEP-Q5: every open hold is reviewed every 30 days**, and the review is added to the record.
11. **DEP-Q6: 30 days is both the longest and the shortest time a database backup is kept**: one backup a day, each kept 30 days and then deleted. A provider plan that costs money is a separate approval.
12. **DEP-Q8: the payment-timeout sweep runs every minute.** An unpaid order is failed within about 16 minutes; the check query allows 20.
13. **DEP-Q9: logs are kept at least 30 days where the chosen host offers it without extra cost.** Anything paid is a separate approval. The 90-day maximum (OQ-48) stands.

### D-034 mysql2 is removed from the dependency tree (SEC-036)
Made by devops on 2026-10-13, following the security review of T-015 and T-016. Technical only.

1. **Cause.** `better-auth` 1.7.7 declares `mysql2` as an optional peer. pnpm installed it (3.15.3), and `pnpm audit --prod` then reported two advisories (GHSA-3f6p-5ww8-9rcr high, GHSA-rgwj-5xj2-c3m3 moderate). The application uses PostgreSQL; in `better-auth`'s `dist` only `test-utils` imports `mysql2`, so the code was not reachable.
2. **Choice.** `overrides: { mysql2: "-" }` in `pnpm-workspace.yaml` removes the package from the resolution. Observed: the lockfile loses `mysql2` and its `denque`, `seq-queue`, and `sqlstring` dependencies, `pnpm audit --prod` exits 0 with "No known vulnerabilities found", and `pnpm install --frozen-lockfile` is clean.
3. **Why not an exception list.** A list of ignored advisories would stay in force for a package that could come back with a new advisory. Removing the package leaves the audit unfiltered: every real advisory still fails it. Raising `mysql2` to a patched version (tried: `>=3.23.1` resolved to 3.24.5) fixes the advisories too but keeps an unused database driver installed and adds `@types/node` to the Prisma peer set.
4. **Reversal.** If the project ever uses MySQL, delete the override in the same change that adds the use.

### D-035 The admin bootstrap writes its rows directly (CR-53)
Recorded by the database agent on 2026-10-13, from the code review of T-015 and T-016 (CR-53), where the orchestrator accepted the code as the correct design and ruled that the documents change. Technical only; BR-26 and D-028 are unchanged.

1. **Choice.** `bootstrapAdmin` (`src/modules/auth/bootstrap-admin.ts`) inserts one `User` (role `ADMIN`) and one credential `Account` with Prisma inside one `$transaction`. It does not call the auth library to create them. The rows have the library's formats: ids from the library's `generateRandomString` (32 characters of `a-z`, `A-Z`, `0-9`), the email trimmed and lower-cased, `providerId` `credential`, `accountId` equal to the user id, and the password hashed with the library's own `hashPassword` (scrypt).
2. **Why.** The library declares `role` with `input: false` (`src/server/auth/auth.ts`), so any user it creates is a `CUSTOMER`. Creating through the library and then updating the role would be an update of an existing row to `ADMIN`, which DATA_MODEL.md section 7.6 forbids and BR-26 relies on. Loosening `input: false` would reopen the escalation that the tests in `tests/integration/auth/guards-and-escalation.test.ts` close.
3. **Proof.** "creates an active ADMIN with a credential account, and the admin can sign in" (`tests/integration/auth/bootstrap-admin.test.ts`): the admin signs in through the application's sign-in route, so the formats are the library's.
4. **Consequence.** The library's `databaseHooks.user.*` do not run for an admin created this way. None is configured today; only `databaseHooks.session.create.before` exists, and it runs when the admin signs in. A change that adds a user hook must make the script do the same work, or record why admins are exempt. The seed (T-014) needs sample sellers, which sign-up cannot create, so it will insert its users the same way.
5. **Documents.** DATA_MODEL.md sections 4.1 and 6.1 say the rows are inserted directly, not "through the auth library".

### D-036 Owner answers: tooling, sign-up, sign-in route, account lock
Answered by the owner on 2026-10-13 (interactive session, thirty-seventh). Items 1 and 2 are done; 3 to 7 are recorded here and wait for an owner agent; 8 and 9 are settled without code change beyond CR-70.

1. **`tsx` added** (`tsx` 4.23.15, exact pin, devDependency). `pnpm admin:bootstrap` can now start (`pnpm exec tsx -e` ran; the script itself has not been run against a database). Its `esbuild` install script is refused with `allowBuilds: esbuild: false` in `pnpm-workspace.yaml`, like the other build scripts; without that line `pnpm install --frozen-lockfile` exits 1 with `ERR_PNPM_IGNORED_BUILDS`. T-014 seed may use `tsx` as its runner.
2. **Playwright added** (`@playwright/test` 1.64.0, exact pin, devDependency) for T-060. The Chromium download (`playwright install chromium`) is not done yet. CR-49 (how e2e reaches a production build) is still to be ruled.
3. **CR-57: sign-up signs the new user in.** After a successful sign-up the response carries the session cookie. Open technical conflict, to be settled by auth and security before it is built: a duplicate email must not be distinguishable from a new one (current behaviour, SEC-035 floor), and a session cookie on one and not the other would reveal it. The owner's wish stands; the likely shape is that a duplicate email also gets a response of the same form and the user signs in normally. Not decided here.
4. **Sign-in route is `/sign-in`.** `src/server/auth/redirect.ts` and `src/proxy.ts` change from `/login` to `/sign-in`; `ROUTES.signIn` is unchanged.
5. **SEC-032 is fixed, not accepted** (owner: "5 fix"). An address that is not the account holder must not be able to lock an account, admins included, out of sign-in. Auth and security propose the mechanism.
6. **SEC-049: the proposed rule is used** (owner: "6 use the proposed rule"). Repeated-word rule plus refusing the prefixes `better-auth-secret` and `integration-test-secret`; devops builds it and flips the `it.fails`.
7. **SEC-041: limit of 3** (owner: "limit it to about 3"). Read as: at most 3 combining marks or kept invisible characters in a row in a name. Natural Thai needs up to 3 (vowel above, tone mark, vowel below), so 3 refuses stacks and keeps real words. Auth confirms the exact scope against the Thai test words before building.
8. **CR-70: the owner takes the orchestrator's recommendation, which is to show the "open store" link at every width** (it is `hidden sm:inline-flex` today). That matches DESIGN_SYSTEM.md and needs no new approval.
9. **Years are shown in the Buddhist era** (2569). This is what `src/lib/format.ts` already does; no change.

10. **The proposal strings in `src/i18n/th.ts` are approved as written** (owner: "10 use as is"): app shell (`skipToContent`, `navLabel`, `search.label`, `cart.label`, `cart.labelWithCount`, footer `navLabel` and `copyright`), `notFound.*`, `errors.*`, `pagination.*`, and the `account.*` texts of the T-030 pages. The frontend agent changes the "proposal" comments to "approved" and DESIGN_SYSTEM.md "Copy guidelines" lists them.
11. **The footer of every page shows the two approved notice pills** `th.notice.mockPayment` ("การชำระเงินจำลอง") and `th.notice.simulatedShipping` ("การจัดส่งจำลอง") (owner: "11 as recommended"). Site-wide, not only on cart, checkout, and order pages. Frontend builds it with the T-018 shell follow-up.

12. **Address cap: 10 saved addresses per user** (owner left the number to the orchestrator). This replaces the earlier note "no cap and no rate limit on addresses per user" (thirty-third session). Enough for home, work, and family; small enough that one account cannot fill the table. Creating the 11th is refused with a validation error and Thai text to be proposed; the count and the insert run under the existing `User` row lock (`FOR NO KEY UPDATE`, DATA_MODEL 7.5) so two parallel requests cannot pass 10. Owner agents: backend-api (module `src/modules/profile/`, API_CONTRACTS 5.3.1, tests), database (DATA_MODEL note), frontend (message and disabled add button).

No owner question is open now.

### D-037 Sign-up signs the user in; decoy cookie for a duplicate email (CR-57)
Auth agent, 2026-10-13, built in `510ebe7`; settles D-036 item 3.

Sign-up answers 200 `{accepted:true}` with one session `Set-Cookie` line in every accepted case. For a new email it is a real session, created by the library's sign-in with the chosen password. For an email that already has an account it is a decoy with the same name, attributes, and value form and no session; nothing changes and nobody is signed in, whatever password was sent. A session the request came with is deleted in both cases. The client learns the outcome from `GET /api/v1/auth/session` and, on `null`, shows the sign-in form with a generic message (REQ-C-01). Residual: that session check reveals whether the email was registered, at one sign-up allowance per probe; unavoidable without email verification.

SEC-041 limit of 3 is built as `NAME_MAX_MARK_RUN = 3` (a run of 4 or more combining marks or U+200B to U+200D is refused). Two stricter rules are not built and wait for an owner answer: U+FE0E/U+FE0F only after an emoji, and no two kept invisible characters in a row.

SEC-032 (D-036 item 5) is proposed, not built: see the SEC-032 entry in `docs/SECURITY.md`. Building it needs `src/server/rate-limit.ts` (backend-api) and a security ruling on the SR-02 capacity split.

### D-038 Owner ruling on SEC-050: give `sign-in-account` a larger capacity share
Owner, 2026-10-14, option (a) of the four in `docs/SECURITY.md` SEC-050.

`sign-in-account` gets a larger share of the limiter's total window budget, taken from the signed-in rules; the total (`MAX_TOTAL_WINDOWS`) does not change. The new share must make filling the rule cost clearly more than 33 new emails per second, and the signed-in rules must still hold their own limits. Built by backend-api; security re-checks.

### D-039 Owner ruling on CR-T021-01 and CR-T021-04 (2026-10-14)

Owner answers: (1) build the GET filter form (price in baht converted to satang server side, category select on search) now; (2) a missing product, store, or category may answer HTTP 200 with the "not found" page, because `notFound()` runs inside Suspense (Next docs). Known cost: crawlers may treat these pages as soft-404; revisit before public launch. E2E must expect 200 plus the not-found content, not 404.

### D-040 Owner rulings on the T-040 questions (2026-10-14)

The owner accepted the orchestrator's recommendation on all three questions raised by T-040 (sixty-third session):

1. **Approval refuses a deactivated applicant.** Approving an application whose applicant has `isActive = false` creates nothing and answers a conflict error; the application stays `PENDING` so an admin can reject it. Reason: a store owned by a deactivated account is hidden anyway (BR-27) and could not be managed. Needs a code change and a test in `src/modules/sellers/` (backend-api), plus the code name in API_CONTRACTS 5.7.1.1.
2. **A store logo may be an upload that is also a product picture of the same store.** The ownership check by `storeId` is the rule; no extra restriction. Reason: uploads are public by design and a link is not a copy (API_CONTRACTS 5.8).
3. **Text limits stay as the agent set them:** store name 100, description 2000, rejection reason 500 characters.

### D-041 Owner ruling on SEC-058: unique store names, rename audit, reserved names (2026-10-15)

The owner accepted the security agent's remediation (a) + (b) + (d) and not (c) or (e):

1. **(a) Unique store names.** A store name is refused when it equals another store's name after NFKC, case folding, and white-space collapsing. Enforced by a unique index on a normalised column, on application, on approval, and on rename. Look-alike letters from other scripts are not caught; this is an accepted residual risk, to be recorded in SECURITY.md.
2. **(b) Rename audit.** Every store rename writes an `AuditLog` row (old name, new name, time, seller as actor) in the same transaction. T-050 shows the history to admins.
3. **(d) Reserved names.** Names that claim to be the marketplace are refused (the placeholder brand name, "admin", "official", and Thai equivalents). The list lives in one module constant; the owner may extend it.
4. **(c) No rename rate limit.** `PATCH /seller/store` keeps no limit (API_CONTRACTS section 6 unchanged).

The SEC-058 `it.fails` case flips to `it` unchanged once (a) lands; a case is added for (b) and (d). Owners: database (column, index, migration), backend-api (`src/modules/sellers`, contract), security (re-check).

### D-042 Owner ruling on SEC-059 and SEC-060: reserved-name matching and look-alike characters (2026-10-15)

The owner accepted the security agent's recommendation on both Low findings raised by the SEC-058 re-check:

1. **SEC-059: options (a) + (b).** A store name is refused as reserved when, after punctuation is stripped, its key contains a reserved key (so `Admin.` and `<site name> Official` are refused, not only an exact match). Accepted side effect: a real store whose name happens to contain a reserved word is refused too; the list stays in `RESERVED_STORE_NAMES` and the owner may trim it.
2. **SEC-060: option (b).** `NAME_ALLOWED_TEXT` refuses the characters that create look-alike names: a doubled sara e, a repeated tone mark, and blank look-alikes such as U+2800. `store_name_key` is not extended and no migration is written. Accepted side effect: the same rule applies to every field that uses `NAME_ALLOWED_TEXT` (sign-up name, profile display name, store text), so those fields refuse these characters too.

Owners: backend-api (`src/modules/auth/schema.ts`, `src/modules/sellers/store-name.ts`, contract), security (flip the SEC-059 and SEC-060 `it.fails` cases and re-check). Frontend needs no new string if the existing reserved and invalid-text messages are reused.

### D-043 Owner ruling on SEC-068 and SEC-069: product limit and rate limit (2026-10-20)

The owner accepted the values proposed in SECURITY.md SEC-068 item 2 and SEC-069 remediation.

1. **Per-store product limit:** 1,000 products that are not `ARCHIVED`. `createProduct` refuses with a 409 before anything is written.
2. **Rate limit on `POST /seller/products` (create) and on publish:** 60 an hour per seller, with `Retry-After` (API_CONTRACTS section 6).

Owners: backend-api (`src/modules/inventory`, `src/modules/uploads`, `src/server/rate-limit.ts`, contract), security (flip the SEC-068 and SEC-069 `it.fails` cases and re-check).

## Pending decisions for the user

Undecided, none blocking the MVP: marketplace name and logo, real product photos, hosting provider for staging and production, production object storage, email provider, payment gateway.

### D-044 Owner rulings on the T-034 checkout UI questions (2026-10-22)

The owner told the orchestrator to take the orchestrator's recommendation for all five questions.

1. New Thai copy stays in `src/i18n/th.ts` as proposals. product-requirements reviews the wording before T-034 is VERIFIED.
2. The "test a failed payment (simulated)" checkbox stays visible to every customer. It is labelled as simulated, and checkout only works with the mock provider outside production. No environment flag.
3. `/orders/{id}` is the order confirmation page. No separate route.
4. Checkout shows the first 50 addresses. A cap on addresses per user (50) is added later by backend-api; no "more" control.
5. After an unknown outcome, "Check status" may resend with the same idempotency key, only when a cart read shows the cart is unchanged (API_CONTRACTS 5.5.3 forbids automatic resend after a 409 only).

### D-045 Owner accepted the name-based residual of the rule 7 lint guard (SEC-081, SEC-083; 2026-10-22, session 105)

After the second re-check of SEC-081 (commit 0a7ea5e) the owner decided: fix the guard for the gaps found, then accept in writing the residual that name-based lint selectors cannot close. Code review is the control for that residual. No module-graph check is commissioned now.

1. The fix: `noInlineConfig` for all code, refusal of the loader and global identifiers outside a plain member access, refusal of `.constructor` and of string-built computed keys, and refusal of imports of `scripts`, `tests`, `e2e`, and `prisma` from `src` (SEC-083). It is listed in docs/SECURITY.md under SEC-081 and SEC-083.
2. The accepted residual is listed in docs/SECURITY.md under SEC-081, "Accepted residual". In short: string keys built from three or more pieces, long pieces, or variables; `Reflect` helpers called by name; a re-export through an allowed folder; any loader reachable through a name the selectors do not list.
3. SEC-081 and SEC-083 close only after security re-checks the fix. A module-graph check over resolved imports may replace the residual later; it needs a new decision.
