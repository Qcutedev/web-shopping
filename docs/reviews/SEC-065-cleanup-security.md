# Security review: scheduled upload orphan deletion (SEC-065 item 1)

Reviewer: security agent. Date: 2026-10-20. Commits reviewed: `1f38501` (cleanup function, repository), `37d07c8` (wiring in `src/instrumentation.ts`), `5b03eac` (cleanup header), `2044536` (CR-WIRE-02, `.catch` before `.finally`). Input: [SEC-065-wiring-code-review.md](SEC-065-wiring-code-review.md). Register: [../SECURITY.md](../SECURITY.md).

Result: **no Critical, High, or Medium finding.** Deletion is driven only by database rows, never by a directory listing; each path is built from a key that must match `^[0-9a-f]{32}$` and is checked to lie under the root; only rows that no product picture, logo, or order item references and that are older than 24 hours by the database clock are deleted, under `FOR UPDATE ... SKIP LOCKED` with the conditions repeated in the `DELETE`. One new finding: **SEC-073** (Low): a storage root that is missing or wrong (volume not mounted, wrong path) is indistinguishable from success, so each run deletes up to 1,000 rows per process whose bytes stay on the real volume for good, and the result line reports them as deleted. Two observations extend SEC-066 (below).

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested attacks fail. Neither shows that the scheduled deletion is secure.

## Scope

- `src/modules/uploads/cleanup.ts` (whole file at `2044536`), `repository.ts` (`deleteExpiredOrphans`, `countUnreferencedUploads`, `fileLookupStatement`), `storage.ts` (`LocalDiskStorage.pathOf`, `delete`), `config.ts`, `schema.ts` (`STORAGE_KEY_PATTERN`, `ORPHAN_GRACE_PERIOD_SECONDS`), `service.ts` (`createUpload` order of `put` and insert)
- `src/instrumentation.ts`, `src/server/env.ts` (`UPLOAD_DIR` rule), `src/server/errors.ts` (`describeErrorForLog`)
- `prisma/schema.prisma` and the init migration (`Upload.createdAt` default, the three `Restrict` foreign keys), `src/modules/cart/repository.ts` (`findFirstImageKey`), every `storageKey` use under `src/modules` (to find references outside the three foreign keys)
- docs/DEPLOYMENT.md "Uploaded files" and the scheduled jobs section

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Path traversal out of `UPLOAD_DIR` | Holds. `pathOf` calls `assertKey` (32 lower-case hex digits, no separator, no dot) before any join, then requires the joined path to start with `root + sep`. A key that fails throws `TypeError`, which the cleanup counts as failed with one warn line. | `storage.ts:44-96`; `sec065-recheck.itest.ts` hostile-key case (traversal, absolute, upper-case, `.jpg`, trailing slash, empty: canaries intact), run below |
| Symlink escape | Holds for the attacker the app faces: the app never creates a link, and every directory and file name under the root is server-generated. The check is lexical, not `realpath`. `unlink` of a link at the key's own path removes the link, not its target. A two-digit directory that is itself a link or junction is followed: a file named by the key outside the root is deleted. Needs write access to `UPLOAD_DIR` (DEPLOYMENT.md: no other account may write to it) and a file whose name equals a key in the database; not a finding. | New `sec065-cleanup-schedule.test.ts`: file link case (target kept), junction case (documented: outside file deleted), run on this Windows machine, neither skipped |
| Referenced files deleted | Holds. "Referenced" is the three `NOT EXISTS` conditions (`ProductImage.uploadId`, `Store.logoUploadId`, `OrderItem.productImageUploadId`), each backed by a `Restrict` foreign key, so even a wrong query could not delete a referenced row. No other table or text column holds a storage key: every `storageKey` read under `src/modules` goes through one of these relations or an `Upload` row. Bytes are deleted only for keys the `DELETE ... RETURNING` gave back. | `grep storageKey src/modules`; migration lines 490, 511, 538; `sec065-recheck.itest.ts` cases "logo attach in flight", "order item insert in flight", "order picture three years old" |
| Race between upload and sweep | Holds. `createdAt` is the database default (`CURRENT_TIMESTAMP`, the transaction start), compared with `now()` of the same database, so no process clock is involved. `createUpload` writes the bytes and inserts the row in one transaction; the cleanup sees only committed rows and acts on keys only after its own commit. A row is a candidate only 24 hours after its transaction started. A file without a row is never touched by the cleanup (SEC-066). | `service.ts:111-128`; migration line 199; recheck case "60 s inside kept, 60 s past deleted" |
| Race between attach and sweep | Holds. Step 1 locks candidates `FOR UPDATE OF u SKIP LOCKED`, which conflicts with the `FOR KEY SHARE` lock a concurrent foreign key insert or update takes; step 2 repeats every condition with a fresh snapshot. An attach that waited on the lock fails its foreign key afterwards (see observation 3). | `repository.ts:184-208`; recheck in-flight cases |
| Several processes | Holds for one shared volume: `SKIP LOCKED` hands each row to one process; a second `unlink` of the same key is `ENOENT`, counted as deleted. Two runs in parallel deleted each of 30 orphans exactly once. Each process restart runs the job at once; the work is idempotent and bounded, so a crash loop only repeats harmless runs. Not safe with one local disk per instance: see SEC-073 (DEPLOYMENT.md already says the local adapter is wrong for several instances). | Recheck case "two cleanup runs at the same time"; `cleanup.ts:125-147` |
| One schedule per process, no overlap | Holds. `Symbol.for` slot on `globalThis`; `running` flag; timer `unref`'d; since `2044536` a throwing logger can no longer reject the tick's promise. | `cleanup.ts:131-145`; `src/modules/uploads/cleanup.test.ts`, `src/instrumentation.test.ts` run below |
| Start conditions | Holds. Node.js runtime only, not in the build phase, after `loadEnvAtStartup()`, not with `NODE_ENV=test`. In production `UPLOAD_DIR` is required and must be absolute without NUL; outside production a missing value makes `getUploadStorage()` throw before any row is deleted (logged as `UploadStorageNotConfiguredError`, no value). | `instrumentation.ts:42-69`; `env.ts:258-263, 571-575`; `cleanup.ts:88-89` |
| Error logging leaks | Holds. The result line carries counts; the failure line `errorClass` and a label-shaped `errorCode` only (`describeErrorForLog`), never a message, path, or stack; the per-file warn line the key only, never the error. A key is not a capability (a non-public file is served only to its store's seller, SEC-068 item 1 on its branch), and the row is gone. | `cleanup.ts:73-77, 95-103`; `errors.ts:424-437`; `cleanup.test.ts` "nothing of the message"; new case "one warn line per key" (fields are exactly `storageKey`) |
| `UPLOAD_DIR` blast radius | Bounded. The job deletes only `<root>/<two digits>/<key>` for keys of deleted rows, all 128-bit random server values; a sibling file, a file of another name, and a file at `<root>/<key>` are kept. A root that is the file system root (`/`, `C:\`) refuses every path (`root + sep` becomes `//` or `C:\\`), so nothing is deleted, but the rows are (SEC-073). A wrong but existing directory deletes nothing outside the two-level key layout. | New test, "blast radius" and "file system root" cases |
| DoS via a huge directory | Not applicable to the job as built: it never lists a directory (no file system import in `cleanup.ts`); per run at most `ORPHAN_CLEANUP_MAX_BATCHES` x `ORPHAN_CLEANUP_BATCH_SIZE` = 1,000 rows and 1,000 `unlink` calls per process, each batch a transaction of at most 30 s. Backlog is bounded by the per-store cap (50 unreferenced rows per store), which counts expired rows until they are deleted. See observation 2 for the listing sweep SEC-066 proposes. | New case "bounded work per run"; `repository.ts:165` |
| Injection | Holds. Both statements are tagged templates; grace and limit are bound and cast `::int`; ids bound as `text[]`. | `repository.ts:186-205` |

## Findings

- **SEC-073** (Low, OPEN). Registered in [../SECURITY.md](../SECURITY.md) (findings register, SEC-073), with reproduction and remediation.

## Observations (no new finding)

1. **Extends SEC-066.** The cleanup commits each batch's `DELETE` and only then unlinks the files. A process stopped in between (redeploy, out-of-memory kill; the job runs at every start) leaves up to 100 files without a row, with no warn line. Same class and remedy as SEC-066; noted there.
2. **Constraint on the SEC-066 remedy.** SEC-066 remediation (1) proposes a sweep that lists the storage root. That sweep would be the first code here to read a directory, and the root can hold up to 256 directories of any size. It must be bounded per run (stream with `opendir`, a cap on entries examined and on deletions per run, resume across runs, for example one two-digit directory per run), never follow a link (`lstat`, skip anything that is not a regular file), and look up rows in batches. Noted in SEC-066.
3. **Attach waiting on the cleanup's lock fails.** If a seller removes a product's picture while a checkout of that product runs, and the upload is older than 24 hours, the cleanup can lock and delete it before the checkout inserts its `OrderItem`; the checkout then fails its foreign key (an error the buyer can retry). Needs both actions within the same seconds; the seller can only harm its own sale. Availability blip, no data exposure.
4. **Log volume.** If `unlink` fails for every key (permissions, read-only volume), each process writes up to 1,000 warn lines an hour. Not a leak; an alerting concern for devops (SEC-066 item 3).
5. **The warn line holds no error code.** An operator cannot tell a permissions error from a refused key. Operability, not security.
6. **CR-WIRE-01 is closed in code.** `src/server/env.ts` validates `UPLOAD_DIR` (lines 258-263, 571-575), so the code review's Medium no longer applies; DEPLOYMENT.md says so (line 481).

## Commands

- `git status; git diff` -> uncommitted `src/modules/uploads/cleanup.ts` (`.catch` before `.finally`), committed meanwhile as `2044536`; `run-agents.ps1` deleted (not this review's).
- `git log --oneline -12 -- src/instrumentation.ts src/modules/uploads/cleanup.ts` -> `2044536`, `5b03eac`, `37d07c8`, `1f38501`, ...
- `pnpm exec vitest run tests/security/sec065-cleanup-schedule.test.ts` -> first run 1 failed (the "no listing" regex matched `globalThis`; regex narrowed to file system imports), then 1 file, 6 passed, 1 expected fail.
- Negative control: the file copied to `tests/security/zz-scratch-sec073.test.ts` with `it.fails(` replaced by `it(`, `pnpm exec vitest run tests/security/zz-scratch-sec073.test.ts -t "SEC-073: when"` -> exit 1, `expected "vi.fn()" to not be called at all, but actually been called 1 times` (called with `86400, 100`); scratch file deleted (`Test-Path` -> False).
- `pnpm exec prettier --write` then `--check`, `pnpm exec eslint` on the new file -> exit 0 (two unused-argument warnings fixed); byte scan -> 0 bytes above 126, no backslash-u.
- `pnpm typecheck` -> exit 0.
- `pnpm exec vitest run tests/security/sec065-cleanup-schedule.test.ts src/modules/uploads/cleanup.test.ts src/modules/uploads/storage.test.ts src/instrumentation.test.ts` -> 4 files, 53 passed, 1 expected fail.
- `pnpm exec vitest run --config vitest.integration.config.mts tests/security/sec065-recheck.itest.ts` -> 1 file, 20 passed, 1 expected fail (SEC-066).
- `git show 1f38501 37d07c8 5b03eac 2044536 | Select-String` for password, secret, API key, token, connection string, private key, AWS key id -> 2 matches, both the test fixture string `"connect ECONNREFUSED 10.0.0.5:5432 secret"` and its assertion in `cleanup.test.ts`; no secret.

## Not reviewed or not run

- The job in a running `next start` or `next dev`, across real processes or containers, or on a deployment volume (network file system, object store); `SKIP LOCKED` was exercised by two runs in one process only.
- Behaviour on a full or read-only volume, and on Windows with a file held open by an antivirus or a reader (`EBUSY`, `EPERM`).
- The planner's choice for the candidate query on a large `Upload` table (no index on `createdAt`; the query sorts all candidates each batch). Judged not attacker-driven (hourly, fixed batch count).
- `pnpm audit` and a dedicated secret scanner: no manifest changed in the reviewed commits; gitleaks was reported not installed by earlier reviews and was not looked up again. Only the pattern search above was run.
- The full `pnpm test` and `pnpm test:integration` suites.
