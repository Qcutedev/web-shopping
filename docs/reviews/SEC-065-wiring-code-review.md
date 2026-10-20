# Code review: upload cleanup wiring (commit 37d07c8)

Reviewed 2026-10-20 (eighty-first session) by the code-review agent. Verdict: **APPROVED**, no Blocking.

Verified: Node runtime only (`src/instrumentation.ts:42`), skipped in build (:43) and test (:55), called after `loadEnvAtStartup()` (:51), once per process via `Symbol.for` slot (`cleanup.ts:107,128`), timer `unref`'d (:142), no overlap (:134-138), job errors logged as class and code only (:96-103).

## Findings

- **CR-WIRE-01** (Medium). `UPLOAD_DIR` is not validated by `src/server/env.ts`. A missing or relative value starts the server, then cleanup logs "Upload orphan cleanup failed" hourly and removes nothing (fails closed, quietly). Fix: devops adds `UPLOAD_DIR` to env validation (already requested in the T-041 report); until then DEPLOYMENT.md states the gap.
- **CR-WIRE-02** (Low). `cleanup.ts:136` `void runUploadCleanup(...).finally(...)` has no `.catch`; a throwing logger would end the process. Fix: add `.catch(() => undefined)` before `.finally`. Owner: uploads.
- **CR-WIRE-03** (Low). `docs/DEPLOYMENT.md:481`: "Each run writes one line" is inaccurate (one warn line per undeletable file, failure line has `errorCode`); "Both jobs" and "### The two jobs" should say three; "Not yet run on a deployment" appears twice.
- **CR-WIRE-04** (Low). `src/instrumentation.test.ts:198-200` garbled comment; say `run` and `logger` are injected into the real `startUploadCleanupSchedule`.
- **CR-WIRE-05** (Low). `instrumentation.test.ts:209` logger stub uses `as never`; use a typed stub.
- **CR-WIRE-06** (Low). `instrumentation.test.ts:183-193` duplicates :250-270; add `expect(cleanup).not.toHaveBeenCalled()` to the existing cases instead.
- **CR-WIRE-07** (Info). If `import("./modules/uploads")` fails, the purge and sweep timers already run when the catch ends the process (same as the other jobs). In dev, edits to `cleanup.ts` need a restart.

## Ran / not run

Ran: vitest on `src/instrumentation.test.ts` and `src/modules/uploads` (7 files, 173 passed); `pnpm test` (151 files, 4247 passed, 5 expected fail); typecheck; lint (111/111 probes); prettier on 3 files. Mutants on a scratchpad copy: removing the call fails 2 tests; per-module symbol fails the single-timer test; call before env load fails 7 tests.

Not run: real `next start`/`next dev`, `next build` check of `register`, multi-instance `SKIP LOCKED`, integration tests. A security review of scheduled file deletion is still owed.
