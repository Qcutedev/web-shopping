# T-080 documentation drift audit

Date: 2026-10-29. Auditor: documentation agent. Scope: README, CONTRIBUTING, CLAUDE.md, AGENTS.md, `.env.example`, `package.json` scripts, and every file in `docs/`. This file lists what was not fixed. What was fixed is in the commits tagged `(T-080)`.

## Checks that ran in this audit

| Command or check | Result |
| --- | --- |
| `pnpm format:check` | exit 0, all files match Prettier |
| `pnpm lint` | exit 0, 215 of 215 import-guard probes behaved as expected |
| `pnpm typecheck` | exit 0 |
| Every `pnpm <script>` named in README, CONTRIBUTING, CLAUDE.md, `docs/*.md`, `.github`, scripts | exists in `package.json` (checked by grep; `pnpm uploads:init` in SECURITY.md is an option for the owner, not a claim) |
| Environment variables | every variable `src/server/env.ts`, `src/modules/auth/bootstrap-admin.ts`, `next.config.ts`, and `docker-compose.yml` read is in `.env.example` (active or commented), and every name in `.env.example` is read. `PORT`, `HOSTNAME`, `NEXT_TELEMETRY_DISABLED`, `CI` are set by the Dockerfile or CI for the framework and are correctly absent |
| API routes | 62 `route.ts` files compared with API_CONTRACTS.md by method and path: all are documented |
| Seed claims in README | 3 accounts, 4 categories, 9 products match `prisma/seed/data.ts` |
| Tool versions in README | `node -v` v24.20.0, `pnpm -v` 12.11.2, `docker --version` 29.8.2, Compose v5.5.1 |

## Not run

- `pnpm test`, `pnpm build`, `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`: other agents were editing code in the same tree, and the Docker daemon was not running (`docker ps` failed on the engine pipe).
- **The T-080 acceptance ("README steps followed literally on a clean checkout") was NOT done.** Steps 3 to 5 and the admin bootstrap need the Docker database, which was down. `pnpm install --frozen-lockfile` was not run either, to avoid touching `node_modules` under running agents. The owner or the orchestrator must run the README on a clean checkout with Docker Desktop started, then T-080 can be marked.
- Not compared line by line: DESIGN_SYSTEM.md (Thai key tables against `src/i18n/th.ts`), DECISIONS.md bodies, SECURITY.md finding states, DATA_MODEL.md column lists against `prisma/schema.prisma`, the 600-line TEST_STRATEGY.md result tables, REQUIREMENTS.md user stories.

## Drift in documents I may not edit (STATUS, SECURITY, API_CONTRACTS, DATA_MODEL)

| Document and section | It says | The code or other docs show | Change |
| --- | --- | --- | --- |
| STATUS.md, header | "Last updated: 2026-10-22" | Sessions up to 133 (2026-10-29) are recorded below it | STATUS |
| STATUS.md, Summary | "Not done: ... the final code review, security review, and fix pass (T-061 to T-063)" | Same file says T-061 and T-062 reviews were done (sessions 127) and T-063 fixes are running | STATUS |
| STATUS.md, Open list | "Header shows no cart count for signed-in user (header not wired to session); no add-to-cart UI yet" | Session 116 and 115 record a real cart count in the header and add-to-cart on the product page | STATUS |
| STATUS.md, Open list | "T-033 CC-08, CC-09, CC-13 and CC-06 admin half blocked until T-050 to T-053 (no admin code)" | Admin code exists; `tests/integration/admin/concurrency.test.ts` cases (a) to (d) cover part of these; TEST_STRATEGY rows now say so | STATUS |
| STATUS.md, "Next, in order" and "Last known test results (session 102)" | Refer to SEC-085 to SEC-087 and a session 102 result | Both are old; the current runs are in "Resume here" | STATUS |
| STATUS.md, Open list | Test data in `marketplace_dev` "about 4 customers ... and 2 orders" | Not checked (Docker down); likely stale after later sessions | STATUS |
| STATUS.md, Tasks | T-004 IN PROGRESS: "D-028 and D-029 not yet written into every document" | Not re-checked | STATUS |
| STATUS.md, Resume here | About 20 session paragraphs | Memory rule "keep STATUS short" asks for current state only | STATUS |
| API_CONTRACTS.md, line 3 | "This is the **planned** contract" | Every route in `src/app/api` is implemented and documented; the word "planned" contradicts the labels rule | API_CONTRACTS (say "contract; implemented" and keep the date history) |
| API_CONTRACTS.md, section 1.8 note | STATUS still lists "note 401 after guard" as open | `src/server/http.ts` header comment already describes the 401 after the guard (SEC-088) | API_CONTRACTS, if the section lacks it |
| SECURITY.md, top | "State on 2026-10-13 ..." and "State on 2026-10-12: the application code is the server utilities ..." kept as history | The text below it says so, but a reader meets two outdated state lines before any current one | SECURITY (put a current state line first) |
| DATA_MODEL.md, sections 7.4 and 7.5 | Stale about admin cancel (per STATUS session 104/107 notes) | Admin cancel exists (`v1/admin/seller-orders/[id]/status`) | DATA_MODEL; not re-read in this audit |
| DATA_MODEL.md, line 3 | "This is the **design** for schema v1 ... Schema v1 exi[sts]" | 22 models in `prisma/schema.prisma`, 5 migrations | DATA_MODEL: say "describes the schema as built" |

## Drift in documents I may not or did not change

| Document and section | It says | The code shows | Change |
| --- | --- | --- | --- |
| CLAUDE.md, "What this project is" | "early build; most features do not exist yet" | Customer, seller, admin areas, checkout, reviews, uploads, e2e suite exist | CLAUDE.md (orchestrator) |
| CLAUDE.md, "Stack (proposed ...)" | "Exact versions are pinned when the project is scaffolded" | Versions are pinned in `package.json` | CLAUDE.md |
| CLAUDE.md, "Commands" | "`test:integration`, `test:e2e`, `db:migrate`, `db:seed`, and `admin:bootstrap` fail until their tooling lands" | All tooling exists | CLAUDE.md |
| CLAUDE.md, command table | Lists 13 commands | Missing `pnpm format`, `pnpm start`, `pnpm db:migrate:deploy`; all other rows match `package.json` | CLAUDE.md (optional) |
| DECISIONS.md, index | D-001 to D-015 still `PROPOSED` | The stack is installed and in use; the body says the task that exercises a decision confirms it | orchestrator: mark ACCEPTED or leave with a reason |
| DECISIONS.md, D-011 | "The MVP ships `MockPaymentProvider` and `ManualShippingProvider`" | Only the mock payment provider exists (`src/modules/payments/provider.ts`); there is no shipping provider interface. Shipping is typed by the seller | orchestrator: supersede with a new entry (entries are never rewritten) |
| DECISIONS.md, D-012 | In-memory rate limiter | `seller-application` and `review-create` per-user rules count in the database (`UserRateLimitWindow`, SEC-052) | orchestrator: new entry |
| DECISIONS.md, D-048 | Status PROPOSED | The feature is implemented (`/admin/reviews`) | owner approves, then orchestrator |
| REQUIREMENTS.md, Traceability | "none yet" in most "Test files" cells, "the end-to-end suite does not exist yet", "never run" | Integration, security, and e2e suites exist. I added a warning above the tables; I did not rebuild about 100 rows | product-requirements: rebuild or delete the column |
| DESIGN_SYSTEM.md, "Proposed key" tables (about lines 409 and 502) | Keys are proposals | Many keys are in `src/i18n/th.ts`; several still await owner approval per STATUS | ui-ux-design; not compared |
| TEST_STRATEGY.md | CC-06/08/09/13 rows, itest row | I corrected those rows. The rest of the file (about 600 lines, many dated result tables) was not re-checked against code | qa |

## Fixed in this audit

- ARCHITECTURE.md: status line (said nothing was built), directory layout (route names, module list, `api/auth` path, nonexistent `shipping/` and `users/` modules), the "Not implemented yet" sentence, the `ManualShippingProvider` diagram node and table row.
- TEST_STRATEGY.md: CC-06, CC-08, CC-09, CC-13 rows and the closing sentence (admin code exists); the `*.itest.ts` row (22 files exist).
- DEPLOYMENT.md: check-query notes that still waited for T-013, T-015, T-032, and T-071.
- README.md: module list lacked `rate-limit`; admin feature row now names review hide.
- CONTRIBUTING.md: "These scripts are created by the scaffold task. Until then there is nothing to run" removed; Docker need for integration and e2e stated.
- KNOWN_LIMITATIONS.md: review moderation (admin hide exists), rate limiter (two rules are in the database), delivery 24 hour rule.
- AGENT_WORKFLOW.md: "Delegation has not yet been exercised".
- REQUIREMENTS.md: warning above the traceability tables.

## Open points for the owner

- Run the README on a clean checkout with Docker Desktop running, to close T-080 acceptance.
- Docker was not running during this audit, so the Docker-dependent statements in README, DEPLOYMENT.md, and RUNBOOK-STAGING.md (compose service names, ports, `--wait`) were read, not run.
