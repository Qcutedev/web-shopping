# Status

The only place task status is recorded. Owner: orchestrator. Task definitions are in [PROJECT_PLAN.md](PROJECT_PLAN.md).

Last updated: 2026-10-22 (trimmed after the ninety-seventh session). The per-session history, the old change log, the answered owner questions (OQ-01 to OQ-50, answers in [DECISIONS.md](DECISIONS.md) D-025 to D-028), and the old test-result table were removed from this file on purpose. They are in git: run `git log --oneline -- docs/STATUS.md` and `git show <commit>:docs/STATUS.md`. Review findings live in [reviews/](reviews/) and [SECURITY.md](SECURITY.md).

## Summary

Implemented locally (see the Tasks table for each state): foundation, schema, auth, catalog, storefront, profile and addresses, cart, checkout with mock payment, orders, reviews, uploads, seller onboarding, products, inventory and orders, admin module and UI, security headers, e2e suite (partial), CI workflow file, Dockerfile. Many are IMPLEMENTED but not VERIFIED (code review, security re-check, or browser check open).

Not done: a11y checks, the final code review, security review, and fix pass (T-061 to T-063), docs audit (T-080), final acceptance (T-081). CI has never run (no GitHub remote). Nothing has been deployed.

## Resume here

Session 133 finished. Local commits, not pushed. No agent running. 3 tasks done: (1) backend-api `c2b631b` SEC-095: `reactivateUser` locks the acting admin `FOR SHARE`, target `FOR NO KEY UPDATE`, byte id order; `it.fails` flipped in `tests/security/sec094-recheck.itest.ts` (setup changed: extra tx holds the customer row); 5 runs passed; admin integration 152, admin unit 628 passed. Security has not re-checked; a rare three-admin cycle remains (security decides if it is a new finding). (2) database `e22d739` (title says docs, holds code+tests+docs): kept `UserRateLimitWindow_resetAt_idx` (purge already runs, EXPLAIN uses the index); 2 s `statement_timeout` on count and purge; `Retry-After` off-by-one second fixed; rate-limit integration 15, unit 69 passed. (3) documentation T-080 audit `7e32bab`..`0c6b0bc` (`docs/reviews/T-080-docs-audit.md`): README steps on a clean checkout NOT run (Docker was down), so T-080 is not VERIFIED. typecheck, lint, format ok. Not run: `pnpm verify`, full `pnpm test`, full `pnpm test:integration`, e2e, build. Docker dev+test DB containers running. Open drift (owners): STATUS header date and Summary stale; CLAUDE.md stale lines (early build, Stack proposed, scripts fail) and command table lacks `pnpm format`, `start`, `db:migrate:deploy`; API_CONTRACTS line 3 'planned contract'; DATA_MODEL line 3 'schema v1', 7.4/7.5 admin cancel; SECURITY old 'State on' lines; DECISIONS D-001..D-015 and D-048 PROPOSED, D-011 names missing ManualShippingProvider, D-012 partly DB-backed; REQUIREMENTS 'Test files' column stale. Next: security re-check SEC-095 and note the 2 s bound at SEC-052; drift fixes above; README clean-checkout run; then T-081.

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

