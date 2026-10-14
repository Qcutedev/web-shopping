# T-040 seller application and store security review

Reviewer: security agent. Date: 2026-10-15. Commits reviewed: `6c2112c` (module), `fafd73d` (routes, contract, integration tests), `10373b7` (D-040 point 1, `APPLICANT_INACTIVE`). Tree at review: `d3a770b`; tests committed in `458040e`.

Result: **no Critical, High, or Medium finding.** One new Low finding, SEC-058 (store names are not unique, renames are unlimited and unrecorded). Register: [../SECURITY.md](../SECURITY.md).

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Neither shows that the seller module is secure.

## Scope

- `src/modules/sellers/` (`schema.ts`, `service.ts`, `repository.ts`, `errors.ts`, `state.ts`, `slug.ts`, `index.ts`)
- `src/app/api/v1/seller/application/route.ts`, `src/app/api/v1/seller/store/route.ts`
- The `FOR SHARE` store lock (`lockStoreIfApproved`, `requireApprovedStoreForWrite`)
- The D-040 point 1 approval path (`APPLICANT_INACTIVE`), and D-040 point 2 (logo reuse)
- `docs/API_CONTRACTS.md` 5.7.1 and 5.7.1.1
- Read for context: `src/server/auth/actor.ts`, `src/server/auth/session.ts` (how the actor is built), `src/modules/auth/schema.ts` (`NAME_ALLOWED_TEXT`), `src/modules/profile/schema.ts`, `prisma/schema.prisma` (`Store`, `SellerApplication`, `Upload`, `ProductImage`), `src/server/rate-limit.ts` (`SELLER_APPLICATION`), storefront components that render `store.name`.

Not in scope, not built: the admin endpoints that expose approve and reject (T-050), uploads (T-041), seller products (T-042), the seller dashboard pages.

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Role checks | Hold. Each service checks the role itself: `submitApplication` `CUSTOMER` and no store; `getOwnStore` `SELLER`; `updateOwnStore` and `requireApprovedStoreForWrite` an approved seller; approve and reject `ADMIN`. `getOwnApplication` reads only `actor.userId`'s rows. The routes repeat the check earlier. | Code read; `t040-sellers.itest.ts` "services hold without the route's guard" (stale `CUSTOMER` actor whose database role is `SELLER`: 403, nothing written; `CUSTOMER` with a store row: 403; deactivated user: 401) |
| Ownership and tenant isolation | Hold. Every store query has `id = actor.storeId AND ownerId = actor.userId`; `actor` comes from the database per request (`session.ts:67`). No route reads an id from the URL or query; `storeId`, `ownerId`, `userId` in a body are 400. A forged actor naming another seller's store reads and writes nothing (404, `details` `{}`, database unchanged). | `t040-sellers.itest.ts` "a forged actor naming another seller's store"; author's cases in `tests/integration/sellers/endpoints.test.ts` (query and body ids) |
| Mass assignment, privilege escalation | Hold. Both bodies are `z.strictObject`; `status`, `statusReason`, `slug`, `ownerId`, `storeId`, `userId`, `role`, `isSample`, `logoUploadId`, `reviewNote`, `id` are refused, and so are `__proto__`, `constructor`, `prototype` (also through the real `readJsonBody`). The only writes to `role` and store `status` are the admin approval (guarded `WHERE role = 'CUSTOMER' AND isActive = true`) and nothing else. The service builds the repository input field by field; no request object is spread into a write. | `t040-sellers.test.ts` "privileged and prototype keys are refused", "the module never spreads a request body"; `t040-sellers.itest.ts` "prototype keys through the real JSON reader" |
| `storeId` from the session only | Holds. `requireApprovedSeller(actor)` returns `actor.storeId`; the store route file never mentions `storeId`. | `t040-sellers.test.ts` PATCH order case (`not.toMatch(/storeId/)`) |
| Order of refusals (API_CONTRACTS 1.8) | Holds as documented: POST application: Origin, Content-Type, session, role, `seller-application` limit on the user id, body, schema, service. PATCH store: Origin, Content-Type, session, approved seller (before the body, D-032), body, schema, service. GET: session first. Every handler runs in `handleRequest` (`no-store`). | `t040-sellers.test.ts` route cases (source order) |
| Store lock (`FOR SHARE`) | Holds in both orders. Author's case: a held share lock makes a suspension wait. Reviewer's cases, the reverse: a suspension already in flight (row updated, uncommitted) makes `requireApprovedStoreForWrite` and `updateOwnStore` wait; once the suspension commits, both refuse `SELLER_NOT_APPROVED`, and the name is unchanged. PostgreSQL re-reads the row after the wait, so the `status = 'APPROVED'` condition is judged on the committed value. | `t040-sellers.itest.ts` "a suspension already in flight wins over a seller write" (each case also asserts the write had not settled after 200 ms) |
| D-040 point 1 (`APPLICANT_INACTIVE`) | Holds. The approval locks the application, then the applicant row (`FOR NO KEY UPDATE`), refuses an inactive applicant before any write, and the role update also carries `isActive = true`. Lock order application, then user, matches submission (user only), so they cannot deadlock: a submission that holds the user row sees the application still `PENDING` and returns 409 without inserting. | Code read; author's cases in `tests/integration/sellers/decisions.test.ts` (inactive refused, deactivation committed during the wait is seen); full integration run |
| D-040 point 2 (logo reuse) | Holds. `logoKey` is resolved by `storageKey` and `storeId`; an upload that is also a product picture of the same store may be the logo (200); another store's picture or logo is 404 `upload`, identical to an unknown key, nothing changes. | `t040-sellers.itest.ts` "logo reuse rule (D-040 point 2)" |
| Name rule reuse | Holds. `storeNameSchema` is `trim().min(1).max(100).regex(NAME_ALLOWED_TEXT)`, the same rule as sign-up and profile names; each non-empty description line must satisfy the same regex; LF is the only stored line break. On 25 probes (bidi overrides and isolates, U+2028/2029, NEL, VT, NUL, private use, unassigned, variation selector, tag, soft hyphen, Arabic letter mark, Hangul filler, Braille blank, lone surrogate, 3 and 4 combining marks, 3 and 4 zero-width spaces, Thai with tone marks, markup) the store name, sign-up name, profile name, application, and description line accept and refuse exactly the same strings. Store names render through `<UserName>` in the three storefront components that show them. | `t040-sellers.test.ts` "store names and description lines follow the user-name rule"; `Grep` for `store.name` in `src/**/*.tsx` |
| Input cost | Holds. The largest body the reader admits (100 KiB) in a name, description (one line, 50,000 lines, 100 lines of 1,000, mark runs), or logo key is refused in under 250 ms each (well under in practice). | `t040-sellers.test.ts` "parsing the largest body the reader admits is cheap" |
| Information leaks | None found. Store shape has no `ownerId` or `logoUploadId`; application shape has no `userId` or `reviewedById`, and `reviewNote` only when `REJECTED`. 404 for an unknown and a foreign `logoKey` is the same body. Errors carry no cause to the client (`AppError`); the repository logs nothing. Public store pages do not return `contactPhone` (only the seller's own view does). | `t040-sellers.test.ts` "response shapes carry no internal id"; code read of `errors.ts`, `request-frame.ts` |
| Rate limits | `seller-application` 3 per 24 h on the session's user id, after the role check, before the body; a refusal is a throttled security event. `PATCH /seller/store` has none, by contract (section 6); see SEC-058 (c). The SEC-052 saturation risk of signed-in rules now applies to `seller-application` too (residual risks updated). | Code read; author's integration case for the limit |
| CSRF | POST and PATCH call `assertSameOrigin` and `assertContentType` first; GETs change nothing. | Route source order case |
| SQL injection | Raw SQL is tagged-template `$queryRaw` with bound parameters only; no `orderBy` or filter key from input. | Code read |

## Findings

### SEC-058 Store names are not unique, a seller may rename at any time, and no rename is recorded (Low, OPEN)

Full entry in [../SECURITY.md](../SECURITY.md). Any approved seller can take another store's exact display name, or one that claims to be the marketplace, as often as it likes; nothing is reviewed, rate-limited, or recorded (`AuditLog` gets no row; `Store` keeps only the current name). Look-alike letters of other scripts pass the name rule, so an exact-match uniqueness check alone would not stop copies. Reproduction: `tests/security/t040-sellers.itest.ts` describe "SEC-058": the documented case (20 renames, all 200, the other store's exact name, no audit row) and one `it.fails` that, flipped, fails with `expected 200 not to be 200`. Owner decides among: normalised uniqueness, an audit row per rename, a rename limit, reserved names, or written acceptance.

### Observations (not findings)

1. **Deadlock hazard for later tasks.** `requireApprovedStoreForWrite` takes `FOR SHARE`. Two seller transactions that both hold it and then `UPDATE "Store"` (for example a counter or `updatedAt`) deadlock (lock upgrade). Product inserts and updates take only `FOR KEY SHARE` on the store through the foreign key, which is compatible. T-041, T-042, T-043 must not update the store row after this call, or must take `FOR NO KEY UPDATE` instead. Recorded in SECURITY.md residual risks.
2. **Owner deactivation is not re-checked under the lock.** `lockStoreIfApproved` checks store status and owner, not `User.isActive`. Deactivation deletes sessions and the actor is read per request, so the window is one request already past `requireActor`. Recorded as residual.
3. **Approval of a `CUSTOMER` who already owns a store row** (forbidden by the data model) hits `Store_ownerId_key`, is retried as if it were a slug collision three times, then becomes 500 with nothing stored. Fails closed; a clearer outcome is the code reviewer's call.
4. **`seller-application` is consumed before the body is validated**, so a client with invalid bodies spends its own three daily attempts. By contract (section 6); affects only the caller.
5. **Stale contract text.** `docs/API_CONTRACTS.md` 5.7.1.1 says "Not security-reviewed; the route list guard ... names neither route yet". Both are no longer true (backend-api to update).

## Tests added or changed

- `tests/security/t040-sellers.test.ts` (new, 16 plain cases): route order and thinness, name-rule parity, prototype and privileged keys, parse cost, response shapes.
- `tests/security/t040-sellers.itest.ts` (new, 10 plain cases, 1 `it.fails` for SEC-058): suspension in flight, stale and forged actors, prototype keys through the reader, logo reuse both ways, SEC-058.
- `tests/security/t020-t018-catalog-shell.test.ts`: the two seller routes added to `REVIEWED_NON_CATALOG_ROUTES` after this review. No assertion changed.
- `tests/security/sec046-047-recheck.test.ts`: the two slowest cases ("the list is complete for the installed library", about 0.2 s alone; "random values ... 20,000 per form", about 2.1 s alone) get a 60 s timeout. Assertions, counts, and thresholds unchanged.

## Commands run

- `pnpm exec vitest run tests/security/t040-sellers.test.ts tests/security/sec046-047-recheck.test.ts` -> exit 0, 2 files, 33 passed
- `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t040-sellers.itest.ts` -> exit 0, 10 passed, 1 expected fail
- SEC-058 `it.fails` flipped in a scratch copy `tests/security/zz-flip.itest.ts`, `-t "cannot take"` -> exit 1, `AssertionError: expected 200 not to be 200`; copy deleted
- `pnpm exec prettier --write` and `pnpm exec eslint` on the four test files -> eslint exit 0; `pnpm typecheck` -> exit 0
- `pnpm test` -> exit 0, 130 files, 3576 passed, 5 expected fail
- `pnpm test:integration` (Docker up) -> exit 0, 38 files, 1072 passed, 2 expected fail (SEC-053, SEC-058)
- `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t015-t016-auth.itest.ts tests/integration/auth/limits-and-cookies.test.ts -t "SEC-032|per-account limit"` -> exit 0, 5 passed (SEC-032 integration cases; the stale "not run" note in SECURITY.md is corrected)
- `pnpm exec vitest run --project security` -> exit 0, 25 files, 931 passed, 5 expected fail
- `pnpm audit --prod` (pnpm 12.11.2) -> exit 0, no known vulnerabilities; `pnpm audit` -> exit 1, 2 high (`braces`, `deepmerge-ts`, development only, SEC-010, unchanged). T-040 changed no manifest.
- `gitleaks` -> not installed; no secret scan was run. By reading, the T-040 commits add no secret, token, or credential.

## Not run

- Requests through a running `next dev` or `next start` server: handlers were called in process.
- A mutation run of `src/modules/sellers` (the code is not security's to change); the lock cases do show the waiting by timing.
- Browser rendering of store descriptions and logos (no page shows them yet).
- The SEC-057 flip in `9a8d77b` and the other open findings were not re-checked; their statuses are carried over.
