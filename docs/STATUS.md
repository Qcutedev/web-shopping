# Status

The only place task status is recorded. Owner: orchestrator. Task definitions are in [PROJECT_PLAN.md](PROJECT_PLAN.md).

Last updated: 2026-10-22 (trimmed after the ninety-seventh session). The per-session history, the old change log, the answered owner questions (OQ-01 to OQ-50, answers in [DECISIONS.md](DECISIONS.md) D-025 to D-028), and the old test-result table were removed from this file on purpose. They are in git: run `git log --oneline -- docs/STATUS.md` and `git show <commit>:docs/STATUS.md`. Review findings live in [reviews/](reviews/) and [SECURITY.md](SECURITY.md).

## Summary

Done: foundation, database schema, auth, catalog, storefront pages, profile and addresses, cart, uploads, seller UI, seller isolation tests, concurrency tests. Several of these are IMPLEMENTED but not VERIFIED (code review or security re-check or browser check still open).

Not started: checkout UI (T-034), reviews, seller onboarding and seller products/orders, the whole admin area, the E2E suite, CI, Dockerfile, security headers, docs audit, final acceptance. Nothing has been deployed.

## Resume here

Session 104 finished. No agent is running. Local commits, not pushed.

Read first in a new session: CLAUDE.md, this file, `git status`, `git diff`.

Done in session 104: qa `61b122e` (address-limit test accepted; `pg_stat_clear_snapshot()` in 2 polling loops; profile+cart integration 117 passed, run once). Frontend `a1fce5e` (T-034 blocking and all Low items fixed; typecheck, lint, 678 component tests passed). Devops `0a7ea5e` (SEC-081 a to e; 19 `it.fails` flipped; 162 probes ok; security project 1328 passed).

Open:
- Owner approval of changed Thai strings (`src/i18n/th.ts`): `orders.confirmation.failedBody` and `failedTimeoutBody` lost the "items back in cart" sentence (now in `cartReturnBody`, shown only when items exist); checkout lowered line uses OQ-46 `th.quantity.lowered`; unknown-stock refusal uses `th.errors.insufficientStock`.
- T-034 review item "cart-write INSUFFICIENT_STOCK sold-out copy": frontend found no such use in cart-view; fixed the checkout refusal line instead. Confirm with reviewer intent.
- SEC-081: security must re-check `0a7ea5e` and decide close. Residual: Vitest-run `*.test.ts(x)` files are exempt from loader selectors; lint selectors are name-based. SEC-082 (Low, qa) open. One timing flake seen: `t032-sec055-item1-recheck.test.ts` under load.
- Frontend: Thai copy for ADDRESS_LIMIT in `src/i18n/th.ts` and address form; product-requirements approves copy first.
- T-034 not VERIFIED: no browser check at 360/768/1280 px, no e2e, full `pnpm test`/`pnpm build` not run after fixes. No add-to-cart UI yet; header cart count not wired.
- T-033 CC gaps still open: CC-04, CC-06, CC-08, CC-09, CC-10, CC-11, CC-13, CC-14, parts of CC-05 and CC-07.
- Suggested: move payment transitions out of public `src/modules/orders/index.ts` (backend-api). Residual: `returnItemToCart` has no 50-line cap. Auth startup-hook tests may time out under load.

Next, in order:
1. frontend fixes for T-034; SEC-081 guard fix; browser check.
2. Remaining T-033 CC cases; T-031/T-032 review status re-check.
3. Seller products/orders, admin area, E2E, CI.

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
| T-035 | Reviews | NOT STARTED | |
| T-040 | Seller onboarding | NOT STARTED | Row not updated, but session logs say T-040 is IMPLEMENTED (commit `6c2112c` and later) and was code-reviewed. Confirm with `git log` before starting |
| T-041 | Uploads | IMPLEMENTED | Security review done (`reviews/T-041-security.md`, no Critical or High); not VERIFIED |
| T-042 | Seller products, inventory | NOT STARTED | |
| T-043 | Seller orders | NOT STARTED | |
| T-044 | Seller UI | IMPLEMENTED | Code reviewed through CR-156 ([reviews/T-044-code-review.md](reviews/T-044-code-review.md)); e2e 19 passed |
| T-045 | Seller isolation tests | IMPLEMENTED | Security re-check done in session 84 (`e18965e`); no new finding |
| T-050 | Admin module | NOT STARTED | |
| T-051 | Admin UI | NOT STARTED | |
| T-052 | Admin permission tests | NOT STARTED | |
| T-060 | E2E suite | NOT STARTED | A Playwright setup exists (19 tests, from T-044 work); the full suite is not started |
| T-061 | Code review | NOT STARTED | |
| T-062 | Security review | NOT STARTED | |
| T-063 | Fixes, regression | NOT STARTED | |
| T-070 | CI workflow | NOT STARTED | |
| T-071 | Dockerfile, staging runbook | NOT STARTED | |
| T-072 | Security headers | NOT STARTED | |
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
