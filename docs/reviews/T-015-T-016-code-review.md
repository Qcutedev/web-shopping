# Code review: T-015 (auth) and T-016 (admin bootstrap)

Date: 2026-10-13 (fifteenth session). Reviewer: agent code-review, read-only. Commits: `4bd5d96`, `57ad87a`, `fabd057`, `7f3a767`.

Verdict: **APPROVED WITH FOLLOW-UPS.** No Blocking finding. T-016 must not be marked VERIFIED until CR-54 is done. Security sign-off is a separate review: [T-015-T-016-security.md](T-015-T-016-security.md).

Checks the reviewer re-ran: `pnpm lint` exit 0 (82 of 82 import-guard probes); `pnpm typecheck` exit 0; `pnpm exec vitest run src/modules/auth src/server/auth src/proxy.test.ts` 9 files, 100 passed; `pnpm test:integration -- tests/integration/auth` exit 0, 4 files, 54 passed. Not run: `pnpm admin:bootstrap` (tsx missing), full `pnpm verify`, full integration suite.

## Findings

| ID | Severity | Location | Problem | Fix | Owner |
| --- | --- | --- | --- | --- | --- |
| CR-53 | Major | docs/DATA_MODEL.md:81, :320, :331 | Documents say bootstrap and every User/Account insert go "through the auth library". The script inserts User and Account with Prisma directly in one `$transaction` (`src/modules/auth/bootstrap-admin.ts:194-216`). The library declares `role` with `input: false` (`src/server/auth/auth.ts:116`), so it cannot create an ADMIN; create-then-update would break DATA_MODEL.md:688. The code is correct. | Reword 4.1 and 6.1: inserted directly in the library's formats (id, scrypt hash), one transaction. Record a decision. Note that `databaseHooks.user.*` do not run for such admins (none exist today). | database |
| CR-54 | Major | package.json:20, scripts/bootstrap-admin.ts | `admin:bootstrap` runs `tsx`, which is not installed. The script entry (`process.loadEnvFile`, alias resolution, `$disconnect`, exit codes) has never run. | Add and pin `tsx`, record in DECISIONS.md, run `pnpm admin:bootstrap` once per outcome (exit 0, 2, 3) against the dev database. | devops, then auth |
| CR-55 | Minor | docs/API_CONTRACTS.md:457, :461 | Duplicate "No endpoint gives a user the ADMIN role" paragraph. | Delete line 461. | backend-api |
| CR-56 | Minor | docs/DATA_MODEL.md:299, :330, :332, :343, :349 | Five items still say "to validate in T-015" and the library "is not installed yet". All are settled and tested. | Replace with the result and the test. | database |
| CR-57 | Major (owner decision) | docs/API_CONTRACTS.md:442 vs docs/REQUIREMENTS.md:156 | REQ-C-01 says sign-up logs in and a duplicate email gives a generic error. The contract returns `200 {accepted:true}` with no cookie in both cases. No decision records the difference. | Owner rules; then update REQ-C-01 or the contract and add a DECISIONS.md entry. | owner |
| CR-58 | Minor | scripts/bootstrap-admin.ts:22, :40-43 | `process.loadEnvFile(".env")` is outside the `try`; a malformed `.env` prints "failed while closing the database connection". | Move it inside the `try` or print a neutral message. | auth |
| CR-59 | Minor | src/server/auth/routes.ts:181-190 | No test for the concurrent sign-up branch (`FAILED_TO_CREATE_USER` then lookup then 200). Removing it gives a 500 and no test fails. | Integration case: two parallel sign-ups for one email; both 200; one user, one account. | qa |
| CR-60 | Minor | src/server/auth/routes.ts:267-269 | A valid session with a null actor answers 401 on sign-out and leaves the row (IP, user agent) until the purge. Defence in depth only. | Delete the row, still answer 401. | auth |
| CR-61 | Minor | src/modules/auth/bootstrap-admin.test.ts:215-221 | "Password hash format" test only calls the library, cannot fail because of this module. | Delete or relabel as a library pin check. | qa |
| CR-62 | Minor | src/modules/auth/bootstrap-admin.ts:156-161; tests/integration/auth/bootstrap-admin.test.ts:174-180 | `mode: "insensitive"` has no effect (email is already lower-cased) and the test passes without it; the filter cannot use `User_email_key`. | Add a raw-SQL mixed-case seed test, or drop `insensitive`. | auth |
| CR-63 | Minor | tests/integration/auth/bootstrap-admin.test.ts:215-225 | The race test probably reaches the P2002 path but the ordering is not forced. | Inject a hook between lookup and insert, or stub the lookup to return null twice. | qa |
| CR-64 | Minor | docs/DEPLOYMENT.md:386-390 | `Read-Host -MaskInput` needs PowerShell 7.1+; the project shell is Windows PowerShell 5.1. | Add the 5.1 form or state PowerShell 7 is required. | devops |
| CR-65 | Minor | eslint.config.mjs (D-022) | No lint guard enforces that modules import `src/server/auth` only through `actor.ts`. | Add an import guard for `src/modules/**` (not tests) with an allow-list and a probe. | devops |
| CR-66 | Minor | src/server/auth/config.ts:58-62 | `AUTH_SECRET` is validated lazily; a bad secret starts and reports healthy, then every auth route answers 500. | Move the rule into `src/server/env.ts` start-up validation. | devops |

## Agent rulings (fourteenth session)

- Exit code 3 on refusal: accepted.
- Optional `ADMIN_BOOTSTRAP_NAME`: accepted.
- No AuditLog row: accepted (REQ-A-10 does not cover A-11; `AuditLog.actorId` is a required foreign key). Needs a DECISIONS.md entry.
- Direct User/Account insert: accepted as the correct design; the documents change, not the code (CR-53).
