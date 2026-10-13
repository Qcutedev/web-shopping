# SEC-050 re-check (security, 2026-10-14)

Scope: commit `212a70d` ("Raise sign-in-account capacity to 50,000 windows (SEC-050, D-038)"), owner ruling D-038 (option (a)). Files read: `src/server/rate-limit.ts` (rule table, store, saturation), `src/server/sign-in-rate-limit.ts` (unchanged by the commit), `src/server/auth/routes.ts` (`handleSignUp`, `handleSignIn`), the changed tests (`src/server/rate-limit.test.ts`, `tests/security/t019-server-utilities.test.ts`), `docs/API_CONTRACTS.md` sections 1.8 and 6, D-037 and D-038. A devops agent was editing `src/server/env.ts` (SEC-051) at the same time; that file was not read or run here.

## Result

- SEC-050: **FIXED (re-checked 2026-10-14).** D-038's test is met: keeping `sign-in-account` full now takes about 167 new emails a second, five times the 33 before the fix. The signed-in rules still enforce each user's own limit. Residual: the rule is still the cheapest anonymous rule counted in networks (see "Arithmetic").
- New behaviour of the signed-in rules: **not accepted.** New finding SEC-052 (Medium, open, owner decision needed before the endpoints ship).
- Orchestrator's change to `tests/security/t019-server-utilities.test.ts:521` (120,000 to 160,000): **correct, not weakened.**
- SR-02 table in `docs/SECURITY.md`: updated to the D-038 split, with the cost to fill each rule.

## Evidence

| Check | Tool, command | Result |
| --- | --- | --- |
| What the commit changed | `git show 212a70d` | `RATE_LIMITS` capacities only (`sign-in-account` 50,000; four signed-in rules 10,000 each); limits and windows unchanged; `sign-in-rate-limit.ts` not touched; tests and an API_CONTRACTS note |
| New re-check file | Vitest 5.0.3: `pnpm exec vitest run tests/security/sec050-recheck.test.ts` | 7 passed |
| Fix tests and neighbours | `pnpm exec vitest run src/server/rate-limit.test.ts src/server/sign-in-rate-limit.test.ts tests/security/t019-server-utilities.test.ts tests/security/sec032-recheck.test.ts tests/security/sec050-recheck.test.ts` | 5 files, 304 passed |
| Lint, format, types | `pnpm exec eslint tests/security/sec050-recheck.test.ts`; `pnpm exec prettier --check tests/security/sec050-recheck.test.ts`; `pnpm typecheck` | exit 0; exit 0; exit 0 |
| Integration | `pnpm test:integration` | **Not run**: not needed for capacities, and Docker was down in the previous sessions; not tried |
| Whole suite | `pnpm verify` | **Not run**, as instructed (devops was running checks on `src/server/env.ts`) |
| Mutation | none | **Not run**: `src/` is not mine to edit, and another agent was working in `src/server`. By reading: with `maxKeys: 10_000` restored, the 1,999-network case would fill the rule and the owner would get 429, so that case fails against the old split |

`tests/security/sec050-recheck.test.ts`, part 1 (SEC-050). It uses the real limiter with built-in rules on a simulated clock, the real SR-01 derivation with one trusted hop, and the real check order (`sign-in-address`, then `signInEmailChecks`). The victim's request goes through `handleSignIn` with a stub auth library (401 means the password check was reached, 429 means a limit refused).

1. The split sums to 200,000, and every rule's limit and window are unchanged.
2. Arithmetic (below), pinned in code.
3. 1,999 /64 networks of one /48, each at 5 requests a minute with a new email every time, for 5 minutes: `sign-in-account` holds 49,975 windows, and the owner's sign-in reaches the password check (401).
4. 2,000 such networks: the rule holds 50,000 windows, and the owner gets 429 with `Retry-After` of at most 60. `sign-in-address` holds 2,000 windows and `sign-in-email` at most 30,000, so the account rule is the one that gives way.

## Arithmetic

Keeping a fixed-window rule full takes `maxKeys / window` new subjects a second.

| Rule | maxKeys | Window | New subjects per second | Networks needed (steady state) |
| --- | --- | --- | --- | --- |
| `sign-in-account` before D-038 | 10,000 | 300 s | 33.3 | 400 |
| `sign-in-account` now | 50,000 | 300 s | 166.7 | 2,000 |
| `sign-in-email` | 30,000 | 60 s | 500 | 6,000 |
| Per-email rule before SEC-032 | 40,000 | 60 s | 666.7 | 8,000 |
| `sign-in-address` | 40,000 | 60 s | 666.7 | 40,000 |
| `sign-up` | 40,000 | 1 h | 11.1 | 40,000 |

Networks needed: a network reaches the per-email checks at most 5 times a minute (`sign-in-address`). In steady state it therefore holds 5 `sign-in-email` windows (60 s each) and 25 `sign-in-account` windows (300 s each). At a window boundary a network can send up to 10 requests in a short burst, but this does not change the steady-state count.

What this means:

- The fix raises the cost to fill the rule five times, in emails a second and in networks. That is what D-038 asked for.
- `sign-in-account` is still the cheapest anonymous rule counted in networks. It needs 2,000 networks, against 6,000 for `sign-in-email` and 8,000 for the per-email rule before SEC-032. One IPv6 /48 (65,536 /64 networks) is enough, and so is a modest pool of IPv4 addresses. Filled, it refuses sign-in for every email without a live window, admins included.
- Measured in requests a second, `sign-up` is cheaper (11 a second), but it needs 40,000 networks. The /48 case of `sign-up` is already listed in residual risks.
- SR-02's accepted remainder speaks of "tens of thousands of distinct networks". 2,000 is below that. I recorded this in SR-02 and in residual risks rather than opening a new finding: the owner ruled on this exact trade in D-038 and set the test, and the test is met. If the owner wants the pre-SEC-032 cost back (8,000 networks), options (b) or (c) of SEC-050 are still open, and the saturation warning is how the need would show.

## t019 edit

The case floods each anonymous rule to `maxKeys + 2,000` and asserts that the store holds exactly the sum of the anonymous capacities. That sum is now 40,000 + 40,000 + 30,000 + 50,000 = 160,000. Every assertion is kept: each flooded rule refuses a new subject with `saturated` and `Retry-After` of at most 60, a known subject is still counted, all four signed-in rules still serve, there is one warning per rule with no subject in it, and the windows expire. The literal 160,000 equals the sum; it is not a weakened bound. Computing it from the rules would be tidier, but it is not needed.

## SEC-052 (new, Medium): 10,000 cheap accounts keep a signed-in rule refusing everyone else

See `docs/SECURITY.md` SEC-052. Each signed-in rule now fails closed after 10,000 distinct users in its window (20,000 before). The attack has three inputs:

- **Accounts.** They cost one `sign-up` allowance each and need no email verification (D-037). Sign-up returns a session. 10,000 accounts are 2,000 network-hours of sign-ups: one /48 in an hour, or 100 IPv4 addresses in 20 hours.
- **Requests.** A request counts at step 5, before the body, whatever its outcome (API_CONTRACTS 1.8). The attacker therefore needs no cart, order, or valid body.
- **Addresses.** The signed-in rules have no per-address limit. One client can renew every window.

The cost to keep each rule full after the one-time sign-ups:

| Rule | Requests needed |
| --- | --- |
| `seller-application` | 10,000 a day |
| `review-create` | about 2.8 a second |
| `checkout` | about 167 a second |

`uploads` needs 10,000 approved sellers, so it is not cheap to fill. The effect is a site-wide outage of checkout, new reviews, or seller applications for every user without a live window. Their `Retry-After` of at most 60 s only leads to the next refusal.

This is availability only: nothing fails open, no counter is reset, and no data leaks. Nothing calls these rules yet, so it is not exploitable today. SR-02 accepted the property on 2026-10-11 at 20,000 accounts; D-038 halved that threshold. I do not accept it for `checkout`. The reason is the cost: after one hour of sign-ups, a single client's traffic is enough to stop all sales.

Reproduction: describe "SEC-052" in `tests/security/sec050-recheck.test.ts`.

- `seller-application`: 10,000 user ids keep it refusing a new user at 1 minute, 1 hour, and just before 24 h. After the attacker renews at 24 h, the new user is still refused up to 48 h.
- `checkout`: 10,000 user ids renewed once a minute keep it refusing a new customer in each of three minutes.

These cases pass while the finding is open. The fix must invert or replace them.

Remediation options, in `docs/SECURITY.md`:

- (a) A per-address rule in front of the signed-in rules.
- (b) Per-user counters outside the bounded table, for example on the user row.
- (c) A higher `MAX_TOTAL_WINDOWS`, after measuring memory per window.
- (d) Costlier accounts, through email verification or a minimum account age.
- (e) Accept the risk with a written reason, and alert on saturation.

Security recommends (a) or (b) for `checkout` before it ships.

## Not done

- No mutation run against the old split (see Evidence).
- No measurement of memory per window. That measurement is needed for option (c) of either finding.
- No run in a server, and no HTTP request.
- The whole security project and `pnpm verify` were not run.
- A clean run of these tests shows only that these specific scenarios behave as described. It does not show that the limiter is secure.
