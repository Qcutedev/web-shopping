# Security re-check: SEC-033, SEC-034, SEC-035

Reviewer: security agent, 2026-10-13. Independent re-check; the fix commits, their messages, and the author's tests were read but not relied on.

Fix commits: `6bd3542` (SEC-033), `c7dd1cc` (SEC-034), `b2dd578` (SEC-035). Context read: `c1bf5e3` (CR-60, session row deleted at sign-out of a deactivated user), `c58535f` (CR-58, bootstrap `.env` loading).

Findings are registered in [SECURITY.md](../SECURITY.md) ("Findings register") with the same ids. This file records the scope, the method, the evidence, and the verdict.

## Verdict

| Finding | Verdict | Short reason |
| --- | --- | --- |
| SEC-033 bidirectional controls in names | PARTIAL | The schema refusal is fixed and holds against every bypass tried. The rendering part of the remediation (`<bdi>`, frontend) is not built; no screen shows a user name yet. |
| SEC-034 `__Host-` session cookie | FIXED | Every production `Set-Cookie` line is `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`; no other name is read as the session. |
| SEC-035 response time | FIXED | Every failed sign-in and every sign-up waits for the floor; medians within 3 ms on loopback. Holds only while the library's work stays under 250 ms. |

Two new Low findings:

- **SEC-037**: names still accept U+2028 and U+2029, other invisible format characters (U+FEFF, U+2060 to U+2064, U+206A to U+206F, U+FFF9 to U+FFFB, U+180E, U+00AD, tag characters), and names that look blank. Outside SEC-033's remediation, so registered separately.
- **SEC-038**: the library's cookie parser (better-call 1.4.0) trims names with `String.prototype.trim`, so a name padded with U+00A0, U+000B, or U+000C is read as the `__Host-` session cookie. It would undo SEC-034 only if a browser stores and sends a cookie name whose first byte is a raw 0xA0; not verified.

No Critical or High finding. No production code was changed by this review.

A passing test suite or a clean scanner run shows only that those tests and tools found nothing. It does not prove that the code is secure.

## Scope

| Area | Files read |
| --- | --- |
| SEC-033 | `src/modules/auth/schema.ts`, `schema.test.ts`, `bootstrap-admin.ts` (`readBootstrapInput`); every use of `signUpBodySchema` and `NAME_ALLOWED_TEXT` under `src` |
| SEC-034 | `src/server/auth/auth.ts`, `cookies.ts`, `session.ts`, `routes.ts` (cookie forwarding on each route); better-call 1.4.0 `dist/cookies.mjs` (`parseCookies`, `_serialize`) |
| SEC-035 | `src/server/auth/routes.ts` (`waitForFloor`, `handleSignIn`, `handleSignUp`), `config.ts` (`AUTH_RESPONSE_FLOOR`), the session-create hook in `auth.ts` |
| Old reproductions | `tests/security/t015-t016-auth.itest.ts`, diff since `15b9166` |
| Test support | `tests/integration/auth/support.ts` |

## Resumed work

A previous run of this re-check was interrupted and left two uncommitted files. They were read and judged sound: the cases test the claims of the fixes and the new findings, and every `it.fails` case fails on its flaw assertion when flipped. One defect was corrected: the unit file's header said every character was written as an escape, yet it held literal invisible characters (U+202E, U+2028, U+FEFF, and others) in its string literals. They were rewritten as `\u` escapes (visible Thai, Arabic, and Hebrew sample text left as is) and the header was corrected. One plain case was added to the integration file (UTF-8 U+00A0, see SEC-038).

## What was checked and the result

### SEC-033

| Attempt | Result |
| --- | --- |
| Is the refused set the whole Unicode `Bidi_Control` property? | Yes. Enumerated with `/\p{Bidi_Control}/u` over every scalar value: exactly U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069, all refused. |
| Position: start, middle, end, alone, padded with spaces | Refused in every position, for each of the twelve. |
| Trimming: U+00A0, U+FEFF, U+3000 around the name | Refused: zod's `trim()` runs before the pattern and does not remove bidi controls. |
| Among Thai text with U+200B and U+200C | Refused. |
| Bootstrap admin name (`ADMIN_BOOTSTRAP_NAME`) | Refused for all twelve; the error names the variable and does not echo the value. |
| Normalization or case mapping creating a bidi control later | None: no NFC, NFD, NFKC, NFKD form, `toUpperCase`, or `toLowerCase` of any accepted scalar contains one. |
| Partial or code-unit match | The pattern is anchored (`^...$`) and has the `u` flag; astral characters around U+202E do not let it through. |
| Other name entry points | Only the sign-up route and the bootstrap use names; the library's update-user route is not mounted (auth.ts). Store and address names do not exist yet. |
| Legitimate names | Thai, Thai with U+200B or U+200C, Latin, emoji ZWJ sequences, a heart with U+FE0F, Arabic, Hebrew: accepted. |
| Other invisible and layout characters | Accepted: SEC-037 (14 `it.fails` cases). |
| Old `it.fails` cases | The six cases in `t015-t016-auth.itest.ts` are `it` with unchanged bodies and pass. |

### SEC-034

| Attempt | Result |
| --- | --- |
| Every `Set-Cookie` line of a production sign-in | One line, `__Host-better-auth.session_token`, with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`. |
| Every `Set-Cookie` line of a production sign-out (the library also expires its cache and "don't remember" cookies) | Every line has the same attributes and a `__Host-` name. |
| Other set paths | Sign-up and the session route forward no `Set-Cookie` (routes.ts). The CR-60 path (sign-out of a deactivated user) answers 401 with no cookie line. |
| The valid signed token under another name | Not a session under `__Secure-`, the development name, `__host-`, `__HOST-`, `__Host-Better-Auth`, `__%48ost-`, `%5F%5FHost-`, `better-auth%2Esession_token`, or a `.0` suffix. |
| Planted cookie under a non-`__Host-` name, sent first | Does not displace the real one. |
| Library serializer | better-call `_serialize` forces `Secure`, `Path=/`, and no `Domain` for any name that starts with `__Host-`. |
| Name padded with U+00A0, U+000B, U+000C | Read as the session cookie, and wins when sent first: SEC-038 (4 `it.fails` cases). A U+00A0 sent as UTF-8 arrives through Node's latin1 header decoding as U+00C2 U+00A0 and is not trimmed (plain case passes). Browsers refuse a control character in a cookie (RFC 6265bis), which rules out U+000B and U+000C. |
| Old `it.fails` case | Flipped to `it`, body unchanged, passes. Its `every` assertion would also pass on an empty list; the new file asserts the exact list of names. |

### SEC-035

| Attempt | Result |
| --- | --- |
| Failed sign-in paths | Eight states all answer 401 with one body, no cookie, and at least 250 ms: unknown email; wrong password; wrong password with the email in capitals and padded; deactivated with the right and a wrong password; a user without a credential account; a credential account without a password; a wrong password sent with another user's valid session cookie. |
| Deactivated user after the session hook | The second 401 path in `handleSignIn` (actor null after sign-in) also waits (read). |
| Sign-up | New, duplicate, duplicate in capitals, and padded duplicate answer with the same headers and body after at least the floor; one user row for the taken email. |
| Rate-limit refusals | The per-email 429 is identical for a registered and an unknown email and does not wait; the 429s happen before any account read, so their timing does not depend on the account. |
| Where the clock starts | `startedAt` is taken before `readSession`, so a sent cookie's lookup is inside the floor. |
| Distribution | Interleaved, production floor, loopback: sign-in unknown median 271.6 ms (254.1 to 291.6, n 30), wrong password 271.2 (253.1 to 287.0, n 30), deactivated 272.1 (253.8 to 286.2, n 30); sign-up new 269.5 (251.7 to 288.8, n 15), duplicate 272.4 (255.4 to 289.6, n 15). Before the fix (review of T-015): 60.1 against 61.9 ms, 66.9 against 63.8 ms. |
| Not padded | A successful sign-in (needs the password) and a non-401 library error (a 500 not caused by the email alone). When the library's work exceeds the floor (overload) nothing is added: residual risk. |

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run tests/security/sec033-name-recheck.test.ts` | 1 file, 7 passed, 14 expected fail |
| `docker compose up -d --wait` | `marketplace-db-dev-1` and `marketplace-db-test-1` healthy |
| `pnpm test` | 49 files, 1956 passed, 14 expected fail, exit 0 |
| `pnpm test:integration` | Before the added UTF-8 case: 22 files, 830 passed, 5 expected fail (SEC-032 1, SEC-038 4), exit 0. Final run after the added case: 22 files, 831 passed, 5 expected fail, exit 0 |
| `pnpm exec vitest run --config vitest.integration.config.mts tests/security/sec034-035-recheck.itest.ts` | After the added case: 9 passed, 4 expected fail |
| Flipped copies (`it.fails(` to `it(`), deleted afterwards | Unit: 14 failed (`expected true to be false`), 7 passed. Integration: 4 failed (three `expected '<userId>' to be null`, one returned the attacker's id instead of the victim's), 8 passed |
| Scratch timing file `tests/security/zz-timing.itest.ts`, deleted afterwards | Numbers in the SEC-035 table |
| `pnpm exec prettier --write` and `pnpm exec eslint` on the two files; `pnpm typecheck` | Prettier reformatted the unit file; ESLint exit 0; typecheck exit 0 |

## Not covered

- No browser: whether Chrome, Firefox, or Safari stores and sends a cookie name starting with a raw 0xA0 byte (SEC-038), and the browser's own enforcement of the `__Host-` rules.
- Nothing under `next start` or behind a proxy: cookie lines and timing were observed by calling the route functions directly.
- Timing under concurrent load or across a network.
- Rendering of names (no screen shows one yet).
- No dependency audit or secret scan was repeated: the fix commits change no manifest or lockfile (`git show --stat` of each).
