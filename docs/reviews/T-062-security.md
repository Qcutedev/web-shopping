# T-062 security review: full pass over the current tree

Reviewer: security agent. Date: 2026-10-28. Tree: `76fb1cd` (main, clean at start). Register: [../SECURITY.md](../SECURITY.md).

Result: **no new finding, and no open Critical or High finding.** The T-062 acceptance ("findings registered; no open Critical or High") holds on this tree. Six Medium findings stay open (SEC-052, SEC-054, SEC-065 partial, SEC-068, SEC-088, SEC-092); each is an owner decision or a scheduled fix, not a regression.

A clean scanner run shows only that the scanner found nothing. Passing tests show only that the tested attacks fail. Neither shows that the application is secure.

## What was run

| Check | Command | Result |
| --- | --- | --- |
| Production dependency audit | `pnpm audit --prod` (pnpm 12.11.2) | "No known vulnerabilities found" |
| Full dependency audit | `pnpm audit --json` | 13 advisories: 5 high, 6 moderate, 2 low. All are in development-only trees: `deepmerge-ts` 7.1.5 (Prisma CLI), `undici` 8.11.2 (through `jsdom`, the Vitest DOM environment), `fast-uri` 3.1.8 (Prisma CLI, `ajv`). None is in `next`, `zod`, `better-auth`, or any runtime package. This is SEC-010 (Low); the advisory count grew from 8 to 13 since 2026-10-26 because `undici` now lists more advisories at the same version (no manifest changed in the commits since). Advisory texts were not read |
| Secret scanner | `gitleaks`, `trufflehog` | Not installed (`which` finds neither). Not substituted by an assumption; see the next row. CI runs `gitleaks git --redact` (`.github/workflows/ci.yml:183`), which was not run here |
| Secret pattern search, tree | `git grep -nIE` for AWS keys, private-key headers, GitHub and Slack tokens, Stripe live keys, Google API keys, JWT-shaped strings, and URLs with a password, excluding `pnpm-lock.yaml` | Only invented fixtures in tests (`Zq7canary`, `SECRETPW`, `${MARKER}`) and one prose line in `docs/SECURITY.md`. No real credential |
| Secret pattern search, history | `git log --all -p -G<same pattern>` over 718 commits, excluding `docs` and the lockfile; `git log --all -S"BEGIN PRIVATE KEY"` | Only the same test fixtures. No private key was ever added |
| Env files in history | `git log --all --name-only` filtered for `.env` | Only `.env.example` |
| Tracked key material | `git ls-files` for `.env`, `.pem`, `.key`, `id_rsa` | Only `.env.example`; `.gitignore` covers `.env*` (except the example), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `/uploads/` |
| `.env.example` | read in full | Placeholders only; the three secret-shaped values contain `not_a_secret` and are refused when `NODE_ENV=production` (SEC-009, SEC-044) |
| Security regression project | `pnpm exec vitest run --project security` | 51 files, 1745 passed, 32 expected fail, exit 0. The 32 expected failures are the `it.fails` reproductions of the findings that are still open; none is a fixed finding |
| Integration and e2e tests | not run | Instructed not to run them (another agent uses the test database) |
| Lint security rules, `next build`, running server | not run | Not part of this pass. Nothing was measured under `next start` |

## What was read (code paths, not documentation)

1. **Guards on every route handler.** For all 62 `route.ts` files under `src/app`, grep for a session guard and an origin or handler wrapper. Every `admin`, `seller`, `me`, `cart`, `checkout`, and `orders` handler calls `requireActor` plus a role helper (`requireRole` or `requireApprovedSeller`) or a service that does; every state-changing handler calls `assertSameOrigin` and `assertContentType`. The routes without a session guard are the public catalog GETs, the health route, the file route (guard inside `openFile`, only for non-public files), and the four auth routes. The Better Auth catch-all handler is not mounted: `find src/app -path "*api/auth*"` and `grep toNextJsHandler|auth.handler` are empty, so the library's own endpoints (password reset, change email, and so on) are not reachable.
2. **Actor construction.** `src/server/auth/session.ts` `loadActor` reads `role`, `isActive`, `storeId`, and `storeStatus` from the database on every request; the cookie cache is off (`auth.ts:145`); a deactivated user gets the same answer as no session. `src/server/auth/actor.ts` `requireRole` throws on an empty role list.
3. **Admin service.** `src/modules/admin/service.ts`: `adminId(actor)` runs `requireRole(actor, "ADMIN")` before any query in the functions read; the audit actor id is `actor.userId`; no function writes `role`. Settings body is `strictObject` with integer bounds (no moderation switch).
4. **Seller scoping.** `src/app/api/v1/seller/products/[id]/route.ts`: `requireApprovedSeller` for writes, `requireRole(actor,"SELLER")` for reads, the service scopes by the session's store. Isolation is covered by T-045 (see register).
5. **Checkout and money.** `src/modules/checkout/service.ts`: the body names only an address and the mock outcome; prices come from `takeStock` (database); the idempotency lookup is by `(userId, key)`; the cart is locked; the 50-line cap runs before any stock statement. `src/modules/payments/provider.ts`: `getPaymentProvider` throws when `NODE_ENV` is `production` (SEC-056), and is resolved before the transaction. Amounts are checked as safe non-negative integers. `mockOutcome` is client-chosen by design and is only reachable where the mock provider is allowed.
6. **Order reads.** `src/modules/orders/repository.ts:95-106`: `findOwnedOrder` and `findOrdersOfUser` carry `userId` in the `WHERE`; a foreign order is a not-found.
7. **Files.** `src/app/api/files/[key]/route.ts`: fixed `Content-Type` from the record, `nosniff`, `default-src 'none'; sandbox`, `Cache-Control` from `FILE_CACHE_CONTROL`, one 404 for every refusal. `next.config.ts` adds a later rule for `/api/files/:path*` so the sandbox policy is not replaced (SEC-091).
8. **Headers.** `next.config.ts` `buildSecurityHeaders`: CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`; `'unsafe-inline'` for scripts and styles is the documented cost of a static CSP, D-046), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS only in production; `poweredByHeader: false`.
9. **Injection and XSS sinks.** `grep` over `src` (non-test) for `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`: no match. Raw SQL: `$queryRaw` and `$executeRaw` appear in 14 non-test files (89 occurrences, all tagged templates in the module repositories, `src/server/health.ts`, and `src/server/db`); `queryRawUnsafe`, `executeRawUnsafe`, and `Prisma.raw(` appear nowhere in `src` outside tests, so no string-built SQL exists. Whether each interpolated value in the 89 occurrences is bound (a tagged template always binds) was not re-read line by line; it rests on the earlier reviews (T-032, T-041, T-050), the `LIKE` escape helpers (`catalog/repository.ts:137`, `admin/repository.ts:90`), and the T-045 isolation suite. `href` and `src` props built from data: `image.url` and `store.logo.url` are server-generated `/api/files/{key}` paths; other `href` values come from route constants or helpers.
10. **SSRF and open redirect.** No server-side `fetch`, `child_process`, or HTTP client in non-component, non-test `src`. Redirects: `redirect(signInHref(...))` in server components and `NextResponse.redirect` in `src/proxy.ts`, both through `safeRedirectPath` (tests in `src/server/auth/redirect.test.ts`). No CORS headers are set anywhere in `src`.
11. **Rate limits.** Wired on checkout, uploads, review creation, seller application, sign-in (address, email, account), and sign-up. Not wired on admin writes (trusted role, audited), cart writes (bounded by the 50-line cap), address writes (bounded by 50), or seller product writes (SEC-069, open).
12. **Deployment files.** `Dockerfile`: runtime stage runs as `USER node`, `NODE_ENV=production`, health check, no secret in `ENV` or `ARG`. `.github/workflows/ci.yml`: actions pinned by commit SHA, a top-level `permissions` block, `pnpm audit --prod` and gitleaks jobs, no `pull_request_target`, `secrets.` not referenced.

## Re-verification of closed findings

The security project (1745 tests) exercises the fixes of SEC-001 to SEC-009, SEC-011 to SEC-028, SEC-030 to SEC-035, SEC-038 to SEC-040, SEC-043 to SEC-050, SEC-053, SEC-055 to SEC-060, SEC-067, SEC-073 to SEC-080, SEC-089 to SEC-091, and SEC-093 as plain tests, and the 32 `it.fails` cases still fail as written, so nothing flipped silently. Source re-read for this pass: SEC-056 (production refusal of the mock provider), SEC-091 (file CSP rule), SEC-090 (admin sees product pictures, `mayServe`), SEC-088's guard layer, SEC-089 (the audit above shows no advisory in `next`, `zod`, `eslint-config-next`). All still hold. No FIXED status was changed.

## Status of the open findings (carried over, not re-opened)

| Id | Severity | State | What blocks |
| --- | --- | --- | --- |
| SEC-052 | Medium | OPEN | Owner decision: filling a signed-in rate-limit rule with cheap accounts |
| SEC-054 | Medium | OPEN | Contract decision: a hidden cart line shows current content |
| SEC-065 | Medium | PARTIAL | Cleanup built (SEC-073 fixed); no takedown path for a served unattached upload |
| SEC-068 | Medium | OPEN | Item 1 re-checked fixed; items 2 to 4 (draft-attachment cap lift) not re-checked |
| SEC-088 | Medium | OPEN | Owner answer on D-024 (a request in flight when an admin is deactivated) |
| SEC-092 | Medium | OPEN | Owner decision: moderation of review text; an admin hide with an audit row is the minimum before launch |
| SEC-010, 029, 036, 037, 041, 042, 051, 057, 061 to 064, 066, 069 to 072, 081 to 087 | Low | OPEN or PARTIAL | See each finding |

None of the six Mediums is exploitable by an unauthenticated caller to read or change another user's data. SEC-092 and SEC-072 together let a seller seed a fake delivered order through a second account and post review text no one can remove; that is the highest-impact open product-abuse path and the one to close first.

## Not reviewed in this pass

- Seller dashboard pages and components (T-044) and storefront pages beyond the guard wrappers: read for guards and unsafe sinks by grep only, not line by line. They have a code review but no separate security review; the isolation lives in the services and routes, which were reviewed.
- Behaviour under `next start` behind a proxy: header precedence, cookie `Secure` handling, and client-address trust were not measured (SR-01, SEC-091 note).
- Database privileges, backups, and the production database user: deployment configuration.
- The e2e suite and the integration suite: not run (shared test database).
- Real payment: none exists. The mock provider is refused in production, so checkout answers 500 in a production build until a real provider is written and reviewed.
- No account recovery or password change exists, so none was reviewed; it is a product gap, not a flaw in what exists.

## Residual risks that depend on deployment

- `NODE_ENV=production` must be set in the deployment: the mock-provider refusal, the HSTS header, the `Secure` cookie, and the sign-up limit refusal key on it (SEC-056, SEC-093).
- `TRUSTED_PROXY_HOPS` or `TRUSTED_CLIENT_IP_HEADER` must match the real proxy chain, or every per-address limit is wrong (SR-01).
- The rate limiter is per process (SEC-030, SR-02): more than one instance multiplies every limit.
- `UPLOAD_DIR` must be a private volume that is not served by the web server directly.
- Run `gitleaks` (CI job) and `pnpm audit --prod` (CI job) on the real remote; they were not run by CI here.
