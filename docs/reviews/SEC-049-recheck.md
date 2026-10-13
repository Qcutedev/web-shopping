# Security re-check: SEC-049

Reviewer: security agent, 2026-10-14. Independent re-check. The fix commit, its message, its unit tests, and the DEPLOYMENT.md text were read but not relied on.

Commit re-checked: `51c1dda` ("Refuse lag-pattern and published-prefix AUTH_SECRET values in production (SEC-049)"). Decision behind it: D-036 item 6 (owner chose remediation (a) of SEC-049). Tree: `328dd7e` plus the owner's deletion of `run-agents.ps1` (left untouched). Another agent was editing `src/server/rate-limit.ts` and `src/server/sign-in-rate-limit.ts` (SEC-050) at the same time; those files were not read or run here.

Findings are registered in [SECURITY.md](../SECURITY.md) ("Findings register") with the same ids.

## Verdict

| Item | Verdict | Short reason |
| --- | --- | --- |
| SEC-049 lag patterns and published prefixes | FIXED | All six values of the finding and the further shapes tried (period 5 to 8 with a counter, interleaved runs, hex counting, alternating steps) are refused in production by both readers with the weak rule alone. Each of the two new rules and each constant is needed: nine mutants of `env.ts` each fail at least one case. The lag rule refused no random value in 15 generator forms at 1,000,000 values each. The placeholder rule still wins, the rules are production only, and no value reaches an error or the log. |

New finding:

- **SEC-051 (Low)**: the prefix rule matches only `better-auth-secret` and `integration-test-secret` as written with hyphens. The integration secret with `_` or `.` for `-`, or with no separators, plus two characters changed, is accepted (`integration_test_secret_0123X56789_abcdeXghij`); so is the library default spelled `BetterAuthSecret` or `better_auth_secret_` with its digits edited out of every 8-step run. The fix does what the SEC-049 proposal said; the proposal (security's) was too narrow.

Observation, not registered: a phrase of eight four-letter words joined by dashes is refused by the lag rule about 355 times in 1,000,000 (rhyming neighbours such as `west-east-cast` line up at lag 5). Not a documented generator; the cost is a retry. DEPLOYMENT.md says only that a value from the documented commands is rarely refused; devops may add one sentence about word-list generators.

No Critical or High finding. No production code was changed by this review.

A passing test suite or a clean scanner run shows only that those tests and tools found nothing. It does not prove that the code is secure.

## Scope

| Area | Read |
| --- | --- |
| The fix | `git show 51c1dda` (all four files); `src/server/env.ts` whole, above all `checkAuthSecretForProduction`, `hasPublishedPrefix`, `hasLagPattern`, `isWeakAuthSecret`, `readAuthSecret`, `parseEnv` |
| Callers | `src/server/auth/auth.ts` `getAuth` (order of `getEnv` and `readAuthSecret`); `src/instrumentation.ts` `register` |
| Documents | D-036 item 6 in `docs/DECISIONS.md`; SEC-049 in `docs/SECURITY.md`; `docs/DEPLOYMENT.md` weak-secret section |

## What was checked and the result

| Attempt | Result |
| --- | --- |
| The flipped case | `git show 51c1dda -- tests/security` shows `it.fails(` changed to `it(` and the formatter's reindent; the body and the six values are unchanged. The case passes. |
| Lag rule, each lag | A value that only lag 1 refuses (16 neighbour pairs one code point apart in 32 characters, `KLqr34GH...`) and one that only lag 8 refuses (a 7-character random-looking unit plus a counter, `Kd2Xw9L1Kd2Xw9L2...`) are both refused. Per-lag counts were printed with an instrumented copy to make sure no other lag or rule refuses them. |
| Share boundary | 16 of 32 positions refused, 15 of 32 accepted (the same text with one pair broken). The hex count of the finding sits exactly on the boundary (15 of 30 at lag 2), which is why the share must be `>=` 0.5. |
| Prefix rule | Both prefixes, lower, upper, and capitalised, followed directly or by `-`, `:`, `_` and a random tail: refused by both readers. The same tail without the prefix: accepted. |
| Prefix bypasses | Accepted in production: `better_auth_secret_`, `better.auth.secret.`, `BetterAuthSecret`, `integration_test_secret_` followed by a random tail; `xbetter-auth-secret-...` and `my-better-auth-secret-...` (start only); `better-auth-secre-...` (one letter short); and, with weak tails, the five values of SEC-051. Values with a random tail carry their own entropy; the five weak-tailed values are SEC-051. |
| Other residual weak forms | Accepted: `qwertyuiopasdfghjklzxcvbnm123456`, `1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik,` (keyboard), `changeme-please-this-is-my-secret!`, `correct-horse-battery-staple-shop2026`, `shop-production-secret-2026-10-14`, `2026-10-14T00:00:00Z-shop-secret!` (phrases and dates; beyond any shape rule, known since SEC-049); `Xq7K1p3Zm2Xq7K3p3Zm4...` (period 10 with two counters; lag 9 and 10 are not looked at, and no 8-window is fixed); `secret1secret2secret3` followed by 16 random characters (the pattern covers under half; the random part carries the entropy); `deadbeefcafebabe0123abcd4567ef89`. Refused, as intended: `MyShopSecret2026!MyShopSecret2027!` and `Pa55w0rd!Pa55w0rd@...` (repeated window), `secret01secret02...` and `0f0e0d...` (lag). Recorded under residual risks, not registered: each needs an operator to ignore the generation command and invent a structure of that kind. |
| Placeholder first | `better-auth-secret-not_a_secret-...`, `not_a_secret1not_a_secret2...`, and a lag-8 value with `not_a_secret` inside give one issue, the placeholder rule, in both readers. A mutant that checks the weak rule first fails 2 cases. |
| Short values | A prefixed or lag-patterned value under 32 characters gives the length issue only. |
| Production only | Development and test accept every SEC-049 shape in both readers. A mutant without the production check in `readAuthSecret` fails 3 cases. |
| Non-standard `NODE_ENV` | `readAuthSecret` compares `NODE_ENV` as written, so `Production`, `PRODUCTION`, `production ` and `prod` let it accept a weak value. Not reachable in the server: `parseEnv` refuses those spellings (rule `nodeEnv`), the start-up hook runs `parseEnv` first, and `getAuth` calls `getEnv()` before `readAuthSecret()`. Both points are pinned by a case (the second by reading `auth.ts`). |
| No value in output | A lag-refused and a prefix-refused value with a canary: the error's `String()`, stack, JSON, and issues, and the one start-up log line, hold the rule text and no canary. |
| False refusals | Scratch probe, 1,000,000 values per form, every rule counted. Lag rule: 0 refusals in hex 32, 64, 64 upper case, 128; base64 of 24, 32, 48 bytes; base64url of 32 bytes; two UUIDv4 with dashes; UUIDv4 without dashes; 32 alphanumeric; 32 lower-case letters and digits; 32 printable ASCII; 40 decimal digits; 7 words joined without separator. 355 for 8 four-letter words joined with dashes (318 of them refused by the lag rule alone). Older rules: 1 in hex-64 upper (step), 4 in hex-128 (window 3, step 1), 12 in two UUIDs with dashes (window: the fixed version digit lines up), 93 in 40 digits (distinct 83), 989 in the dashed phrases (a word drawn twice). The documented commands (hex-64, base64-44, base64url-43): 0. |
| Cost | `hasLagPattern` is 8 linear passes; an operator sets the variable, so length is not attacker input. Not measured further. |
| DEPLOYMENT.md | The two new bullets match the code. Its claim of 0 lag refusals in 1,000,000 for 6 forms agrees with this probe. |

## Mutants

Scratch copies of `env.ts` swapped in for `@/server/env` by a scratch Vitest config with an alias (folder deleted). Run against `tests/security/sec049-recheck.test.ts` and `tests/security/sec046-047-recheck.test.ts` (29 cases).

| Mutant | Cases failed |
| --- | --- |
| identity | 0 (28 passed, 1 expected fail) |
| M1 no `hasLagPattern` | 5 |
| M2 no `hasPublishedPrefix` | 2 |
| M3 `MAX_PATTERN_LAG = 7` | 1 |
| M4 `MIN_PATTERN_SHARE = 0.6` | 4 |
| M5 `>` for `>=` | 3 |
| M6 prefix compared without lower-casing | 1 |
| M7 weak check before placeholder check | 2 |
| M8 lag loop starts at 2 | 2 |
| M9 `readAuthSecret` checks production rules in every `NODE_ENV` | 3 |

Which of these the older security file alone would catch was not measured. `src/server/env.test.ts` (owner devops) imports `./env` relatively, so the alias does not reach it, and it was not run against the mutants.

## Tests written

- `tests/security/sec049-recheck.test.ts`: 11 plain cases and 1 `it.fails` (SEC-051). Printable ASCII only and no backslash-u (byte scan: 0 and 0). A flipped scratch copy of the `it.fails` case failed at the first value: `"integration_test_secret_0123X56789_abcdeXghij": expected [] to deeply equal [ { variable: 'AUTH_SECRET', ... } ]`; each of the five values was also run alone through `readAuthSecret` and accepted.
- The random-forms case first included two UUIDs with dashes and 40 decimal digits; a run failed on one of them (older rules refuse 12 and 93 in 1,000,000, too often for a bound of 1 in 5,000). Both were removed, with the reason in a comment. Three runs afterwards passed.

Scratch files deleted before commit: `tests/security/_scratch/` (instrumented copy of `env.ts`, 10 mutants, a Vitest config, probes, a flipped copy).

## Commands and results

| Command | Result |
| --- | --- |
| `git status`; `git show --stat 51c1dda`; `git show 51c1dda -- src/server/env.test.ts docs/DEPLOYMENT.md tests/security/sec046-047-recheck.test.ts` | Tree as described; diff as described above |
| `pnpm exec vitest run tests/security/_scratch/probe.test.ts -t candidate --project security --silent=false` | Crafted values, results above |
| Same, `-t "false refusals"` with `PROBE_N=1000000` | 356 s; figures above |
| Mutant loop: `ENV_MUTANT=<id> pnpm exec vitest run --config tests/security/_scratch/vitest.mutant.config.mts tests/security/sec049-recheck.test.ts tests/security/sec046-047-recheck.test.ts` | Table above |
| `pnpm exec vitest run tests/security/sec049-recheck.test.ts` (three times) | 11 passed, 1 expected fail, each time |
| `pnpm exec vitest run tests/security/sec049-recheck.test.ts tests/security/sec046-047-recheck.test.ts tests/security/sec043-045-recheck.test.ts tests/security/sec039-040-cr66-recheck.test.ts tests/security/t011-env-health-recheck.test.ts tests/security/round7-recheck.test.ts src/server/env.test.ts src/server/auth/config.test.ts` | 8 files, 286 passed, 3 expected fail, exit 0 |
| `pnpm exec eslint tests/security/sec049-recheck.test.ts`; `pnpm exec prettier --write` on the same | exit 0 |
| `pnpm typecheck` (`next typegen && tsc --noEmit`) | exit 0. It writes route types under `.next`; noted because `.next` was shared with the concurrent agent |

## Not run

- The whole security project and `pnpm verify`: the orchestrator asked for targeted runs while backend-api edits `src/server/rate-limit.ts` (shared `.next`).
- `pnpm test:integration`, `pnpm build`, and a real `next start` with a refused secret (the exit on refusal was observed by devops for other variables, not re-run).
- The author's `src/server/env.test.ts` against the mutants (relative import; not reachable by the alias).
- No secret scan or dependency audit: the commit changes no dependency and adds only invented test values.
