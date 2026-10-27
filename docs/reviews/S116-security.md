# Session 116 security review: SIGN_UP_RATE_LIMIT override and header session

Reviewer: security agent. Date: 2026-10-27. Commits reviewed: `949285f` (e2e-only `SIGN_UP_RATE_LIMIT`, refused in production) and `2bd6ded` (header sign-up link, signed-in account menu, real cart count). Tree at review: `5d5ffa7`. Register: [../SECURITY.md](../SECURITY.md).

Result: **no Critical, High, or Medium finding.** One new finding:

- **SEC-093 (Low):** the "second" production refusal in `signUpRateLimiter` gets the same runtime `NODE_ENV` that env.ts already checked, so it adds no independent layer. In a `next build` output started with a runtime `NODE_ENV` of `test` or `development`, `SIGN_UP_RATE_LIMIT=1000` passes both checks.

`2bd6ded`: nothing found. The header reads the session on the server, calls the services with the session's actor, and sends only the display name and a number to the client. The menu has no admin or seller link.

A clean scanner run shows only that the scanner found nothing. Passing tests show only that the tested attacks fail. Neither shows that the code is secure.

## Scope

- `949285f`: `src/server/env.ts` (`SIGN_UP_RATE_LIMIT` schema, production refusal), `src/server/rate-limit.ts` (`signUpRateLimiter`, `processStore`, `buildRateLimiter`), `src/server/auth/routes.ts` (`getAuthRuntime`, `handleSignUp`), `playwright.config.ts`, `e2e/support/server-environment.ts`, `.env.example`, `docs/DEPLOYMENT.md` row, `Dockerfile` (`ENV NODE_ENV=production`), `.github/workflows/ci.yml` (NODE_ENV usage)
- `2bd6ded`: `src/components/shell/header-session.tsx`, `account-menu.tsx`, `storefront-shell.tsx`, `site-header.tsx`, `signed-out-nav.tsx`, `cart-link.tsx`, `app-shell.tsx`, the three layouts and `not-found.tsx`, `src/lib/api-client/auth.ts` and `http.ts`, `src/server/auth/session.ts` (`getActor`, `readSession`, `loadActor`), `getProfile`, `getCart`, `src/i18n/fill.ts`, `src/components/user-name.tsx`, `handleSignOut`
- The author's tests (`src/server/sign-up-rate-limit.test.ts`, `src/server/env.test.ts`, `header-session.test.tsx`, `account-menu.test.tsx`) were read, not changed

## What was checked and how

### 949285f: SIGN_UP_RATE_LIMIT

| Question | Result | Evidence |
| --- | --- | --- |
| Set with `NODE_ENV=production` | Refused at start, for every value including `5`, `1`, `0005`, and `abc`. An empty value counts as unset (`raw` maps `""` to undefined) and gives the default 5. | `s116-sign-up-limit.test.ts` "cannot be set in production" |
| `NODE_ENV=staging` or another non-standard value | Refused outright: the `NODE_ENV` schema accepts only `development`, `test`, `production`. | Same file |
| `NODE_ENV` unset | Parsed as `development`, so the override is **accepted**. `next start` and the standalone server set `NODE_ENV=production` when it is unset, and the Dockerfile sets it (lines 34, 67). A custom `node` entry without either would run as development. Residual, the same one SEC-056 lists. | Code read; test "NODE_ENV unset is development" |
| Second refusal in `signUpRateLimiter` | **Not independent (SEC-093).** `getAuthRuntime` passes `env.nodeEnv`, the runtime value env.ts already judged. The function's default, `process.env.NODE_ENV`, is inlined as `"production"` in a build but is never used. | `it.fails` in `s116-sign-up-limit.test.ts`; `.next/server` chunks of the 2026-10-26 build |
| Docker, CI | The image sets `NODE_ENV=production`, so the variable would stop the container at start. The CI e2e job runs Playwright, which sets the variable in its own process for `next dev` (`NODE_ENV: "development"` in `server-environment.ts`). No workflow, Dockerfile, or compose file sets the variable. | Grep of `Dockerfile`, `.github/**`, `e2e/support/**`, `scripts/**`, `package.json` |
| Shared state | Holds. The override limiter is built on the same `processStore` (the `globalThis` table, SEC-030), and keys are `<rule name>:<subject>`. A hit on any other rule through `rateLimiter` counts against the override limiter, and sign-up hits through either limiter use one window. `signUpOverride` is per module copy, but it holds only the rule set, not counts. | `s116-sign-up-limit.test.ts` "shares the process table" |
| Other rules bypassed | No. The override replaces only the rule named `sign-up`. Every other rule keeps its own limit (the author's test). The default `RATE_LIMITS.SIGN_UP` is rejected by the override limiter, so a stale caller fails closed with a TypeError (500) rather than open. `RATE_LIMITS.SIGN_UP` is consumed nowhere else in `src` (grep). | Author's tests; grep |
| Range and type | `^[1-9][0-9]{0,3}$` then `<= 1000`, and `signUpRateLimiter` checks the range again. No `0`, negative, float, or exponent. | Code read; author's tests |
| Secrets | None. `.env.example` carries a commented placeholder only. | Pattern search |

### 2bd6ded: header session

| Question | Result | Evidence |
| --- | --- | --- |
| Session read | `HeaderSession` is a Server Component (no `"use client"`). It calls `getActor(await headers())`, which checks the signed cookie, reads the session with refresh and cookie cache off, and reloads role, store, and `isActive` from the database. A deactivated user gets the signed-out links. It writes nothing. | `session.ts:42-85` read; static case in `s116-header-session.test.ts` |
| Service calls | `getProfile(actor)` and `getCart(actor)` take only the session's actor and scope by `actor.userId`. Both are read-only (`getCart`'s comment says "Writes nothing"). No request value reaches them. | `profile/service.ts:100`, `cart/service.ts:100`; test "called with the session's actor" |
| What crosses to the client | `AccountMenu` receives `{ name }` only and `CartLink` `{ count }` only. The rest of the profile (email, phone, role, store) stays on the server. Tested with an admin profile. | Test "only the name and a number cross to the client" |
| Client bundle | `account-menu.tsx` imports React, `next/link`, `next/navigation`, `UserName`, `th`, `fill`, `ROUTES`, `cn`, and `signOut` from `@/lib/api-client/auth`. Nothing from `@/server` or `@/modules`. `header-session.tsx` and `storefront-shell.tsx` are not client components, and only server files import them (three layouts and `not-found.tsx`). | Static cases; grep of importers |
| Name rendering (XSS, bidi) | The name is a React text child inside `<bdi>` (`UserName`). The `aria-label` is built with `fill`, which uses a replacement function, so `$&` patterns in a name have no effect, and React escapes the attribute. A hostile name renders as `&lt;img ...`. Bidi controls are already refused at the name schema (SEC-033). | Test "a hostile display name is text inside <bdi>" |
| Admin or seller link | None. The menu links `/account` and `/orders` and the sign-out button, the same for every role. | Test "offers no admin or seller link" |
| Sign-out | `POST /api/v1/auth/sign-out` through `apiRequest`: same-origin credentials and `Content-Type: application/json`, so it passes the server's Origin and content-type checks. The server deletes the session row and clears the cookie. A `401` (already gone) is treated as signed out, which is correct. No GET sign-out, so no CSRF-by-link. | `routes.ts:391-423`, `api-client/http.ts:77-91` |
| Caching (Cache Components) | The session part sits behind `Suspense` and reads `headers()`, so it is dynamic per request and is not part of the static shell. No `"use cache"` wraps it. The fallback is the plain cart link, so the fallback holds no user data. | Code read; not observed in a build |
| Errors | A failed session, profile, or cart read degrades to signed-out, fallback name, or no badge, and nothing is logged. Display only; every page and API re-checks the session. `unstable_rethrow` keeps framework control errors. | Code read; author's tests |
| Load | Every rendered page with a session cookie now runs about six reads (session, user, profile, cart lines, visible products, shipping fee). There is no early return for a junk cookie beyond the `hasSessionCookie` name check. Not a finding; noted for capacity. | Code read |

## Findings

### SEC-093 The second production refusal of SIGN_UP_RATE_LIMIT reads the runtime NODE_ENV, not the build-time one

Severity: Low. Status: FIXED (re-checked 2026-10-27, session 119; see "CR-S116-14 and SEC-093 re-check" below). Full entry in [../SECURITY.md](../SECURITY.md#sec-093-the-second-production-refusal-of-sign_up_rate_limit-reads-the-runtime-node_env-not-the-build-time-one).

Remediation in short: at `src/server/auth/routes.ts:94`, refuse when either the inlined `process.env.NODE_ENV` or `env.nodeEnv` is `production`. Then flip the `it.fails` in `tests/security/s116-sign-up-limit.test.ts`. The owner decides on the wider fix: refuse to start when the build-time and runtime `NODE_ENV` disagree.

## Commands run

- `pnpm exec vitest run --project security tests/security/s116-sign-up-limit.test.ts tests/security/s116-header-session.test.ts` -> 2 files, 17 passed, 1 expected fail
- `pnpm exec vitest run --project security` -> 49 files, 1713 passed, 33 expected fail, exit 0
- `pnpm exec prettier --check` and `pnpm exec eslint` on the two new files -> clean; `pnpm exec tsc --noEmit -p .` -> exit 0
- `pnpm audit --prod` (pnpm 12.11.2) -> "No known vulnerabilities found", exit 0. Neither commit changes a manifest or lockfile.
- Secret pattern search: `git show 949285f 2bd6ded` filtered for AWS, private-key, GitHub, Slack, Stripe, Google, JWT shapes, URL credentials, and `password/secret/token/api_key = <12+ chars>`. 1 match, the invented canary `postgresql://shop_app:Zq7canaryPw@db.example.test` in `src/server/env.test.ts`. `gitleaks` is not installed (`Get-Command gitleaks` empty), and a pattern search is weaker than a scanner.
- Inspected `.next/server/chunks/*.js` of the 2026-10-26 build for how `NODE_ENV` reads compile.

## CR-S116-14 and SEC-093 re-check (session 119, 2026-10-27)

Reviewer: security agent. Tree: `690d812` (includes `039613d`). Question from [S116-code-review.md](S116-code-review.md) CR-S116-14: env.ts refuses `SIGN_UP_RATE_LIMIT` only when the runtime `NODE_ENV` is `production`; can a preview or staging environment with another `NODE_ENV` set it?

**Decision: closed for every `next build` output. No change to `src` is needed.** SEC-093 is re-checked and FIXED.

| Path an operator could take | Result | Evidence |
| --- | --- | --- |
| `NODE_ENV=staging`, `preview`, `prod`, `Production`, ` production`, `stage` | Server does not start: the schema accepts only `development`, `test`, `production` (`src/server/env.ts:218-220`). | `cr-s116-14-sign-up-limit-node-env.test.ts`, 7 cases |
| Production build, runtime `NODE_ENV=development` or `test`, `SIGN_UP_RATE_LIMIT=1000` | env.ts accepts it, but `getAuthRuntime` now calls `signUpRateLimiter(env.signUpRateLimit)` with one argument, and the default `process.env.NODE_ENV` is inlined as `"production"`, so it throws. The handler builds the runtime inside its `try`, so every auth route answers 500: fails closed, the limit is never raised. | Fresh `next build` (below): compiled `function(e,i="production"){...if("production"===i)throw TypeError("The sign-up rate limit cannot be changed...` and `t=(0,p.A)(e.signUpRateLimit)` (one argument). Runtime simulation in the new test file and in `s116-sign-up-limit.test.ts` |
| Next.js upgrade changes how `NODE_ENV` is inlined | Pinned. `node_modules/next/dist/build/define-env.js:76` sets it from the `dev` flag or `experimental.allowDevelopmentBuild`, never from the runtime value. A static case fails if that line changes; `next.config.ts` does not set `allowDevelopmentBuild` (static case). | New test file |
| Docker image | `ENV NODE_ENV=production`, `CMD [... "next", "start"]`, no `next dev`. Refused at env.ts and again at the limiter. | Static case |
| A server started with `next dev` (inlined `"development"`) and `NODE_ENV` development or test | **Override accepted.** This is how the e2e suite runs, on purpose. `next dev` is not a deployment mode, and such a server also lacks every other production check (SEC-009, `Secure` cookie, HSTS). Residual, listed in SECURITY.md. | Code read; `e2e/support/server-environment.ts` |

On the suggested "explicit e2e marker" (allow the override only when, for example, `E2E=1` is set): not recommended as a security control. The marker comes through the same channel (process environment) and the same operator as `SIGN_UP_RATE_LIMIT`, so it adds no independent layer; the only case it would still cover is the `next dev` residual, where the larger exposure is the dev server itself. The build-time refusal is the independent layer, and it now holds. The owner may still add a marker as a guard against a copied `.env` on a developer machine; that is hygiene, not a finding.

### Commands run (session 119)

- `$env:NEXT_DIST_DIR = ".next-sec119"; pnpm exec next build` -> exit 0. Separate dist dir so the shared `.next` and e2e were not touched. Grep of `.next-sec119/server/chunks/*.js` gave the two compiled lines quoted above. The dir was then deleted; the build had also rewritten `tsconfig.json` (its own include lines and formatting), restored with `git restore --source=HEAD -- tsconfig.json`.
- `pnpm exec vitest run --project security tests/security/cr-s116-14-sign-up-limit-node-env.test.ts tests/security/s116-sign-up-limit.test.ts` -> 2 files, 31 passed.
- `pnpm exec prettier --check` and `pnpm exec eslint` on the new file -> clean, exit 0.
- `next start` with the override was not run against the build; the 500 behaviour rests on the compiled code and the unit-level simulation.

## Not covered

- `pnpm build` and `next start`: not run in session 116 (session 119 ran `next build` into a separate dir, see above; `next start` still not run). `.next` is shared with `next dev`, and e2e may run in parallel. The inlining claim rests on a build that predates `949285f` (same mechanism, other function).
- The RSC payload of a real page, and a browser run of the account menu and sign-out.
- `f475211` (e2e specs): not in this review's scope.
- Better Auth's own handler: not mounted (routes.ts header). Not re-checked here.
