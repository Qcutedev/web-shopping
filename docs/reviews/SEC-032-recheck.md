# SEC-032 re-check (security, 2026-10-14)

Scope: commits `9f039fb` and `2d00506`. Files read: `src/server/sign-in-rate-limit.ts`, `src/server/rate-limit.ts` (rule table, store, sweep, saturation), `src/server/auth/routes.ts` (`handleSignIn`, `consume`), `src/modules/auth/schema.ts` (`email`, `emailRateLimitSubject`), better-auth 1.7.7 `dist/api/routes/sign-in.mjs` (how the library looks up the email), the changed tests.

## Result

- SEC-032: **FIXED (re-checked 2026-10-14) at unit and route level.** One address cannot keep an account from signing in. A successful sign-in (200) through the database was not run: Docker was down, so the integration cases were not run.
- SR-02 capacity split: **not accepted as final.** New finding SEC-050 (Medium). It needs an owner decision.
- `Retry-After` cap of 60 s on sign-in: **accepted**, with a corrected reason (see below).
- Arithmetic ("one address adds at most 29; three addresses are needed"): **correct**, with one qualification.
- Edit of `tests/security/t019-server-utilities.test.ts`: **not weakened.**

## Evidence

| Check | Tool, command | Result |
| --- | --- | --- |
| The fix's unit tests | Vitest 5.0.3: `pnpm exec vitest run src/server/sign-in-rate-limit.test.ts src/server/rate-limit.test.ts tests/security/t019-server-utilities.test.ts` | 3 files, 287 passed |
| New re-check file | `pnpm exec vitest run tests/security/sec032-recheck.test.ts` | 7 passed |
| Lint, types | `pnpm exec eslint tests/security/sec032-recheck.test.ts`; `pnpm typecheck` | exit 0; exit 0 |
| Integration | `pnpm test:integration` | **Not run**: Docker is down. These never ran: the flipped `it` and the three new or changed SEC-032 cases in `tests/security/t015-t016-auth.itest.ts`, and the changed case in `tests/integration/auth/limits-and-cookies.test.ts` |

`tests/security/sec032-recheck.test.ts` runs `handleSignIn` itself. It uses the built-in rule set on a simulated clock, the SR-01 derivation with one trusted hop, and a stub auth library: a 401 means the request reached the password check, and a 429 means a limit refused it. Cases:

1. After five attempts from one address, that address gets 429 with `Retry-After` of at most 60. The owner from another address still reaches the password check.
2. One address at full rate for ten simulated minutes never causes the owner's once-a-minute attempt to be refused.
3. Bypass by spelling: letter case, surrounding ASCII space, U+00A0, and U+3000 all reach the library as one account. The library lower-cases the email itself. The schema rejects full-width letters, U+212A, U+0130, and U+200B (probed with `node -e` against the schema's own zod chain).
4. Spellings of one email increment one `sign-in-email` subject and one `sign-in-account` subject.
5. Address spoofing: entries a client writes to the left of the trusted hop in `X-Forwarded-For` do not give it a new address. The 6th attempt is still 429.
6. Plus-addressing: `owner+x@` is a different account for the library, so it gets a different counter by design. It cannot be used against `owner@`.
7. A full `sign-in-account` rule keeps the owner's live counter through a sweep, with nothing evicted and no reset. A new email is refused (fails closed) with `Retry-After` of at most 60.

Not done: a mutation run of the new file against the pre-fix code. `src/` is not mine to change. The implementer reports that 7 of 11 unit cases fail with the old single check.

## Arithmetic

The claim holds. One address has fixed 60 s windows that start at its own first hit. At most six of them overlap one 300 s `sign-in-account` window, and if six do, the first began with a hit before that window, which leaves 4 + 5 × 5 = 29 hits. Two addresses add at most 58, so the owner's **first** attempt in a window is at most the 59th and is allowed. Three addresses can fill the window.

The qualification: the owner's own attempts count in the same window. With two attacking addresses at their strongest timing, the owner's 59th and 60th attempts are allowed and the 61st is refused, so an owner who mistypes the password once or twice can be refused until the window ends. The statement "two addresses cannot keep the owner out" is true only for an owner who succeeds within two attempts in that window. Lowering the limit does not change this. It is part of the per-account residual risk.

## Retry-After cap (60 s)

Accepted. The cap is not an SR-01 matter, as the implementer suggested; it is SEC-032 item 4, "a 429 does not say which limit refused". The limiter state is unchanged, and a client that retries early is refused again, so nothing weakens. Its value as concealment is small. A 429 to the first request from a fresh address can only come from `sign-in-account` or saturation, whatever `Retry-After` says. The only fact that can be learned is that an email was tried about 60 times in 5 minutes, and an unknown email is counted the same way, so existence is not disclosed. The cost is UX only: an honest client may be refused for up to 5 minutes in steps of 60 s.

## t019 edit

The case keeps every assertion and floods one more rule (`sign-in-account`). The store total is still 120,000, and the warning count now follows the number of rules flooded (4 instead of the literal 3). The test is stronger, not weaker. The flipped `it.fails` case in `t015-t016-auth.itest.ts` has an unchanged body, with formatting changes only. The "pins the cost" case pinned the flaw and now pins the fix, which is the intended change.

## SEC-050 (new, Medium): `sign-in-account` is the cheapest anonymous rule to fill

See `docs/SECURITY.md` SEC-050. `sign-in-account` holds 10,000 windows of 300 s each. Compared with the old `sign-in-email` (40,000 windows of 60 s), keeping it full takes about one twentieth of the distinct emails per second, and therefore of the addresses that pass `sign-in-address`. While it is full, every sign-in for an email that has no live window is refused, admins included. It fails closed, as SR-02 requires, but at a far lower cost than the threshold SR-02's accepted remainder had in mind ("tens of thousands of distinct networks").
