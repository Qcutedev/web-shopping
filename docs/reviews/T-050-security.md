# T-050 security review: admin module and /api/v1/admin route handlers

Reviewer: security agent. Date: 2026-10-23. Commits reviewed: `e57e3c7` (module, routes, unit tests), `961e568` (API_CONTRACTS 5.9.8), `c25a89e` (integration tests), `f57d929` (test helper lint fix). Tree at review: `f57d929`, with uncommitted work by other agents in progress: backend-api's code-review fixes in `src/modules/admin/repository.ts`, `service.ts`, `state.ts` and `tests/integration/admin/endpoints.test.ts` (CR-T050 items: activation values from the state table, the category foreign-key check narrowed to `Product_categoryId_fkey`), and frontend's T-051 files under `src/components/admin/`, `src/lib/api-client/admin.ts`, `src/i18n/th.ts`. The backend diff was read; none of it changes a finding below. Register: [../SECURITY.md](../SECURITY.md).

Result: **no Critical finding in the admin module.** The admin-only guard holds on all 26 handlers and in all 26 service functions; session revocation, self-deactivation, the last-admin rule, audit rows, input limits, mass assignment, and the money and stock changes hold. Two new findings:

- **SEC-088 (Medium):** a request of an admin that passed the guard before that admin was deactivated still completes its write, audited under the deactivated admin's id. Needs an owner answer on D-024 (TEST_STRATEGY T12).
- **SEC-089 (High, not in T-050's code):** `pnpm audit --prod` reports two critical remote-code-execution advisories and one high denial-of-service advisory for the installed `next` 16.4.0, patched in 16.4.1. Under AGENT_WORKFLOW.md "Review gates" item 4, admin work is not done while a High finding is open.

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Neither shows that the admin endpoints are secure.

## Scope

- `src/modules/admin/service.ts`, `repository.ts`, `schema.ts`, `state.ts`, `mapping.ts`, `errors.ts`, `index.ts`
- The 23 route files under `src/app/api/v1/admin/` (26 handlers)
- `src/server/auth/session.ts` (`loadActor`, `requireActor`), `src/server/auth/actor.ts` (`requireRole`)
- `src/modules/sellers/service.ts` and `repository.ts` (`approveApplication`, `rejectApplication` and their rows), `src/modules/orders/state.ts` (fulfilment table), `src/modules/orders/seller-repository.ts` (`claimAndRestoreStock`, `markShipmentDelivered`), `src/modules/catalog/visibility.ts` (owner and category flags), the settings CHECK constraints in the first migration
- REQ-A-01 to REQ-A-10, BR-17, BR-20, BR-21, BR-26 to BR-28, D-024, D-027, DATA_MODEL.md 6.17
- The author's tests `tests/integration/admin/endpoints.test.ts` (case list read, run, not changed)

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Admin-only guard on every route | Holds. Each of the 26 handlers calls `requireActor(request)`, then `requireRole(actor, "ADMIN")` (the only role check), before reading the path, query, or body; reads never read a body and never call the CSRF helpers; each handler passes `actor` first to exactly one service function. Exactly 23 route files exist under `admin/`. | `t050-admin.test.ts`, describe "the admin route files" (one case per file, one per handler) |
| Role check in the service (TM-07) | Holds. All 26 exported service functions call `adminId(actor)` (= `requireRole(actor, "ADMIN")`) before any repository call; write functions evaluate it as an argument, so it throws before the repository runs. With the admin repository, the sellers decisions, and `db` replaced by traps, every function is 403 FORBIDDEN for a customer and for a seller with zero repository, sellers, or database calls; an admin actor reaches the trap (control). The application decisions also check the role inside the sellers module. | Same file, describe "every admin service function refuses a customer and a seller first" (52 cases plus control and coverage case) |
| Guest, customer, seller on real PostgreSQL | Holds (author's case, run by this review): guest 401, customer and seller of either store status 403 on all 26, nothing changes. | `tests/integration/admin/endpoints.test.ts` "every admin endpoint rejects non-admins" |
| Deactivated admin | Holds for the session: deactivation deletes every session of the target in the same transaction, and `loadActor` refuses an inactive user on every request. The deactivated admin's old cookie is 401 UNAUTHENTICATED on all 26 handlers with no database change. **Fails for an in-flight request** (SEC-088): no write transaction re-reads the acting admin. | `t050-admin.itest.ts` "the deactivated admin's old cookie is 401 on every admin handler"; "SEC-088" (2 `it.fails`) |
| Self-deactivation, self-demotion | Holds. `userId === adminId` is refused with 409 SELF_DEACTIVATION before any lock or write. No endpoint or statement changes a role (BR-26): no body schema has a `role` field, no `data:` writes `role`, no raw `SET "role"`. | Static repository case; strict-body cases; author's "cannot deactivate themselves", "no body or query can set a role" |
| Last admin | Holds. For an admin target every active admin row is locked `FOR UPDATE` in id order and counted; one left is 409 LAST_ADMIN. Two admins deactivating each other at the same moment: exactly one 200, the other 401 or 409, one active admin remains (5 rounds). | `t050-admin.itest.ts` "two admins deactivating each other at once"; author's "last active admin" case |
| Session revocation | Holds. `tx.session.deleteMany({ where: { userId } })` in the deactivation transaction; count recorded in the audit metadata. Reactivation restores no session. Store suspension does not end sessions, by D-027. | Static case; itest (0 sessions after deactivation) |
| Audit log completeness (REQ-A-10) | Holds. Each of the nine write transactions (deactivate, reactivate, store move, moderation decision, category create, update, delete, seller-order move, settings) contains exactly one `writeAudit(tx, ...)` with `actorId: adminId`; refusals return before it or roll back; no-op category and settings changes write nothing. The two application decisions write theirs in the sellers module. No file under `src` updates or deletes an `AuditLog` row. A body naming `actorId` is 400 and writes nothing; the real row names the session's admin. Metadata holds reasons and before/after values, no token, hash, IP, or browser detail. Gap: append-only is not enforced in the database (residual risks). | Static cases "every write function writes exactly one audit row", "nothing in src updates or deletes an audit row"; itest "the audit actor is the session's admin only" |
| Input limits | Holds. Ids 1 to 200 characters, no U+0000, no lone surrogate; `q` at most 100 after trim, matched as plain text (`%`, `_`, `\` escaped); every list capped at 50 rows; a repeated parameter is 400; reasons 1 to 500 characters (sellers' rule); category names 1 to 100 under the name rule (C0, bidi controls, U+2028, U+FEFF refused; U+200B accepted, which is SEC-041, already open); `sortOrder` 0 to 1,000,000; `contentRevision` 1 to 2^31-1; audit `action` and `targetType` a word pattern; dates need an explicit offset and `from < to`. Body size is the shared `readJsonBody` limit (reviewed earlier). | Schema cases in `t050-admin.test.ts` |
| IDOR | Not applicable in the usual sense: an admin may read every row by design, so no query is owner-scoped. The control is the role, checked above. Unknown ids are 404 with a fixed body. | Author's "an unknown id is 404 and writes nothing" |
| Mass assignment | Holds. Every body is `z.strictObject`; `role`, `userId`, `actorId`, `storeId`, `status`, `moderationStatus`, `isActive` (except on category PATCH, where it is a listed field), `isSample`, `slug`, `requireProductApproval`, `priceSatang`, `stock`, `paymentStatus`, `__proto__`, `constructor` (spread and raw-JSON forms) are 400. The service copies each field by name; no request object is spread into a write. Unknown query keys (for example `orderBy`) are stripped, not interpreted. | Strict-body cases (8 schemas x 15 keys x 2 forms); static "no request object is spread" case |
| Money and settings | Holds. Shipping fee integer satang 0 to 100,000; commission integer basis points 0 to 10,000 in steps of 100; non-integers, strings, `NaN`, `Infinity`, `1e20`, out-of-range values are 400; database CHECKs back both. The change is under a `FOR UPDATE` lock with `updatedById` from the session. Existing seller orders keep their copied values. | Settings schema case; migration CHECKs read |
| Stock and fulfilment moves | Holds. An admin may cancel from `PENDING` or `PROCESSING` and deliver from `SHIPPED`, never on a failed order (all 30 combinations checked). The seller-order row is locked `FOR UPDATE OF so`; the guarded `UPDATE` takes its source states from the same table; cancel restores stock through the claim (`stockRestoredAt IS NULL ... RETURNING`), so at most once per item even against a concurrent payment failure; deliver sets the shipment time once. Payment is never touched (BR-21). | `adminMayMove` case; code read; author's "cancel restores stock once", "failed order", "cancel before payment" cases |
| Moderation | Holds. Approve and reject need `PENDING` and `PUBLISHED`; takedown needs `APPROVED`; the revision the admin saw must equal the stored one, checked under the row lock and repeated in the guarded statement, so content changed after review cannot be approved. No setting turns approval off (BR-17). | Code read; author's moderation cases |
| Injection | Holds. Raw statements are tagged templates with bound values; the one `Prisma.join` is over the constant source states of the fulfilment table; no `Unsafe` call, no `Prisma.raw`. Order by is fixed in every list. | Static injection case |
| Error leakage | Holds. 404 and 409 errors have fixed bodies and reasons (`SELF_DEACTIVATION`, `LAST_ADMIN`, `STALE_REVISION`, `CATEGORY_HAS_PRODUCTS`, `INVALID_STATE_TRANSITION`); unexpected `Error`s and Prisma errors go to the frame's 500 with fixed public text (reviewed under SEC-017, SEC-048). DTOs are built key by key: no password hash, session, or session address or browser detail. The module does not log. | Code read of `errors.ts`, `mapping.ts` |
| CSRF | Holds. Each of the 14 mutations checks `Origin`, then `Content-Type: application/json`, before the session; the four body-less mutations (deactivate, reactivate, approve application, delete category) still require both headers and read no body; `GET` changes nothing. | Route source-order cases |
| Visibility after deactivation or category switch-off | Holds as specified: the catalog's visibility rule reads the owner's `isActive` and the category's `isActive` (BR-23, BR-27). | `src/modules/catalog/visibility.ts` read |
| Rate limits | None on admin endpoints (contract section 6). Admin-only; listed under residual risks. | Contract read |
| Secrets | Pattern search of the four commits: 0 matches. gitleaks not installed. | `git show e57e3c7 961e568 c25a89e f57d929` with PowerShell `Select-String`; `Get-Command gitleaks` empty |
| Dependencies | **SEC-089**: `next` 16.4.0 has GHSA-2464-fhr4-w9xw (critical), GHSA-673q-mjm6-r5xr (critical), GHSA-p3m5-59mp-jv5r (high). | `pnpm audit --prod` |

## Findings

Full entries, with reproduction and remediation, are in [../SECURITY.md](../SECURITY.md).

- **SEC-088 (Medium, OPEN):** deactivated admin's in-flight request still completes. Reproduction: `tests/security/t050-admin.itest.ts`, describe "SEC-088", 2 `it.fails`; flipped to `it` they failed with `AssertionError: expected 'done' to be an instance of AppError` (admin C deactivated and the commission changed by an admin already deactivated). Remediation: check the acting admin's row (`FOR SHARE`, active `ADMIN`) first in every admin write transaction, and in the two sellers decisions; or the owner accepts it in D-024.
- **SEC-089 (High, OPEN):** upgrade `next` and `eslint-config-next` to 16.4.1 or later before any deployment.

## Route-list gate

The 23 admin route files are added to `REVIEWED_NON_CATALOG_ROUTES` in `tests/security/t020-t018-catalog-shell.test.ts`, each after its guard was read and checked by `t050-admin.test.ts`. Run together: 2 files, all passed (218, later 231).

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/security/t020-t018-catalog-shell.test.ts tests/security/t050-admin.test.ts --project security` | 2 files, 218 passed; 231 on a later run (t050-admin.test.ts 126; the gate file 92, then 105, as frontend added component files the gate enumerates) |
| `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t050-admin.itest.ts` | 3 passed, 2 expected fail |
| The same with both `it.fails` flipped to `it` (file restored afterwards, BOM removed) | 2 failed: `expected 'done' to be an instance of AppError`; 3 passed |
| `pnpm exec vitest run --config vitest.integration.config.mts tests/integration/admin` | 30 passed, 1 failed: `only the Product.categoryId key is read as CATEGORY_HAS_PRODUCTS (CR-T050-06)`, a case backend-api was adding together with uncommitted repository changes at that moment; not this review's code |
| `pnpm exec vitest run --project security` | 41 files, 1517 passed, 32 expected fail, 1 failed: `sec033-rendering-recheck.test.ts` SEC-057 "every product title read in storefront source is isolated or pinned" lists six uncommitted T-051 files under `src/components/admin/` (`action-button.tsx`, `admin-frame.tsx`, `audit-section.tsx`, `products-section.tsx`, `stores-section.tsx`, `users-section.tsx`); the T-051 review must look at them |
| `pnpm typecheck` | exit 2, only in uncommitted frontend files (`src/components/admin/list-view.tsx`, `orders-table.tsx`: missing `./format-count`; `src/i18n/th.ts:1169`: duplicate key); no error in the test files |
| `pnpm exec eslint` and `pnpm exec prettier --check` on the three test files | 0 problems; formatted |
| `pnpm audit --prod` (pnpm 12.11.2) | 3 vulnerabilities, 1 high, 2 critical, all `next` (SEC-089) |
| `docker compose up -d --wait db-test` | test database container started (it was stopped) |

Not run: `pnpm build` (told not to), e2e, `pnpm test` for all projects, the full integration suite.

## Not covered

- The admin pages and components (T-051, in progress by frontend); how they render seller and customer text (TM-15), and the SEC-057 rendering gate entries above.
- T-052 (admin permission suite) does not exist yet; TM-07 stays PARTIAL until it does.
- Concurrency between an admin store suspension and a seller write, and between an admin cancel and a seller move, was read in the lock order but not raced by this review (the author's race cases were run).
- The advisories of SEC-089 were not read (no third-party access); reachability rests on a grep of `src` and `next.config.ts`.
- Behaviour under `next start` (all calls were in process with real `Request` objects).
