# SEC-065 re-check

Reviewer: security agent. Date: 2026-10-20. Commit re-checked: `1f38501` (backend-api, "SEC-065: per-store cap on unattached uploads, orphans not served, cleanup function"). Tree at review: `d1910bb`, with uncommitted work of another agent under `src/modules/inventory/`, `src/app/api/v1/seller/products/`, and `tests/integration/inventory/` (not reviewed, not touched). Register: [../SECURITY.md](../SECURITY.md).

Result: **SEC-065 PARTIAL.** Remediation items 2 (orphans not served) and 3 (per-store cap) are fixed and hold under the attacks tried. Item 1 (cleanup) is built and correct in every case tried, but nothing schedules it. Item 4 (admin takedown) does not exist. Item 5 is deployment. Two new findings: **SEC-066** (Low, files without a row are never removed) and **SEC-067** (Medium, the new reference check scans the whole `OrderItem` table on every file request, which needs no session and has no rate limit). No Critical or High finding.

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Neither shows that the upload lifetime is secure.

## Scope

- `git show 1f38501` (12 files)
- `src/modules/uploads/repository.ts` (`lockStoreUploads`, `countUnreferencedUploads`, `findUploadByKey`, `deleteExpiredOrphans`), `service.ts` (`assertUploadAllowance`, `createUpload`, `openFile`), `cleanup.ts`, `storage.ts` (`LocalDiskStorage.delete`, `pathOf`), `schema.ts`, `errors.ts`, `index.ts`
- `src/app/api/v1/seller/uploads/route.ts`, `src/app/api/files/[key]/route.ts`
- `src/modules/sellers/repository.ts` (`updateOwnStore`, logo attach scoped by `storeId`)
- `prisma/schema.prisma` (`Upload`, `ProductImage`, `Store.logoUploadId`, `OrderItem`) and `prisma/migrations/20261011121529_init_schema_v1/migration.sql` (indexes, checks, foreign keys)
- `docs/API_CONTRACTS.md` section 5.8 "Lifetime", "Orphan cleanup", 5.8.1
- `tests/integration/uploads/endpoints.test.ts` SEC-065 cases and `tests/security/t041-uploads.itest.ts` (read, not changed)

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Test not weakened | Holds. The SEC-065 `it.fails` became `it` with its body unchanged. The documented case now asserts 404 instead of 200; its row assertions are unchanged. The finding allowed this adaptation. | `git show 1f38501 -- tests/security` |
| Cap is atomic | Holds. Inside one transaction: `FOR SHARE` on the store row, then `pg_advisory_xact_lock(hashtextextended('uploads:'||storeId, 0))`, then the count, then the bytes, then the insert. Under READ COMMITTED the count runs after the lock is granted, so it sees every earlier upload of the store that committed. The lock is released at commit or rollback. The early check before the body is advisory only. No other path inserts `Upload` rows (`Grep`). A hash collision only makes two stores wait for each other. | Code read. Reviewer cases: 12 parallel POSTs through the route with 3 places left give exactly 3 x 201 and 9 x 409 `UPLOAD_LIMIT`, 50 rows, every stored file has a row. Two stores racing at 1 place each get 1 each. Author's case: 3 service calls, 1 place. |
| Deadlock with suspension | None found by reading. Every upload takes the store's `FOR SHARE` before the advisory lock, and nothing else takes the advisory lock, so no cycle exists. A suspension waits for the share holders to finish in turn. | Code read. Author's T-041 case "a suspension that starts during an upload waits for it and does not deadlock" still passes. |
| Orphans 404 to everyone | Holds. `openFile` takes no actor, and the route reads no session. An expired orphan gives the same 404 envelope to anonymous, customer, admin, another seller, and the owning seller. The age is judged by the database clock: 60 s inside the grace period is served, 60 s past it is 404. | Reviewer cases. |
| Cross-store isolation | Holds. The cap counts rows of the session's store only (`requireApprovedSeller(actor).storeId` early, `requireApprovedStoreForWrite` in the transaction). Another store's full cap does not refuse a parallel upload. Another store cannot attach an expired orphan as its logo (404 upload), and that orphan stays 404 and is cleaned up. The owner can attach it, after which it is served and kept (section 5.8). | Reviewer cases. Author's case "another store's uploads never count". |
| Cleanup keeps referenced uploads | Holds. Step 1 `FOR UPDATE OF u SKIP LOCKED` skips a row whose attach is in flight, because the attach's foreign key check holds `FOR KEY SHARE`. Step 2 repeats every condition in a new snapshot. Uploads kept: a logo `UPDATE` in flight, an `OrderItem` insert in flight, a `ProductImage` insert in flight (author), and an order picture three years old. The `Restrict` foreign keys are the backstop. | Reviewer cases; author's case. The case where an attach commits between step 1's snapshot and its lock was checked by reading only (step 2 catches it). It was not forced. |
| Cleanup keeps recent uploads | Holds. An upload 60 s inside the grace period is kept, one 60 s past it is deleted (database clock). | Reviewer case. |
| Concurrent cleanups | Hold. Two runs at once, batch size 7, 30 orphans: no error, each key deleted exactly once, the fresh upload kept, and the summed `rowsDeleted` equals the keys seen. | Reviewer case (wraps the real `deleteExpiredOrphans`). |
| Path traversal | Holds. Keys come from rows, never from requests, and `LocalDiskStorage.delete` refuses any key outside `^[0-9a-f]{32}$` with a TypeError before it builds a path. The cleanup catches the error, counts the file as failed, and writes one warn line with the key. Hostile `storageKey` rows tried (`../escape-canary`, `../../escape-canary`, `..\escape-canary`, an absolute path to a canary, upper-case hex, `<32 hex>.jpg`, `<31 hex>/`, empty) are all deleted, and both canaries outside the root stay intact. A pattern-valid key whose path is a directory: the row is deleted, the directory and its content are kept, and the file is counted failed. No check constraint on `Upload.storageKey` exists in the database (observation 2). | Reviewer cases. |
| Disk and database out of step | Partly. A row whose bytes are gone is deleted without error and counted as deleted (the missing file counts as deleted). A file with no row is never served, but nothing ever removes it, and the cap does not count it: SEC-066. | Reviewer cases (documented + `it.fails`). |
| Cost of the new checks | Defect. No index exists on `OrderItem.productImageUploadId`. `EXPLAIN` of the serving statement with `enable_seqscan = off` still plans `Seq Scan on "OrderItem"`. This runs on every unauthenticated `GET /api/files/{key}` of an upload older than 24 hours that is neither a product picture nor a logo. It also runs in the cap count and in the cleanup, and in the `Restrict` check of every `Upload` delete: SEC-067. | Reviewer case (documented + `it.fails`). Migration read. |
| Logging | Holds. Cleanup lines hold counts and storage keys only. The 409 does not reveal the count. | Code read. |

## Findings

- **SEC-065** PARTIAL (re-checked 2026-10-20). The cap and the 404 are fixed. The cleanup is built but not scheduled. No takedown exists. Full evidence in SECURITY.md.
- **SEC-066** (Low, OPEN). The cleanup walks rows, never the disk. A file whose delete failed, or whose process died between `storage.put` and the end of the transaction, stays for ever. It is outside the per-store bound.
- **SEC-067** (Medium, OPEN). The `OrderItem` reference check has no index. Each unauthenticated, unlimited file request for an order-only picture or a not-yet-deleted expired orphan scans every order item. Fix: `@@index([productImageUploadId])` on `OrderItem` (database owner).

### Observations (not findings)

1. Until devops wires `startUploadCleanupSchedule` into `src/instrumentation.ts`, a store whose 50 unattached uploads have expired can never upload again, and no endpoint lets the seller delete an upload. This is an availability defect for honest sellers and is recorded in SEC-065's status. It gives an attacker nothing.
2. `Upload.storageKey` has no database check matching `STORAGE_KEY_PATTERN`; the factory `createUpload` writes `test-upload-N`. Storage refuses such keys, so this is safe, but a check constraint would make a bad row impossible.
3. The grace period counts from `createdAt`, not from the last detach. A picture detached after 24 hours is 404 at once and deleted at the next run. The contract says "nothing references ... for longer than a grace period". The owner may want the wording aligned. This is not a security issue: it removes bytes sooner, not later.
4. The cap bounds unattached uploads only. Attached pictures (8 per product) are bounded by how many products a store may create, and `openFile` serves a picture of any product whatever its status. Whether throw-away draft products bypass the cap for free hosting depends on `src/modules/inventory`, which another agent is building. It belongs to that review.

## Tests added

New file `tests/security/sec065-recheck.itest.ts` (integration project), 17 plain cases and 2 `it.fails`:

- "the cap holds under parallel requests through the route" (2)
- "an expired orphan is 404 whoever asks" (2)
- "cross-store isolation of orphans" (3)
- "the cleanup never deletes a referenced or recent upload" (5)
- "the cleanup and paths outside the storage root" (4 plain, 1 `it.fails` SEC-066)
- "SEC-067 the reference lookup on order items is a full table scan" (1 plain, 1 `it.fails`)

No existing case was changed or deleted. The file is printable ASCII and contains no backslash-u escape (SEC-040).

## Commands run

- Docker Desktop started; `docker compose up -d --wait db-test` -> container `marketplace-db-test-1` healthy (PostgreSQL 18, 127.0.0.1:5433)
- `pnpm exec vitest run --config vitest.integration.config.mts tests/integration/uploads tests/security/t041-uploads.itest.ts tests/security/sec065-recheck.itest.ts` -> exit 0, 3 files, 67 passed, 3 expected fail (SEC-064, SEC-066, SEC-067)
- `pnpm exec vitest run src/modules/uploads` -> exit 0, 6 files, 141 passed
- Scratch copy `tests/security/zz-sec065-flip.itest.ts` with `it.fails(` replaced by `it(`, `-t "SEC-066|index"` -> exit 1, 2 failed: `expected true to be false`; `expected 'Index Scan using "Upload_storageKey_k...' not to match /Seq Scan on "OrderItem"/`. The copy was deleted (`Test-Path` False). The first attempt was refused by the run lock (`ConcurrentRunError`, another agent's integration run); the second ran.
- `pnpm exec prettier --write tests/security/sec065-recheck.itest.ts` -> formatted, then unchanged; `pnpm exec eslint tests/security/sec065-recheck.itest.ts` -> exit 0
- `pnpm exec tsc --noEmit -p tsconfig.json` -> exit 2. All errors are in `tests/integration/inventory/support.ts` (another agent's uncommitted work); none are in the new file
- `git show 1f38501 | grep -iE <token shapes>` -> no match; `command -v gitleaks trufflehog` -> neither installed

## Not run

- `pnpm verify`, `pnpm test`, the full `pnpm test:integration`, and `pnpm exec vitest run --project security`: the caller limited the run to this re-check's tests. No file under `src` changed in this re-check.
- `pnpm audit`: 1f38501 changed no manifest or lockfile.
- A mutation run of the parallel cap cases against a copy without the advisory lock (no edit of `src` allowed). The cases were not shown to fail without the lock.
- Requests through a running `next start`; handlers were called in process.
- The cleanup across several processes, and the cleanup schedule as wired (it is not wired).
- A forced interleaving of an attach that commits between the cleanup's snapshot and its lock.
