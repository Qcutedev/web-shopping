# Security re-check: SEC-039, SEC-040, CR-66 (AUTH_SECRET at start-up)

Reviewer: security agent, 2026-10-13. Independent re-check; the fix commits, their messages, the fix notes in SECURITY.md, and the authors' tests were read but not relied on.

Commits re-checked: `6cec19c` (SEC-039, SEC-040), `3e62ab8` (fix notes in SECURITY.md), `a561503` (CR-66), `609bcba` (env stubs in tests). Tree: `609bcba` plus the owner's staged deletion of `run-agents.ps1` (untouched).

Findings are registered in [SECURITY.md](../SECURITY.md) ("Findings register") with the same ids. This file records the scope, the method, the evidence, and the verdict.

## Verdict

| Item | Verdict | Short reason |
| --- | --- | --- |
| SEC-039 unassigned, private-use, default-ignorable characters in names | FIXED | Every `Cf`, `Cn`, `Co`, and `Default_Ignorable_Code_Point` scalar value is refused except exactly U+200B, U+200C, U+200D, U+FE0E, U+FE0F. U+1D159 alone is refused. The 11 cases fail on the pre-fix rule and pass now. |
| SEC-040 literal invisible characters in the rule's source | FIXED for the files named | `schema.ts` has no byte above 0x7E; the exceptions are spelled as escapes. Seven literal characters remain in four test files outside auth's paths: SEC-043. |
| CR-66 `AUTH_SECRET` validated at start-up | Rules hold as written | Missing, empty, shorter than 32, and (production) the `.env.example` value are refused by `parseEnv` and `readAuthSecret` alike; no rendering of any refusal and no start-up log line carries the value. Two gaps outside the rules: SEC-044, SEC-045. |

New findings:

- **SEC-041 (Low)**: the five kept invisible characters are accepted anywhere and in any number: about 27 hidden bytes after a visible name; U+FE0E and U+FE0F after Latin letters. Owner decision needed for the Thai characters.
- **SEC-042 (Low)**: combining marks stack without limit on one base ("Zalgo"), so a name can paint over neighbouring UI.
- **SEC-043 (Low)**: literal invisible characters in `src/proxy.test.ts`, `src/server/http.test.ts`, `src/server/logger.test.ts`, `tests/integration/harness/test-database-url.test.ts`; no check covers test files outside `tests/security`.
- **SEC-044 (Low)**: production accepts a 32-character constant, 32 blanks, the library's published default secret, and a secret published in `tests/`.
- **SEC-045 (Medium)**: when `BETTER_AUTH_SECRETS` is set, the library signs with it instead of the validated `AUTH_SECRET` (`1:x` gives the secret "x"), and a malformed entry is written whole into the `error` log through `errorResponse`. Needs an operator to set an undocumented variable.

No Critical or High finding. No production code was changed by this review.

A passing test suite or a clean scanner run shows only that those tests and tools found nothing. It does not prove that the code is secure.

## Scope

| Area | Files read |
| --- | --- |
| SEC-039, SEC-040 | `src/modules/auth/schema.ts` (current and `6cec19c~1`), `git show 6cec19c` for `schema.ts` and `tests/security/sec037-038-recheck.test.ts`; every user of `signUpBodySchema` and `NAME_ALLOWED_TEXT` (`routes.ts`, `bootstrap-admin.ts`) |
| CR-66 | `src/server/env.ts`, `src/server/auth/config.ts`, `src/server/auth/auth.ts` (`createAuth`, `getAuth`), `src/instrumentation.ts`, `.env.example`, `src/server/env.test.ts` (start-up cases), `src/server/http.ts` (`errorResponse`), `src/server/auth/routes.ts` (`mapLibraryError`) |
| Library | better-auth 1.7.7 `dist/context/create-context.mjs`, `dist/context/secret-utils.mjs`, `dist/context/helpers.mjs`, `dist/utils/constants.mjs`; @better-auth/core 1.7.7 `dist/env/env-impl.mjs`; every `env.*AUTH*` read in `dist` |
| Files | Every text file listed by `git ls-files -co --exclude-standard` |

## What was checked and the result

### SEC-039

| Attempt | Result |
| --- | --- |
| Old reproductions | `git show 6cec19c -- tests/security/sec037-038-recheck.test.ts`: only `it.fails(` to `it(`, the formatter's line joins, and the header comment. The 11 SEC-039 cases and the SEC-040 case pass. |
| Do they test the fix | The test file pointed at the pre-fix rule (copy in `tests/security`, deleted): 12 failed, all 11 SEC-039 cases among them. |
| Every candidate code point | All `Cf`, `Cn`, `Co`, `Default_Ignorable_Code_Point` scalar values after a letter, every 61st also at the start and in the middle: only the five kept ones pass. |
| Blank-looking names | U+115F, U+1160, U+3164, U+FFA0, U+2800, U+1D159, U+3000, U+00A0 alone, doubled, or wrapped in kept characters: refused. |
| Normalisation | No accepted scalar value produces a forbidden one under NFC, NFD, NFKC, NFKD. |
| Legitimate names | Thai with marks and U+200B, emoji with U+FE0F or U+FE0E, keycap, ZWJ family, flag, CJK: accepted. |
| Kept characters, placement | "Admin" plus U+FE0F accepted; "Admin" plus 95 kept characters accepted: SEC-041. |
| Combining marks | One letter plus 95 U+0301 accepted; "Admin" plus 90 U+0336 accepted: SEC-042. |
| Other probes | Cyrillic look-alike and NFD forms accepted (known residual, confusables); format characters U+1BCA0, U+13430, U+2062, U+061C refused; IVS U+E0100 and Mongolian U+180F refused (usability note: Japanese ideographic variants and Mongolian are refused). |

### SEC-040

| Attempt | Result |
| --- | --- |
| Bytes of the fixed files | `schema.ts`, `cookies.test.ts`, `sec037-038-recheck.test.ts`, `env.ts`: 0 bytes above 0x7E. `schema.test.ts`: 132, visible Thai letters only. |
| Escapes in the rule | The lookahead and the blank list are written as escapes (asserted by a plain case). |
| Whole repository | 233 text files (234 after this review's new file): seven lines in four test files, as the fix note said: SEC-043. Documents and agent definitions: none. |
| Tool behaviour | Observed again: the file-writing tool turned the escapes of a scratch script into characters (91 bytes), and an edit of SECURITY.md that quoted the rule turned four escapes into U+200B, U+200D, U+FE0E, U+FE0F. That line was rewritten by script and the repository re-scanned clean apart from SEC-043. The new test file uses `String.fromCodePoint` with numbers only. |

### CR-66

| Attempt | Result |
| --- | --- |
| Missing or empty | Refused in development, test, production by `parseEnv` and `readAuthSecret` (rule "is required"). |
| Length | 31 UTF-16 units refused, 32 accepted, both readers, both modes. |
| Placeholder | The exact `.env.example` value (read from the file) refused in production by both readers, accepted outside production as designed. |
| No value in errors | For five refusals (short, placeholder, other variables): message, `String()`, stack, `JSON.stringify`, `util.inspect` contain no part of the secret; no `cause`. |
| No value in logs | `loadEnvAtStartup` with a short secret: one line, no secret. Logging the parsed env object through the logger: secret and database password not written. |
| Start-up order | `instrumentation.ts` calls `loadEnvAtStartup` before anything else and exits 1 on a refusal; `getAuth` calls `readAuthSecret` again, so a lazily created instance obeys the same rule. |
| Weak values | `"x"` times 32, 32 blanks, `better-auth-secret-12345678901234567890`, the integration-test secret: all accepted in production: SEC-044. The library's own low-entropy warning is suppressed by its `error` log level. |
| Library override | `BETTER_AUTH_SECRETS=1:x` makes `x` the signing secret; a malformed entry is quoted in a `BetterAuthError` that `errorResponse` logs: SEC-045. The client's 500 body carries nothing. |

## Tests written

`tests/security/sec039-040-cr66-recheck.test.ts` (no character above 0x7E, no backslash-u escape):

- 14 plain cases: SEC-039 re-check (5), SEC-040 re-check (2), SEC-042 Thai control (1), CR-66 (5), SEC-045 control (1).
- 7 `it.fails` cases: SEC-043 (1), SEC-041 (2), SEC-042 (1), SEC-044 (1), SEC-045 (2). A copy with `it.fails(` changed to `it(` failed all seven on their flaw assertions.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/security/sec037-038-recheck.test.ts tests/security/sec033-name-recheck.test.ts` | 2 files, 42 passed |
| `pnpm exec vitest run tests/security/sec039-040-cr66-recheck.test.ts` | 14 passed, 7 expected fail |
| `pnpm exec vitest run tests/security/sec039-040-cr66-recheck.test.ts tests/security/sec037-038-recheck.test.ts` | 2 files, 35 passed, 7 expected fail, exit 0 |
| `pnpm exec vitest run --project security` | 10 files, 470 passed, 7 expected fail, exit 0 |
| `pnpm test` | 52 files, 2033 passed, 7 expected fail, exit 0 |
| `pnpm exec eslint tests/security/sec039-040-cr66-recheck.test.ts` | exit 0 |
| `pnpm exec prettier --check` on the new file | clean |
| `pnpm typecheck` | exit 0 |
| Scratch scan of `git ls-files -co --exclude-standard` | SEC-043 lines only |

## Not checked

- `pnpm test:integration` was not run: nothing in this re-check touches the database.
- A real `next start` with a refused `AUTH_SECRET` (that the process exits): not run; the hook's exit path was read and its unit tests exist.
- How a browser draws the names of SEC-041 and SEC-042; the effect of `BETTER_AUTH_TRUSTED_ORIGINS` on the library's origin check.
- No secret scanner is installed (`gitleaks`, `trufflehog` not found in earlier rounds; not re-checked); no dependency audit in this round.
- The SEC-033 rendering part (`<bdi>`), the catalog module, and T-018 remain unreviewed.
