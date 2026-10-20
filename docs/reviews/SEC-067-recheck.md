# SEC-067 re-check

Reviewer: security agent. Date: 2026-10-20. Commit re-checked: `c55c575` (database, "SEC-067: index OrderItem.productImageUploadId"). Tree at review: `1ac3abb`, with an unrelated staged deletion of `run-agents.ps1` (not touched). Register: [../SECURITY.md](../SECURITY.md). Finding raised in [SEC-065-recheck.md](SEC-065-recheck.md).

Result: **SEC-067 FIXED.** Every lookup of order item references by upload id can now use `OrderItem_productImageUploadId_idx`. No new finding.

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Plan checks on a near-empty test database show that the index can serve each statement, not which plan PostgreSQL picks on production data.

## Scope

- `git show --stat c55c575` (3 files: `prisma/schema.prisma`, migration `20261020090000_order_item_upload_index`, `docs/DATA_MODEL.md`)
- The migration: one statement, `CREATE INDEX "OrderItem_productImageUploadId_idx" ON "OrderItem"("productImageUploadId")`. Plain, not `CONCURRENTLY`; it blocks writes to `OrderItem` while it builds. No shared or production database exists yet.
- `src/modules/uploads/repository.ts`, unchanged by the fix: the four statements with the `OrderItem` condition (`countUnreferencedUploads` line 82, `findUploadByKey` line 110, `deleteExpiredOrphans` lines 144 and 156).

## What was checked and how

| Check | Result | Evidence |
| --- | --- | --- |
| Index exists on the migrated test database | Holds. One row in `pg_indexes` for `OrderItem_productImageUploadId_idx`, btree, leading column `productImageUploadId`. | New `it` case |
| Serving statement (`findUploadByKey`, unauthenticated `GET /api/files/{key}`) | Holds. With `enable_seqscan = off`, the plan holds no `Seq Scan on "OrderItem"` and names the index. | Former `it.fails`, flipped; index name assertion added |
| Cap count (`countUnreferencedUploads`, twice per upload request) | Holds. Same plan checks. | New `it` case |
| Cleanup lock and delete (`deleteExpiredOrphans`) | Holds. Same plan checks on both statements. `EXPLAIN` without `ANALYZE` executes nothing. | New `it` case |
| The new cases fail without the index | Shown. In a scratch file (deleted), inside a transaction that is rolled back, `DROP INDEX` then the same `EXPLAIN` plans `Seq Scan on "OrderItem"` and names no index. | Scratch run, 1 passed |
| `Restrict` foreign key check on every `Upload` delete | Not planned. PostgreSQL runs it internally on the same leading column, so the index is usable; not observed. | Reading only |

## Test changes

`tests/security/sec065-recheck.itest.ts`, describe renamed to "SEC-067 the reference lookup on order items uses an index":

- Removed: "(documented) serving a file plans a sequential scan of OrderItem even with sequential scans disabled" (it now fails, as expected after the fix).
- Flipped `it.fails` to `it`: "serving a file looks up order item references through the index"; assertion kept, `toContain(INDEX)` added.
- Added: the `pg_indexes` case, the cap count case, the cleanup case.
- Each statement is copied from `repository.ts`. A change there must be copied into the test, or the test checks a statement the application no longer runs.

## Commands

- `docker ps` -> `marketplace-db-test-1 Up 28 minutes (healthy) 127.0.0.1:5433->5432/tcp`
- `pnpm exec vitest run --config vitest.integration.config.mts tests/security/sec065-recheck.itest.ts` -> 1 file passed, 20 passed, 1 expected fail (SEC-066)
- Scratch negative control `tests/security/zz-scratch-sec067-control.itest.ts` (deleted after the run) -> 1 passed
- `pnpm exec vitest run --config vitest.integration.config.mts tests/integration/uploads tests/security/t041-uploads.itest.ts tests/security/sec065-recheck.itest.ts` -> 3 files passed, 70 passed, 2 expected fail (SEC-064, SEC-066)
- `pnpm exec prettier --check tests/security/sec065-recheck.itest.ts` -> all files use Prettier code style
- `pnpm exec eslint tests/security/sec065-recheck.itest.ts` -> exit 0
- `pnpm exec tsc --noEmit` -> exit 0

No dependency audit (c55c575 changed no manifest). No secret scanner installed; the diff of c55c575 holds no credential (read).

## Residual

- `GET /api/files/{key}` still has no session and no rate limit (TM-17 residual). Each request is now an index lookup instead of a table scan, but the request rate is still the attacker's.
- Plans on production statistics were not observed (no such database exists).
