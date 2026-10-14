# T-031 cart security review

Date: 2026-10-14. Reviewer: security agent. Commit reviewed: `7ddfcd1` (cart code unchanged at `caa356b`). While this review ran, backend-api committed the code-review follow-ups `5b41754`, `1199ff5`, `4e05d06`, `eed95a9`, `05c6bcd` (CR-T031-02 to -06). The tests below were run against both `caa356b` (detached worktree) and `05c6bcd` (working tree); the follow-up diffs were read only where they changed the repository calls (`setLineQuantity` now `updateManyAndReturn`, the picture read inside the transaction). Findings register: [SECURITY.md](../SECURITY.md).

Verdict: no Critical or High finding. Two new Medium findings (SEC-053, SEC-054), both needing an owner or contract decision. Ownership, mass assignment, quantity bounds, and server-side amounts hold at unit level. That is not proof that the cart is secure: the database-level controls (lock, transaction, constraints, concurrency) are untested until `tests/integration/cart` exists and runs (code-review CR-T031-01).

## Scope

- `src/modules/cart/` (`schema.ts`, `service.ts`, `repository.ts`, `pricing.ts`, `errors.ts`, `index.ts`)
- `src/app/api/v1/cart/route.ts`, `items/route.ts`, `items/[itemId]/route.ts`
- Supporting code read: `src/server/auth/session.ts` (`requireActor`, `loadActor`), `src/server/request-frame.ts`, `src/server/errors.ts` (`AppError`), `src/modules/catalog/visibility.ts`, `src/modules/catalog/image.ts`, the `Cart` and `CartItem` constraints in `prisma/migrations/20261011121529_init_schema_v1/migration.sql`
- Contract: `docs/API_CONTRACTS.md` sections 5.4, 5.8 (serving), 6

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Authentication | Every handler calls `requireActor` first after the origin and content-type checks; `loadActor` refuses an inactive user | Read |
| IDOR on `{itemId}` | Holds. The cart id comes from `SELECT ... FOR UPDATE WHERE "userId" = <session user>`; every line query has `{ id, cartId }`; a foreign id and an unknown id give the same `404` with `details: {}`; a user without a cart gets `404` and no cart is created | `t031-cart.test.ts` "T-031 ownership" (7 cases); 2 mutants (dropping `cartId` from `findLineInCart`, from `deleteLineInCart`) each fail 1 or 3 cases |
| Raw SQL | One tagged-template `$queryRaw` with the user id as a bound parameter | Test "the cart lock is a parameterised query" |
| Mass assignment | Bodies are `z.strictObject`: `priceSatang`, totals, `userId`, `storeId`, `cartId`, `stock`, `__proto__`, `constructor` are all refused on POST and PATCH | 22 cases |
| Quantity bounds | `z.number().int().min(1).max(99)`; 0, -1, 100, 1.5, "5", 1e308, 2^31, 2^53, null, true, arrays, objects refused; add above 99 refused with the line unchanged; DB check `CartItem_quantity_check` 1 to 99 as a second layer | 15 cases; migration read |
| Server-side amounts | Price, stock, and fee read from the database on every request; no price stored in the cart; integer satang with `assertSatang` (safe-integer, non-negative); a price change shows in the next read | Test "a price change after the add is what GET charges" |
| Stock | No cart write changes `Product.stock`; a request above stock stores the stock | 2 cases |
| BR-16 own store | Seller adding own product: `409 OWN_STORE`, nothing stored; `storeId` from the session's database read | Test |
| Hidden vs missing product | Same public error | Test |
| Error leakage | Unexpected errors become `500` with fixed message and `{}` details (`AppError`, SEC-017); the Prisma P2025/P2003 race (CR-T031-02) gave a generic 500 at `7ddfcd1`, fixed as 404 in `5b41754` | Read |
| CSRF | `assertSameOrigin` on POST, PATCH, DELETE; GET writes nothing | Read |
| Caching | `ok()` sets `Cache-Control: no-store` (SEC-006) | Read |
| Rate limits (SR-02, SEC-052) | No cart endpoint calls the limiter, by contract section 6; so the cart adds nothing to SEC-052's shared-capacity problem. The cost is unbounded request count (residual risks) and unbounded cart size (SEC-053) | Read |
| Hidden-line content | Returns current title, slug, and picture of a hidden product (SEC-054) | Test |
| Dependencies | `7ddfcd1` changes no manifest or lockfile, so no audit run | `git show --stat 7ddfcd1 -- package.json pnpm-lock.yaml` |
| Secrets | No secret scanner installed (`Get-Command gitleaks` empty). The new files were read; they hold no credential | Read |

## Findings

- SEC-053 (Medium, OPEN): a cart holds any number of distinct lines; every read and the future checkout work on all of them. Owner decision: the maximum.
- SEC-054 (Medium, OPEN): a hidden cart line shows the product's current title, slug, and picture, so a seller's unapproved edit or an admin-taken-down picture reaches customers holding the line. Contract decision: the shape of a `NOT_AVAILABLE` line.

Observations, not findings:

- `GET /cart` reads lines, visibility, and fee in three statements without a transaction; a write between them can make one response inconsistent. Display only; checkout must re-read under its lock (T-032).
- An admin can hold a cart (contract: access `user`). Not a security issue.
- Exact stock is returned in the cart; the product detail already makes it public (API_CONTRACTS 5.2).
- For T-032: the cart totals are safe integers in JavaScript, but `99 * priceSatang` summed over lines can pass the 32-bit `Int` range of an order column. Checkout must check the total against the column type before insert.

## Tests added

`tests/security/t031-cart.test.ts`: the real cart service and repository against an in-memory stand-in for the Prisma client that applies each query's `where` and records it. 54 cases: 52 pass, 2 `it.fails` for SEC-053 and SEC-054 (flipped to `it` in a scratch copy, each failed on its flaw assertion). It proves the shape of the queries and what the service does with their results, not what PostgreSQL does.

## Not run

- `pnpm test:integration`: Docker down; and `tests/integration/cart` did not exist.
- `pnpm verify`, `pnpm build`: excluded by the orchestrator.
- Any HTTP request against a running server.
- `pnpm audit`: no dependency change in the reviewed commit.
- A secret scanner: none installed.
