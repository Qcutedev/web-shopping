# Security re-check: SEC-046, SEC-047, SEC-048

Reviewer: security agent, 2026-10-13. Independent re-check. The fix commits, their messages, the handoff note in SECURITY.md, and the authors' tests were read but not relied on.

Commits re-checked: `544d2ee` (SEC-046, SEC-047), `5219fec` (SEC-048, auth part), `5dfa22f` (SEC-048, http part). Tree: `b876b2f` plus the owner's deletion of `run-agents.ps1` (left untouched). A first security agent started this re-check and was interrupted. Its uncommitted test file and scratch probes were inspected, re-run, and kept or extended. Nothing was redone from scratch.

Findings are registered in [SECURITY.md](../SECURITY.md) ("Findings register") with the same ids. This file records the scope, the method, the evidence, and the verdict.

## Verdict

| Item | Verdict | Short reason |
| --- | --- | --- |
| SEC-046 telemetry variables | FIXED | All seven library variables are refused by name, in every `NODE_ENV`, by both readers, with one issue each and no part of the value. A grep of the installed library finds no other `BETTER_AUTH_` name that is read. The secret is read through `readAuthSecret` before the library is created, so a refused variable stops the library and its telemetry. |
| SEC-047 weak-secret bypasses | FIXED; new bypasses of another kind registered as SEC-049 | Every bypass of the finding is refused, and so are 31 further near-misses. Each new rule refuses on its own: removing it makes a case fail. Over 1,000,000 random values in each of 6 generated forms, none was refused. |
| SEC-048 error messages in the log | FIXED | `errorResponse` logs only `{ errorClass, status?, code? }` for every unexpected error: library, Prisma, runtime, and odd thrown values. Against the code before `5dfa22f`, 4 of the new cases fail. At the time of this re-check, what `getAuthRuntime()` could throw before the handler's `try` was an `EnvValidationError` that holds no value. Superseded: since commit `0769f7c` (CR-83) the runtime is built inside each handler's `try` and a failure is the standard 500 envelope with the class name only in the log ([T-020-T-018-security.md](T-020-T-018-security.md), section "CR-83"). |

New finding:

- **SEC-049 (Low)**: production still accepts secrets that are plainly patterned, for example `secret1secret2secret3secret4secret5`. Each of the six values in the reproduction passes all six rules, and so do a keyboard row and word phrases. A further rule was measured: one code-point difference at a lag of 1 to 8 covering at least half the positions. It refuses the six structural values and refused 0 of 1,000,000 random values in each of 4 forms. Word phrases still pass it.

Observations, not registered (reasons given below): a `Proxy` whose `getPrototypeOf` trap throws makes `errorResponse` throw; `src/server/health.ts` still logs up to 300 characters of the driver's message (accepted earlier); the library's own logger writes its log message (`detail`), and some library messages quote request URLs.

No Critical or High finding. No production code was changed by this review.

A passing test suite or a clean scanner run shows only that those tests and tools found nothing. It does not prove that the code is secure.

## Scope

| Area | Files read |
| --- | --- |
| SEC-046 | `src/server/env.ts` (`AUTH_LIBRARY_VARIABLES` and its comment, `checkAuthLibraryVariables`, `readAuthSecret`, `parseEnv`, `loadEnvAtStartup`); `src/server/auth/auth.ts` (`createAuth`, `getAuth`); every `.mjs`, `.cjs`, and `.js` file under `dist` of better-auth, @better-auth/core, and @better-auth/telemetry 1.7.7 (searched by a test) |
| SEC-047 | `src/server/env.ts` (`checkAuthSecretForProduction`, `isRepetition`, `isPrintableAscii`, `hasRepeatedWindow`, `hasConstantStepRun`, `containsPublishedSecret`, `isWeakAuthSecret`); `git show 544d2ee -- tests/security` (four files) |
| SEC-048 | (Code as of commit `7795e8f`, before CR-83.) `src/server/auth/library-error.ts` (whole), `src/server/auth/routes.ts` (`getAuthRuntime`, `openScope`, the four handlers' `catch`, `mapLibraryError`), `src/server/auth/session.ts` `readSession`, the four `src/app/api/v1/auth/*/route.ts`; `git show 5dfa22f -- src/server/http.ts src/server/errors.ts tests/security`; `src/server/db/client.ts` (lazy client); `src/server/health.ts` `describeError`; `src/modules/auth/bootstrap-admin.ts` `describeError`; every `logger.error` call that interpolates a value in better-auth and @better-auth/core `dist` (grep) |

## What was checked and the result

### SEC-046

| Attempt | Result |
| --- | --- |
| The list | `AUTH_LIBRARY_VARIABLES` holds exactly the seven names. The test writes the names out, so dropping one fails a behaviour case, not only the list pin. |
| Each name, every value, every `NODE_ENV` | `1`, `true`, `false`, `0`, and a URL with a canary were tried in development, test, and production. Both readers refuse each name with exactly one issue: the name and `authLibraryVariable`. The canary is not in `String()`, the stack, the JSON, or the issues. An empty value is not refused, and the library ignores it too. |
| All seven at once | Seven issues, in list order. The one start-up log line names all seven and contains no value. |
| Order of reads | `getAuth` passes `readAuthSecret()` into `createAuth`, so the refusal throws before the library exists. The library's telemetry `init` runs when its context is created, and that context is never created. `telemetry: { enabled: false }` is still set. Both points are pinned by reading the source. |
| Completeness | A test lists every `BETTER_AUTH_` name in the three `dist` trees, with the versions pinned at 1.7.7. The names found are the seven, plus `BETTER_AUTH_TELEMETRY_ID` (a getter of @better-auth/core that nothing reads; asserted) and three framework URL names that lose to the explicit `baseURL` (SEC-045 re-check). |
| Library behaviour pin | The SEC-043-045 case still passes: a child process on 127.0.0.1 receives one `init` POST when both variables are set. This case shows why the refusal is needed. |
| Mutants | 11 copies of `env.ts` were made: each drops one name, skips the check in one reader, uses the wrong rule, or refuses empty. Each copy failed 2 to 5 cases. |

### SEC-047

| Attempt | Result |
| --- | --- |
| The finding's values | The flipped case in `sec043-045-recheck.test.ts` passes. `git show 544d2ee` shows only `it.fails(` changed to `it(` and the formatter's reindent. |
| Near-misses | 31 values are refused by both readers with the weak rule alone: case changes, one character added, the published values inside a longer value, with `_` for `-`, with one digit changed, or reversed; the integration secret in upper case or with `!`; word repetitions with one change; a constant-step run of 8 anywhere (steps 0, 1, -1, 2, and through punctuation); and space, tab, DEL, U+00A0, U+200B, U+FEFF, fullwidth a, Cyrillic a, an emoji, and a lone surrogate between two fillers. |
| Each rule on its own | In the first cases most values held FILLER twice, so the repeated-window rule refused them all. Copies of `env.ts` without the printable-ASCII rule, without the distinct count, with space allowed, or ignoring step 0 passed every case. New cases use two different fillers (`FILLER + FILLER_2` is accepted as the control), so each case trips one rule only. All four copies now fail. |
| Equivalent mutants | Three copies of `env.ts` still pass: one without `isRepetition`, one comparing published values exactly, and one comparing them case-sensitively. No value can tell them apart from the real code. A periodic value of 32 or more characters always repeats an 8-character window. Both published values contain a run of 8 digits in steps of 1, so any value that contains one, in any case, is refused by the step rule. These rules are redundant today but harmless. A third published value without such a run would make the substring rule necessary. |
| Window 9 | A copy with a window of 9 fails 1 case. |
| Production only | Development and test accept the weak shapes. A copy of `readAuthSecret` without the production check fails 7 cases. |
| Placeholder first | A value with `not_a_secret` and U+00A0 gives one issue, the placeholder rule. |
| No value in output | Five refused shapes were checked in `parseEnv`, `readAuthSecret`, and the start-up log line. None contains the canary or the filler. Every rule text is one of the `ENV_RULES` constants. |
| False refusals | Measured in this re-check with 1,000,000 values per form: `openssl rand -hex 32`, `-base64 32`, base64url of 32 bytes, `-hex 16`, upper-case hex of 32 bytes, and base64 of 24 bytes. 0 refused in every form. The interrupted run had measured 1 refusal in 1,000,000 for `-hex 16` (a run `12345678`). The suite allows at most 2 in 20,000 per form. |
| Fixtures changed by the commit | `Zq7canary-auth-secret-0123456789abcdef` became `...-Kd2Xw9Lm4Rt6Pn3b` in `round7-recheck.test.ts` and `t011-env-health-recheck.test.ts`. The old value is now refused, because `0123456789` is a step run. The new value is accepted. In `sec039-040-cr66-recheck.test.ts` the 31-character filler changed from `k` repeated to a patternless slice, so the case still sees only the length rule. That case's assertions did not change. None of the four files was weakened. |
| Interrupted agent's edit to `sec043-045-recheck.test.ts` | The random-values case required "never refused". Under the new floor, a random value has about a 1 in 10^6 chance of a constant-step run, so that case would fail now and then. It now allows at most 1 refusal per form in 3,000, and requires any refusal to be the weak rule. This loosens a false-positive (availability) check, not a security control. The reason is written in the file. Accepted. |
| Remaining bypasses | `secret1secret2secret3secret4secret5`, `abcdefg!abcdefg@abcdefg#abcdefg$`, `aBcDeFgHiJkLmNoPqRsTuVwXyZ012345`, `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`, `acdfgijlmoprsuvxyACDFGIJLMOPRSUVX`, and `000102030405060708090a0b0c0d0e0f` are each accepted in production. The same holds for `qwertyuiopasdfghjklzxcvbnm123456` (known, documented in DEPLOYMENT.md), `changeme-please-this-is-my-secret!`, `better-auth-secret-` followed by 16 random characters, and the integration secret with two characters changed. Registered as SEC-049. |

### SEC-049 decision

The six structural values are not the shapes SEC-047 named, so SEC-047 counts as fixed. Each value is still a secret that someone could type and that an attacker would try early. The decision is the same as for SEC-047: Low, because it depends on an operator ignoring the documented generation command. The `it.fails` case is in `sec046-047-recheck.test.ts`. A flipped copy fails at the first value: `"secret1secret2secret3secret4secret5": expected [] to deeply equal [ { variable: 'AUTH_SECRET', ... } ]`. Each of the six was also run alone through `readAuthSecret`, and each was accepted.

A candidate rule was measured with a scratch script: for a lag of 1 to 8, refuse when one code-point difference covers at least half of the positions. At a share of 0.5 it refuses all six structural values, and it accepts the keyboard row, the `changeme` phrase, and three fixtures. On 1,000,000 values per form it refused 0 of hex-64, hex-32, base64-44, and base64url-43. At a share of 0.6 it misses the hex-counting value. Word phrases are beyond any shape rule. The generation command stays the control. The owner may instead accept SEC-049 as a residual. The remediation in the register states both options.

### SEC-048

| Attempt | Result |
| --- | --- |
| The flipped case | `git show 5dfa22f -- tests/security` shows only `it.fails(` changed to `it(` and the formatter's reindent. The case passes. |
| Every kind of unexpected error | Nine values were passed to `errorResponse`: `BetterAuthError`; `PrismaClientKnownRequestError` (message, `meta.target`, `meta.modelName` with a canary); `PrismaClientInitializationError` (a URL with a password); `PrismaClientUnknownRequestError`; a `TypeError` with a nested cause; an `Error` with `detail`, `query`, and `meta` properties; a thrown string; a thrown plain object; and an `Error` whose `name` is prose. Each gave a 500 whose body holds the request id and no canary. Each wrote one error line with no canary and no stack frame, whose `err` keys are only `errorClass`, `status`, and `code`. The class is right in each case: a thrown string is `string`, and prose in `name` falls back to `Error`. |
| Prisma and APIError | A Prisma P2002 is recorded as `{ errorClass: "PrismaClientKnownRequestError", code: "P2002" }`. An `APIError` is recorded as `{ errorClass: "APIError", status: 400, code: "SOME_CODE" }`, without its body message. |
| Causes chosen by services | `internalError(cause)` (error line) and `conflict("DUPLICATE_SKU", { cause: prismaError })` (warn line) are reduced the same way. |
| Auth record | A `reduceLibraryError` result passes through `errorResponse` unchanged as `{ errorClass: "BetterAuthError" }`. |
| Hostile values | A `Proxy` whose `get`, `has`, and `ownKeys` traps throw, and an `Error` whose `name`, `code`, and `status` getters throw: each still gives a 500 and one line with no canary. |
| Pre-fix code | `git show 5dfa22f~1:src/server/http.ts` was put in a scratch folder and loaded in place of `http.ts` by a scratch Vitest config. 4 of the 12 new cases fail against it: all nine kinds, Prisma, APIError, and service causes. The other 8 pass there too; they cover the auth part, robustness, and the route gap. |
| `getAuthRuntime()` before `try` (STATUS.md gap) | The four route files call `getAuthRuntime()` as an argument, outside the handler's `try`. A throw there skips `errorResponse`, so Next.js prints it with its message and stack, and the client gets the framework's 500 without the JSON envelope or a request id. What can throw there: `getEnv` (`parseEnv`) and `getAuth` (`readAuthSecret`, then `createAuth`). Both build the library context and the Prisma client lazily, so with a valid configuration nothing throws (tested). Five invalid configurations were each sent through the real `POST` of `sign-in/route.ts`, each with a canary: a library variable, a weak secret, a short secret, an FTP `APP_URL`, and a MySQL `DATABASE_URL`. Each throws `EnvValidationError`, and its `String()`, stack, and JSON hold no canary. No secret can leak through this gap today. It remains a contract deviation (no envelope, no request id) for backend-api or auth to close, by moving the call inside the `try`. It is not a security finding. **Superseded (2026-10-13):** closed by auth in commit `0769f7c` (CR-83). The route files now pass `getAuthRuntime` itself and each handler builds the runtime inside its `try`; the five configurations above now give 500 `INTERNAL_ERROR` with a fresh request id and one log line `err: { errorClass: "EnvValidationError" }`, without the canary. Re-checked in [T-020-T-018-security.md](T-020-T-018-security.md), section "CR-83". |

### Observations (not registered)

- **`errorResponse` can throw.** `toAppError` calls `isAppError`, which uses `instanceof`. A `Proxy` whose `getPrototypeOf` trap throws makes `errorResponse` throw that trap's error, and the framework then prints it. Seen in this re-check: the canary appeared in the stack. A revoked `Proxy` throws a `TypeError` with a fixed message. No code in the repository throws a `Proxy`, and planting one needs code in the process. The same `instanceof` was there before the fix. Suggested for backend-api: wrap `isAppError` in `try`.
- **Health check messages.** `src/server/health.ts` `describeError` still logs up to 300 characters of the driver's message. That was accepted in SEC-026 and is in "Residual risks". The orchestrator ruled that every unexpected error gets the reduction (SR-04), but this one path is outside `errorResponse` and was not changed. The probe query is fixed, so no request data can reach that message. The message can name the database host, port, and user. Whether the ruling should cover it is for the orchestrator.
- **The library's own logger** (`auth.ts`) writes the library's log message as `detail`. Grepping better-auth and @better-auth/core for `logger.error` calls that interpolate a value finds, among others, `Invalid origin: ${originToValidate}` and `Invalid redirect URL: ${url}`. Those quote request data, not secrets. The application does not mount the library's routes and checks `Origin` itself, so whether those lines can be reached was not tested.
- **Label form is not secrecy.** An identifier-shaped value in an error's `name` or `code` passes the SEC-027 form check. That is acceptable while those properties are set by code (SEC-027 residual).

## Tests written

- `tests/security/sec046-047-recheck.test.ts`: 16 plain cases and 1 `it.fails` (SEC-049). The interrupted agent wrote 12 plain cases and the `it.fails` case. This re-check added 4 cases ("each rule refuses on its own"). The file contains only ASCII (`grep -cP '[^\x00-\x7F]'` gives 0) and no backslash-u (`grep -cF '\u'` gives 0).
- `tests/security/sec048-recheck.test.ts`: 12 plain cases, all new. Same ASCII check.
- `tests/security/sec043-045-recheck.test.ts`: header comment and the random-values case changed by the interrupted agent (see SEC-047 above).

Scratch files were deleted before commit: `tests/security/_scratch/` held 24 `env.ts` mutants, two vitest configs, three probes, the pre-fix `http.ts`, and a flipped copy. Some of them held literal non-ASCII characters and a BOM, which made the SEC-040 and SEC-043 hygiene cases fail while the folder existed.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/security/sec046-047-recheck.test.ts tests/security/sec043-045-recheck.test.ts` (files as left by the interrupted agent) | 2 files, 29 passed, 1 expected fail |
| Scratch mutant loop: `ENV_MUTANT=<copy> pnpm exec vitest run --config tests/security/_scratch/vitest.mutant.config.mts` with both files | identity: 29 passed, 1 expected fail. L1 to L11 (list, readers, rule, empty): 2 to 5 failed each. W4, W5: 3 failed. W8: 1 failed. W9: 7 failed. W1, W2, W3, W6, W7, W10, W11: 0 failed |
| The same after the 4 isolating cases were added (`sec046-047` only) | W1, W2, W10, W11: 1 failed each. W3, W6, W7: 0 failed (equivalent, explained above). Identity: 16 passed, 1 expected fail |
| Flipped copy of `sec046-047`, `-t SEC-049` | 1 failed: `"secret1secret2secret3secret4secret5": expected [] to deeply equal [...]` |
| Scratch probe, `PROBE_N=1000000` | 0 refused of 1,000,000 in each of 6 forms; 31 crafted values (results above) |
| Scratch lag-rule probe | Six structural values refused at share 0.5; 0 of 1,000,000 in each of 4 forms at 0.5 and 0.6 |
| `pnpm exec vitest run tests/security/sec048-recheck.test.ts` | 12 passed |
| The same with the pre-fix `http.ts` (scratch config) | 4 failed, 8 passed |
| `pnpm exec prettier --write` and `pnpm exec eslint` on the three test files | eslint exit 0; prettier reformatted `sec046-047` once |
| `pnpm exec vitest run --project security` with `_scratch` present | 2 failed (the SEC-040 and SEC-043 hygiene scans flagged the scratch files) |
| `pnpm exec vitest run --project security` after deleting `_scratch` | 13 files, 520 passed, 4 expected fail, exit 0 |
| `pnpm test` | 57 files; 1 failed, 2134 passed, 4 expected fail; exit 1. The failure is `src/server/auth/library-error.test.ts` > "control: errorResponse given the raw error logs the quoted value": `expected '{"code":"INTERNAL_ERROR","err":{"erro...' to contain 'Zq7SECRETcanary'`. That case asserts the flaw that 5dfa22f removed, so `main` has been red since 5dfa22f. It is not caused by this review (only `tests/security` and `docs` changed). Owner: auth. Replace the control with a case that asserts the new behaviour; do not delete it without a replacement. |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, 111 of 111 import-guard probes |
| `pnpm format:check` | exit 0 (after `prettier --write` on the two docs) |

The 4 expected failures are SEC-041 (2), SEC-042 (1), and SEC-049 (1).

## Not checked

- `pnpm test:integration` was not run. Nothing in this re-check touches the database; the Prisma errors were constructed, not raised by a query.
- `pnpm build` and a real `next start` were not run, so this re-check did not observe that a refused variable or weak secret ends the process, or what Next.js prints for an error thrown before the handler's `try`.
- `src/server/auth/library-error.ts` was read and passed through `errorResponse`. Its own tests (`src/server/auth/library-error.test.ts`) were not re-run separately; they are part of `pnpm test`.
- No dependency audit and no secret scanner in this round.
- SEC-041, SEC-042, the SEC-033 rendering part, the catalog module (T-020), and T-018 remain as before.
