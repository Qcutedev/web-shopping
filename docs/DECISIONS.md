# Decision Log

Owner: orchestrator. Add an entry whenever a choice constrains future work. Never rewrite an old entry; supersede it with a new one.

Status values: `PROPOSED` (not yet validated against installed versions or the user), `ACCEPTED`, `SUPERSEDED by D-0xx`.

Every decision below is `PROPOSED`: the stack has not been installed, so version compatibility is unverified. Each is confirmed or revised during T-010.

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
Node.js v24.20.0, npm 11.19.0, pnpm 12.11.2 (Corepack 0.35.0), Docker 29.8.2 with Compose v5.5.1 on WSL 3.0.1.0, git 2.55.0, GitHub CLI 2.102.0. Pinned by T-010 on 2026-10-11 from `create-next-app@16.4.0` defaults: Next.js 16.4.0 (Turbopack, `cacheComponents` and `partialPrefetching` on, as generated), React 19.3.0, TypeScript 5.9.3, Tailwind CSS 4.3.3 via `@tailwindcss/turbopack`, ESLint 9.39.5 with `eslint-config-next` 16.4.0, Prettier 3.9.9, Vitest 5.0.3, Zod 4.6.5. D-002 and D-014 are thereby validated for the scaffold. Prisma, Better Auth, and Playwright versions are pinned when T-013, T-015, and T-060 add them.

## Pending decisions for the user

Undecided, none blocking the MVP: marketplace name and logo, real product photos, hosting provider for staging and production, production object storage, email provider, payment gateway.
