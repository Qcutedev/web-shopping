# SEC-058 re-check after D-041

Reviewer: security agent. Date: 2026-10-15. Commits re-checked: `b86418f` (database), `601e068` (backend-api), `6094b42` (qa). Tree at review: `e9ac44e`. Ruling: [D-041](../DECISIONS.md). Register: [../SECURITY.md](../SECURITY.md).

Result: **SEC-058 FIXED** for the controls the owner chose: (a) unique names after normalisation, (b) a rename audit row, (d) reserved names. Two new Low findings: **SEC-059** (the reserved-name rule matches the whole name only) and **SEC-060** (Thai and blank look-alike copies get a different key). No Critical, High, or Medium finding.

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Neither shows that store names cannot be imitated.

## Scope

- `prisma/migrations/20261015090000_store_name_key/migration.sql`, `prisma/schema.prisma` (`Store.nameKey`), `prisma/seed.ts` (name conflict check)
- `src/modules/sellers/repository.ts` (`checkStoreName`, `insertApplication`, `lockOwnStore`, `updateOwnStore`, `lockStoreIfApproved`, `approveApplicationRow`), `store-name.ts`, `errors.ts`, `service.ts`, `index.ts`
- `tests/integration/sellers/store-names.test.ts`, `tests/integration/schema/unique-constraints.test.ts` (read, not changed)
- Read for context: `src/modules/sellers/schema.ts` and `src/modules/auth/schema.ts` (`NAME_ALLOWED_TEXT`), `src/i18n/th.ts` (`site.name`)

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Uniqueness on every path | Holds. The key is a STORED generated column computed by the database, so no write can leave it stale; the unique index refuses a duplicate on the approval insert and on the rename update. The application check is an early answer only. `Grep` finds no other application write of `Store.name`. | Code read; reviewer cases (a) |
| Variants | Same key for case, full width, compatibility forms (ligatures, Kelvin sign, mathematical letters, superscripts, circled letters, Roman numerals), sharp s, final sigma, all White_Space characters, all default-ignorables (zero-width, ZWNJ, ZWJ, variation selectors, tags, Hangul fillers, U+034F, U+180E), Thai sara am, Thai mark order. Different key: other scripts' look-alikes (accepted, D-041), U+2800, U+2044, a doubled Thai mark, two sara e for sara ae (SEC-060), punctuation, `0`/`O`. Idempotent on every probe. | `psql` probe of 42 pairs in a scratch database on PostgreSQL 18.6 (dropped); reviewer case "case, width, spacing ..." (16 variants of 6 names, rename and application) |
| Races | Hold. Rename against approval of one name (5 rounds): exactly one wins, loser 409, application stays `PENDING`. Two stores swapping names at once: neither succeeds, no duplicate key (both 409 in 3 of 3 runs; a 500 from a deadlock is possible and fails closed). Concurrent renames to one name: author's case. | Reviewer cases; author's case |
| Audit row (b) | Holds. One `SELLER_STORE_RENAMED` row per rename, seller as actor, before name read under the `FOR UPDATE` lock, after name as stored, in the same transaction; six concurrent renames of one store give six rows that chain from the old name to the final one. No row on any refusal (taken, reserved, foreign logo, suspended store, forged actor). A name sent unchanged writes no row; a case-only change does (same key as its own). | Reviewer cases (b); author's cases |
| Reserved names (d) | Holds for the whole name in any case, width, spacing, or with invisible characters. Bypassed by any addition (`<site name> Official`, `Admin.`): SEC-059. | Reviewer case (d); SEC-059 cases |
| What a refusal reveals | No other store's name, key, slug, or id in the response body, the public error, or the log; the `STORE_NAME_TAKEN` error has no cause (the P2002 `meta` holding the key is read for the constraint name and SQLSTATE only). The 409 itself is an existence oracle for a guessed key, including hidden stores; judged not to matter (see SECURITY.md SEC-058). | Reviewer case "the refusal names no other store"; code read of `isStoreNameKeyViolation`, `storeNameTaken` |
| Locks | The rename takes `FOR UPDATE` from the start (no upgrade from `FOR NO KEY UPDATE`). It waits for a transaction holding `requireApprovedStoreForWrite`'s `FOR SHARE` and then succeeds; no deadlock. By reading, the rename takes no other row lock before the store row except the `FOR KEY SHARE` on its own user row from the audit insert, so no cycle with the approval (application, user, store) or with seller writes was found. | Reviewer lock case; code read |
| Migration | Oldest store of each collision group keeps its name, others get ` (<slug>)`; a remaining collision fails the index and, with the file sent as one multi-statement message, leaves nothing behind. No audit row, and the renamed name may exceed 100 characters. | Two seeded scratch databases (dropped) |
| Pre-fix behaviour | The flipped SEC-058 case and its replacement both fail on the pre-fix tree 5a68460. | Temporary worktree (removed): `expected 200 not to be 200`; `1: expected 200 to be 409` |

## Findings

- **SEC-058** FIXED (re-checked 2026-10-15). Full evidence in SECURITY.md.
- **SEC-059** (Low, OPEN): reserved names are refused only as the whole name. `<site name> Official`, `Admin.`, `Official Support` are accepted. Documented case plus `it.fails`.
- **SEC-060** (Low, OPEN): two sara e for sara ae, a doubled Thai tone mark, and U+2800 for a space make a copy of a Thai store name that the key does not catch. Documented case plus `it.fails`.

### Observations (not findings)

1. A swap of two store names at the same instant can deadlock in the unique index; PostgreSQL aborts one (500). Not observed; fails closed.
2. Migration renames are unaudited and may exceed `STORE_NAME_MAX`; a failing migration prints a store name in its error. Existing stores with reserved names are not renamed.
3. `store_name_key` depends on PostgreSQL's Unicode tables; after a major upgrade the stored keys must be recomputed and the index rebuilt (residual risk in SECURITY.md).

## Tests added or changed

`tests/security/t040-sellers.itest.ts`:
- The SEC-058 `it.fails` "a store cannot take the exact name of another store" is now `it`; its body is unchanged.
- The "documented behaviour" case is replaced by "fixed (D-041): of 20 alternating renames ...": the same 20 alternating renames, now asserting `409 STORE_NAME_TAKEN` for the 10 to the other store's name, 200 for the others, final name `Name 18`, and 10 audit rows with the seller as actor.
- New describes: "SEC-058 re-check (a)" (4 cases), "SEC-058 re-check: the rename's FOR UPDATE against a held FOR SHARE" (1), "(b)" (2), "(d)" (2), "SEC-059" (1 plain, 1 `it.fails`), "SEC-060" (1 plain, 1 `it.fails`).
- No case deleted or weakened. The file stays printable ASCII without backslash-u escapes (SEC-040).

## Commands run

- `docker exec marketplace-db-test-1 psql ... -f /tmp/sec058_probe.sql` in a scratch database `sec058_probe` -> 42 pairs, results above; database dropped
- The migration file on scratch databases `sec058_mig_s1` and `sec058_mig_s2` (shell script in the container) -> s1 exit 0, 2 renamed; s2 exit 1, `could not create unique index "Store_nameKey_key"`, nothing left; both dropped
- `git worktree add --detach <scratch>\wt 5a68460`, `pnpm exec prisma generate`, `pnpm exec vitest run --config vitest.integration.config.mts tests/security/zz-sec058-oldcode.itest.ts` -> exit 1, 2 failed on their assertions; worktree removed (`git worktree remove --force`, `git worktree prune`). pnpm's pre-run install failed in the worktree (could not create a directory); the run used the main `node_modules` through a junction, removed afterwards
- `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t040-sellers.itest.ts` -> exit 0, 22 passed, 2 expected fail
- Swap case in a scratch copy with an outcome print, 3 runs (deleted) -> both `409 CONFLICT STORE_NAME_TAKEN` each time
- SEC-059 and SEC-060 `it.fails` flipped in a scratch copy (deleted), `-t "SEC-059|SEC-060"` -> exit 1, `expected 200 to be 409` for both
- `pnpm exec prettier --write` then `--check` and `pnpm exec eslint tests/security/t040-sellers.itest.ts` -> exit 0; `pnpm typecheck` -> exit 0
- `pnpm exec vitest run --project security` -> exit 0, 25 files, 931 passed, 5 expected fail
- `pnpm test:integration` -> exit 0, 39 files, 1099 passed, 3 expected fail (SEC-053, SEC-059, SEC-060)
- `Get-Command gitleaks, trufflehog` -> neither installed; no secret scan. The fix commits change no manifest or lockfile, so no dependency audit was run

## Not run

- Requests through a running `next dev` or `next start` server; handlers and services were called in process.
- Prisma's own migration applier on a failing collision (emulated with one multi-statement message through `psql`).
- A browser check of how the SEC-060 copies render (the claim that they look alike rests on common Thai font behaviour, not on a screenshot).
- A forced deadlock of two simultaneous swaps; the 500 path's log line was therefore not inspected.
- `pnpm test`, `pnpm verify`, `pnpm build`: no file under `src` changed in this re-check.
