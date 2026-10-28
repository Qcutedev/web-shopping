# Status

The only place task status is recorded. Owner: orchestrator. Task definitions are in [PROJECT_PLAN.md](PROJECT_PLAN.md).

Last updated: 2026-10-22 (trimmed after the ninety-seventh session). The per-session history, the old change log, the answered owner questions (OQ-01 to OQ-50, answers in [DECISIONS.md](DECISIONS.md) D-025 to D-028), and the old test-result table were removed from this file on purpose. They are in git: run `git log --oneline -- docs/STATUS.md` and `git show <commit>:docs/STATUS.md`. Review findings live in [reviews/](reviews/) and [SECURITY.md](SECURITY.md).

## Summary

Implemented locally (see the Tasks table for each state): foundation, schema, auth, catalog, storefront, profile and addresses, cart, checkout with mock payment, orders, reviews, uploads, seller onboarding, products, inventory and orders, admin module and UI, security headers, e2e suite (partial), CI workflow file, Dockerfile. Many are IMPLEMENTED but not VERIFIED (code review, security re-check, or browser check open).

Not done: a11y checks, the final code review, security review, and fix pass (T-061 to T-063), docs audit (T-080), final acceptance (T-081). CI has never run (no GitHub remote). Nothing has been deployed.

## Resume here

Session 128 round 2 started. Round 1 done and committed: database `1ee583a`, `bd40679` (SEC-092 columns); backend-api `65d5960`, `1995cd7`, `b35ae6d` (SEC-072, 24 h); documentation `2cf9f8d` (single instance). Round 2, paths disjoint: (1) backend-api: SEC-092 step 2, admin hide-review endpoint + AuditLog + `hiddenAt: null` in public reads; paths `src/modules/admin/**`, `src/modules/reviews/**`, `src/modules/catalog/**`, `src/app/api/v1/admin/reviews/**`, tests for those, `docs/API_CONTRACTS.md`, `docs/DECISIONS.md`. (2) frontend: map `DELIVERY_TOO_EARLY`; paths `src/components/seller/order-status-panel*`, `src/i18n/th.ts`. (3) qa: schema counts in `tests/integration/schema/check-constraints.test.ts` (31 to 33) and `foreign-keys.test.ts` (28 to 29). Then: frontend admin hide page, security re-check SEC-092/SEC-072. If no commits follow, inspect `git status` first.

Session 128 started. Owner: take the recommended option on every open decision. Three agents in parallel, paths disjoint: (1) database: SEC-092 step 1, Review hide columns (`hiddenAt`, `hiddenByUserId`, `hiddenReason`) + migration + DATA_MODEL; paths `prisma/**`, `docs/DATA_MODEL.md`. (2) backend-api: SEC-072 option (1), seller may set DELIVERED only 24 h after `Shipment.shippedAt` (DB clock, guarded statement) + tests; paths `src/modules/orders/**`, `tests/**/orders/**`, `docs/API_CONTRACTS.md`. (3) documentation: CR-T061-03, DEPLOYMENT.md says single instance; paths `docs/DEPLOYMENT.md`. Next round: backend-api admin hide-review endpoint + audit row (SEC-092 step 2), frontend admin page, security re-check. If no commits follow, inspect `git status` first.

Session 127 finished. Local commits, not pushed. No agent running. (1) T-061 code review `c5312b4` (`docs/reviews/T-061-code-review.md`): APPROVE, CR-T061-01..06 Low/Info; CR-T061-02 owner decides whether same `Idempotency-Key` with a different address should be rejected; CR-T061-03 DEPLOYMENT.md should say single instance (rate limiter per process). typecheck and lint ok; no test suite run by reviewer. (2) T-062 security review `23689ec` (`docs/reviews/T-062-security.md`): 0 new findings, no open Critical or High; `pnpm audit --prod` clean; dev audit 13 advisories (SEC-010 Low); gitleaks/trufflehog not installed (pattern search only); security project 1745 passed, 32 expected fail. Open Mediums: SEC-052, 054, 065, 068, 088, 092; close SEC-092 first (with SEC-072). (3) qa `f7d6063`: `pnpm test:integration` exit 0, 69 files, 1564 passed, 8 expected fail. Not run: e2e, `pnpm verify`. Next: T-063 fixes for open items, then T-080. a11y waits for owner axe approval. Owner: CR-S116-11 header keys.

Session 126 finished. Local commits, not pushed. No agent running. (1) qa `bd3843d`: CR-S123-01/02 fixed in TEST_STRATEGY (68-passed e2e quoted from session 123, not re-run). (2) ui-ux-design `8210828`: CR-S123-04/05 notes in DESIGN_SYSTEM. (3) `pnpm verify` first FAILED: 8 component tests asserted native `.disabled` on loading buttons (stale since `e357960`); frontend fixed them `0b46f53` (aria-disabled, second-click-once asserts); `pnpm verify` now exit 0 (full vitest 226 files, 5974 passed). Not run: integration, e2e. Open: a11y waits for owner axe approval. Owner: CR-S116-11 header keys.

Session 125 finished. Local commits, not pushed. No agent running. (1) documentation `c6b34a2`: README.md:97 ADMIN_BOOTSTRAP_* aligned with `.env.example`. (2) security `593d19f`: SECURITY.md SEC-075 and SEC-009 name variables instead of stale `.env.example` line numbers (other line refs like `src/server/env.ts:540` not re-checked). (3) frontend `6c27b77`: CR-S123-03 fixed (`loading` only on pending button; typecheck, lint, format ok; admin actions + seller orders tests 69 passed; no browser check, not full `pnpm test`/`pnpm verify`). Open: CR-S123-01/02 (qa, TEST_STRATEGY:303,317), CR-S123-04 (ui-ux-design note: forms ignore submits while pending), CR-S123-05 Info. a11y waits for owner axe approval. Owner: CR-S116-11 header keys.

Session 124 finished. Local commits, not pushed. No agent running. (1) code review `7bdbc68` (`docs/reviews/S123-code-review.md`): APPROVE, CR-S121-01..08 fixed; open Low: CR-S123-01/02 (qa: TEST_STRATEGY:303,317 stale "defect"/"red" and ERR_ABORTED stated as fact), CR-S123-03 (frontend: `loading` plus `disabled` together loses focus/spinner in `categories-panel.tsx:130,224`, `settings-form.tsx:147`, `order-status-panel.tsx:179-230`), CR-S123-04 (ui-ux-design: note in DESIGN_SYSTEM that forms ignore submits while pending), CR-S123-05 Info. (2) ui-ux-design `f21762a`: Button loading documented. (3) documentation `1358189`, `c711239`, `09936d4`: KNOWN_LIMITATIONS, `.env.example` placeholders, STATUS summary/checklist. Not run: full `pnpm test`, `pnpm verify`. Next: README.md:97 says ADMIN_BOOTSTRAP_* not in `.env.example` (documentation); SECURITY.md:1590 stale `.env.example` line numbers (security); CR-S123 fixes; a11y waits for owner axe approval. Owner: CR-S116-11 header keys.

Session 122 finished. Local commits, not pushed. No agent running. (1) code review `d7d57de` (`docs/reviews/S121-code-review.md`): CHANGES REQUIRED. CR-S121-01 (Medium: TEST_STRATEGY:316 still describes the removed ERR_ABORTED retry; qa), CR-S121-02 (Medium: BOM in `scripts/build-probe.ps1` fails `sec039-040-cr66-recheck`, so `pnpm test` fails; devops), CR-S121-03..08 Low/Info. (2) qa `1f1d579`, `2344039`: `e2e/keyboard.spec.ts` journeys 3-4 keyboard-only; `pnpm test:e2e` 67 passed 1 failed, twice; the failure is a real defect: loading `Button` sets native `disabled` (`src/components/ui/button.tsx:89`), focus drops to BODY after add-to-cart (frontend/ui-ux-design: use aria-disabled like quantity-stepper). Mutation checks done for outline and tabIndex. (3) documentation `ad34893`, `90cbed3`: README rewritten, DEPLOYMENT, RUNBOOK-STAGING aligned; not covered: KNOWN_LIMITATIONS.md says no app, `.env.example` lacks ADMIN_BOOTSTRAP_*/NEXT_DIST_DIR comment, STATUS summary and MVP checklist stale. Full `pnpm test` times out under load (8-10 files, pass alone). Dev DB has throwaway user `docs-check-admin@example.com`. Next: devops CR-S121-02/04/05, qa CR-S121-01/03, frontend focus defect, re-review. a11y waits for owner axe approval. Owner: CR-S116-11 header keys.

Session 121 finished. Local commits, not pushed. No agent running. (1) qa `91c655b`, `ab22b2b`: CR-S119-01..10 addressed (warm-up moved to `global-setup.ts` `warmRoutes`, no retry; semantic cart marks; `reason` and stock asserts; TEST_STRATEGY updated). `pnpm test:e2e` 65 passed twice, `e2e/review.spec.ts` alone 1 passed; not `pnpm verify`; no mutation run for CR-S119-04..08; ERR_ABORTED cause still a hypothesis, 3 clean runs is a small sample. (2) devops `119b6bf`: `scripts/build-probe.ps1` (CR-S119-11). (3) security `9e6f599`: `sec074-077-recheck` fixed. Next: code review re-check of CR-S119 fixes; a11y (owner approves axe dependency); keyboard journeys 3-4. Owner: CR-S116-11 header keys.

Session 120 finished. Local commits, not pushed. No agent running. (1) qa `6fa17ae`, `dca97d3`, `a7474e8`: pagination journey (7) and journey 10 at 360/768 px (8) IMPLEMENTED; `pnpm test:e2e` 65 passed (not `pnpm verify`); a11y not written (no axe package; owner approves dependency); keyboard-only journeys 3-4 unwritten. `browse.spec.ts` still assumes it runs first. (2) security `edfe9a3`: SEC-093 re-check, stays FIXED, 43 security tests passed; owner decides refusing start when build/runtime NODE_ENV differ. (3) code review `345859a` (`docs/reviews/S119-code-review.md`): CHANGES REQUIRED, 21c9c33 and 5d1af57 approved; CR-S119-01 (Medium, blocking: `ERR_ABORTED` retry in `e2e/auth-negative.spec.ts:37-47` hides a failure in 3 of 4 runs, cause unproven, docs state it as fact), CR-S119-02 (Medium: `registerCustomer` no warm-up, move to global-setup), CR-S119-03..11 Low/Info open. Open: `tests/security/sec074-077-recheck.test.ts` fails 1 (expects `env: e2eServerEnvironment({`, config now spreads it; security fixes). Next: qa fixes CR-S119-01..08; devops probe script for `NEXT_DIST_DIR` builds (rewrites `tsconfig.json`). Owner: CR-S116-11 header keys.

Session 119 finished. Local commits, not pushed. No agent running. (1) CR-S116-02 FIXED `21c9c33`: header badge uses `countCartLines` (one COUNT); cart+shell unit 106 passed, cart integration 86 passed; not full `pnpm test`. (2) CR-S116-14 closed, SEC-093 FIXED `5d1af57` (18 new security tests; `next dev` still accepts the sign-up override on purpose; owner may refuse build/runtime NODE_ENV mismatch at start). (3) T-060 journeys 12-16 IMPLEMENTED (`e2e/review`, `suspended-seller`, `checkout-lowered`, `cart-unbuyable`, `resubmission`); `pnpm test:e2e` 50 passed (not `pnpm verify`, no mutation run); auth-negative warm-up retries `ERR_ABORTED` (flake, cause unproven). Still missing: 360/768 repeats (journey 10), pagination, a11y, production-build variant. Owner: CR-S116-11 (`fallbackName` and `profile` both "บัญชีของฉัน"), add to the 8 pending `th.shell.header.*` keys.

Session 118 started. Three agents in parallel, paths disjoint: (1) frontend: CR-S116-01, 06, 07, 08, 12; paths `src/components/shell/**`, `src/lib/api-client/auth.ts`. (2) devops: CR-S116-03, 04, 05 and SEC-093; paths `playwright.config.ts`, `src/server/auth/routes.ts`, `src/server/rate-limit.ts`, `tests/unit/e2e/**`, `tests/security/s116-sign-up-limit.test.ts`. (3) qa: CR-S116-09, 10, 13; paths `e2e/**`. CR-S116-02 (backend-api), 11, 14 not in this run. If no commits follow, inspect `git status` first.

Session 117 finished. Local commits, not pushed. No agent running. (1) code review of S116 `34a8d02` (CR-S116-01..14). (2) security `d4487e7`, `0cc635d` (SEC-093 Low). (3) qa e2e negative paths: `e2e/auth-negative.spec.ts` (sign-in empty, generic invalid credentials, sign-up malformed, duplicate email, off-site `next`) and `e2e/cart-negative.spec.ts`; `support/sign-in-budget.ts` paces sign-ins under the 5/minute limit (`takeSignIn()`); `pnpm test:e2e` 44 passed, typecheck, lint, format ok, not `pnpm verify`. CR-S116-01..14 and SEC-093 fixes not started. Still missing: journeys 12-16, a11y.

Session 116 started. Done, IMPLEMENTED not VERIFIED: (1) frontend `2bd6ded` header sign-up link, account menu, real cart count (new `th.shell.header.*` keys await owner; no browser check; badge stale after add-to-cart until navigation; no seller link). (2) devops `949285f` `SIGN_UP_RATE_LIMIT` (e2e only, refused in production; set in `playwright.config.ts`). (3) qa `f475211`: e2e customer specs register, sign in and add to cart through the UI; `pnpm test:e2e` 35 passed, 0 failed (not `pnpm verify`). Not covered: sign-up/sign-in negative paths, add-to-cart error states, journeys 12-16, a11y. No agent running. Owner questions: seller "ร้านค้าของฉัน" header link? add `router.refresh()` in `add-to-cart.tsx` for stale badge? approve `th.shell.header.*` (8 keys); DESIGN_SYSTEM.md header line needs update.

Session 115 finished. Local commits, not pushed. No agent running. (1) T-035 CR-T035-01..04 FIXED `bb9ba6e` (reviews unit 87, integration 41 passed); owner still approves Thai review copy. (2) documentation `e14f5a1`: TEST_STRATEGY e2e lines aligned; DEPLOYMENT already correct. (3) frontend `d3e3d4d`, `fe750e9`: /sign-in, /sign-up, add-to-cart on product page; `pnpm test` 5830 passed, typecheck, lint, format ok; no build, no browser check, no e2e. BOM stripped from 3 e2e specs (orchestrator, uncommitted fix of SEC-043 test). Owner approves new Thai keys `th.auth.*`, `th.cart.add.*`. Open: unknown slug stays 200 (D-039; owner reverses to get 404); header has no sign-up link or signed-in state; cart badge static; sign-up rate limit 5/hour vs e2e (owner/devops); e2e specs can now register through UI but are not yet rewritten; journeys 12-16 and a11y missing. Commit trailer on `bb9ba6e` says Opus 5.5.

Session 114 finished. Local commits, not pushed. No agent running. (1) documentation `82360a9`: DEPLOYMENT and TEST_STRATEGY aligned with ci.yml. (2) T-060 IMPLEMENTED (partial) `3ac15fc`..`1faf422`: `pnpm test:e2e` 35 passed (19 old + 16 new: browse, listing-lifecycle, seller-onboarding, checkout); no mutation run; not `pnpm verify`. Gaps: no sign-up/sign-in page and no add-to-cart control on product page (frontend), sign-up rate limit 5/hour is fully used by the suite (new specs that register get 429; owner/devops: e2e-only limit), unknown product slug answers HTTP 200 not 404, TEST_STRATEGY lines ~438-440 and ~565 still say Playwright not installed. (3) T-035 code review: APPROVE, CR-T035-01..04 Low: drop "provisional" (schema.ts, schema.test.ts, API_CONTRACTS ~983), API_CONTRACTS list and 5.6.1 tests bullet, assert reason at `tests/integration/reviews/rules.test.ts` lines 152 and 244, owner approves Thai review copy. Docker `marketplace-db-test-1` running.

Session 113 finished. Local commits, not pushed. No agent running. SEC-091 FIXED and re-checked (`01c6bf2`, `7ede2f2`; not yet seen under `next start`: curl a real `/api/files/<key>` after next build). T-070 follow-up `4e20153`: secret-scan job (gitleaks, may flag history on first run) and dependabot; owner may add `docker-compose` ecosystem for the postgres digest. CI docs fixed `05303ba` (DEPLOYMENT.md release step 1 still says e2e "Planned (T-060)", documentation to fix). Session 112 follow-up: T-070 IMPLEMENTED `a34194b` (no agent running; owner must `gh auth login` and create remote for a first CI run; DEPLOYMENT.md "CI pipeline" and TEST_STRATEGY ~line 440 stale, documentation to fix; no secret-scan job, no dependabot); python PIDs 12388 and 20372 still running (kill denied by classifier, owner decides). Session 112 finished. Local commits, not pushed. No agent running. T-035 IMPLEMENTED: backend `589eef4`..`3b73244`, frontend form `6abab92` (no browser check; new Thai keys `th.orders.review.*`, `th.errors.reasons.NOT_DELIVERED`/`DUPLICATE_REVIEW` await owner approval), qa `732682d` (32 review integration tests, full integration 1549 passed), security `694f0bb`..`9dfb5e1` (route-list gate fixed, `pnpm test` 5796 passed). Open: SEC-091 (Medium, T-072: site CSP overrides upload CSP `default-src 'none'; sandbox` on `/api/files/{key}`; orchestrator fixes `next.config.ts` with a later headers rule, flips `it.fails` in `tests/security/t072-headers-review.test.ts`, security re-checks); SEC-092 (Medium, owner decides review moderation; minimum admin hide-review action with audit row); SEC-072 (Low). Owner questions: notice text when a reviewed product is hidden; DUPLICATE_REVIEW closes form and asks reload, acceptable? Docker `marketplace-db-test-1` and `marketplace-db-dev-1` running.

Session 111 finished. Local commits, not pushed. No agent running. T-072 IMPLEMENTED `9457ac8` (D-046 ACCEPTED by owner 2026-10-26: static CSP keeps `unsafe-inline`; security review pending). T-035 backend IMPLEMENTED `589eef4`..`3b73244` (`POST /orders/{id}/items/{itemId}/review`; `pnpm test` fails 1 by design until security adds the route to `REVIEWED_NON_CATALOG_ROUTES` in `tests/security/t020-t018-catalog-shell.test.ts`; comment rules approved by owner (D-047); frontend review form, qa adopt `tests/integration/reviews/endpoints.test.ts`, database add REVIEW_TRANSACTION_OPTIONS to DATA_MODEL 21.5). T-071 IMPLEMENTED `9d0dfcf` (`scripts/container-smoke.ps1` SMOKE OK; `APP_URL` must be a build arg; no standalone output). A hung python shell from devops may still run.

Session 110 finished. Local commits, not pushed. No agent running. SEC-089 FIXED and re-checked (`f9d916f`, `8c47d0b`, `docs/reviews/SEC-089-recheck.md`): `next` 16.4.3, `zod` 4.6.7, `pnpm audit --prod` clean, `pnpm verify` ok, e2e 19 passed. Advisory texts not read yet (no web access in agent). Docker `marketplace-db-test-1` running. T-051 now blocked only by owner approval of Thai copy (`docs/reviews/T-051-copy-review.md`) and a browser check.

Session 109 finished. Local commits, not pushed. No agent running. SEC-090 FIXED and security re-checked (`1b6ca5c`, `docs/reviews/SEC-090-recheck.md`): TEST_STRATEGY pointers `3160560`; BR-41 `ef45406` (owner: all statuses); build `027edfa`, `10c0cd9`; full integration 1507 passed (backend-api run). SEC-089 upgrade done in session 110 (`next` 16.4.3, `zod` 4.6.7, audit clean, `pnpm verify` ok; security re-check and e2e pending). Optional frontend: review page shows empty box when a picture's bytes are missing.

Session 108 finished. Local commits, not pushed. No agent running; `git status` clean after this commit. (1) T-052 VERIFIED `af041eb`: `tests/integration/admin/permissions.test.ts` 17 passed (admin folder 53 passed); TEST_STRATEGY OQ-13/OQ-37 and TM-07 rows still to point at it (documentation). (2) T-051 security review `4c02b2f` (`docs/reviews/T-051-security.md`): SEC-090 (High, OPEN: admin gets 404 on non-public product pictures in `mayServe`, `src/modules/uploads/service.ts:167-170`, so approve is blind; product-requirements decides admin may read them per API_CONTRACTS 5.8, backend-api builds, security re-checks, flip `it.fails` in `tests/security/t051-admin-ui.itest.ts`; frontend meanwhile must say pictures could not load) and SEC-089 (High, upgrade `next`/`eslint-config-next` 16.4.1+, no agent may edit src while it runs) block T-051. (3) Thai copy review `c635580` (`docs/reviews/T-051-copy-review.md`): owner must approve F-1 (mock label on admin report revenue), F-2 ("ยกเลิกโดยระบบ" vs failed, BR-20), F-3 ("ปิดบัญชี" -> "ปิดใช้งานบัญชี"), C-1..C-12 and 4 questions; then frontend applies. Still open from 107: SEC-088, CR-T050-05/08, backend-api browser-safe `src/modules/admin/schema.ts`, Q42(a). Docker container `marketplace-db-test-1` running.

Session 107 finished. Local commits, not pushed. T-050 code review (`docs/reviews/T-050-code-review.md`) fixed in `f57d929`..`2a87136` except CR-T050-05 (database owner: shared FK helper, SQLSTATE 23001 and 23503) and CR-T050-08. T-050 security review `2fe8748` (`docs/reviews/T-050-security.md`): SEC-088 (Medium, OPEN, owner decides D-024/T12: fix by re-checking acting admin in each write transaction, also sellers approve/reject, or accept) and SEC-089 (High, OPEN: `next` 16.4.0 has 3 advisories, upgrade `next` and `eslint-config-next` to 16.4.1+ before any deploy; start after no agent edits src). T-051 IMPLEMENTED `854fd13`, `89f9957`: 12 admin pages; `pnpm test` 5640 passed; typecheck, lint, format ok; no browser check, build or e2e. T-051 needs its own security review (TM-15), product-requirements review of `th.admin` Thai copy, backend-api to make `src/modules/admin/schema.ts` browser-safe (client copy in `src/components/admin/client-schemas.ts`), no admin link in storefront header, Q42(a) paid time not in order list. Docker container `marketplace-db-test-1` running.

Session 106 finished. Local commits, not pushed. (1) Guard fix `84b93f6`; security re-check `b8f8171`: SEC-081, SEC-083, SEC-084 stay OPEN, new Low SEC-085, SEC-086, SEC-087. OWNER QUESTION: keep fixing the name-based guard (devops, re-check again) or widen D-045 in writing. (2) T-040/T-042/T-043 rows corrected to IMPLEMENTED. (3) T-050 IMPLEMENTED (`e57e3c7`, `961e568`, `c25a89e`): 26 admin endpoints, typecheck, lint, format ok, integration 1471 passed. `pnpm test` fails 1 case by design: security route-list gate `tests/security/t020-t018-catalog-shell.test.ts` needs the 23 `src/app/api/v1/admin/` routes listed after security review. Not yet done: code review, security review of T-050. Commits carry trailer "Claude Opus 5.5" (agent used its own model name); amend only if owner wants.

T-050 parked owner questions: Q44 admin paid-date filter one end only (now 400, both required); Q42(a) show paid time in admin order list; no-op PATCH of category/settings writes no audit row, acceptable?; limits chosen, see API_CONTRACTS 5.9.8 (category name 100, sortOrder 0..1000000, search 100, reason 500). Other owners: auth `deleteSessionsOfUser` duplicated in admin repository (D-022); database DATA_MODEL 7.4/7.5 stale about admin cancel; qa adopt `tests/integration/admin/*`, T-052 open. Docker container `marketplace-db-test-1` left running.

Session 105 follow-up: owner approved the changed Thai strings (all) and chose for SEC-081: fix the guard, then accept the residual in writing (code review is the control). devops finished SEC-081/SEC-083 guard fixes (`23720f2`, IMPLEMENTED, not VERIFIED); security re-check is starting (paths `docs/SECURITY.md`, `tests/security/**`); devops had touched 6 src files (rate-limit, timeout-sweep, uploads cleanup, auth security-events, session-purge, library-error) to satisfy the new rules, for owner review; old line: paths `eslint.config.mjs`, `scripts/check-import-guards.mjs`, `tests/security/sec081-recheck-2.test.ts`, `docs/SECURITY.md`, `docs/DECISIONS.md`. If no commit follows, inspect `git status` first.

Session 105 finished. Local commits, not pushed.

Read first in a new session: CLAUDE.md, this file, `git status`, `git diff`.

Done in session 105: qa `908f5af`, `7f6111a` (48 new tests in `tests/integration/checkout/cc-remaining.test.ts`: CC-04, CC-05, CC-07, CC-10, CC-11, CC-14, CC-06 seller side; 48 passed, neighbours 264 passed; no mutation run yet). Frontend (no commit): T-034 typecheck, lint, `pnpm test` 4828 passed, `pnpm build` ok, browser check at 360/768/1280 px on /checkout, /orders, /cart (success and failed-payment paths). Security `374ca0b`: SEC-081 stays OPEN, new SEC-083 (Low).

Open:
- (APPROVED by owner in session 105) Changed Thai strings (`src/i18n/th.ts`): `orders.confirmation.failedBody` and `failedTimeoutBody` lost the "items back in cart" sentence (now in `cartReturnBody`, shown only when items exist); checkout lowered line uses OQ-46 `th.quantity.lowered`; unknown-stock refusal uses `th.errors.insufficientStock`.
- T-034 review item "cart-write INSUFFICIENT_STOCK sold-out copy": confirm with reviewer intent. T-034 browser check did not cover empty cart, INSUFFICIENT_STOCK refusal, list failure, skeletons; no e2e.
- SEC-081 OPEN. Needs fixes (see SECURITY.md): `noInlineConfig` for all code; refuse `module`/`global`/`globalThis`/`Reflect`/`__non_webpack_require__` except as member-access object, refuse `.constructor` and computed binary/template keys (orchestrator, `eslint.config.mjs`); add probes to `scripts/check-import-guards.mjs` (devops). SEC-083 (Low): block `src` imports of `scripts|tests|e2e|prisma`. Then flip `it.fails` in `tests/security/sec081-recheck-2.test.ts`; security re-checks. Owner: accept name-based residual in writing or commission a module-graph check. SEC-082 (Low, qa) open. Flake: `t032-sec055-item1-recheck.test.ts` under load.
- Frontend: Thai copy for ADDRESS_LIMIT in `src/i18n/th.ts` and address form; product-requirements approves copy first.
- T-033 CC-08, CC-09, CC-13 and CC-06 admin half blocked until T-050 to T-053 (no admin code). TEST_STRATEGY open item T12 (deactivated admin in-flight request) is open.
- Header shows no cart count for signed-in user (header not wired to session); no add-to-cart UI yet. `pnpm build` and `next dev` share `.next`: do not run together.
- Test data left in `marketplace_dev`: about 4 customers `bc*@example.com`/`bs*@example.com` and 2 orders.
- Suggested: move payment transitions out of public `src/modules/orders/index.ts` (backend-api). Residual: `returnItemToCart` has no 50-line cap. Auth startup-hook tests may time out under load.

Next, in order:
1. Owner answer on SEC-085 to SEC-087 / D-045.
2. T-050 code review and security review (add admin routes to the route-list gate), T-051 admin UI, T-052, then the blocked CC cases.
3. E2E, CI.

Do not run two e2e suites at once: they share database `marketplace_e2e` and port 3100.

Agents must not type backslash-u escapes in tool input: the tool turns them into real invisible characters. Generate them from code points in a script.

Last known test results (session 102): `pnpm verify` ok after SEC-081 change; security project 1291 passed earlier in session; e2e not run.

Standing rules from the owner (D-019): never guess, park questions here and ask in batches; commit locally after each task passes its checks, never push without being told; stop for owner review at the five milestones.

## Open owner decisions

| Id | Decision | Where |
| --- | --- | --- |
| OQ-20 | Design details to confirm on real pages (input text size 15 or 16 px, chip and search height, required-field marking, sold-out quantity selector, negative amounts, error summary) | DESIGN_SYSTEM.md |
| Others from session 91 | SEC-072, SR-02 split, SEC-064, SEC-066, seller header link, SEC-073 residual (a/b/c), `th.ts` proposal strings, mobile sort. They may have been answered since; check before asking | old STATUS.md in git, [SECURITY.md](SECURITY.md) |

## Blockers

| Id | Blocker | Blocks | Next step |
| --- | --- | --- | --- |
| B-04 | No GitHub remote; `gh` not logged in | T-070 cannot be verified on a real run | Owner runs `gh auth login`, then creates the repository; CI can be written but not proven until then |

## Environment

Windows 11, PowerShell. Node v24.20.0, pnpm 12.11.2, Docker 29.8.2 with Compose v5.5.1 (daemon was up in session 96), PostgreSQL 18 through Docker only, `gh` 2.102.0 installed. Project at `C:\dev\web shoping`, outside OneDrive. Details: [DEPLOYMENT.md](DEPLOYMENT.md), D-020.

## Tasks

Notes marked "stale?" were written while Docker was down; later sessions ran the integration suite, but these rows were never re-checked, so they are not VERIFIED.

| Id | Task | Status | Note |
| --- | --- | --- | --- |
| T-001 | Install prerequisites | VERIFIED | |
| T-002 | Initialise git | VERIFIED | |
| T-003 | Verify delegation | VERIFIED | |
| T-004 | Review planning documents | IN PROGRESS | Findings in [reviews/T-004-findings.md](reviews/T-004-findings.md); D-028 and D-029 not yet written into every document |
| T-010 | Scaffold | VERIFIED | |
| T-011 | Env validation, health | VERIFIED | CR-43 to CR-52 follow-ups were open at the time; check the review register |
| T-012 | Compose databases | VERIFIED | Open for T-013: Thai sort order under default `en_US.utf8` collation |
| T-013 | Schema v1 | IMPLEMENTED | Needs code review of the commit and T-023 constraint tests |
| T-014 | Seed | IMPLEMENTED | Orchestrator has not re-run; `tests/unit/seed/*.test.ts` not in any vitest project |
| T-015 | Auth | IMPLEMENTED | Review follow-ups; see [reviews/](reviews/) |
| T-016 | Admin bootstrap | IMPLEMENTED | `pnpm admin:bootstrap` never run against a database (CR-54) |
| T-017 | Design tokens, primitives | VERIFIED | |
| T-018 | App shell | IMPLEMENTED | CR-68 browser check at 360/768/1280 px not run |
| T-019 | Server basics | VERIFIED | |
| T-020 | Catalog API | IMPLEMENTED | stale?: re-check acceptance and review |
| T-021 | Storefront pages | IMPLEMENTED | Code review CHANGES REQUIRED (`reviews/T-021-code-review.md`); no browser check; image URLs 404 until uploads are used |
| T-023 | Integration-test harness | VERIFIED | |
| T-030 | Profile, addresses | IMPLEMENTED | stale?: code review APPROVED WITH FOLLOW-UPS (CR-91 to CR-96) |
| T-031 | Cart | IMPLEMENTED | Code review CHANGES REQUIRED (`reviews/T-031-code-review.md`); security review pending |
| T-032 | Checkout, orders, mock payment | IMPLEMENTED | Reviewed, fixes applied; integration suite 1357 passed (session 99); open: SEC-053, SEC-056, CR-T032-08 |
| T-033 | Concurrency tests | IMPLEMENTED | Orchestrator has not re-run; CC-12 done; other CC gaps open |
| T-034 | Checkout UI | IMPLEMENTED | Commit `cb07d84`; code review found 1 blocking (Resume here); security ok; no browser check |
| T-035 | Reviews | IMPLEMENTED | Backend, form, tests, security review done (`reviews/T-035-security.md`); SEC-092 open; no browser check |
| T-040 | Seller onboarding | IMPLEMENTED | Commit `6c2112c` and later; code reviewed; not VERIFIED |
| T-041 | Uploads | IMPLEMENTED | Security review done (`reviews/T-041-security.md`, no Critical or High); not VERIFIED |
| T-042 | Seller products, inventory | IMPLEMENTED | Security review (SEC-067 to SEC-070) and code review CR-T042-01 to 08 done, follow-ups `adb37c8`; not VERIFIED |
| T-043 | Seller orders | IMPLEMENTED | Security review, code review CR-T043-01 to 06 fixed `5b03eac`; not VERIFIED |
| T-044 | Seller UI | IMPLEMENTED | Code reviewed through CR-156 ([reviews/T-044-code-review.md](reviews/T-044-code-review.md)); e2e 19 passed |
| T-045 | Seller isolation tests | IMPLEMENTED | Security re-check done in session 84 (`e18965e`); no new finding |
| T-050 | Admin module | IMPLEMENTED | Commits `e57e3c7` to `2a87136`; code and security review done; integration 36 admin tests passed; SEC-088, SEC-089, CR-T050-05/08 open |
| T-051 | Admin UI | IMPLEMENTED | Commits `854fd13`, `89f9957`; component tests pass; security review `4c02b2f`: SEC-090 FIXED `1b6ca5c`, SEC-089 fixed, re-check pending; copy review `c635580` awaits owner; no browser check |
| T-052 | Admin permission tests | VERIFIED | `af041eb`; 17 tests passed, admin folder 53 passed |
| T-060 | E2E suite | IMPLEMENTED | Partial: 35 e2e passed (`3ac15fc`..`1faf422`); customer specs use sign-in and add-to-cart UI (`f475211`, 35 passed); journeys 12-16 and a11y not written; not VERIFIED |
| T-061 | Code review | NOT STARTED | |
| T-062 | Security review | NOT STARTED | |
| T-063 | Fixes, regression | NOT STARTED | |
| T-070 | CI workflow | IMPLEMENTED | `.github/workflows/ci.yml` (`a34194b`): verify, integration, e2e, audit jobs; actionlint clean; local equivalents pass (verify 5796, integration 1558, e2e 19); never run on GitHub (no remote, B-04); secret-scan job and dependabot added `4e20153` |
| T-071 | Dockerfile, staging runbook | IMPLEMENTED | `Dockerfile`, `docs/RUNBOOK-STAGING.md`, `scripts/container-smoke.ps1`: both images build, migrate applies offline, container `/api/health` 200, headers present (local run, 2026-10-26). Not deployed; no provider chosen; no CI run |
| T-072 | Security headers | IMPLEMENTED | next.config.ts, tests/security/headers-t072.test.ts (7 pass), D-046; dev `/` 200 with headers; not run under `next start` |
| T-080 | Docs audit | NOT STARTED | |
| T-081 | Final acceptance | NOT STARTED | |

## MVP acceptance checklist

Statuses come from the Tasks table and the recorded runs above; the documentation agent did not re-run e2e or integration suites for this table (2026-10-28). Nothing here is VERIFIED until T-081 acceptance.

| # | Capability | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Customers register and log in | IMPLEMENTED | `/sign-up`, `/sign-in`; e2e `auth-negative.spec.ts` |
| 2 | Customers browse products and manage a cart | IMPLEMENTED | T-020, T-021, T-031; e2e `browse`, `cart-negative` |
| 3 | Customers complete a labelled mock checkout | IMPLEMENTED | T-032, T-034; e2e `checkout.spec.ts`; payment is `MOCK` |
| 4 | Orders persist in the database | IMPLEMENTED | T-032; integration suite |
| 5 | Multi-seller cart handled correctly | IMPLEMENTED | T-032 splits per seller; `tests/integration/checkout` |
| 6 | Sellers apply, get approved, manage own products | IMPLEMENTED | T-040, T-042, T-044, T-050; e2e `seller-onboarding`, `listing-lifecycle` |
| 7 | Sellers manage only their own orders and inventory | IMPLEMENTED | T-043, T-045 isolation tests |
| 8 | Admins approve sellers and moderate listings | IMPLEMENTED | T-050, T-051, T-052; no browser check of T-051; review moderation absent (SEC-092) |
| 9 | Server-side price, stock, and permission validation | IMPLEMENTED | T-032, T-033, T-045, T-052 tests; security review open items in SECURITY.md |
| 10 | App builds and runs from documented instructions | IN PROGRESS | README rewritten (session 122); a clean-machine run not done; `pnpm verify` not run in session 123 |
| 11 | Automated tests run with truthful results | IN PROGRESS | `pnpm test:e2e` 68 passed (session 123); full `pnpm test` times out under load; CI never run |
| 12 | Deployment and security limitations documented | IN PROGRESS | [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) rewritten 2026-10-28; no deployment exists |

## Deployment

| Stage | State |
| --- | --- |
| Local | runs with `pnpm dev` and Docker databases |
| Staging | not configured |
| Production | not configured |

