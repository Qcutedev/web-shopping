# Security re-check: SEC-043, SEC-044, SEC-045

Reviewer: security agent, 2026-10-13. Independent re-check; the fix commits, their messages, the fix notes in SECURITY.md, and the authors' tests were read but not relied on.

Commits re-checked: `395ec6e` (SEC-043), `c46c52e` (SEC-044, SEC-045), `e362c62` (fix notes in SECURITY.md), and `59ed184`, which carries part of the SEC-043 fix (see below). Tree: `6c1d57c` plus the owner's deletion of `run-agents.ps1` (untouched).

Findings are registered in [SECURITY.md](../SECURITY.md) ("Findings register") with the same ids. This file records the scope, the method, the evidence, and the verdict.

## Verdict

| Item | Verdict | Short reason |
| --- | --- | --- |
| SEC-043 literal invisible characters in four test files | FIXED | The seven lines now spell escapes of the same code points (old line and new line compared after decoding). No invisible or bidi character, invalid UTF-8, or NUL byte in any of the 236 readable files. |
| SEC-044 weak production `AUTH_SECRET` | FIXED, with bypasses registered as SEC-047 | The four values of the finding and the published values with any blank padding are refused by both readers. 8 distinct code points, not 16, is the right threshold. One added character defeats the repetition and distinct-count rules. |
| SEC-045 `BETTER_AUTH_SECRETS` overrides the validated secret | FIXED; item 3 not done (SEC-048); telemetry variables not covered (SEC-046) | `options.secrets ??` wins, so the variable is never parsed. Nine environment forms leave the signing secret unchanged. The four variables are refused by name. The changed test body is not weakened. |

New findings:

- **SEC-046 (Low)**: when `BETTER_AUTH_TELEMETRY` and `BETTER_AUTH_TELEMETRY_ENDPOINT` are both set, the library posts an `init` event (configuration flags, host details, no secret) to that endpoint, even though `createAuth` sets `telemetry: { enabled: false }`. Neither variable is refused.
- **SEC-047 (Low)**: production accepts secrets that are plainly not random: `"password"` four times plus `"1"`, `"a"` 25 times plus 7 letters, the alphabet in order, 25 U+200B plus 7 letters, and the library's default in upper case or with one added character.
- **SEC-048 (Low)**: remediation item 3 of SEC-045 was not done. `errorResponse` logs the message of any library error other than `APIError`. No reachable library error is known to carry a secret now, so this is defence in depth.

No Critical or High finding. No production code was changed by this review.

A passing test suite or a clean scanner run shows only that those tests and tools found nothing. It does not prove that the code is secure.

## Scope

| Area | Files read |
| --- | --- |
| SEC-043 | `git show 395ec6e`, `git show 59ed184` (the parts touching `tests/integration/harness/test-database-url.test.ts` and `tests/security/sec039-040-cr66-recheck.test.ts`); the `isInvisible` and `invisibleInRepository` functions of the latter |
| SEC-044 | `src/server/env.ts` (constants, `checkAuthSecretForProduction`, `isRepetition`, `isWeakAuthSecret`, `readAuthSecret`, `parseEnv`); `git show c46c52e -- tests/security` |
| SEC-045 | `src/server/auth/auth.ts` (whole), `src/server/env.ts` (`AUTH_LIBRARY_VARIABLES`, `checkAuthLibraryVariables`), `src/server/http.ts` `errorResponse`, `src/server/auth/routes.ts` `mapLibraryError` |
| Library | better-auth 1.7.7 `dist/context/create-context.mjs`, `dist/context/helpers.mjs`, `dist/context/secret-utils.mjs`, `dist/cookies/index.mjs`, `dist/utils/url.mjs`; @better-auth/core 1.7.7 `dist/env/env-impl.mjs`; @better-auth/telemetry 1.7.7 `dist/node.mjs`. Every `env.*` read in these `dist` trees was listed with `grep`. Every interpolated `BetterAuthError` message was listed too. |

## What was checked and the result

### SEC-043

| Attempt | Result |
| --- | --- |
| Which commit fixed what | `395ec6e` changes six lines in three files. The seventh line (`tests/integration/harness/test-database-url.test.ts:348`) was fixed in `59ed184`, labelled CR-59, CR-61, CR-63. The flip of the hygiene case from `it.fails` to `it` is also in `59ed184`. The fix note cites `395ec6e` for all of them; corrected in the register. Both diffs touch only the named lines. |
| Same values | A scratch script compared each old line with the new line after decoding its four-digit escapes. All seven lines are identical. The old literals were U+00A0, U+D7FF and U+E000, U+2028 (three times), and U+00A0. None remain at HEAD. |
| Whole repository, by bytes | Strict UTF-8 scan of 238 listed files (236 read). The character class is wider than the test's: it adds `Zs`, `Cc`, `Bidi_Control`, U+00AD, U+FEFF, and U+FFFD. No invalid UTF-8, no NUL, no invisible or bidi character. Visible characters outside the finding: U+FFFD on 8 lines (two in `src/server/http.test.ts`, six in two files under `tests/security`) and one U+0301 at `src/server/http.test.ts:2051`. Noted only. |
| The regression case | The case skips any file that contains a NUL byte, treating it as binary. It also decodes leniently, so a stray Latin-1 byte becomes U+FFFD, which it does not flag. A new case covers both gaps for files with a text extension. It passes. |

### SEC-044

| Attempt | Result |
| --- | --- |
| Values of the finding | `"x"` times 32, 32 blanks, the library default, and the integration secret are refused by `parseEnv` and `readAuthSecret` with `authSecretWeak`. |
| Padding | Both published values with space, tab, LF, CRLF, U+00A0, U+3000, U+FEFF, or U+2028 before, after, or around them are refused. With U+200B appended they are accepted: `trim` does not remove U+200B (SEC-047). |
| Repetition and distinct count | Exact periods, 32 U+00A0, 32 U+200B, and 7 distinct characters without a period are refused. One added character defeats both rules (SEC-047). |
| Unicode tricks | Distinct characters are counted by code point. Lone surrogates repeated are refused. 16 astral characters are refused by the length rule, because zod 4.6.5 counts code points, not UTF-16 units as the comment says. That is stricter than stated, so it is not a finding. |
| 8 or 16 distinct | Measured on 200,000 random values per form. Fewer than 16 distinct: 92.7 % of hex-32 (`openssl rand -hex 16`) and 23.5 % of hex-64 (`-hex 32`). Fewer than 12: 1.7 % of hex-32. Fewer than 8: none in any form. base64url-43 and base64-32: none below 16. A threshold of 16 would refuse correct secrets, so the remediation's 16 was wrong and 8 is accepted. |
| Random values | 12,000 values (base64url of 32 bytes, hex of 16 and 32 bytes, base64 of 24 bytes) are all accepted by both readers (plain case). |
| A stronger rule | Candidate rule (SEC-047 remediation): printable ASCII only, no 8-character substring twice, no 8-character run with a constant step. On 500,000 values per form it refused 0, 0, 0, and 1 (one hex-64 value). It refuses every bypass found except a keyboard row. |
| No value in errors | Refusals of a weak value carry no part of it in `String()`, stack, or JSON. |

### SEC-045

| Attempt | Result |
| --- | --- |
| Library secret path | `create-context.mjs:70`: `options.secrets ?? parseSecretsEnv(env.BETTER_AUTH_SECRETS)`. With `secrets` given, the variable is not parsed, and `secret` is `secretsArray[0].value`. |
| Environment forms | `1:x`, `2:y,1:z`, an entry without version, `abc:def`, `1:`, `" , "`, `BETTER_AUTH_SECRET=x`, `AUTH_SECRET=x`, and all three at once: the signing secret is the validated one and nothing is thrown. |
| Other library reads | `BETTER_AUTH_SECRET` in `cookies/index.mjs` appears only in `getCookieCache`, which nothing calls. `BETTER_AUTH_URL` and five other URL variables lose to `baseURL` (tested for `BETTER_AUTH_URL`). `BETTER_AUTH_TRUSTED_ORIGINS` is appended on every call whatever the options, so the start-up refusal is its only control; it is refused. The telemetry variables override the option and are not refused (SEC-046, shown with a child process and a loopback listener). |
| Refusal | Each of the four variables is refused by both readers in development, test, and production. The error names the variable only and carries no part of the value. An empty value is not refused, and the library ignores it too. |
| The changed test body | Before the fix, the case required the library to throw and then checked that the log carried nothing. The new body requires no error at all and the validated secret in use. The log assertions are kept but can no longer run. The property "the entry does not reach the log" is kept and holds more strongly, so the case is not weakened for SEC-045. What it no longer exercises is `errorResponse` with a library error, which is item 3: it now has its own `it.fails` (SEC-048). |
| Item 3 | Not done. `errorResponse` logs `err: cause`, and the logger writes its message. `mapLibraryError` reduces an `APIError` to its status and code but passes a `BetterAuthError` through unchanged. A canary in a `BetterAuthError` message reaches the log line (SEC-048 case). The interpolated library messages that are still reachable carry configuration names, versions, and URLs, not secrets, so the finding is Low. |
| Pre-fix code | `c46c52e~1` copies of `env.ts` and `auth.ts` were placed in a scratch folder under `tests/security` and deleted afterwards. Against them the new SEC-044 cases fail, the signing-secret case fails with `expected 'x' to be ...`, and the four-variables case fails. |

## Tests written

`tests/security/sec043-045-recheck.test.ts`. It has no character above 0x7E and no backslash-u escape; code points are numbers given to `String.fromCodePoint`.

- 14 plain cases: SEC-043 (2), SEC-044 (6), SEC-045 (5), and a SEC-046 library-behaviour pin (1, child process and 127.0.0.1 listener).
- 3 `it.fails` cases: SEC-046, SEC-047, SEC-048. A copy with `it.fails(` changed to `it(` failed all three on their flaw assertions.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/security/sec043-045-recheck.test.ts` | 14 passed, 3 expected fail |
| Flipped copy `tests/security/zz-flip.test.ts` (deleted) | 3 failed, 14 passed |
| Pre-fix copies in `tests/security/_baseline` (deleted) | SEC-044 and SEC-045 cases fail as described above |
| `pnpm exec vitest run --project security` | 11 files, 489 passed, 6 expected fail, exit 0 |
| `pnpm test` | 54 files, 2064 passed, 6 expected fail, exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, 111 of 111 import-guard probes |
| `pnpm format:check` | exit 0 (run before the SECURITY.md edit; `pnpm exec prettier --check docs/SECURITY.md` clean afterwards) |
| `pnpm exec eslint tests/security/sec043-045-recheck.test.ts`, `pnpm exec prettier --write` on it | exit 0; reformatted once |
| Scratch byte scans (Node 24.20.0) | As in SEC-043 above; the scripts and the new test file contain only ASCII (`grep -P '[^\x00-\x7F]'` count 0) |

The 6 expected failures are SEC-041 (2), SEC-042 (1), and the 3 new ones.

## Not checked

- `pnpm test:integration` was not run: nothing in this re-check touches the database.
- A real `next start` with a weak `AUTH_SECRET` or one of the library variables set (that the process exits) was not run. The refusal was tested on `parseEnv`, `readAuthSecret`, and the implementer's `loadEnvAtStartup` cases.
- Database (Prisma) error messages reaching `errorResponse`: same pattern as SEC-048, not tested.
- The library's origin check with `BETTER_AUTH_TRUSTED_ORIGINS` set at run time after start-up (needs code in the process).
- No dependency audit and no secret scanner in this round (`gitleaks` and `trufflehog` were not installed in earlier rounds; not re-checked).
- SEC-041, SEC-042, the SEC-033 rendering part, the catalog module, and T-018 remain as before.
