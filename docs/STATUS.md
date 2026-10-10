# Status

The only place task status is recorded. Owner: orchestrator. Task definitions are in [PROJECT_PLAN.md](PROJECT_PLAN.md).

Last updated: 2026-10-10

## Summary

Planning documents and agent definitions are written and the empty Next.js scaffold builds. **No marketplace feature exists yet. Nothing has been deployed.**

## Environment (checked 2026-10-10 on the developer machine)

| Tool | Result |
| --- | --- |
| OS | Windows 11, PowerShell |
| git | 2.55.0 installed; repository on `main`, local commits only, no remote |
| Node.js | v24.20.0 |
| npm / pnpm | npm 11.19.0; pnpm 12.11.2 via Corepack 0.35.0, shim in `%APPDATA%\npm` (`corepack enable` into `Program Files` needs admin) |
| Docker | Docker 29.8.2 and Compose v5.5.1 installed; daemon running on WSL 3.0.1.0 (`docker info` succeeded 2026-10-11) |
| PostgreSQL (`psql`) | not installed natively; planned through Docker |
| GitHub CLI (`gh`) | 2.102.0 installed; not logged in |
| Claude Code subagents | available in this session; project agent definitions written but not yet exercised |
| Project folder | `C:\dev\web shoping`, outside OneDrive |

Terminals and editors opened before the installs do not see the new PATH until restarted.

## Blockers

| Id | Blocker | Blocks | Next step |
| --- | --- | --- | --- |
| B-01 | ~~Node.js and a package manager are not installed~~ | Resolved 2026-10-10 | Node v24.20.0, pnpm 12.11.2 |
| B-02 | ~~Docker Desktop is installed but cannot start: WSL is not installed~~ | Resolved 2026-10-11 | WSL installed, Docker daemon running; no database container started yet |
| B-03 | ~~Project sits in a OneDrive-synced folder~~ | Resolved 2026-10-10 | Project now at `C:\dev\web shoping` |
| B-04 | No GitHub remote; `gh` not logged in | T-070 cannot be verified on a real run | User runs `gh auth login`, then create the repository; CI can be written but not proven until then |

## Questions for the owner

Parked questions per D-019. Work that depends on an open question waits; everything else continues.

| Id | Question | Raised by | Blocks |
| --- | --- | --- | --- |
| OQ-01 | The approved light-grey outline on input boxes and outline buttons (`#C9CDD1`) is too faint for accessibility guidelines (1.59:1, guideline 3:1). Keep the approved look, or use a darker grey outline (`#7F8790`) on form controls? | ui-ux-design, T-003 | Input and outline-button styling in T-017 |
| OQ-02 | The accent green is reserved for main buttons and links. Should the "จัดส่งแล้ว" (shipped) status badge also be green-accent, or a neutral or blue colour? | ui-ux-design, T-003 | Badge colours in T-017 |
| OQ-03 | For the currently selected tab, page number, or menu item: dark ink (like the selected category chip in the mockup) or accent green? | ui-ux-design, T-003 | Tabs, pagination, nav styling in T-017 |
| OQ-04 | Products need admin approval before going live (confirmed). Should admins also have a switch to turn approval off? If so, what happens to products already waiting when it is switched off? (REQUIREMENTS Q7) | T-004 | T-013, T-042, T-050 |
| OQ-05 | When a seller edits an already-approved product, which changes need approval again (any; only title, description, category, pictures; none), and does the product stay on sale while waiting? (Q8) | T-004 | T-013, T-042 |
| OQ-06 | Can a seller fix a rejected or taken-down product and resubmit it, or is the rejection final? (Q9) | T-004 | T-013, T-042, T-050 |
| OQ-07 | After a failed (test) payment: can the customer retry the same order or must they check out again? Do the items go back into the cart? Do sellers see the failed order at all? (Q10) | T-004 | T-013, T-032, T-034 |
| OQ-08 | Refunds are not built in the MVP. When a seller or admin cancels an already-paid order: allow and show "refund handled outside the system", allow and mark the test payment refunded, or forbid cancelling once paid? Do cancelled orders count in sales and revenue figures? (Q11) | T-004 | T-013, T-032, T-043, T-050 |
| OQ-09 | If one cart item can no longer be bought at checkout: stop the whole checkout until the customer removes it, or buy the rest without it? (Q12) | T-004 | T-031, T-032, T-034 |
| OQ-10 | When an admin switches a category off: do its products disappear from the whole shop and become unbuyable, or only the category page disappears? (Q13) | T-004 | T-020 |
| OQ-11 | Do sold-out products stay visible marked "สินค้าหมด", or are they hidden? (Q14) | T-004 | T-020, T-021 |
| OQ-12 | At what quantity does a product count as "low stock" (for example 5 or fewer)? (Q15) | T-004 | T-021, T-042, T-043 |
| OQ-13 | Can an admin make another user an admin from the admin screens, or are admins created only by the setup script? (Q16) | T-004 | T-016, T-050 |
| OQ-14 | When an admin deactivates a user who owns a store: are the store and its products hidden too, or do they stay on sale? (Q17) | T-004 | T-020, T-050 |
| OQ-15 | Temporary shop name until the real one is provided. The approved mockup shows "ชื่อแบรนด์"; confirm or give another. (Q18) | T-004 | none; one string in `src/i18n/th.ts` |
| OQ-16 | Limits on what an admin may enter in settings: highest shipping fee and commission range (for example fee up to 1,000 THB, commission 0 to 100 percent). (Q19) | T-004 | T-013, T-050 |
| OQ-17 | Once marked shipped, an order can only become delivered. Is there a need to cancel a shipped order or mark it lost? | T-004 | T-013, T-043 |
| OQ-18 | If a store renames itself, do old orders show the old name (frozen at purchase, like product details) or the new one? | T-004 | T-013 |
| OQ-19 | Approve changing CLAUDE.md rule 7 as proposed in D-021 (list of code allowed to reach the database layer). | T-004, B1 | T-011 database check, T-015, T-014, T-016, T-023 |
| OQ-20 | Design details to confirm on real pages at milestone 1, each currently a marked placeholder: text size in input boxes (15 px as approved, or 16 px so iPhones do not zoom in when typing); chip height on desktop; search box height (52 px used); how required or optional form fields are marked; whether the quantity selector is hidden or greyed out for sold-out products; how negative amounts are written; whether forms show an error summary at the top | ui-ux-design, T-017 | none now; T-018, T-021, T-034 visuals |
| OQ-21 | How long should server logs be kept, and who may read them? They will contain visitors' IP addresses for security events. | security | T-071 runbook; not blocking the MVP build |
| OQ-22 | May the system store the IP address and browser details of each login with the session, and for how long? | security | T-015 |
| OQ-23 | When stock drops below the quantity a customer already chose (in the cart or on a product page): lower their quantity automatically and say so, or keep their number and ask them to change it? | code-review of T-017 | T-021, T-031, T-034 |
| OQ-24 | Quantity is above the available stock and the customer presses the Up arrow key: nothing happens (like the disabled plus button), or jump to the highest quantity that can be bought (current behaviour)? | code re-review of T-017 | QuantityStepper detail before T-021 |

The full review register is [reviews/T-004-findings.md](reviews/T-004-findings.md).

## Security findings

Registered in [SECURITY.md](SECURITY.md). State after the 2026-10-11 re-check: 0 Critical, 0 High, 0 Medium open. Fixed and re-checked: SEC-001 to SEC-007, SEC-011. Open Low: SEC-008, SEC-009 (devops, compose image tag and placeholder credentials), SEC-010 (dev-only `pnpm audit` advisory in `eslint-config-next`, no patched version, production tree clean), SEC-012 to SEC-018 (backend-api: narrower log-redaction bypasses, invisible characters in logs, `INTERNAL_ERROR` details reaching the client, rate-limit rule registration order). 41 `it.fails` tests in `tests/security` demonstrate the open backend findings. The secret scan was a manual pattern search; no dedicated scanner is installed. Nothing calls these utilities yet, so caller-side rules are unverified.

## Tasks

| Id | Task | Status | Evidence / note |
| --- | --- | --- | --- |
| T-001 | Install prerequisites | VERIFIED | `node -v`, `pnpm -v`, `docker info` succeed; versions in D-020; database reachable through T-012 |
| T-002 | Initialise git | VERIFIED | Commit `65357c3`; `git status` clean afterwards; no env files tracked |
| T-003 | Verify delegation | VERIFIED | ui-ux-design agent rewrote DESIGN_SYSTEM.md to the approved direction (D-018) and returned the standard report; orchestrator confirmed the diff touches only that file and the acceptance greps hold. Raised OQ-01 to OQ-03 |
| T-004 | Review planning documents | IN PROGRESS | Both reviews returned 2026-10-11. Orchestrator-owned findings fixed (plan dependencies, ownership table, D-022 to D-024); REQUIREMENTS.md updated by product-requirements. Still open: findings owned by database, backend-api, qa, security, and 16 owner questions (OQ-04 to OQ-19). Register: reviews/T-004-findings.md |
| T-010 | Scaffold | VERIFIED | Re-review 2026-10-11: APPROVE. Follow-ups closed the same day (non-normal import paths, non-literal require, `prisma/` exemption; probes now 42 of 42); still open: widen the driver pattern when T-013 picks the Prisma output path and adapter (re-review item N3). History: | 2026-10-11 `pnpm verify` exit 0 on the scaffold. Code review 2026-10-11: CHANGES REQUIRED (import guard bypassed by relative, dynamic, and `.js` imports). Fixed by the orchestrator: guards match by regular expression, cover JS files and dynamic imports, deny `src/server/db` everywhere except `src/modules`; `scripts/check-import-guards.mjs` (27 of 27 probes) runs in `pnpm lint`; `noUncheckedIndexedAccess` enabled. `pnpm verify` exit 0 on the integrated tree; re-review running. Scripts `test:integration`, `test:e2e`, `db:*`, `admin:bootstrap` are defined but their tooling is not installed yet |
| T-011 | Env validation, health | NOT STARTED | Needs T-012, T-013; database check waits on OQ-19 |
| T-012 | Compose databases | VERIFIED | Code review APPROVE and security review (no Critical or High; SEC-008, SEC-009 Low open) 2026-10-11. devops agent report 2026-10-11; orchestrator re-ran `docker compose ps` (both healthy) and a query in each database: PostgreSQL 18.6, UTF8, UTC. Dev on 127.0.0.1:5432 (named volume), test on 127.0.0.1:5433 (tmpfs). No `.env` exists or is tracked. Code review pending. Open for T-013: Thai sort order under the default `en_US.utf8` collation |
| T-013 | Schema v1 | BLOCKED | Waits on owner answers that change the first migration (OQ-04 to OQ-08, OQ-16 to OQ-18) and on data-model fixes from the review (B3, S7, S8, S10 to S12, S19) |
| T-023 | Integration-test harness | NOT STARTED | Added 2026-10-11 (review finding B9) |
| T-014 | Seed | NOT STARTED | |
| T-015 | Auth | NOT STARTED | |
| T-016 | Admin bootstrap | NOT STARTED | |
| T-017 | Design tokens, primitives | VERIFIED | Re-review 2026-10-11: APPROVE. Minor follow-ups for ui-ux-design before T-021: a 400-digit typed quantity commits as 1 instead of max; a typed draft stays on screen after the control is disabled and re-enabled; arrow-key behaviour when out of range waits on OQ-24. History: | Code review 2026-10-11: APPROVE with should-fix items (QuantityStepper out-of-range contract, missing tests, Pagination non-finite input); fixed 2026-10-11 (component tests 155 of 155); re-review running. ui-ux-design agent report 2026-10-11; orchestrator ran `pnpm verify` on the integrated tree: exit 0, 257 of 257 unit and component tests passed, build succeeded. 21 primitives; test-only dependencies added (jsdom 30.1.2, Testing Library). Not yet seen in a browser. Not built: Dialog, Drawer, Tabs, Toast, Table, FileUpload, StatCard, Switch, ProductCard, CartButton. Code review pending. Raised OQ-20 |
| T-018 | App shell | NOT STARTED | |
| T-019 | Server basics | VERIFIED | Re-review 2026-10-11: code review APPROVE; security re-check: SEC-001 to SEC-007 FIXED on the security agent's own evidence, no Critical, High, or Medium open. Seven new Low findings (SEC-012 to SEC-018) and review follow-ups N9 to N14 are with backend-api; fix agent running. History: | Code review 2026-10-11: CHANGES REQUIRED (every ZodError mapped to 400; rate-limit rules sharing one counter; quadratic log scrubbing). Security review: 4 Medium. Fixes landed 2026-10-11 (all 34 security tests that demonstrated SEC-001 to SEC-006 now pass as plain tests; `getClientAddress` added per SR-01; contract conventions written into API_CONTRACTS.md); orchestrator `pnpm verify` exit 0. Security and code-review re-checks running. backend-api agent report 2026-10-11; orchestrator re-ran on `src/server`: Prettier clean, ESLint 0 warnings, 151 of 151 unit tests passed; imports are only `zod` and `node:crypto`. Code review and security review pending. Interim contract choices to write into API_CONTRACTS.md: header `X-Request-Id`, `details` always present, `details.fields` as `{ path, code, message }[]`. Unresolved for security: trusted-proxy rule for per-IP limits (S20), behaviour at the limiter key cap, accepting client-supplied request ids, which personal fields the logger redacts |
| T-020 | Catalog API | NOT STARTED | |
| T-021 | Storefront pages | NOT STARTED | |
| T-030 | Profile, addresses | NOT STARTED | |
| T-031 | Cart | NOT STARTED | |
| T-032 | Checkout, orders, mock payment | NOT STARTED | |
| T-033 | Concurrency tests | NOT STARTED | |
| T-034 | Checkout UI | NOT STARTED | |
| T-035 | Reviews | NOT STARTED | |
| T-040 | Seller onboarding | NOT STARTED | |
| T-041 | Uploads | NOT STARTED | |
| T-042 | Seller products, inventory | NOT STARTED | |
| T-043 | Seller orders | NOT STARTED | |
| T-044 | Seller UI | NOT STARTED | |
| T-045 | Seller isolation tests | NOT STARTED | |
| T-050 | Admin module | NOT STARTED | |
| T-051 | Admin UI | NOT STARTED | |
| T-052 | Admin permission tests | NOT STARTED | |
| T-060 | E2E suite | NOT STARTED | |
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

## Test and build results

| Date | Command | Result |
| --- | --- | --- |
| 2026-10-11 | `pnpm verify` (scaffold only) | exit 0; unit tests 2 passed, 0 failed; build succeeded |
| 2026-10-11 | `pnpm verify` (after T-017, T-019) | exit 0; 13 test files, 257 passed, 0 failed; build succeeded |
| 2026-10-11 | `pnpm test` (security project added) | exit 0; 14 files, 267 passed, 34 expected failures (open security findings), 0 unexpected |
| 2026-10-11 | `pnpm verify` (after review fixes to T-010, T-017, T-019) | exit 0; import-guard probes 27 of 27; 16 test files, 643 passed, 0 failed, 0 expected failures; build succeeded |
| 2026-10-11 | `pnpm verify` (after re-review and security re-check) | exit 0; import-guard probes 42 of 42; 16 test files, 719 passed, 41 expected failures (open Low findings SEC-012 to SEC-018), 0 unexpected; build succeeded |
| 2026-10-11 | `pnpm audit` / `pnpm audit --prod` (run by security agent) | 1 high in a dev-only dependency (SEC-010) / no known vulnerabilities |

No integration, E2E, or security scan has been run yet.

## Deployment

| Stage | State |
| --- | --- |
| Local | not runnable yet |
| Staging | not configured |
| Production | not configured |

## Change log

| Date | Change |
| --- | --- |
| 2026-10-10 | Environment checked. Planning documents, agent definitions, and GitHub templates written. |
| 2026-10-10 | Node, Docker Desktop, and gh installed by the user; pnpm enabled; git initialised. B-01 and B-03 resolved; B-02 narrowed to missing WSL. |
| 2026-10-11 | WSL installed by the user; Docker daemon confirmed running. B-02 resolved. Build work paused at the user's request. |
