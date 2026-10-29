# Status

The only place task status is recorded. Owner: orchestrator. Task definitions are in [PROJECT_PLAN.md](PROJECT_PLAN.md).

Last updated: 2026-10-29 (header and Summary corrected in session 134; the sections below were trimmed after session 97). The per-session history, the old change log, the answered owner questions (OQ-01 to OQ-50, answers in [DECISIONS.md](DECISIONS.md) D-025 to D-028), and the old test-result table were removed from this file on purpose. They are in git: run `git log --oneline -- docs/STATUS.md` and `git show <commit>:docs/STATUS.md`. Review findings live in [reviews/](reviews/) and [SECURITY.md](SECURITY.md).

## Summary

Implemented locally (see the Tasks table for each state): foundation, schema, auth, catalog, storefront, profile and addresses, cart, checkout with mock payment, orders, reviews, uploads, seller onboarding, products, inventory and orders, admin module and UI, security headers, e2e suite (partial), CI workflow file, Dockerfile. Many are IMPLEMENTED but not VERIFIED (code review, security re-check, or browser check open).

Done as reviews: the full code review (T-061, `reviews/T-061-code-review.md`) and the full security review (T-062, `reviews/T-062-security.md`). Not done: a11y checks, the fix pass and regression run (T-063, in progress), docs audit acceptance (T-080: the clean-checkout README run is open), final acceptance (T-081). CI ran green on GitHub (run 40889555775, all 5 jobs). Nothing has been deployed.

## Resume here

STOPPED by owner 2026-10-29, no agent running, tree clean, nothing pushed. Local commits ahead of origin: `4c460df`, `d14f71b` (maintenance.yml, devops, actionlint clean), `dc8aeaf` (upload limit 4 MiB), `6aae8ce` (`POST /api/v1/internal/maintenance`). The backend-api agent was stopped before finishing: its last note says part A was committed with failing gates recorded, and integration, build and audit were not run. Next: run `pnpm verify`, `pnpm test:integration`, `pnpm audit --prod`, fix failures, add `CRON_SECRET` and `MAINTENANCE_VIA_HTTP` to `.env.example` and the DEPLOYMENT.md env table, code and security review the endpoint, then push. Plan: scheduled work via GitHub Actions cron every 10 min, upload limit 4 MiB for Vercel's 4.5 MB body cap. Earlier: Vercel Blob adapter D-051 pushed (`12f0c49`). Owner chose free-tier deploy (Vercel Hobby + Neon PostgreSQL + Vercel Blob for pictures; Firebase and Cloudflare Workers/D1 rejected). Starting: `VercelBlobStorage` adapter behind the existing `StorageProvider` (D-051 PROPOSED), run by agent backend-api, touching `src/modules/uploads/**`, `src/server/env.ts` (+ test), `.env.example`, `package.json`/lockfile, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md`. Not deploying anything yet; deploy needs owner approval. If this paragraph is stale and files are uncommitted, inspect them before relaunching. Repo https://github.com/Qcutedev/web-shopping (public), `gh` logged in as Qcutedev with `workflow` scope. CI run 40889555775 on `3bf29ed`: all 5 jobs success (verify, audit, integration, e2e, gitleaks); B-04 closed, T-070 VERIFIED. Local: `pnpm verify` exit 0, integration 1682 passed, e2e 92 passed (incl. axe, 0 violations). Next: (1) Owner decides T-081 exceptions: manual a11y pass (image contrast, reading order), uncovered pages (seller order detail, seller product edit, admin order and product detail), open menus and error states. (2) Optional: SEC-096 remediation (b). Owner note: commit author email is public in history; rewriting history needs an explicit owner order.

## Open owner decisions

| Id | Decision | Where |
| --- | --- | --- |
| OQ-20 | Design details to confirm on real pages (input text size 15 or 16 px, chip and search height, required-field marking, sold-out quantity selector, negative amounts, error summary) | DESIGN_SYSTEM.md |
| Others from session 91 | SEC-072, SR-02 split, SEC-064, SEC-066, seller header link, SEC-073 residual (a/b/c), `th.ts` proposal strings, mobile sort. They may have been answered since; check before asking | old STATUS.md in git, [SECURITY.md](SECURITY.md) |

## Blockers

| Id | Blocker | Blocks | Next step |
| --- | --- | --- | --- |
| none | | | |

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
| T-061 | Code review | IN PROGRESS | [reviews/T-061-code-review.md](reviews/T-061-code-review.md) |
| T-062 | Security review | IN PROGRESS | [reviews/T-062-security.md](reviews/T-062-security.md); SEC-095 and SEC-096 FIXED and re-checked |
| T-063 | Fixes, regression | IN PROGRESS | SEC-096 fixed `1140024`, re-checked `05835d1`; `pnpm verify` exit 0 |
| T-070 | CI workflow | VERIFIED | `.github/workflows/ci.yml` (`a34194b`): verify, integration, e2e, audit jobs; actionlint clean; GitHub run 40889555775 (2026-10-29, commit `3bf29ed`): verify, integration, e2e, audit, secret-scan all success; secret-scan job and dependabot added `4e20153` |
| T-071 | Dockerfile, staging runbook | IMPLEMENTED | `Dockerfile`, `docs/RUNBOOK-STAGING.md`, `scripts/container-smoke.ps1`: both images build, migrate applies offline, container `/api/health` 200, headers present (local run, 2026-10-26). Not deployed; no provider chosen; no CI run |
| T-072 | Security headers | IMPLEMENTED | next.config.ts, tests/security/headers-t072.test.ts (7 pass), D-046; dev `/` 200 with headers; not run under `next start` |
| T-080 | Docs audit | IMPLEMENTED | Audit [reviews/T-080-docs-audit.md](reviews/T-080-docs-audit.md); drift fixed `59cedec`; README clean-checkout run passed 2026-10-29 (install, migrate, seed, bootstrap, dev 200); `pnpm verify` exit 0 (session 135), owner accepted all decisions |
| T-081 | Final acceptance | IN PROGRESS | 2026-10-29 session 136: `pnpm verify` exit 0, integration 1682 passed (81 files), e2e 67 passed + 1 stale spec fixed (`cart-unbuyable` taken-down test, SEC-054 removed the title) and re-run 2 passed; full e2e 92 passed after a11y spec added. Open: manual a11y pass |

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
| 10 | App builds and runs from documented instructions | VERIFIED | README clean-checkout run passed 2026-10-29; `pnpm verify` exit 0 (session 136) |
| 11 | Automated tests run with truthful results | IN PROGRESS | Session 136: verify exit 0, integration 1682 passed, e2e 92 passed; GitHub CI run 40889555775 green (all 5 jobs) |
| 12 | Deployment and security limitations documented | IN PROGRESS | [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) rewritten 2026-10-28; no deployment exists |

## Deployment

| Stage | State |
| --- | --- |
| Local | runs with `pnpm dev` and Docker databases |
| Staging | not configured |
| Production | not configured |

