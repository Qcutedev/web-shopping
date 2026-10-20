# T-042 security review: seller products and inventory

Reviewer: security agent. Date: 2026-10-20. Commits reviewed: `9c0ff06` (module, routes, tests) and `7aef770` (API_CONTRACTS 5.7.2.1). Tree at review: `dad5469`, then `c55c575` (database agent's SEC-067 index, not part of this review). Register: [../SECURITY.md](../SECURITY.md).

Result: **no Critical or High finding.** Ownership, store scoping, the approved-store check, mass assignment, money and stock bounds, and the stock and picture races hold under every attack tried. Three new findings: **SEC-068** (Medium: pictures of products no admin approved are public, and attaching uploads to drafts lifts the SEC-065 cap), **SEC-069** (Low: no limit on products or publishes, so one seller can fill the approval queue), **SEC-070** (Low: the slug keeps the words of the first title, which no admin may have seen).

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Neither shows that the seller product endpoints are secure.

## Scope

- `src/modules/inventory/{schema,state,errors,repository,service,index}.ts`
- `src/app/api/v1/seller/products/route.ts`, `[id]/route.ts`, `[id]/stock/route.ts`, `[id]/publish/route.ts`, `[id]/unpublish/route.ts`, `[id]/archive/route.ts`
- `src/modules/sellers/service.ts` (`requireApprovedStoreForWrite`), `src/modules/sellers/slug.ts`, `src/server/auth/actor.ts` (`requireApprovedSeller`, `requireRole`)
- `src/modules/uploads/{service,repository,storage}.ts` and `src/app/api/files/[key]/route.ts` (how attached pictures are counted and served)
- `docs/API_CONTRACTS.md` section 5.7.2.1; REQUIREMENTS REQ-S-04 (read for the moderation rules)
- The author's tests `tests/integration/inventory/endpoints.test.ts` and `support.ts` (read, not changed)

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Route guards and their order | Holds. Writes: `assertSameOrigin`, `assertContentType`, `requireActor`, `requireApprovedSeller`, then body and path. Reads: `requireActor`, `requireRole(SELLER)`, then the query. No route reads a store id or imports the database. The no-body writes never read the body. | `t042-inventory.test.ts`, "the six seller product route files" (source order per handler) |
| Role and ownership in the service | Holds. Every write's first statement is `requireApprovedStoreForWrite` (role, approved store, share lock). Every product lookup has the id, `storeId` from the session, and `Store.ownerId = actor.userId`. Every guarded write repeats the store condition. Reads check `SELLER` themselves. | Code read; `t042-inventory.itest.ts` "seven endpoints" case; a seller demoted to `CUSTOMER` after sign-in gets 403 on reads and writes, nothing changes |
| IDOR across stores | Holds. GET, PATCH, PATCH stock, publish, unpublish, archive, DELETE with another store's product id: 404 with the same body as an unknown id, and a whole-database snapshot is unchanged. `?storeId=` on the list is ignored. | Reviewer case. Mutant (product lock without the store condition, swapped in by `vi.mock` in a scratch file, deleted): the case fails at PATCH with `expected 403 to be 404`; the second layer (the store condition in the `UPDATE`) still refuses, so no foreign write happens even then |
| Foreign uploads as pictures | Holds. Another store's upload, another store's logo, and an unknown key give one identical 404 `upload` on create and on edit; no link is written. | Reviewer case; the author's case covers the foreign upload on create |
| Mass assignment | Holds. All three bodies are strict. `storeId`, `ownerId`, `userId`, `id`, `slug`, `status`, `moderationStatus`, `moderationNote`, `moderationRequestedAt`, `contentRevision`, `isSample`, `createdAt`, `updatedAt`, `images`, `uploadIds`, `role`, and `__proto__`, `constructor`, `prototype` as own JSON keys are refused on create, edit, and stock. Stock cannot be set through the edit body. | `t042-inventory.test.ts` "no body can set ..." |
| Moderation | Holds. No seller save yields `APPROVED` from another status; an `APPROVED` product keeps `APPROVED` only for price, picture order, or no change (REQ-S-04). The state table moves `Product.status` only; `ARCHIVED` is final. Publish never sets moderation (author's case). | `t042-inventory.test.ts` "a seller can never reach APPROVED" |
| Price and stock | Holds. Integers only; price 100 to 100,000,000 satang; stock and `set` 0 to 1,000,000; `adjust` non-zero, at most 1,000,000 either way; strings, fractions, `1e21`, `2^31`, `-0` for adjust, arrays, objects refused. Values reach SQL as bound `::int` parameters; the `WHERE` of the stock statements repeats the bounds. | Unit cases; code read |
| Stock race | Holds. 20 parallel `adjust: -1` on stock 10: exactly 10 x 200, 10 x 409, stock 0. 8 parallel `adjust: +5` from 999,990: stock ends at exactly 1,000,000. The product row lock orders them and the guarded `UPDATE` is the backstop. | Reviewer cases (one process, real PostgreSQL) |
| Picture race | Holds. One upload attached at once by two PATCHes and one create: exactly one success, two 409 `UPLOAD_IN_USE`, one link. | Reviewer case |
| Slug | Generated server-side with 40 random bits, never accepted from a client. A collision on every attempt is 409 `SLUG_TAKEN` whose body and log hold neither the slug nor the index name, and nothing is created. Defect: the slug keeps the first title for ever (SEC-070). | Reviewer cases (generator forced by `vi.mock`) |
| Pictures of hidden products served | Defect. `openFile` checks no product status: pictures of `DRAFT`, `REJECTED`, and `TAKEN_DOWN` products are served to an anonymous request (SEC-068). | Reviewer documented case and two `it.fails` |
| Products per store, upload cap | Defect. No limit on products; attaching 50 uploads to 7 drafts frees the cap of 50 unattached uploads (SEC-068). No rate limit on product writes; 60 creates and publishes in a row all enter the queue (SEC-069). | Reviewer documented cases |
| Text fields | Hold. Title, description lines, and SKU refuse U+0000, C0 controls, bidi controls, U+2028, U+2029, U+FEFF. U+200B and U+200C are accepted by the SEC-033 ruling (Thai). Markup is accepted as text; the control is output escaping, and no page renders these fields yet. | Unit cases |
| Error leakage | Holds. 404s carry `details` `{}` or `{ resource }` only; 409s carry a reason only; `DUPLICATE_SKU`, `UPLOAD_IN_USE`, `SLUG_TAKEN` are mapped by index name without attaching the database error. Unmapped errors go to the frame's 500 (class name logged only, reviewed before). | Code read; SLUG_TAKEN case |
| CSRF | Holds. Every write checks `Origin` first and requires `application/json`; reads change nothing. | Source-order cases |
| Injection | Holds. Raw statements are tagged templates with bound values only; `orderBy` is fixed; filter keys come from enums. | Code read |
| Secrets | No secret found by a pattern search of the two commits (passwords, keys, tokens, connection strings). gitleaks and trufflehog are not installed. Neither commit changes a manifest or lockfile, so no dependency audit was run. | `git show 9c0ff06 7aef770` piped to a pattern search; `command -v gitleaks trufflehog` |

## Observations (no finding)

1. An inactive category answers 409 `CATEGORY_INACTIVE` and an unknown id 404 `category`, so a seller can tell whether an opaque category id exists. Category ids are not secret; no gain.
2. A seller transaction share-locks the category row, so an admin's switch-off of a category waits until the seller's write ends (at most the 10 s transaction timeout). Intended (BR-23).
3. With the product lock unscoped (mutant), a foreign write would be 403 instead of 404, which tells the id exists. Today the lock is scoped, so this cannot happen; it shows the second layer works.

## Findings

- **SEC-068** (Medium, OPEN). Pictures whose only reference is a product no admin approved (draft, rejected, taken down) are served without a session, and attaching uploads to throw-away drafts frees the SEC-065 cap. Fix: serve such pictures to the owning seller only; a per-store product and byte limit; a rate limit on product create.
- **SEC-069** (Low, OPEN). No limit on products, publishes, or re-submits; one seller can fill the approval queue.
- **SEC-070** (Low, OPEN). The slug is the first title and never changes; a title no admin saw stays in the public URL.

## Not reviewed

- Pages or components that render seller product text (none exist yet; T-043).
- The admin side of moderation (T-050/T-051), including whether approval checks `contentRevision`.
- Requests through a running `next start`; behaviour across several processes or under load.
- Code review of `9c0ff06` (code-review agent's task).
