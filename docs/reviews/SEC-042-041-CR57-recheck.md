# SEC-042, SEC-041, and CR-57 re-check (security, 2026-10-14)

Scope: four commits by auth on 2026-10-13.

- `f139c23`: the sign-in redirect moves from `/login` to `/sign-in` (D-036 item 4).
- `ae8e0d3`: at most 3 combining marks or kept invisible characters in a row in a name (SEC-041, SEC-042, D-036 item 7).
- `510ebe7`: sign-up signs a new user in, and a duplicate email gets a decoy cookie (CR-57, D-036 item 3, D-037).
- `4497d91`: the SEC-032 proposal, text only. It has since been built and re-checked (SEC-032 entry, 2026-10-14), so nothing in it was re-checked here.

Files read:

- `src/modules/auth/schema.ts`
- `src/modules/profile/schema.ts` (the profile and address fields reuse the rule)
- `src/server/auth/routes.ts` (`handleSignUp`, `handleSignIn`, `signInWithLibrary`)
- `src/server/auth/sign-up-cookie.ts`, `src/server/auth/auth.ts`, `src/server/auth/session.ts`
- `src/server/auth/redirect.ts`, `src/proxy.ts`, `src/lib/routes.ts`
- The tests the commits changed or added: `src/modules/auth/schema.test.ts`, `src/server/auth/sign-up-cookie.test.ts`, `src/server/auth/redirect.test.ts`, `src/proxy.test.ts`, `tests/integration/auth/sign-up-sign-in.test.ts`, `tests/security/sec039-040-cr66-recheck.test.ts`, `tests/security/sec034-035-recheck.itest.ts`
- Library sources in `node_modules`:
  - better-auth 1.7.7: `dist/api/routes/sign-up.mjs`, `dist/api/routes/sign-in.mjs`, `dist/cookies/index.mjs` (`setSessionCookie`, `setCookieCache`, `createCookieGetter`)
  - `@better-auth/core` 1.7.7: `dist/utils/id.mjs`
  - better-call 1.4.0: `dist/cookies.mjs`, `dist/context.mjs`, `dist/crypto.mjs`

## Result

| Item | Verdict |
| --- | --- |
| SEC-042 | **Schema part FIXED (re-checked 2026-10-14).** The display part (frontend clipping) stays OPEN. A run of 4 or more characters from `\p{M}` or U+200B to U+200D is refused, wherever it stands, for every kind of mark tried (Mn, Mc, Me, outside the BMP). The profile name and the five address text fields use the same rule. The rule stays linear on 200,000-character inputs. Six one-line mutants of the rule were all caught. One limit remains: the rule counts code points, not marks after normalisation, so a precomposed letter can carry 5 or 6 marks in total (see "Precomposed letters"). |
| SEC-041 | **Still OPEN, partly fixed.** The long invisible run is closed: all 625 runs of four kept characters are refused, and so is the 95-character payload. Still open: a variation selector after a letter that has no emoji form, and two or three kept characters in a row. The owner's answer does not cover either. Both `it.fails` cases still demonstrate them, correctly, and are left as `it.fails`. |
| CR-57 | **No new finding.** The answers for a new email and a duplicate are alike in status, body, header names, and cookie line, apart from the cookie value. The decoy is never signed with the secret. A duplicate never reaches the library's sign-in, so sign-up is not a second way to check a password. Every error path is a 500 with no cookie. Six mutants of `routes.ts` and five of `sign-up-cookie.ts` were tried. Ten were caught. One is equivalent: the library's cookie attributes already hold the same `maxAge`. The enumeration residual named in D-037 is real. It is not new: before CR-57 the same probe was a sign-up followed by one sign-in. |
| D-036 item 4 (`/sign-in`) | **Correct.** `SIGN_IN_PATH` is a constant equal to `ROUTES.signIn`. `next` still goes through `safeRedirectPath`, and `/sign-in` is outside the proxy matcher, so there is no redirect loop. The mutant that sets it back to `/login` was caught by two unit tests. |
| Edit to `tests/security/sec034-035-recheck.itest.ts` | **Not weakened** (see "The itest edit"). |
| Edit to `tests/security/sec039-040-cr66-recheck.test.ts` | **Not weakened.** `git show ae8e0d3 -- tests/security/sec039-040-cr66-recheck.test.ts` shows one `it.fails(` changed to `it(` and a two-line comment added. The body is byte-identical. |

## Evidence

| Check | Tool, command | Result |
| --- | --- | --- |
| What the commits changed | git 2.55.0: `git show --stat f139c23 ae8e0d3 510ebe7 4497d91`; `git show <commit> -- src/ tests/` | As listed in "Scope" |
| Baseline before new tests | Vitest 5.0.3, Node 24.20.0: `pnpm exec vitest run tests/security/sec039-040-cr66-recheck.test.ts src/modules/auth/schema.test.ts src/server/auth/sign-up-cookie.test.ts src/server/auth/redirect.test.ts src/proxy.test.ts` | 5 files, 101 passed, 2 expected fail (the two SEC-041 cases) |
| New re-check file | `pnpm exec vitest run tests/security/sec041-042-cr57-recheck.test.ts` | 28 passed |
| Fix tests and new file together | the six files above plus the new file | 6 files, 129 passed, 2 expected fail |
| Security project | `pnpm exec vitest run --project security` | 20 files, 690 passed, 2 expected fail, exit 0 |
| Mutation | scratch PowerShell script (outside the repository): for each mutant it read the source file's bytes, replaced one line, ran the six files above, wrote the original bytes back, and compared SHA-256 before and after | 18 mutants; 17 caught, 1 equivalent; every file restored byte-identical (hashes matched; `git status` afterwards showed only the new test file and the pre-existing deletion of `run-agents.ps1`) |
| Precomposed letters | scratch test `tests/security/zz-precomposed.test.ts`, run once and deleted | see "Precomposed letters" |
| Lint, format, types | `pnpm exec eslint tests/security/sec041-042-cr57-recheck.test.ts`; `pnpm exec prettier --check tests/security/sec041-042-cr57-recheck.test.ts` (after `--write`); `pnpm typecheck` | exit 0; exit 0; exit 0 |
| Byte check of the new file | PowerShell `[IO.File]::ReadAllBytes`, bytes above 0x7E or control bytes other than LF and CR; `Select-String` for backslash-u | 0; 0 |
| Integration | `pnpm test:integration` | **Not run.** Docker is down, and the instruction was not to run it. The CR-57 integration cases in `tests/integration/auth/sign-up-sign-in.test.ts` and the SEC-035 case of `sec034-035-recheck.itest.ts` have never run against PostgreSQL. |
| Whole suite | `pnpm verify` | **Not run**, as instructed |

### Mutants

Each mutant changed one line. "Caught" means at least one case failed.

| Id | File | Change | Caught by |
| --- | --- | --- | --- |
| S1 | schema.ts | `NAME_MAX_MARK_RUN = 4` | 18 cases: 12 new (all the Mn, Mc, and Me rows, the start-of-name case, the limit), plus `schema.test.ts` |
| S2 | schema.ts | run lookahead removed | 19 cases, among them the flipped SEC-042 case in `sec039-040-cr66-recheck.test.ts` |
| S3 | schema.ts | class `\p{Mn}` in place of `\p{M}` | 4 new cases only (Mc, two Me, random names). **No pre-existing test caught it.** |
| S4 | schema.ts | U+200B to U+200D dropped from the class | 8 cases (new and `schema.test.ts`) |
| S5 | schema.ts | U+200D dropped from the class | 4 cases |
| S6 | schema.ts | `+ 1` dropped (a run of 3 refused) | 15 cases (the Thai words and the three-mark rows) |
| R1 | routes.ts | `equaliseSignInWork` call removed | 1 new case (one verify with the password sent). **No pre-existing unit test caught it.** |
| R2 | routes.ts | decoy line not appended | 3 new cases |
| R3 | routes.ts | duplicate sent down the sign-in path | 4 new cases (sign-in never called for a duplicate, decoy never signed, and others) |
| R4 | routes.ts | previous session not deleted | 1 new case |
| R5 | routes.ts | `createdUserId` falls back to the library's made-up id | 3 new cases |
| R6 | routes.ts | unique-index error with no account answered with the decoy instead of 500 | 1 new case (fails closed) |
| C1 | sign-up-cookie.ts | signature of 31 bytes | 3 cases (new, and `sign-up-cookie.test.ts`) |
| C2 | sign-up-cookie.ts | `maxAge` override removed | **Not caught: equivalent.** The session cookie's attributes already carry `maxAge: options.session?.expiresIn` (better-auth `dist/cookies/index.mjs:49`), so the line does not change |
| C3 | sign-up-cookie.ts | token of 31 characters | 3 cases |
| C4 | sign-up-cookie.ts | `HttpOnly` not written | 6 cases |
| C5 | sign-up-cookie.ts | equaliser does not verify | 1 new case. **No pre-existing unit test caught it.** |
| F1 | redirect.ts | `SIGN_IN_PATH = "/login"` | 2 cases (`redirect.test.ts`, `proxy.test.ts`) |

Before this re-check, nothing ran without a database that noticed R1 to R6 or C5. The integration cases cover several of them, but they have not run. The new file covers them at unit level, with the database module mocked.

## SEC-042 and SEC-041: what was tried

All of these are in `tests/security/sec041-042-cr57-recheck.test.ts`.

1. Ten kinds of four-character runs, each also tested with three:
   - Latin Mn
   - Thai vowels and tone marks
   - Devanagari Mc (U+0903)
   - Me enclosing circle (U+20DD)
   - Me keycap (U+20E3)
   - Mn outside the BMP (U+1D167)
   - half marks (U+FE20 to U+FE23)
   - extended diacriticals (U+1AB0, U+1DC0)
   - variation selectors with joiners
   - marks mixed with U+200B

   Each run was placed at the end of a name, in the middle, and as a whole name after a base. Three in a row is accepted and four is refused in every case.
2. A run at the very start (no base before it) is refused. Surrounding spaces are trimmed before the rule runs.
3. The profile name and the address fields `recipientName`, `line1`, `subdistrict`, `district`, and `province` behave the same as the sign-up name. They import the same regular expression.
4. 3,000 random names over 15 code points (letters, a space, Mn, Mc, Me, the five kept characters, and a non-BMP mark), with a fixed seed. Each name is accepted exactly when its longest run, counted independently one code point at a time, is 3 or less. Both outcomes occur: between 300 and 2,700 names are refused.
5. Time: four hostile inputs of about 200,000 characters (runs of three repeated, a fourth mark at the end, 200,000 spaces, alternating U+200B) are each judged in under 1 s, by the regular expression and by the field schema. The run check is one anchored lookahead with a lazy scan, so the work grows linearly.
6. SEC-041: all 625 runs of four from the five kept characters are refused, after "Admin" and inside it. The 95-character payload of the original finding is refused.

### Precomposed letters

Measured with a scratch test, deleted afterwards:

| Base | Accepted with 3 marks after it | Marks after NFD | NFD form accepted |
| --- | --- | --- | --- |
| U+1EC7 (Vietnamese e with circumflex and dot below) | yes | 5 | no |
| U+01D5 (U with diaeresis and macron) | yes | 5 | no |
| U+1FA2 (Greek omega with psili, varia, and ypogegrammeni) | yes | 6 | no |
| U+0041 | yes | 3 | yes |

The rule counts code points as written. A precomposed letter followed by three marks therefore draws 5 or 6 marks on one base. The SEC-042 remediation named "more than four". The stack is bounded at about twice the height three marks give, against 95 before the fix. The owner's rule ("3 in a row") is met as written. This is not a new finding, but it is why the display part of SEC-042 (clip the name container) is still needed and stays open.

The same measurement shows an inconsistency. The NFC and NFD forms of one visible name can get different answers, because names are not normalised (already in residual risks). A user whose keyboard sends NFD Vietnamese gets at most 2 marks per letter, so no real name is refused by this.

### Usability note (not security)

The limit applies to every script. Some syllables in other scripts carry four or more marks in a row and are refused. Checked example: the Burmese word for "sweat", U+1001 U+103B U+103D U+1031 U+1038. Node's `/\p{M}/u` classes the last four as marks, a run of 4. Tibetan and Indic stacks were not checked one by one. The owner chose the limit for Thai, and this re-check does not dispute it. It is recorded so that a later complaint is recognised.

## CR-57: what was tried

`handleSignUp` itself was called with the database module mocked (`user.findUnique` and `session.deleteMany`) and with a stub of the library's API. The stub keeps the real library instance's cookie name, attributes, and secret. Its `signUpEmail` behaves as better-auth 1.7.7 does with `autoSignIn: false`: a duplicate gets a made-up user whose id matches no row. Its `signInEmail` writes the session line with better-call's own `serializeSignedCookie`. `verifyPassword` of `better-auth/crypto` is wrapped so the calls can be counted.

1. **Same answer.** A new email, a duplicate, and a duplicate in capitals with surrounding spaces give the same status (200), the same body bytes, and the same headers apart from `x-request-id`, once each `Set-Cookie` value is masked. Each answer has exactly one `Set-Cookie` line, and its decoded value has the form 32 characters, a dot, and 43 base64 characters with `=`.
2. **The decoy is no session.** The real line's signature equals `HMAC-SHA-256(secret, token)` in base64. That check reproduces better-call's `signCookieValue`, and was confirmed against the real line. None of 301 decoy values (1 from the route, 300 from `decoySessionCookieLine`) passes it, and all 301 differ. better-call's `getSignedCookie` refuses a value whose signature does not verify before any database lookup, so a decoy reads as signed out at no cost.
3. **No sign-in for a duplicate.** For an existing email, the library's sign-in is never called, whether the password sent is the account's own or another. The sign-up therefore cannot be used to test a password, and cannot give the attacker the holder's session.
4. **Same work.** The duplicate path calls `verifyPassword` exactly once, with the password sent. The new path does not call it (its verify happens inside the library's sign-in).
5. **New email.** The library's sign-in is called once, with exactly the email and password of the sign-up.
6. **Race (unique index).** If `signUpEmail` fails with `FAILED_TO_CREATE_USER` and the account exists, the answer is the decoy, with no sign-in.
7. **Fails closed.** Each of these gives a 500 with no `Set-Cookie`:
   - `FAILED_TO_CREATE_USER` with no account
   - any other library error
   - a failure of the sign-in after the account was created
8. **Schema first.** A name with four marks gives 400 before the library is called, with no cookie.
9. **Rotation.** A session the request came with is deleted by its own token, read from the session the library resolved, for a new and a duplicate email alike. Nothing else is deleted. Without a session cookie, nothing is deleted.

Read but not tested:

- **Extra cookie lines.** `signInEmail` with `rememberMe: true` calls `setSessionCookie(ctx, session, false)`. That writes only the session token line. `dont_remember` is written only when `dontRememberMe` is true, and `setCookieCache` returns at once because the cookie cache is off. A `dont_remember` cookie sent by the client therefore cannot add a line to the new path and leave the duplicate path without one.
- **Token alphabet.** The token in the decoy uses the same alphabet and length as a real session token: `generateId(32)` of `@better-auth/core` uses `a-z`, `A-Z`, `0-9`.
- **Cross-site requests.** Sign-up is refused before anything else when the `Origin` does not match. A login CSRF (a foreign site signing a victim into the attacker's new account) is therefore blocked by step 1, and by `SameSite=Lax` as well.

### Residuals, not new findings

- **Enumeration after the answer.** With the cookie it was given, `GET /api/v1/auth/session` returns an actor for a new email and `null` for a duplicate. D-037 names this. Before CR-57 the same probe was a sign-up followed by a sign-in with the password just chosen. CR-57 removes the sign-in, but the sign-up allowance (5 an hour per address) was the binding cost before and still is. A probe of an unregistered email still creates an account. Closing this needs email verification.
- **Timing under load.** The new path does more database work than the duplicate path: an insert of the user and account, a session insert, and two extra reads. The SEC-035 floor of 250 ms hides this only while the work fits under it. This is unchanged in kind from the existing residual, but the gap is larger now.
- **First duplicate after a process start.** On first use the equaliser also hashes its fixed text once. The first duplicate in a process therefore does one extra scrypt hash, for one sample per process. Its total is three scrypt operations against two, and this stays under the floor while one scrypt operation takes less than about 80 ms.
- **The decoy cookie and the proxy.** A browser that holds a decoy passes the proxy's presence check for `/account`, `/seller`, and `/admin`. The page guards then refuse it, as they refuse any forged cookie (TM-07). This affects usability only.

## The itest edit

`git show 510ebe7 -- tests/security/sec034-035-recheck.itest.ts` adds 13 lines and changes 1, all in the case "sign-up: new, duplicate, duplicate in capitals, and padded duplicate answer alike after the floor".

These are unchanged: the four cases, `status` 200, the floor bound `ms >= FLOOR.minimumMs - TOLERANCE_MS`, the exclusion of `x-request-id` only, the sorted header list, the body, `answers.size === 1`, and the single-user count.

What changed:

- **The masking.** For `set-cookie` only, the value between the first `=` and the first `;` is replaced by `<value>`. The cookie name and every attribute are still compared in full, across all four answers. Any difference in name, `Max-Age`, `Path`, `HttpOnly`, `Secure`, or `SameSite`, or a second line, still fails the case. A value must be masked, because two real session values also differ every time.
- **Two new assertions.** There is exactly one `Set-Cookie` line, and its decoded value has the session form.

Before CR-57 the case also asserted, without saying so, that sign-up sets no cookie. The owner's decision (D-036 item 3) changed exactly that property. So the edit removes no protection that the decision did not remove, and it adds the count and form checks.

Verdict: **not weakened.** The case has not run, because it needs PostgreSQL.

## Register changes

- SEC-042: status changed to "schema part FIXED (re-checked 2026-10-14); display part OPEN". Re-check evidence written.
- SEC-041: status stays OPEN. The partial fix is re-checked. Both `it.fails` cases stay, because each still holds an assertion the code does not meet.
- History table, summary, scans table, and residual risks updated in `docs/SECURITY.md`.
- No new finding. No `it.fails` was flipped in this round: the only finding fixed (SEC-042) was flipped by auth in `ae8e0d3`, and that flip is confirmed above.

## Not done

- `pnpm test:integration`, `pnpm verify`, and `pnpm build` were not run. Docker is down, and the instruction was not to run them.
- No HTTP request was made, and no measurement of the new path's time against the floor. The CR-57 integration cases and the SEC-035 itest case have never run.
- The CR-57 route cases use a stub library and a mocked database. They show that the route's own logic is correct. They do not show what PostgreSQL and the real library do together; that is left to the integration cases.
- The frontend clipping of names (the SEC-042 display part) was not looked for. No page renders a user name yet.
- No dependency audit or secret scan was repeated. The commits change no manifest or lockfile (`git show --stat`).
- A clean run of these tests shows only that these specific attacks fail. It does not show that sign-up or the name rule is secure.
