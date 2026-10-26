# SEC-091 re-check: sandbox CSP on uploaded files

Reviewer: security agent. Date: 2026-10-26. Fix: `01c6bf2` ("fix: keep strict CSP on uploaded files (SEC-091)", orchestrator). Tree at re-check: `01c6bf2`. Next.js 16.4.3. Finding: [../SECURITY.md](../SECURITY.md#sec-091-the-global-csp-from-nextconfigts-replaces-the-sandbox-policy-of-uploaded-files). Original review: [T-072-security.md](T-072-security.md).

Result: **FIXED.** For every path that reaches `src/app/api/files/[key]/route.ts`, the config headers now carry `Content-Security-Policy: default-src 'none'; sandbox`, which is the same value the route sets. The site CSP still applies to every other path. `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` still reach file responses.

A passing test shows only that the tested cases hold. It does not show that file responses are safe in a deployment. A clean scanner run would show only that the scanner found nothing.

## The fix

In `next.config.ts:61-66`, `headers()` returns a second rule after the site rule `/:path*`:

```ts
{
  source: "/api/files/:path*",
  headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox" }],
},
```

The commit also changed two tests. In `tests/security/t072-headers-review.test.ts`, the SEC-091 `it.fails` became `it`. In `tests/security/headers-t072.test.ts`, the test now expects two rules and checks that rule 1 is `/api/files/:path*`.

## Why the later rule wins (Next.js 16.4.3, read in `node_modules`)

| Step | Source | Behaviour |
| --- | --- | --- |
| Documented rule | `next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`, "Header Overriding Behavior" | "If two headers match the same path and set the same header key, the last header key will override the first." |
| Loading | `next/dist/lib/load-custom-routes.js` `loadHeaders` | Calls `config.headers()`, validates the result, and runs `processRoutes`. The order is kept. Next.js only `unshift`s its own `Set-Cookie` rule, and only when `deploymentId` and `useSkewCookie` are both set. Neither is set in this project. |
| Matching | `next/dist/server/lib/router-utils/filesystem.js` `buildCustomRoute` | Uses `getPathMatch(source, { strict: true, removeUnnamedParams: true, sensitive: caseSensitiveRoutes })`. The default is case-insensitive. |
| Merge | `next/dist/server/lib/router-utils/resolve-routes.js` "handle headers" | Walks the rules in order. Every matching rule runs `resHeaders[key] = value`, so for one key spelling the last matching rule wins. Both rules spell the key `Content-Security-Policy`. |
| Route handler | `next/dist/server/send-response.js` (read in the T-072 review) | Appends a handler's header only when the outgoing response does not already have it. The config value therefore reaches the browser. It equals the route's value, so the route's header no longer matters. |

## Does the test really model Next.js precedence?

The flipped case in `t072-headers-review.test.ts` mostly does. It walks the rules in order with `getPathMatch` and a `Map` keyed by the lower-cased name, last write wins. That is the same result as the framework for these rules. It differs from the framework in three ways:

1. It calls `getPathMatch(source)` without the router's options (`strict`, `removeUnnamedParams`, `regexModifier`).
2. It skips `loadCustomRoutes`.
3. It folds key case. The framework does not fold key case at the merge step, so two spellings of one header name would give two entries there.

None of these changes the outcome for the current rules. Also, the case has an `if (fromConfig !== undefined)` branch. If both rules were removed, the assertion would be skipped, and the case would pass. The test cannot see the route's own header. That pass is correct only because of `send-response.js`, and no test checks that file.

New file `tests/security/sec091-recheck.test.ts` (6 cases) uses the framework's own pieces. It loads the rules through `loadCustomRoutes(nextConfig)`, builds each matcher with `buildCustomRoute("header", ...)`, and applies the `resolve-routes.js` merge without folding key case. It also fails if two spellings of the CSP name appear. It asserts the following:

- `/api/files/<key>` with `.webp`, `.png`, and no suffix gets exactly `default-src 'none'; sandbox`, plus `nosniff` and `X-Frame-Options: DENY`.
- `/API/FILES/...` and `/Api/Files/...` also get the sandbox. App Router routing is case-sensitive, so these paths never reach the route anyway.
- `/api/files` also gets the sandbox, because `:path*` matches zero segments. No route exists at that path, so the stricter policy has no effect.
- `/`, `/api/v1/cart`, `/api/filesx/abc`, `/api/v1/files/x`, and `/products/p-1` keep the site CSP with no `sandbox`.
- The sandbox rule comes after the site rule. With the two rules swapped, the site CSP wins. This is a negative control, and it shows the model depends on order.
- The route still sets the same sandbox value.

Negative control against the code before the fix: the new file was run against `git show 01c6bf2~1:next.config.ts`, using a temporary copy in `tests/security/` that was deleted afterwards. 4 of the 6 cases failed: the file key paths, the case variants, `/api/files`, and the order check. The first failure was `expected 'default-src \'self\'; script-src \'se…' to be 'default-src \'none\'; sandbox'`. The two cases that held are the site paths and the route source, which is correct.

## Running framework: probe under `next dev`

I did not run `pnpm build` (the orchestrator told me not to), and I did not run `next start`. The project's own server was not started. Instead I built a probe app in the session scratchpad. It is not in the repository and has been stopped. It used this repository's `node_modules` (Next.js 16.4.3) through a junction. Its `next.config.mjs` had the same two rules in the same order: the site rule set `SITE-POLICY` plus `X-Frame-Options: DENY`, and the second rule was the fix's rule verbatim. Its `app/api/files/[key]/route.js` returned `Content-Security-Policy: ROUTE-POLICY` and `nosniff`. I started it with `next dev --webpack -p 3318` and fetched headers with `curl -s -D -`:

| Request | Status | CSP received |
| --- | --- | --- |
| `/api/files/0123456789abcdef.webp` | 200 | `default-src 'none'; sandbox` (plus `X-Frame-Options: DENY`, `nosniff`) |
| `/api/files/abc.webp?x=1` | 200 | sandbox |
| `/api/files/abc%2Ewebp`, `/api/files/%61bc.webp`, `/api/files/a%2Fb`, `/api\files\abc.webp` | 200 | sandbox |
| `/API/FILES/abc.webp` | 404 | sandbox |
| `/api/%66iles/abc.webp` | 404 (does not reach the route) | `SITE-POLICY` |
| `/api/files/abc.webp/`, `//api/files/abc.webp`, `/api//files/abc.webp` | 308 to `/api/files/abc.webp` | n/a (redirect) |
| `/api/other` (route sets `ROUTE-POLICY`) | 200 | `SITE-POLICY` (the config still overrides a route) |
| Rules swapped, `/api/files/0123456789abcdef.webp` | 200 | `SITE-POLICY` (negative control) |

The encoded-prefix request `/api/%66iles/...` is the only path that misses the sandbox rule. It does not reach the file route: the dynamic route matches the raw pathname. It gets the site policy on a 404 page, so nothing is lost.

## What could not be verified

- **The project under `next build` + `next start`.** I did not run `pnpm build`. The precedence was shown with the framework's loader and matcher in a unit test, and end to end only in a probe app under `next dev`. Header routes are built by the same `resolve-routes.js` in dev and in production. However, production loads them from the build's `routes-manifest.json`, and I did not inspect that file. The original finding was reproduced under `next start` with a probe. The fix has not been.
- **A real upload through the project's server.** I did not request a real stored file. No upload exists in the development database, and the server was not started.
- **The container or a reverse proxy over HTTPS.** A proxy or CDN that sets or merges `Content-Security-Policy` could change the header. `scripts/container-smoke.ps1` checks only `HEAD /`. This depends on the deployment.
- **Browser behaviour.** I did not open an uploaded file in a browser to observe the sandbox.

## Observations (no new finding)

- The sandbox policy has no `frame-ancestors` directive. `default-src` does not cover framing. File responses still carry `X-Frame-Options: DENY` from the site rule (shown in the unit test and in the probe), so framing stays denied. The route itself never set `frame-ancestors`, so this is not a regression.
- The policy is now written in two places: `next.config.ts` and the route. `sec091-recheck.test.ts` asserts both, so if one changes without the other, a test fails.

## Commands run

- `pnpm exec vitest run tests/security/sec091-recheck.test.ts tests/security/t072-headers-review.test.ts tests/security/headers-t072.test.ts`: 3 files, 19 passed.
- Negative control: the new file pointed at the pre-fix `next.config.ts` (temporary copies, deleted): 4 failed, 2 passed.
- `pnpm exec prettier --write`, `pnpm exec eslint`, and `pnpm exec tsc --noEmit -p .` on the new file: clean, with no type error in `tests/security`.
- Probe: `next dev --webpack -p 3318` in the scratchpad, `curl -s [--path-as-is] -D - -o /dev/null <url>` (table above). Then the server was stopped: port 3318 has no listener.
