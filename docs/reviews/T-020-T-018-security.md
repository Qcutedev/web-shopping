# Security review: T-020 catalog, T-018 app shell, CR-83 request frame

Reviewer: security agent, twenty-eighth session, 2026-10-13. Read-only on `src/`. Docker was down, so this review ran unit-level tests only; nothing was run against PostgreSQL or a running server.

Verdict: **no new finding.** No Critical, High, Medium, or Low issue was found in the reviewed code. The SEC-033 rendering part stays OPEN: the component is correct, but nothing uses it yet. Register: 49 findings, unchanged.

A clean result here means that these reads and these tests found nothing. It does not show that the catalog or the shell is secure. The catalog's row selection was checked by recording the queries it sends, not by running them.

## Scope

| Area | Commits | Read |
| --- | --- | --- |
| T-020 catalog | 9f7301a, c7bf362 (code review), 4aa752a, 6cb6466, f98ce5b, 9fe2fa1, 9b96bb4, 10e314c, cd50e34 | `src/modules/catalog/` (`visibility.ts`, `repository.ts`, `service.ts`, `schema.ts`, `image.ts`, `errors.ts`, `index.ts`), the six route files under `src/app/api/v1/{categories,products,stores}`, `src/server/public-get.ts`, `src/server/request-frame.ts`, `src/server/http.ts` (`parseInput`, `ok`, `paginated`, `toAppError`), `src/server/errors.ts` (`fromZodError`, `validationError`), `prisma/schema.prisma` (Store, Category, Product, Upload, ProductImage, Review), API_CONTRACTS 1.7, 1.8, 1.10, 5.2, 5.2.1, 6, REQ-C-05 to REQ-C-09, Next.js 16.4.0 `dist/shared/lib/router/utils/route-matcher.js` |
| T-018 app shell | 1018fde, 54a070a, 24e1577 | `src/components/shell/*`, `src/components/user-name.tsx`, `src/components/ui/search-field.tsx`, `src/i18n/fill.ts`, `src/i18n/th.ts`, `src/lib/routes.ts`, `src/app/layout.tsx`, `src/app/not-found.tsx`, `src/app/(storefront)/*`, `next.config.ts`, `src/proxy.ts`, `src/server/auth/redirect.ts` |
| CR-83 | 6cb6466 (backend-api), 2a061ea and 0769f7c (auth), 9fe2fa1 (contract) | `src/server/request-frame.ts`, `src/server/public-get.ts`, `src/server/auth/routes.ts` (`AuthRuntimeSource`, `open`, `failure`, the four handlers), the four `src/app/api/v1/auth/*/route.ts`, `src/app/api/v1/auth/runtime-failure.test.ts`, `git show 0769f7c -- tests/security/sec048-recheck.test.ts`, `git show 2a061ea` |

## T-020 catalog

What holds, with the evidence:

| Check | Result | Evidence |
| --- | --- | --- |
| Exposure of hidden products | Holds. Every product query (list count, list page, detail, the id lookup before reviews) has the shape `{ AND: [VISIBLE_PRODUCT_WHERE, ...] }`, with no `OR` or `NOT` that could widen it. `VISIBLE_PRODUCT_WHERE` is exactly the five BR-05 conditions. A review query takes only the `productId` that the visible-product lookup returned. | `tests/security/t020-t018-catalog-shell.test.ts`, "every catalog read asks for visible rows only", one case per route. Each sends 14 hostile query keys (`storeId`, `userId`, `ownerId`, `role`, `status`, `moderationStatus`, `isActive`, `where`, `select`, `orderBy`, `__proto__`, `constructor`, `__proto__[isAdmin]`, and others) and records every database call. |
| Exposure of hidden stores | Holds. Both store lookups are `{ AND: [PUBLIC_STORE_WHERE, { slug }] }`, which requires `status APPROVED` and an active owner. A store's product list takes its `storeId` from that lookup only. | Same file; a recorded `storeId` must be `store-1`, the id the public lookup returned. `GET /products` sends no `storeId` at all. |
| Inactive categories | Holds. The category list and the `category` filter both require `isActive: true`. A product needs its category active (condition 5). | Same file. |
| Fields that must not leave (API_CONTRACTS 5.2: SKU, moderation, contact phone, owner id) | Holds at both layers. No `select` names `sku`, `moderation*`, `contentRevision`, `contactPhone`, `owner`/`ownerId`, `statusReason`, `user`/`userId`, `orderItem*`, `email`, or `storeId`. The mappers build answers from an allowlist, so a row with extra fields does not pass them on. | Same file: the fake rows carry a canary in every such field and the answer must not contain it; a separate case checks the exact key sets of the detail, its store and category, and a review. |
| Writes | Holds. Only `findMany`, `findFirst`, `count`, and `aggregate` are called. No transaction and no raw SQL. | Same file. Also the agent-reported no-write snapshot in `tests/integration/catalog` (not re-run). |
| Uniform 404 | Holds. Each of these gives the same body apart from `requestId`: a hidden or unknown product, its reviews, a store, a store's products, and an unknown or inactive category (`NOT_FOUND`, `details: {}`). No later query runs after the null lookup, so query count does not reveal anything. | Same file, "a hidden row and an unknown row get one answer". |
| Validation before the database; no echo | Holds. Each of 21 malformed inputs gives 400 `VALIDATION_ERROR` with no database call and no log line, and the answer does not repeat the input. The inputs were: page not a number, 15 digits, or zero; `pageSize` 51 or -1; an unknown or repeated `sort`; `q` too long or holding U+0000; non-numeric or out-of-range prices; max below min; a broken or empty `category`; a slug with a broken escape, with U+0000 after decoding, 201 characters long, or holding a lone surrogate. Zod messages name limits, not values, and unknown keys are stripped, so they never appear in a path. | Same file, "a refused request reads nothing". |
| Percent-decoding of `{slug}` | Accepted as documented (CR-90). Next.js 16.4.0 decodes each dynamic segment once (`route-matcher.js`, `decodeURIComponent`; a broken escape there is the framework's `DecodeError`). The schema then decodes once more when a `%` is left. The lookup is an exact match on a parameterised query, so a second decode only reaches a slug that exists and is visible anyway. A decoded U+0000 or lone surrogate is refused. An escaped lone surrogate in `q` cannot arrive: the URL parser turns it into U+FFFD. | Code reading; same file (`%00`, `%E0%B8`, surrogate, and U+FFFD cases). How the framework handles the pathname before matching was not measured on a running server. |
| `LIKE` wildcards | `escapeLikePattern` escapes `%`, `_`, and `\`. Prisma parameterises the value. Whether Prisma 7.10 escapes on its own as well, which would double-escape, was not checked against the database by this review. The agent-reported integration case "treats %, _, and backslash ... as plain characters" covers it. | Code reading. |
| Pagination limits | Hold. `pageSize` is 1 to 50 (51 is 400). `page` has at most 14 digits, and `(MAX_PAGE - 1) * MAX_PAGE_SIZE` is a safe integer. A page past the end sends only the count, never an `OFFSET` query. The page query asks for at most 50 rows. | Same file. |
| Error envelope and logging | Hold. When a database error carries a canary in its message, `meta`, and `query`, every route answers 500 `INTERNAL_ERROR` without the canary. Each writes exactly one log line, whose `err` is `{ errorClass }` only. A 400 or 404 writes no line, so no query string (search terms) is logged. | Same file, one case per route. |
| Request id | Holds. Without a trusted proxy configuration, a client's `X-Request-Id` is not reused. | Same file; `cr083-request-frame-recheck.test.ts` also shows that it is reused under `TRUSTED_PROXY_HOPS=1` and not when the configuration is refused. |
| Rule 6 (scoping) | Does not apply to public reads; no request can set a store id (above). | |
| Rule 3 (money) | `priceSatang` is passed through from the row. The price filter takes whole numbers from 0 to 100,000,000 only. | Code reading. |
| Thin handlers, rule 7 | Holds. Each of the six route files exports only `GET`, returns `handlePublicGet(request, async ...)`, imports neither the database layer nor Prisma, and reads no session. | Same file, static cases. `pnpm lint` reported 111 of 111 import-guard probes as expected. |
| Cache | Each catalog answer carries `Cache-Control: no-store`. | Same file. |

The mutation check passed. Each of six changes to a copy of the catalog code made at least one new case fail (1 or 2 cases each): the detail lookup without the visibility rule, the list `select` with `sku`, the store lookup without the public rule, the detail mapper spreading the row, an `OR` added to the product `where`, and the category lookup without `isActive`. Each copy was a scratch file under `tests/security/_scratch`, swapped in with `vi.mock`; the folder was deleted afterwards. `src/` was not touched.

Residual, not findings (also in SECURITY.md "Residual risks"):

- The public catalog reads have no rate limit, by contract. A search is an unindexed `ILIKE '%q%'` plus a count (CR-88, D-013). Each request has a bounded cost, but nothing bounds how many requests a client sends.
- The product detail gives the exact stock (BR-30, by design).
- A review stays public, without a name, after its author is deactivated. No requirement covers this; it is a question for product-requirements, not a leak.
- The catalog hands out whatever upload a `ProductImage` row links. That the upload belongs to the product's store must be checked where the link is written (T-041/T-042), not here.

## T-018 app shell

| Check | Result | Evidence |
| --- | --- | --- |
| SEC-033 second layer (`<bdi>`) | `UserName` renders its children in one `<bdi>` and React escapes them. A name with U+202E, U+2069, and `<img ... onerror=...>` renders as exactly `<bdi>` + escaped text + `</bdi>`. **It has no caller**: the shell renders only `th.site.name`. Nothing forces its use. `fill()` returns a string, so a name put into a sentence through a `{name}` placeholder cannot be isolated. No current template has a placeholder for user text. SEC-033 rendering part stays OPEN (SECURITY.md SEC-033 updated). | `t020-t018-catalog-shell.test.ts`, "UserName isolates and escapes" (uses `renderToStaticMarkup`) |
| External links, markup injection | None found. No `dangerouslySetInnerHTML`, no `target=`, no `http(s)://` or `javascript:` in the shell, `UserName`, or any page file. Every `href` is a `ROUTES.*` constant or the skip-link anchor. `ROUTES` holds same-site paths only. The font comes through `next/font/google`, which is fetched at build time and served locally; it makes no request at run time. | Same file, static cases (11) |
| i18n strings | `th.ts` holds no URL or address. Its placeholders are `{count}`, `{name}` (the site name), `{available}`, and `{quantity}`. `fill()` inserts values through a callback, so `$&` and the other replacement patterns are not interpreted. There is no second pass: `{x}` inside a value stays literal. A placeholder named like an `Object.prototype` member needs an own value (`Object.hasOwn`). | Same file, "fill() is not a second template engine" |
| Footer | Shows the mock-payment and simulated-shipping labels from `th.notice` (CLAUDE.md). The links are internal. There is no year, so no date is read. | Code reading |
| Search form | A GET form to `/search` with `maxLength` 100. The server validates `q` again. The term is in the URL, which is usual. The browser's default referrer policy keeps it from other origins; no explicit `Referrer-Policy` is set yet (TM-23, T-072). | Code reading |
| Security headers | None are configured. `next.config.ts` has no `headers()`, and the proxy matches only `/seller`, `/admin`, and `/account`. Pages are now served (home, not-found), so TM-23 matters from here on. It is planned in T-072 and stays NOT STARTED. It is not registered as a finding because a planned task holds it. | Code reading |

Observation for frontend and auth, not security: the proxy sends anonymous visitors to `SIGN_IN_PATH = "/login"` (`src/server/auth/redirect.ts:9`), but the header and footer link to `ROUTES.signIn = "/sign-in"`. Neither page exists yet. Pick one path before the sign-in page is built.

## CR-83

| Check | Result | Evidence |
| --- | --- | --- |
| `getAuthRuntime` inside the `try` | Holds. All four route files pass `getAuthRuntime` itself (`git show 0769f7c~1` had `handleSignIn(request, getAuthRuntime())`). Each of the four handlers in `routes.ts` calls `open(request, source, ...)` after its outer `try {`, and nothing before that `try` calls the source, `getAuthRuntime`, or `getEnv`. | `tests/security/cr083-request-frame-recheck.test.ts`, static cases |
| Failure path | Under each of five refused configurations, every one of the four routes answers 500 with a fresh request id, even when `X-Request-Id` is sent with `TRUSTED_PROXY_HOPS=1`, because the proxy setting itself cannot be read. The body holds no canary, and there is one log line without it. | Same file |
| Direct assertion kept | `getAuthRuntime()` under the five configurations throws `EnvValidationError`. Its `String()`, stack, and JSON hold no canary. Before 0769f7c this was asserted in `sec048-recheck.test.ts`. It is kept here as a second layer, in case some other caller prints the error. | Same file |
| `handleRequest` | Everything that `run` throws becomes the envelope, with no canary in the body or the log. `connection()`, the request id, and the child logger sit before the `try`. The configuration read for the request id (`requestIdTrust`) has its own `catch` and falls back to a generated id. The trust setting is read in one place, and `public-get.ts` only delegates. | Same file |
| Auth agent's edit of `tests/security/sec048-recheck.test.ts` (0769f7c) | **Not weakened.** The block used to assert that the route throws `EnvValidationError` with no canary in its text. It now asserts the 500 envelope, `INTERNAL_ERROR`, a matching request id in header, body, and log line, exactly one log line, and `err` equal to `{ errorClass: "EnvValidationError" }`, all without the canary. The valid-configuration case is unchanged. The one assertion that no longer applies there (the thrown error's own text) is kept in the new file. | `git show 0769f7c -- tests/security/sec048-recheck.test.ts`; the file passes (12 of 12) |
| CR-79 control (2a061ea) | Not a security test; read for SEC-048. The control now shows that the raw logger lets the canary through, and a new case shows that `errorResponse` does not. No assertion was dropped that guarded the fix. | `git show 2a061ea` |
| Auth handlers' own scope | `openScope` still resolves the request id from `runtime.trustedProxy` rather than through `handleRequest`. Both read the same validated `getEnv().trustedProxy`. Moving onto the frame is auth's open CR-83 follow-up; it is not a security issue. | Code reading |

Stale text fixed in this review, because each said `getAuthRuntime()` throws before the `try`: SECURITY.md SEC-048 re-check evidence and the `AUTH_SECRET` residual-risk item; `reviews/SEC-046-047-recheck.md` lines 15 and 83, marked superseded, and line 33, dated as pre-CR-83.

## Addendum 2026-10-14: GET /api/v1/categories/{slug} (CR-T021-05, commit b829f77)

Reviewed by reading `src/app/api/v1/categories/[slug]/route.ts`, `getCategory` in `src/modules/catalog/service.ts`, `findActiveCategoryBySlug` in `src/modules/catalog/repository.ts`, `slugParamsSchema` in `src/modules/catalog/schema.ts`, and API_CONTRACTS 5.2. No finding.

| Area | Result | Evidence |
| --- | --- | --- |
| Auth | Public by contract. The handler reads no session and no header; it runs inside `handlePublicGet` like its six siblings. | Static case in `tests/security/t020-t018-catalog-shell.test.ts` |
| Input | The path slug goes through the shared `slugParamsSchema` (decode once, 1 to 200 characters, storable text). A broken escape, U+0000, 201 characters, a lone surrogate, and an empty slug are each `400 VALIDATION_ERROR` before any read, with no echo and no log line. Query parameters are ignored and reach no query. | Same file, refused-request cases and the hostile-query case |
| Query | Exactly one `category.findFirst` with `where: { slug, isActive: true }` and `select: { name, slug }`. No write, no raw SQL, nothing from the client but the validated slug. | Same file, "one category read by slug and isActive" |
| Info leak | The answer is exactly `{ name, slug }`; the stored `id`, `isSample`, `sortOrder`, and `isActive` stay out. A database failure is a 500 without the error text, one log line with the class name only. | Same file |
| Enumeration | An unknown and an inactive slug give the same 404 body after the same single read. The active categories are already public through `GET /categories`, so a found slug reveals nothing new. | Same file, the shared 404 case |
| Rate limit | None, like every catalog read (API_CONTRACTS 5.2.1). One indexed lookup by unique slug per request, cheaper than the list reads; covered by the existing residual-risk item on public catalog reads in SECURITY.md. | Code reading |

The route guard ("exactly the catalog route files") was red at HEAD 7daf187 because this route was not listed; it now lists seven routes.

## Checks run

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --project security tests/security/t020-t018-catalog-shell.test.ts` | 63 passed |
| `pnpm exec vitest run --project security tests/security/cr083-request-frame-recheck.test.ts` | 17 passed |
| `pnpm exec vitest run --project security tests/security/sec048-recheck.test.ts` | 12 passed |
| The new catalog file against six mutants (scratch, deleted) | Each mutant: 1 or 2 failed |
| `pnpm exec vitest run --project security` | 15 files, 600 passed, 4 expected fail, exit 0. The four are the open SEC-041 and SEC-042 cases in `sec039-040-cr66-recheck.test.ts` (3) and SEC-049 in `sec046-047-recheck.test.ts` (1). None is new. |
| `pnpm test`, twice | Each run: 62 files, 2221 passed, 1 failed, 4 expected fail, exit 1. The failure both times is `src/server/logger.test.ts` "writes 100 lines ... within the time bound" (1141 ms against 1000 ms), the known wall-clock flake of STATUS.md, owned by backend-api. Run alone it passes, 380 of 380. |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0, 111 of 111 import-guard probes |
| `pnpm format:check` | exit 0 |
| `pnpm audit --prod` | No known vulnerabilities, exit 0 |
| `pnpm audit` | 2 high, exit 1: `braces` (SEC-010) and `deepmerge-ts` <8.0.0 (GHSA-ggr8-5vv4-36mx) through the Prisma CLI's `@prisma/config` (SEC-010, amended 2026-10-12). `mysql2` is gone since the SEC-036 override. |
| Byte scan of the two new test files | 0 bytes outside printable ASCII, tab, CR, and LF; no backslash-u escape |
| `gitleaks`, `trufflehog` | Not installed; no secret scan was run. The new files hold invented canaries only. |
| 2026-10-14 addendum: `pnpm vitest run tests/security/t020-t018-catalog-shell.test.ts` | 1 file, 79 passed, exit 0 |
| 2026-10-14 addendum: `pnpm test` | 122 files, 5 failed, 3384 passed, 5 expected fail, exit 1. None of the five is in this file. Four come from another agent's uncommitted work in the tree at the time (`category-heading.tsx` and its test start with a U+FEFF byte-order mark, `storefront-pages.test.tsx:232` holds a literal U+202E, and `catalog-views.test.tsx` expects text without the new isolate marks). The fifth, the SEC-047 random-value case in `sec046-047-recheck.test.ts`, passed when its file was rerun. |
| 2026-10-14 addendum: `prettier --check`, `eslint` on the test file; byte scan | exit 0, exit 0; 0 bytes outside printable ASCII, tab, CR, LF |

## Not verified

- `pnpm test:integration` (Docker down). The catalog's row selection against PostgreSQL, the no-write snapshot, the `LIKE` escaping, and the CR-84 change to `tests/integration/catalog/endpoints.test.ts` (14 digits 200, 15 digits 400) were not run by anyone after the change.
- Real HTTP against `next dev` or `next start`: framework percent-decoding of the pathname before route matching, the framework's answer to a broken escape in a path, `HEAD` on the catalog routes, and the response headers the framework adds.
- The shell in a browser: rendering, `<bdi>` behaviour with a real right-to-left name, and the referrer actually sent.
- Timing of a hidden against an unknown slug, measured. By reading, both run the same single query and stop.
- `pnpm build` and the client bundle contents.
