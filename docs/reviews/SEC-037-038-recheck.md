# Security re-check: SEC-037, SEC-038

Reviewer: security agent, 2026-10-13. Independent re-check; the fix commits, their messages, the fix notes in SECURITY.md, and the author's tests were read but not relied on.

Fix commits: `20ee58d` (SEC-037), `dea1fa6` (SEC-038), `51542da` (fix notes in SECURITY.md). Tree re-checked: `70bb2bb`.

Findings are registered in [SECURITY.md](../SECURITY.md) ("Findings register") with the same ids. This file records the scope, the method, the evidence, and the verdict.

## Verdict

| Finding | Verdict | Short reason |
| --- | --- | --- |
| SEC-037 invisible, line-breaking, blank-looking names | FIXED (schema part) | Every character and category the finding and its remediation named is refused or not stored; no single invisible character makes a name. The rendering part stays with SEC-033 (frontend). |
| SEC-038 padded cookie name read as the `__Host-` session cookie | FIXED | The filter tokenizes like the library's parser and rewrites the header, so the library only sees names that `trim()` leaves unchanged. Every `auth.api` call that passes headers goes through it. No bypass found. |

Two new Low findings:

- **SEC-039**: names still accept unassigned (`Cn`) and private-use (`Co`) code points, default-ignorable combining marks, and variation selectors. Some are invisible, and the 256 variation selectors carry one hidden byte each (up to 49 bytes in a name), the same hidden-text channel as the tag characters SEC-037 closed. U+1D159 alone counts as visible and looks blank. Outside the categories SEC-037's remediation named, so registered separately.
- **SEC-040**: `src/modules/auth/schema.ts` lines 33 and 40 hold literal invisible characters (U+200B, U+200D, the Hangul fillers, U+2800) although the comment at lines 44-45 says the source is written with escapes only. A reviewer cannot see what the rule allows. Probable cause: the agents' file-writing tool turns a backslash-u escape in its input into the character itself (it happened to this re-check's own test file, see "Side work").

No Critical or High finding. No production code was changed by this review.

A passing test suite or a clean scanner run shows only that those tests and tools found nothing. It does not prove that the code is secure.

## Scope

| Area | Files read |
| --- | --- |
| SEC-037 | `src/modules/auth/schema.ts`, `schema.test.ts`, `bootstrap-admin.ts` (`readBootstrapInput`, `signUpBodySchema.shape`), `src/server/auth/routes.ts` (`handleSignUp`); every use of `signUpBodySchema` and `NAME_ALLOWED_TEXT` under `src` |
| SEC-038 | `src/server/auth/cookies.ts`, `cookies.test.ts`, `session.ts`, `routes.ts`, `auth.ts`, `src/proxy.ts`, `src/proxy.test.ts`; better-call 1.4.0 `dist/cookies.mjs` (`parseCookies`) |
| Old reproductions | `git diff 6cb51c9 HEAD -- tests/security/` (the two re-check files of the previous round) |
| Call sites | `git grep`-equivalent search for `auth.api.`, `getAuth(`, `better-auth`, `toNextJsHandler`, `headersForAuthLibrary`, `hasSessionCookie` under `src` |

## What was checked and the result

### SEC-037

| Attempt | Result |
| --- | --- |
| Old reproductions | The 14 SEC-037 cases in `sec033-name-recheck.test.ts` were changed from `it.fails(` to `it(`, bodies unchanged (two comments edited); they pass. |
| Every `Cc`, `Cf`, `Zl`, `Zp` scalar value at the start, middle, end | None survives in the parsed name except U+200B to U+200D (kept by decision). A character at an end that zod's `trim()` removes (tab, line feed, U+FEFF, U+2028, U+2029) is accepted but not stored; the stored value is what counts. |
| Lone surrogates (high and low, start, middle, end) | Refused. |
| Blank-looking names | No single character of `Zs`, `Mn`, `Me`, `Default_Ignorable_Code_Point`, or the five fillers makes a name, alone, doubled, or with U+200B to U+200D (enumerated over every scalar value). A Thai vowel sign alone is refused. |
| Visible character that looks blank | U+1D159 (musical symbol null notehead, `So`) alone is accepted: SEC-039. |
| Unassigned and private-use code points next to a letter | 952,198 accepted (814,730 `Cn`, 137,468 `Co`), among them the invisible default-ignorable U+2065, U+FFF0 to U+FFF8, U+E0000, U+E0002 to U+E001F, U+E0080 to U+E0FFF, and the noncharacters: SEC-039. |
| Default-ignorable marks and variation selectors | U+034F, U+17B4, U+17B5, U+180B to U+180D, U+180F, U+FE00 to U+FE0F, U+E0100 to U+E01EF accepted; the variation selectors encode one byte each: SEC-039. |
| Tag characters (ASCII smuggling, the SEC-037 case) | Refused (`Cf`). Only the unassigned tag-plane code points pass (SEC-039). |
| Anchors and flags | `^...$` with the `u` flag; a line separator at either end of the raw pattern input is refused. |
| Legitimate names | Thai with marks and U+200B, ZWJ family emoji, a heart with U+FE0F, a keycap, a flag, apostrophe and hyphen, accented Latin: accepted. |
| Entry points | Sign-up (`routes.ts:192`, `parseInput(signUpBodySchema, ...)`) and the bootstrap (`bootstrap-admin.ts:111`). No other name field exists yet. |
| Source of the rule | Literal invisible characters at `schema.ts:33` and `:40`, contrary to its comment: SEC-040. |

### SEC-038

| Attempt | Result |
| --- | --- |
| Old reproductions | The four SEC-038 cases in `sec034-035-recheck.itest.ts` were changed from `it.fails(` to `it(`, bodies unchanged (one re-wrapped by the formatter); three cases were added. All pass. |
| Parser agreement | better-call `parseCookies` splits on `;`, takes the name up to the first `=`, trims it with `trim()`, keeps the first pair of a name, and skips a segment without `=` by jumping to the last `;` before the next `=`. The filter splits on `;`, splits each part at its first `=`, drops parts without `=`, and drops a pair whose name `trim()` would shorten beyond SP and HTAB; it then rewrites the header as `name=value; ...`. A value cannot hold `;`, and a name cannot hold `=`, so the library tokenizes the rewritten header exactly as the filter did and every name it sees is unchanged by `trim()`. |
| Padding characters a request can carry | The latin1 characters `trim()` removes beyond SP and HTAB that a `Headers` value accepts are exactly U+000B, U+000C, U+00A0 (CR and LF are refused by the Headers API; Node decodes header bytes as latin1, so nothing above U+00FF arrives). |
| Each of them at the start, end, both, mixed with SP and HTAB, attacker's pair first | 18 combinations, each answers with the victim. |
| Two `Cookie` header lines | The Headers API joins them with `; ` (measured), so a second line is a second pair; the padded pair in the first line does not win. |
| Segment without `=`, empty name, `;;;` before the padded pair | Victim. |
| Padded pair inside a quoted value of another cookie | Not the attacker (both parsers split on `;` regardless of quotes). |
| Page path (`getActor` with a `Headers` object, as `await headers()` gives) | Padded pair dropped; a padded pair alone is no session. |
| Sign-out with only a padded attacker cookie | 401, no session ended (`hasSessionCookie` applies the same rule). |
| Neighbouring padded or odd cookies | The real cookie is kept. |
| Call sites | `session.ts:47-50` `getSession`, `routes.ts:198-201` `signUpEmail`, `routes.ts:280-284` `signInEmail`, `routes.ts:310-313` `signOut`: all pass `headersForAuthLibrary(...)`; none passes a `Request`. No mounted library handler, no direct use of a library cookie parser under `src`. The session-create hook in `auth.ts` reads the headers the library was given, which are the filtered copy; only the `Cookie` header differs from the request. |
| Cookie cache and other library cookies | Cookie cache is off (`auth.ts:126`); the filter applies to every pair anyway. |

## New tests

| File | Runs with | Content |
| --- | --- | --- |
| `tests/security/sec037-038-recheck.test.ts` | `pnpm test` | 5 plain SEC-037 cases; 9 `it.fails` SEC-039 cases and 2 `it.fails` enumerations; 3 static SEC-038 call-site cases; source hygiene: no literal invisible character under `tests/security` (plain) and under non-test `src` (`it.fails`, SEC-040). Every non-ASCII character in the file is an escape. |
| `tests/security/sec038-cookie-recheck.itest.ts` | `pnpm test:integration` | 8 plain cases through `handleGetSession`, `handleSignOut`, and `getActor` with production cookie settings. Characters built with `String.fromCharCode`. |

## Side work in `tests/security`

While writing the unit file, every backslash-u escape written through the editing tool landed in the file as the literal character (U+2028, U+200B, U+FE0F, and others). The file was rewritten by a script so that every character above U+007E is an escape, and its bytes were checked. The same scan found literal invisible characters in five older files of this agent: `t015-t016-auth.itest.ts` (the six bidirectional controls of SEC-033), `round7-recheck.test.ts`, `sec019-body-limit-recheck.test.ts`, `sec022-024-json-body-recheck.test.ts`, `sec034-035-recheck.itest.ts` (U+00C2 U+00A0). Each occurrence was inside a string or template literal and was rewritten as an escape by script; the values are identical, no assertion changed (`git diff -- tests/security` on those files: 19 lines changed, each a literal character replaced by its escape, one line re-wrapped by Prettier). The new hygiene case keeps `tests/security` free of them.

## Commands and results

| Command | Result |
| --- | --- |
| `docker compose up -d --wait` | `marketplace-db-dev-1`, `marketplace-db-test-1` healthy |
| `node <scratchpad>/probe-names.mjs` (imports `src/modules/auth/schema.ts`; Node 24.20.0, Unicode 17.0) | The accepted and refused names in the SEC-037 table |
| `pnpm exec vitest run tests/security/sec037-038-recheck.test.ts` | 1 file, 9 passed, 12 expected fail |
| Copy with `it.fails(` changed to `it(` (`tests/security/zz-flip-sec037.test.ts`, deleted) | 12 failed on their flaw assertions (`expected true to be false`; 13 default-ignorable ranges; 952198 `Cn`/`Co`; two `schema.ts` lines), 9 passed |
| `pnpm exec vitest run --config vitest.integration.config.mts tests/security/sec038-cookie-recheck.itest.ts` | 8 passed |
| Same, with the drop line `if (name !== rawName.trim()) continue;` removed from `cookies.ts` (backup restored, `git diff` empty) | 4 of 8 failed, each with the attacker's user id |
| Unit file with `session.ts` passing `headers` unfiltered (restored, `git diff` empty) | The call-site case failed naming `src/server/auth/session.ts getSession` |
| Unit file with `schema.ts` replaced by `git show 20ee58d^:src/modules/auth/schema.ts` (restored, `git diff` empty) | 4 plain SEC-037 cases failed |
| `pnpm test` | 51 files, 1994 passed, 12 expected fail, exit 0 |
| `pnpm test:integration` | 23 files, 846 passed, 1 expected fail (SEC-032), exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, 82 of 82 import-guard probes |
| `pnpm format:check` | exit 0 (after `prettier --write` on the touched test files) |
| `git diff 6cb51c9 70bb2bb` filtered for secret shapes (no scanner installed) | No match |

## Not covered

- No browser: whether a browser stores and sends a cookie name with a raw 0xA0 byte (moot for the session cookie with the filter), and how U+1D159 and the SEC-039 characters render in Chrome, Firefox, and Safari with the project's fonts.
- Nothing under `next start` or behind a proxy: the routes were called as functions.
- The static call-site case sees only `.api.<method>(` written that way; a destructured `api` or an alias would escape it.
- No dependency audit: the fix commits change no manifest or lockfile (`git show --stat` of each).
- The SEC-033 rendering part (`src/components/user-name.tsx`, commit 54a070a) was not re-checked; nothing renders a user name yet.
