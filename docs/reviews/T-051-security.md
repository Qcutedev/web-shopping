# T-051 security review: admin pages and components

Reviewer: security agent. Date: 2026-10-23. Commits reviewed: `854fd13` (admin pages, API client, shared admin components) and `89f9957` (component tests, renames for the SEC-057 scan). Tree at review: `ec243f5`, clean. Register: [../SECURITY.md](../SECURITY.md). Threat rows: TM-07, TM-15.

Result: **no Critical finding.** The access guard of the pages holds, the client components reach no server code, and text written by sellers and customers renders as escaped, isolated text. One new finding:

- **SEC-090 (High):** the product review page shows the pictures of a product awaiting approval through `/api/files/{key}`, which refuses an admin session (SEC-068 item 1). The admin approves without seeing the pictures, and they become public on approval. Picture moderation (BR-17, BR-18) does not happen.

SEC-089 (High, `next` 16.4.0 advisories) is still open: `pnpm audit --prod` gives the same three advisories. Under AGENT_WORKFLOW.md "Review gates" item 4, T-051 is not done while SEC-089 or SEC-090 is open. Update 2026-10-23: SEC-090 is fixed and re-checked ([SEC-090-recheck.md](SEC-090-recheck.md)); SEC-089 was not re-checked there.

A clean scanner run shows only that the scanner found nothing. Passing tests show only that the tested attacks fail. Neither shows that the admin pages are secure.

## Scope

- The 13 files under `src/app/admin/` (12 pages and the layout)
- The 36 non-test files under `src/components/admin/`, including `client-schemas.ts`, `with-admin.tsx`, `queries.ts`, `action-button.tsx`, `categories-panel.tsx`, `settings-form.tsx`, and every section, table, and view
- `src/lib/api-client/admin.ts` and `http.ts`, `src/components/account/request-error.tsx`, `src/lib/routes.ts` (`signInHref`), `src/server/auth/redirect.ts`, `src/proxy.ts`
- `src/components/shell/*` (no admin link)
- `src/modules/uploads/service.ts` (`mayServe`), `src/modules/admin/schema.ts` (DTO shapes)
- The author's tests under `src/components/admin/*.test.ts(x)` were read for their mocks only; nothing was taken from their cases

## What was checked and how

| Area | Result | Evidence |
| --- | --- | --- |
| Page guard (TM-07) | Holds. Each of the 12 pages renders static copy and one section; no page or the layout imports `src/modules`, `src/server`, or the API client, and none is a route handler or a server action. Each section calls `renderForAdmin`, and every use of an `@/modules/admin` value in `src/components/admin` sits inside the callback passed to it. `renderForAdmin` reads the session through `getActor`, redirects a visitor to `/sign-in?next=...`, returns the refusal state for a customer or seller, and runs the callback only for `ADMIN`. The services check the role again (T-050). The query parsing before the guard reads only the address bar. | `t051-admin-ui.test.ts`, "the admin pages hold no data access" (page list pinned), "no admin service is reached before the session and role are read" (AST walk, with a control), "renderForAdmin decides on the role before calling its callback" |
| Proxy | Holds as a convenience only: `/admin/:path*` without a session cookie is redirected to sign-in, with `next` passed through `safeRedirectPath`. It is not the boundary. | Code read; `src/proxy.test.ts` (author's) |
| Open redirect | Holds. `returnTo` and `retryHref` are fixed admin paths or `adminProductHref(id)` / `adminOrderHref(id)`, with the id percent-encoded; `signInHref` encodes it, and the sign-in page re-checks it (TM-19). | Code read |
| Storefront header | Holds. No file under `src/components/shell`, and no file under `src/app`, `src/components`, or `src/lib` outside the admin area, names `/admin` or the admin routes. | "the storefront shell links to no admin page" |
| Client bundle (rule 7) | Holds. The 9 Client Components under `src/components/admin` reach, through runtime imports followed to the end, no file of `src/server/db`, `src/server/auth/session.ts`, `src/server/env*`, `src/server/logger*`, no module `service`, `repository`, or `index`, not `src/modules/admin/schema.ts`, `queries.ts`, or `with-admin.tsx`, and no `pg`, `@prisma/*`, `next/headers`, or `node:*`. Types from the admin schema are imported with `import type` only. `client-schemas.ts` imports only `zod` and the name pattern of `src/modules/auth/schema.ts`; `action-button.tsx` imports the reason schema of `src/modules/sellers/schema.ts`, which reaches `sellers/state.ts` and `server/errors.ts` (pure). | "the admin client components reach no server code" (one case per file, control on `dashboard-section.tsx` which does reach the session and the db) |
| Secrets and PII to the client | Holds for secrets: no DTO carries a password hash, session, token, IP, or browser detail (T-050). The list pages hand whole DTOs to Client Components, so the payload carries fields not shown (for example every order's delivery address on the order list). The viewer is an admin entitled to each of them; recorded in residual risks as data minimisation, not a finding. | Code read of the DTO types and every table |
| Stored XSS (TM-15) | Holds. Product title, description, SKU, category, store name, moderation note; applicant name and email, store name, description, review note; store name, slug, status reason; user name, email, store name; delivery address, store name, item title, carrier, tracking number: each with markup, `<script>`, an `onerror` attribute, and a right-to-left override renders escaped, inside `<bdi>`. Audit metadata is `JSON.stringify` as text inside `<pre>`; a value holding `</pre></details><script>` cannot close either element. No admin file uses `dangerouslySetInnerHTML`, `innerHTML`, `javascript:`, `eval`, or `new Function`. Ids, phone numbers, order numbers, and postal codes are shown bare; they are server-made or pattern-checked. | "seller and customer text renders as isolated, escaped text (TM-15)" (7 cases) |
| Links built from data | Holds. Every `href` is a constant admin path, `adminProductHref` / `adminOrderHref` (encoded), a query with `encodeURIComponent` (store id, report days) or a fixed enum value, or `listHref` over `URLSearchParams`. No `href` takes seller or customer text. | Code read |
| CSRF | Holds. Every mutation goes through `src/lib/api-client/admin.ts` to `/api/v1/admin/...` with `Content-Type: application/json`, `credentials: "same-origin"`, `cache: "no-store"`, and the id percent-encoded into one path segment; the server checks `Origin` and the content type before the session (T-050). The filter and report forms are `GET` and change nothing. No server action exists. | "admin mutations go to /api/v1/admin as same-origin JSON" (all 14 exported calls) |
| Role and ownership in the UI | Holds. Buttons follow the server's rules only to save a refused click (self-deactivation hidden, decisions only on `PENDING`, transitions from `isFulfilmentTransitionAllowed(..., "ADMIN")`); the server decides each request. `contentRevision` sent with a decision is the one read with the content shown on the same page, so an approval cannot apply to text the admin did not see. Not so for pictures: SEC-090. | Code read |
| Moderation of pictures | **Fails** (SEC-090). The review page and the queue render `<img src="/api/files/{key}">`; `mayServe` serves a non-public picture only to a `SELLER` of the owning store, so the admin gets 404 and an empty box with no message. | `t051-admin-ui.itest.ts` "SEC-090" |
| Money input | Holds. The settings form converts baht to integer satang with `parsePriceInput` and whole percent to basis points with integers; the client schemas copy the server bounds (`client-schemas.test.ts` compares them); the server validates again. | Code read |
| Error leakage | Holds. A failed read shows fixed Thai copy and a retry link; an unexpected error's message is never rendered. Request errors map the code and the `reason` to Thai copy; the English `message` is never shown. | "an unexpected error inside the callback is not shown to the admin"; code read |
| Indexing | Holds. Every page sets `robots: { index: false, follow: false }`. | Page cases |
| Dependencies | SEC-089 unchanged. | `pnpm audit --prod` |
| Secrets in the commits | 0 matches. `gitleaks` not installed. | `git show 854fd13 89f9957` with PowerShell `Select-String` |

The rename commit `89f9957` changed `title` to `heading` on Thai copy objects and the frame's prop, which the SEC-057 scan flagged as product-title reads. Each renamed value is Thai copy, not a product title, so the rename does not hide a title read. Every real product title read in the admin files (`product.title`, `item.productTitle`) is the sole child of `UserName`, and the SEC-057 scan passes.

## Findings

Full entries, with reproduction and remediation, are in [../SECURITY.md](../SECURITY.md).

- **SEC-090 (High), FIXED 2026-10-23** by BR-41 (commit 027edfa); re-check in [SEC-090-recheck.md](SEC-090-recheck.md). Original entry: the admin product review page cannot show the pictures it asks the admin to approve. Reproduction: `tests/security/t051-admin-ui.itest.ts`, describe "SEC-090". A documented case shows today's state: the admin DTO links `/api/files/{key}`, the owner gets 200, and the admin gets 404. The `it.fails` case asserts that the admin reads every picture; flipped in a temporary copy (deleted), it failed with `AssertionError: expected 404 to be 200`. Remediation: a rule and a build for an admin read of non-public product pictures (API_CONTRACTS 5.8 already asks for one), with the SEC-068 re-check adjusted. Until then, the page must not offer approval without the pictures, or it must say that they could not be loaded.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --project security` (before the new files) | 41 files, 1541 passed, 32 expected fail, exit 0 |
| `pnpm exec vitest run tests/security/t051-admin-ui.test.ts --project security` | 44 passed (first run: 1 failed on a wrong assertion of this review's own audit case, corrected) |
| `pnpm exec vitest run --config vitest.integration.config.mts tests/security/t051-admin-ui.itest.ts` | 2 passed, 1 expected fail |
| The same with `it.fails` flipped to `it` in `tests/security/zz-flip-t051.itest.ts` (deleted afterwards) | 1 failed: `AssertionError: expected 404 to be 200`; 2 passed |
| `pnpm exec vitest run --project security` (with the new files) | 42 files, 1585 passed, 32 expected fail, exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm exec eslint --max-warnings 0` on the two new files | exit 0 |
| `pnpm exec prettier --write` on the two new files | formatted |
| `pnpm audit --prod` (pnpm 12.11.2) | 3 vulnerabilities, 1 high, 2 critical, all `next` 16.4.0 (SEC-089) |
| `docker ps` | `marketplace-db-test-1` up, healthy |

Not run: `pnpm build`, e2e, `pnpm test` for all projects, the full integration suite, `tests/integration/admin` (another agent is working there), any page in a browser or through `next start`.

## Not covered

- Pages in a real browser and through `next start`: the `Cache-Control` of admin HTML with Cache Components and partial prefetching on, the back-forward and router caches after sign-out, and what a prefetch of an admin link fetches for a non-admin.
- Security headers on admin pages (CSP, `frame-ancestors`, referrer policy): TM-23, planned in T-072. Admin pages can be framed today, so clickjacking of the confirm dialogs is not prevented by a header.
- The Thai copy of `th.admin` (another agent reviews the copy).
- T-052 (admin permission suite).
- The seller dashboard pages were not payload-tested by this review.
