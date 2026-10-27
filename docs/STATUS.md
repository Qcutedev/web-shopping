# Status

The only place task status is recorded. Owner: orchestrator. Task definitions are in [PROJECT_PLAN.md](PROJECT_PLAN.md).

Last updated: 2026-10-22 (trimmed after the ninety-seventh session). The per-session history, the old change log, the answered owner questions (OQ-01 to OQ-50, answers in [DECISIONS.md](DECISIONS.md) D-025 to D-028), and the old test-result table were removed from this file on purpose. They are in git: run `git log --oneline -- docs/STATUS.md` and `git show <commit>:docs/STATUS.md`. Review findings live in [reviews/](reviews/) and [SECURITY.md](SECURITY.md).

## Summary

Done: foundation, database schema, auth, catalog, storefront pages, profile and addresses, cart, uploads, seller UI, seller isolation tests, concurrency tests. Several of these are IMPLEMENTED but not VERIFIED (code review or security re-check or browser check still open).

Not started: checkout UI (T-034), reviews, seller onboarding and seller products/orders, the whole admin area, the E2E suite, CI, Dockerfile, security headers, docs audit, final acceptance. Nothing has been deployed.

## Resume here

Session 114 started (owner: "run 3 tasks"). Three agents running in parallel: documentation (`docs/DEPLOYMENT.md`, `docs/TEST_STRATEGY.md`: stale CI and e2e text, OQ-13/OQ-37/TM-07 pointers); qa (T-060 E2E suite: `e2e/**`, `playwright.config.ts`); code-review (T-035 reviews, read-only, report only). If no commit follows, inspect `git status` first.

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
| T-060 | E2E suite | NOT STARTED | A Playwright setup exists (19 tests, from T-044 work); the full suite is not started |
| T-061 | Code review | NOT STARTED | |
| T-062 | Security review | NOT STARTED | |
| T-063 | Fixes, regression | NOT STARTED | |
| T-070 | CI workflow | IMPLEMENTED | `.github/workflows/ci.yml` (`a34194b`): verify, integration, e2e, audit jobs; actionlint clean; local equivalents pass (verify 5796, integration 1558, e2e 19); never run on GitHub (no remote, B-04); no secret scan job |
| T-071 | Dockerfile, staging runbook | IMPLEMENTED | `Dockerfile`, `docs/RUNBOOK-STAGING.md`, `scripts/container-smoke.ps1`: both images build, migrate applies offline, container `/api/health` 200, headers present (local run, 2026-10-26). Not deployed; no provider chosen; no CI run |
| T-072 | Security headers | IMPLEMENTED | next.config.ts, tests/security/headers-t072.test.ts (7 pass), D-046; dev `/` 200 with headers; not run under `next start` |
| T-080 | Docs audit | NOT STARTED | |
| T-081 | Final acceptance | NOT STARTED | |

## MVP acceptance checklist

| # | Capability | Status |
| --- | --- | --- |
| 1 | Customers register and log in | NOT STARTED |
| 2 | Customers browse products and manage a cart | NOT STARTED |
| 3 | Customers complete a labelled mock checkout | NOT STARTED |
| 4 | Orders persist in the database | NOT STARTED |
| 5 | Multi-seller cart handled correctly | NOT STARTED |
| 6 | Sellers apply, get approved, manage own products | NOT STARTED |
| 7 | Sellers manage only their own orders and inventory | NOT STARTED |
| 8 | Admins approve sellers and moderate listings | NOT STARTED |
| 9 | Server-side price, stock, and permission validation | NOT STARTED |
| 10 | App builds and runs from documented instructions | NOT STARTED |
| 11 | Automated tests run with truthful results | NOT STARTED |
| 12 | Deployment and security limitations documented | IN PROGRESS |

## Deployment

| Stage | State |
| --- | --- |
| Local | runs with `pnpm dev` and Docker databases |
| Staging | not configured |
| Production | not configured |

