# T-072 security review: security headers and CSP

Reviewer: security agent. Date: 2026-10-26. Commit reviewed: `9457ac8` (`next.config.ts` `buildSecurityHeaders`, `tests/security/headers-t072.test.ts`, D-046). Next.js 16.4.3. Register: [../SECURITY.md](../SECURITY.md).

Result: **no Critical or High finding.** The header set is sound and the static CSP with `'unsafe-inline'` is acceptable as decided in D-046 (residual risk below). One new finding:

- **SEC-091 (Medium):** the global CSP from `next.config.ts` replaces the stricter `default-src 'none'; sandbox` policy that `/api/files/{key}` sets on uploaded images (T-041, TM-17). Next.js keeps a config header and drops the route's header of the same name. Observed under `next build` + `next start`.

A clean scanner run shows only that the scanner found nothing, and passing tests show only that the tested cases hold. Neither shows that the headers protect every response in a deployment.

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Coverage | Holds. One rule, `source: "/:path*"`, matches `/`, storefront, seller, admin, and API paths (Next.js's own path matcher). `poweredByHeader: false`. | `t072-headers-review.test.ts` "every page path, the root, and API paths" |
| CSP directives | Hold for D-046. Production: `default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' blob: data:`, `font-src`/`connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`; no wildcard, no remote origin, `data:` only for images. `'unsafe-eval'` only when `NODE_ENV` is exactly `development`; unset or `test` gives none. | Author's tests; new directive-parsing case |
| `upgrade-insecure-requests` | Holds: production and `APP_URL` starting `https://` only. `headers()` is evaluated at `next build`, so `APP_URL` must be set at build time (T-071 makes it a build argument); a build without it silently omits the directive. | Code read |
| HSTS | Holds. `max-age=63072000; includeSubDomains`, production only, no `preload`. Deployment dependent: `includeSubDomains` forces HTTPS on every subdomain of the deployed host. | New case |
| Other headers | Hold. `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment, usb, interest-cohort off), `Cross-Origin-Opener-Policy: same-origin`. | Author's tests |
| Interaction with route headers | **Fails, SEC-091.** Next.js 16.4.3 `send-response.js` appends a route handler's header only "if it is not present in the outbound response"; config headers are set first. The file route's sandbox CSP is therefore replaced by the site CSP. | Probe app (below); `t072-headers-review.test.ts` `it.fails` "SEC-091" |
| `'unsafe-inline'` scripts (D-046) | Accepted by owner. Consequence: the CSP gives no protection against injected inline script or event-handler attributes; output escaping is the only XSS control. Static checks (`t020-t018`, `t051`, SEC-033/SEC-057 re-checks, new T-035 case) find no `dangerouslySetInnerHTML` on user content. | Residual risk |

## Reproduction of SEC-091

A two-file probe app in the session scratchpad (not in the repository), using this repository's `node_modules` (Next.js 16.4.3): `next.config.mjs` with one rule `/:path*` setting `Content-Security-Policy: GLOBAL-CONFIG-POLICY`; `app/api/probe/route.js` returning `Content-Security-Policy: default-src 'none'; sandbox`. `next build --webpack`, `next start -p 3317`, `curl -s -D - -o /dev/null http://localhost:3317/api/probe` printed one CSP header, `Content-Security-Policy: GLOBAL-CONFIG-POLICY`. The probe was stopped and nothing of it is in the repository. The project's own server was not started for this (no upload exists in the development database to request).

## Commands run

- `pnpm exec vitest run tests/security/t072-headers-review.test.ts` -> 5 passed, 1 expected fail; the same file with `it.fails` flipped in a temporary copy (deleted) -> 1 failed: `expected 'default-src \'self\'; script-src \'se…' to match /default-src 'none'/`
- Probe: `next build --webpack`, `next start`, `curl -D -` (above)
- `pnpm test` -> 215 files, 5796 passed, 33 expected fail
- `pnpm audit --prod` -> "No known vulnerabilities found"

## Not covered

- The project under `next start` or in the container over HTTPS (`scripts/container-smoke.ps1` checks the headers on `HEAD /` of the container, including `upgrade-insecure-requests`; agent-reported SMOKE OK, not re-run here, and it does not request `/api/files`).
- Which headers the `/_next/static` and `/_next/image` responses carry in production.
- A CSP violation report endpoint (none exists, so violations are not seen).
- Browser behaviour of the CSP on real pages (inline bootstrap, Tailwind styles): not run.
