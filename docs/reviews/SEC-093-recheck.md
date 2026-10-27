# SEC-093 independent re-check (session 120)

Reviewer: security agent. Date: 2026-10-27. Tree: `8cafc0a`. Fix under review: `039613d` (`src/server/auth/routes.ts`, `src/server/rate-limit.ts`, `playwright.config.ts`, `tests/security/s116-sign-up-limit.test.ts`). Earlier re-check: `5d1af57` (session 119, no `src` change). Original finding: [S116-security.md](S116-security.md#sec-093-the-second-production-refusal-of-sign_up_rate_limit-reads-the-runtime-node_env-not-the-build-time-one). Register: [../SECURITY.md](../SECURITY.md).

Note on the request: `5d1af57` is the session 119 re-check commit (docs and one test). The code change is `039613d`. Both were read.

**Result: SEC-093 stays FIXED.** No new finding.

A clean scanner run shows only that the scanner found nothing. Passing tests show only that the tested attacks fail. Neither shows that the code is secure.

## Questions and answers

| Question | Result | Evidence |
| --- | --- | --- |
| Can the override be enabled in a production build? | No. `getAuthRuntime` calls `signUpRateLimiter(env.signUpRateLimit)` with one argument. The default `process.env.NODE_ENV` is inlined as `"production"` by `next build`. Any limit other than 5 throws, whatever the runtime `NODE_ENV`. | Fresh build, compiled lines below; `s120-sec-093-recheck.test.ts` |
| Does it fail open or closed? | Closed. The runtime is built inside each handler's `try` (`open`), so the TypeError becomes the standard 500. Sign-up answers 500 with no `Set-Cookie`. Sign-in, sign-out, and session answer 500 too, because they share the runtime. The log line carries only `errorClass: "TypeError"`. | New test, 3 handler cases |
| Can a runtime `NODE_ENV=production` be bypassed? | No. env.ts refuses the variable at start for every value when `NODE_ENV=production`. Values outside `development`, `test`, `production` stop start-up. | `s116-sign-up-limit.test.ts`, `cr-s116-14-...test.ts` (re-run) |
| Can request input reach the limit? | No. The limit comes from `getEnv()`, which takes no argument and parses `process.env` once (`cached ??= parseEnv(process.env)`). `signUpRateLimiter` has one call site in all of `src` (non-test files). `signUpRule` is set only in `getAuthRuntime`. All four auth route files pass the `getAuthRuntime` function itself. `signUpBodySchema` is a `z.strictObject`, so an extra body field is a 400. A header, query, or body named after the limit has no effect. | Static cases in the new test; code read of `routes.ts:91-107`, `152-159`, `250-260`, `env.ts:651-656` |
| Default limit in production | Unchanged. Limit 5 returns the shared `rateLimiter` and `RATE_LIMITS.SIGN_UP` before the production check. | New control case |
| Playwright | The override is in `webServer.env` only, next to `NODE_ENV: "development"`. The runner process does not get it. | `tests/unit/e2e/server-environment.test.ts`, 6 passed |
| Could the inlining change? | Pinned by the session 119 static case on `node_modules/next/dist/build/define-env.js` and the absence of `allowDevelopmentBuild` in `next.config.ts` (re-run, passes). | `cr-s116-14-...test.ts` |

## Build evidence

`$env:NEXT_DIST_DIR = ".next-sec120"; pnpm exec next build` -> exit 0 (Next.js 16.4.3). A search of `.next-sec120/server/**/*.js`:

- `src_server_036rnuoifokz-._.js` and `src_server_1lj21w7f7igwm._.js`: `function(e,i="production"){if(e===o.SIGN_UP.limit)return{limiter:f,rule:o.SIGN_UP};if("production"===i)throw TypeError("The sign-up rate limit cannot be changed when NODE_ENV=production.");`
- `src_server_0xem0d3alyxvu._.js`: `let e=(0,d.y)(),t=(0,p.A)(e.signUpRateLimit);` (`getAuthRuntime`, one argument)

The dir was deleted afterwards. The build rewrote `tsconfig.json` (its formatting and two include lines for the new dist dir); `git diff` showed only that, and it was restored with `git restore --source=HEAD -- tsconfig.json`.

## Commands run

- `git show 5d1af57`, `git show 039613d -- src playwright.config.ts tests`
- `pnpm exec vitest run --project security tests/security/s120-sec-093-recheck.test.ts tests/security/cr-s116-14-sign-up-limit-node-env.test.ts tests/security/s116-sign-up-limit.test.ts` -> 3 files, 43 passed (first run: 1 failure in my own static case, which wrongly counted the multi-line declaration as a call; the pattern was corrected, no product behaviour involved)
- `pnpm exec vitest run tests/unit/e2e/server-environment.test.ts` -> 6 passed
- `pnpm exec prettier --check` and `pnpm exec eslint` on the new file -> clean, exit 0
- `pnpm exec tsc --noEmit -p .` -> exit 0

## Not covered

- `next start` against the build with the override set: not run. The 500 rests on the compiled code and the handler-level simulation (`vi.stubEnv("NODE_ENV", "production")` stands for the inlined value).
- A mutation run of the new test against the pre-fix `routes.ts` (`env.nodeEnv` passed): not run, because `src` is not the reviewer's to edit. The session 116 `it.fails` showed the pre-fix behaviour for `getAuthRuntime`.
- A server started with `next dev` still accepts the override (e2e, on purpose). The wider start-up check (refuse when build-time and runtime `NODE_ENV` differ) stays the owner's choice. Both are in SECURITY.md Residual risks.
- `pnpm audit` and a secret scan were not repeated: the reviewed commits change no manifest, and the new file holds no secret-like value.
