# Status

The only place task status is recorded. Owner: orchestrator. Task definitions are in [PROJECT_PLAN.md](PROJECT_PLAN.md).

Last updated: 2026-10-11

## Summary

Planning documents and agent definitions are written and the empty Next.js scaffold builds. **No marketplace feature exists yet. Nothing has been deployed.**

## Resume here (handoff updated 2026-10-11, fourth session)

A new session should read CLAUDE.md, this file, DECISIONS.md (D-017 to D-029), PROJECT_PLAN.md, AGENT_WORKFLOW.md, and reviews/T-004-findings.md. All work is committed locally on `main` (no remote, nothing pushed) unless the list below says otherwise.

Standing rules from the owner (D-019): never guess, park questions here and ask in batches; commit locally after each task passes its checks, never push without being told; stop for owner review at the five milestones. Run at most two or three agents at a time (owner, third session). Milestone 1 (foundation plus browsable storefront) is in progress.

Before starting, check the machine: Docker Desktop running and `docker compose up -d --wait` (the test database is empty after every container start); `pnpm install --frozen-lockfile`; `pnpm verify` should exit 0 with 1199 passed and 0 expected failures.

Done in the third session (each committed):

- Owner answered OQ-25 to OQ-50 (D-026) and the follow-up questions the agents raised (D-028). Orchestrator rulings D-027 (sessions and suspension) and D-029 (a GET never writes; checkout stores a lowered quantity and stops; `storeId` rejected).
- SEC-020 fixed and re-checked; SEC-008 re-checked; SEC-021 found, fixed, and re-checked. Open findings: SEC-009 and SEC-010, both Low.
- API_CONTRACTS.md rewritten for the T-004 findings and D-026; D-026 written into REQUIREMENTS.md (BR-31 to BR-38), DATA_MODEL.md, and SECURITY.md (OQ-47 to OQ-50).

Fourth session (2026-10-11, evening), each item committed unless marked:

- Machine checked: Docker up, both databases healthy, `pnpm verify` exit 0 with 1191 passed.
- Step 3 done (`7532fc6`): BR-17 to BR-38 are in the PROJECT_PLAN.md "Covers" columns; T-016 acceptance states the BR-26 behaviour; D-030 keeps Markdown out of Prettier. Left over: script `db:migrate:deploy` is added with T-013; REQUIREMENTS.md still says the Covers columns lack BR-17 to BR-38 ("gap" sentence above its second traceability table), to be removed by product-requirements in the fix round after the cross-document check.
- DEPLOYMENT.md finished by devops (`b94de02`): OQ-47 to OQ-50, D-028, D-029; new sections "Scheduled work", "Database backups", "Restore procedure", "Open questions" (DEP-Q1 to DEP-Q11). Not yet reviewed by security against SR-06 and SR-07.
- Step 1 is finished. TEST_STRATEGY.md by qa (`4e48dd6`): every case is a plan, no test was run; disagreements between documents are its T1 to T12 under "Risks and open concerns"; qa reports nothing blocks T-013 or T-023. Design system by ui-ux-design (`e1bbaa6`): OQ-45 hover border through `--control-border-hover`, the four approved Thai texts in `src/i18n/th.ts`; `pnpm verify` exit 0 with **1199 passed** (the new baseline).
- Step 2 reviews are done (both read-only). Cross-document check: T-013 was blocked only by X-01 (no Better Auth version named), now ruled; findings X-01 to X-16 are answered by D-031 (`f60751d`) or handed to owners below; the register reviews/T-004-findings.md is brought up to date. Code review of `66a0cfa`, `e1bbaa6`, `4407b71`, `28c92d1`, `e2a4a7a`, `9c9158b`, `d4ff53e`: all four change sets APPROVED WITH FOLLOW-UPS, no Blocking finding (CR-01 to CR-14).
- **Running when this was written:** database on T-013 (uncommitted work in `prisma/`, `src/server/db/`, `package.json`, `pnpm-lock.yaml`, `eslint.config.mjs`, `docs/DATA_MODEL.md`; if it died, read `git status` and `git diff`, check whether a migration was half-applied with `pnpm exec prisma migrate status`, and relaunch with the T-013 brief: Prisma 7.10.0 exact, auth tables from the Better Auth 1.7.7 schema, acceptance = fresh-database migrate, deploy to the test database, constraint demonstrations by SQL, `pnpm verify`). backend-api on `docs/API_CONTRACTS.md` only (X-02 to X-05, X-08 to X-11, the D-031 point 4 order of refusals; uncommitted).
- Still to hand out, two agents at a time: product-requirements (X-13: stale lines about 345, 291, 109 and REQ-S-09 in REQUIREMENTS.md; REQ-C-11 wording per D-031 point 3; reverse-index rows for BR-03, BR-04, BR-06); backend-api code follow-ups in `src/server` (CR-02 `conflict()` without a reason, CR-03 non-fatal UTF-8 decoding, CR-04 nesting depth, CR-05 log level of an aborted body, CR-06, CR-09 handler order per D-031 point 4) with a security re-check; ui-ux-design (CR-01 a test of compiled rule order, CR-07 disabled-and-invalid border, CR-12, CR-13); frontend later (CR-08 pin the four Thai texts with a test, CR-14 the stepper's `onChange` on mount against D-029 when the cart page is built). Then close T-004, then T-023.
- `ARCHITECTURE.md` line 34 still says "db (pending D-021)"; D-021 is accepted.

Technical points still open after D-031, none blocking T-013: T10 / X-07 (expired-session delete during a `GET`) for auth and security in T-015; T1 / X-05 (blind resend) and the refused-checkout mechanism before T-032; T4, T8, T9 as qa listed them.

Raised by devops, for other owners: the start-up hook file an in-process timer would need (Next.js instrumentation file) has no owner in AGENT_WORKFLOW.md, assign one before T-015; script names for running the purge and the sweep on demand are needed with T-015 and T-032; T-011 fixes the timeout variable (proposed `PAYMENT_TIMEOUT_MINUTES`, integer, default 15); security rules on restored sessions (DEP-Q7) and settles DEP-Q4 with devops in T-071; KNOWN_LIMITATIONS.md "no background job runner" is updated when T-015 lands.

Parked for the owner (ask in plain Thai with a recommendation, with the next batch; none blocks T-013):

- Q38 (REQUIREMENTS.md): the Thai mark on a cart line whose product is hidden; must not say why. Recommended: "สินค้านี้ไม่พร้อมจำหน่ายในขณะนี้".
- Confirm the shared reading of "view only" for a suspended store: all three documents also refuse editing the store profile (name, description, logo, contact phone), uploading, and deleting a product. The owner was told in chat and has not objected; no schema effect either way.
- Paid time (X-03): should order pages show when an order was paid, and should the admin order list be filterable by paid date so it matches the report? No recommendation needed to continue; `Order.paidAt` exists in the model either way.
- Admin dashboard (X-14): is one total number of users enough, or users split into active and deactivated? The documents use one total.
- Chips: should filter chips also show the ink border on hover? D-026 OQ-45 names form controls and outline buttons only, so chips were left unchanged. Recommended: decide on real pages at milestone 1 with OQ-20.
- DEPLOYMENT.md "Open questions" DEP-Q1 to DEP-Q3 and DEP-Q5 to DEP-Q9 (who the system administrators are and who approves one; how often access is checked; who may place and close an investigation hold and how often a hold is reviewed; whether 30 days is also the shortest time a backup is kept; whether a restore signs everyone out; how soon after 15 minutes an unpaid order must fail; a shortest time for logs). Each has a recommendation in the document. None blocks T-013; DEP-Q7 and DEP-Q8 should be answered before T-015 and T-032.

Next steps, in order:

1. Finish writing D-026, D-028, and D-029 into TEST_STRATEGY.md (qa: R1 to R10 answered; the cart read reports but never stores a lowered quantity; the refused checkout stores it and the second submission succeeds; K5 `storeId` rejected not ignored; corrected OQ-06, OQ-07, OQ-09, OQ-12 cases; new cases listed in the product-requirements reports, including suspended-store view-only, 15-minute timeout, paid-date report, bootstrap with an existing email, D-027 sessions, and "no GET changes state"; plan a test for the blind resend of a refused checkout, API_CONTRACTS 8.2 item 1) and into DEPLOYMENT.md (devops: OQ-47 named log-access accounts, OQ-48 90 days as a maximum for every copy plus the investigation-hold procedure, OQ-49 scheduled session purge and the 15-minute payment-timeout sweep, OQ-50 30-day backups and a restore that ends with the session clean-up). Then DESIGN_SYSTEM.md and the primitives (ui-ux-design: OQ-45 hover border in the ink colour, OQ-46 message, the three D-028 Thai texts into `src/i18n/th.ts`).
2. code-review (read-only): check that REQUIREMENTS.md, DATA_MODEL.md, and API_CONTRACTS.md agree with each other and with D-025 to D-029; give a per-id verdict for reviews/T-004-findings.md; say whether anything blocks T-013. Suspected mismatches to confirm: a price-only correction raises `contentRevision` in DATA_MODEL 4.2 but not in API_CONTRACTS (its "choice 7"); whether the API exposes `Order.paidAt`; the two-transaction refused checkout (DATA_MODEL 7.1) against API_CONTRACTS 5.5.3; the blind-resend risk in API_CONTRACTS 8.2 item 1. Fix what it finds, then update the register and close T-004. Separately, code-review of the code: T-017 follow-up (`66a0cfa`), T-019 rounds two and three, and the SEC-020 and SEC-021 fixes (`9c9158b`, `d4ff53e`).
3. Orchestrator: add BR-17 to BR-38 to the "Covers" columns in PROJECT_PLAN.md (T-016 "idempotent" now means BR-26); add script `db:migrate:deploy` with T-013; decide whether Markdown stays excluded from Prettier (`.prettierignore` has `*.md`, so `format:check` proves nothing about docs).
4. T-013 schema (database): the database agent reports nothing blocks it. Pick up `Order.paidAt`, the two `OrderItem` cart-return columns, and the items in DATA_MODEL section 19.4; pin Prisma and widen the driver lint pattern (re-review item N3). Then T-023 integration-test harness (qa); then T-011 env validation and health (devops, including SR-01 proxy variables, `APP_URL`, the SEC-009 refusals, and a named setting for the 15-minute payment timeout); then T-015 auth (with devops: choose what runs the session purge and the payment-timeout sweep on a schedule, D-029), T-014 seed, T-016 admin bootstrap, T-018 app shell, T-020 catalog API, T-021 storefront pages, T-072 security headers.
5. Before T-032: backend-api and security rule on the blind resend of a refused checkout.
6. Milestone 1 report to the owner, with OQ-20 and OQ-45 shown on real pages.

Known environment limits: six agents in parallel plus one more exhausted the usage limit in about 25 minutes; in the third session three at a time, with long resumed agents, exhausted it in about three hours. Run two at a time, prefer fresh agents with a narrow brief over resuming one with a very large context, and update this section and commit after every finished task (owner request: always leave a summary before the limit). Also: the session cannot edit its own permission settings, so command prompts need the owner's "always allow"; long multi-agent runs can exhaust the usage limit (it happened once; interrupted agents were resumed without loss). Approved design mockups: link in D-018.

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

**Answered 2026-10-11:** the owner answered every question below except OQ-20. The answers are in DECISIONS.md D-025 and are binding; the table is kept for the question wording only. **Still open: OQ-20** (design details, to be reviewed on real pages at milestone 1).

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

### Second batch (raised 2026-10-11 while writing the answers into the documents)

**Answered 2026-10-11:** the owner answered every question in this batch. The answers are in DECISIONS.md D-026 and are binding; the table is kept for the question wording only. The follow-up questions raised while writing D-026 into the documents (REQUIREMENTS Q31 to Q37, DATA_MODEL DM-Q8 to DM-Q12, API_CONTRACTS section 8.1) were answered the same day: D-028. **No owner question is open except OQ-20.**

| Id | Question | Source | Blocks |
| --- | --- | --- | --- |
| OQ-25 | After a failed payment, does the customer still see the failed order in their order history, and what does the admin see? | REQUIREMENTS Q21 | T-032, T-034 |
| OQ-26 | When failed-payment items return to the cart and the same product is already there: add the quantities together (within 99 and stock) or keep the cart's quantity? | Q22 | T-032 |
| OQ-27 | If an order fails because the payment system never answered, do the items return to the cart the same way? | qa R3 | T-032 |
| OQ-28 | Adding more than is in stock, or a sold-out product, to the cart: refuse, or lower the quantity? | Q24 | T-031 |
| OQ-29 | A product in a cart sells out: keep the line marked "สินค้าหมด" or remove it? | qa R4 | T-031, T-034 |
| OQ-30 | Is the customer told about a lowered quantity only on the cart page or also at checkout, and does checkout stop so they see it first? | qa R5 | T-034 |
| OQ-31 | When a store owner is reactivated or a category is switched back on, do the store and products come back by themselves? (Written as yes.) | Q26 | T-020, T-050 |
| OQ-32 | A deactivated store owner cannot log in to ship paid orders. Does the admin cancel those by hand? | Q27, DM-Q6 | T-050 |
| OQ-33 | Does a sold-out product count as "low stock", and do products not on sale count? | qa R8 | T-042, T-043 |
| OQ-34 | Do sales figures include the shipping fee? Do order counts include cancelled and failed orders, and an order with one store's part cancelled? | Q23, qa R9 | T-043, T-050 |
| OQ-35 | Does only reordering a product's pictures need approval again? REQUIREMENTS recommends no; DATA_MODEL is written for yes until answered. | Q25, DM-Q4 | T-042 |
| OQ-36 | Resubmitting a rejected or taken-down product: automatic when a correction is saved, or a separate "submit again" button? May it be resubmitted unchanged? | Q20 | T-042 |
| OQ-37 | May the setup script be run again to create more admins, or only the first? | Q28 | T-016 |
| OQ-38 | May the commission rate have decimals (for example 2.5 percent)? | Q29 | T-050 |
| OQ-39 | May a seller put a product into a switched-off category? | Q30 | T-042 |
| OQ-40 | Largest stock quantity a seller may enter for one product (recommended 1,000,000). | DM-Q1 | T-042 |
| OQ-41 | Does a seller see an order while its payment is still being processed, or only once paid? | DM-Q2 | T-043 |
| OQ-42 | Does the admin approval queue include products saved but not yet published? | DM-Q3 | T-050 |
| OQ-43 | A never-ordered product deleted by its seller disappears from customers' carts with no message. Acceptable? | DM-Q5 | T-031, T-042 |
| OQ-44 | Order numbers count upwards, so order volume can be estimated from them. Acceptable for now? | DM-Q7 | T-013 detail (fallback documented) |
| OQ-45 | Form controls now rest on the colour they used to show on hover, so hovering shows no border change. Add a darker hover border, and which colour? | ui-ux-design | visual detail |
| OQ-46 | Wording of the "quantity was lowered" message. Proposed: "สินค้าเหลือ {available} ชิ้น ระบบปรับจำนวนเป็น {available} ชิ้นให้แล้ว". | ui-ux-design | T-021, T-034 |
| OQ-47 | "System administrators" who may read logs: only the people who run the servers, or also shop admins? (Documents apply the stricter reading.) | security, devops | T-071 |
| OQ-48 | Is 90 days a maximum only, or also a promise that logs are available that long? Does it cover copies such as log backups? May lines for an open security investigation be kept longer? | security, devops | T-071 |
| OQ-49 | How soon after a login session expires must its IP address and browser details be gone (at once, within an hour, a day)? Nothing in the system runs on a schedule yet. | security, database | T-015 |
| OQ-50 | How long are database backups kept? They still contain old sessions' IP addresses. | security, devops | T-071 |

The full review register is [reviews/T-004-findings.md](reviews/T-004-findings.md).

## Security findings

Registered in [SECURITY.md](SECURITY.md). State on 2026-10-11 after the third session: 21 findings, 19 fixed and re-checked by the security agent, 0 Critical, High, or Medium open. Open Low: SEC-009 (placeholder credentials; the fix lands in `src/server/env.ts` with T-011) and SEC-010 (dev-only `pnpm audit` advisory in `eslint-config-next`, no patched version, production tree clean). Fixed this session: SEC-020 (body reader memory), SEC-008 (image pinned by digest), SEC-021 (body reader could read without end). The secret scan was a manual pattern search; no dedicated scanner is installed. Nothing calls the server utilities yet, so caller-side rules are unverified.

## Tasks

| Id | Task | Status | Evidence / note |
| --- | --- | --- | --- |
| T-001 | Install prerequisites | VERIFIED | `node -v`, `pnpm -v`, `docker info` succeed; versions in D-020; database reachable through T-012 |
| T-002 | Initialise git | VERIFIED | Commit `65357c3`; `git status` clean afterwards; no env files tracked |
| T-003 | Verify delegation | VERIFIED | ui-ux-design agent rewrote DESIGN_SYSTEM.md to the approved direction (D-018) and returned the standard report; orchestrator confirmed the diff touches only that file and the acceptance greps hold. Raised OQ-01 to OQ-03 |
| T-004 | Review planning documents | IN PROGRESS | Second session 2026-10-11: findings fixed in REQUIREMENTS.md, DATA_MODEL.md, TEST_STRATEGY.md, DEPLOYMENT.md, SECURITY.md, and the lint allow-list (B1). Third session: API_CONTRACTS.md rewritten (commit `3f4e508`); D-026 written into REQUIREMENTS.md, DATA_MODEL.md, SECURITY.md. Remaining: D-028 and D-029 into those documents, TEST_STRATEGY.md and DEPLOYMENT.md, the cross-document check by code-review, and updating the per-item statuses in the register. Earlier: Both reviews returned 2026-10-11. Orchestrator-owned findings fixed (plan dependencies, ownership table, D-022 to D-024); REQUIREMENTS.md updated by product-requirements. Still open: findings owned by database, backend-api, qa, security, and 16 owner questions (OQ-04 to OQ-19). Register: reviews/T-004-findings.md |
| T-010 | Scaffold | VERIFIED | Re-review 2026-10-11: APPROVE. Follow-ups closed the same day (non-normal import paths, non-literal require, `prisma/` exemption; probes now 42 of 42); still open: widen the driver pattern when T-013 picks the Prisma output path and adapter (re-review item N3). History: | 2026-10-11 `pnpm verify` exit 0 on the scaffold. Code review 2026-10-11: CHANGES REQUIRED (import guard bypassed by relative, dynamic, and `.js` imports). Fixed by the orchestrator: guards match by regular expression, cover JS files and dynamic imports, deny `src/server/db` everywhere except `src/modules`; `scripts/check-import-guards.mjs` (27 of 27 probes) runs in `pnpm lint`; `noUncheckedIndexedAccess` enabled. `pnpm verify` exit 0 on the integrated tree; re-review running. Scripts `test:integration`, `test:e2e`, `db:*`, `admin:bootstrap` are defined but their tooling is not installed yet |
| T-011 | Env validation, health | NOT STARTED | Needs T-013 |
| T-012 | Compose databases | VERIFIED | Code review APPROVE and security review (no Critical or High; SEC-008, SEC-009 Low open) 2026-10-11. devops agent report 2026-10-11; orchestrator re-ran `docker compose ps` (both healthy) and a query in each database: PostgreSQL 18.6, UTF8, UTC. Dev on 127.0.0.1:5432 (named volume), test on 127.0.0.1:5433 (tmpfs). No `.env` exists or is tracked. Code review pending. Open for T-013: Thai sort order under the default `en_US.utf8` collation |
| T-013 | Schema v1 | IN PROGRESS | Started 2026-10-11 (fourth session) by the database agent. The data-model fixes from the review are in DATA_MODEL.md; versions and the auth-table source are fixed by D-031 point 1 |
| T-023 | Integration-test harness | NOT STARTED | Added 2026-10-11 (review finding B9) |
| T-014 | Seed | NOT STARTED | |
| T-015 | Auth | NOT STARTED | |
| T-016 | Admin bootstrap | NOT STARTED | |
| T-017 | Design tokens, primitives | VERIFIED | Follow-up 2026-10-11 (commit `66a0cfa`): OQ-01 to OQ-03, OQ-23, OQ-24 and the two QuantityStepper minors implemented; orchestrator re-ran type check, lint, format, and component tests (175 of 175); code review of this follow-up pending. Earlier: Re-review 2026-10-11: APPROVE. Minor follow-ups for ui-ux-design before T-021: a 400-digit typed quantity commits as 1 instead of max; a typed draft stays on screen after the control is disabled and re-enabled; arrow-key behaviour when out of range waits on OQ-24. History: | Code review 2026-10-11: APPROVE with should-fix items (QuantityStepper out-of-range contract, missing tests, Pagination non-finite input); fixed 2026-10-11 (component tests 155 of 155); re-review running. ui-ux-design agent report 2026-10-11; orchestrator ran `pnpm verify` on the integrated tree: exit 0, 257 of 257 unit and component tests passed, build succeeded. 21 primitives; test-only dependencies added (jsdom 30.1.2, Testing Library). Not yet seen in a browser. Not built: Dialog, Drawer, Tabs, Toast, Table, FileUpload, StatCard, Switch, ProductCard, CartButton. Code review pending. Raised OQ-20 |
| T-018 | App shell | NOT STARTED | |
| T-019 | Server basics | VERIFIED | Re-review 2026-10-11: code review APPROVE; security re-check: SEC-001 to SEC-007 FIXED on the security agent's own evidence, no Critical, High, or Medium open. Second fix round landed 2026-10-11 for SEC-012 to SEC-018 and review follow-ups N9 to N14 (all 41 demonstrating tests now pass as plain tests; orchestrator `pnpm verify` exit 0, 948 of 948); security re-check confirmed them FIXED and raised SEC-019 (body size limit), fixed in a third round (`pnpm verify` exit 0, 1050 of 1050). Code review of rounds two and three and the SEC-019 re-check are batched with T-015. Open contract points for backend-api: Content-Type on body-less mutations, Idempotency-Key format. History: | Code review 2026-10-11: CHANGES REQUIRED (every ZodError mapped to 400; rate-limit rules sharing one counter; quadratic log scrubbing). Security review: 4 Medium. Fixes landed 2026-10-11 (all 34 security tests that demonstrated SEC-001 to SEC-006 now pass as plain tests; `getClientAddress` added per SR-01; contract conventions written into API_CONTRACTS.md); orchestrator `pnpm verify` exit 0. Security and code-review re-checks running. backend-api agent report 2026-10-11; orchestrator re-ran on `src/server`: Prettier clean, ESLint 0 warnings, 151 of 151 unit tests passed; imports are only `zod` and `node:crypto`. Code review and security review pending. Interim contract choices to write into API_CONTRACTS.md: header `X-Request-Id`, `details` always present, `details.fields` as `{ path, code, message }[]`. Unresolved for security: trusted-proxy rule for per-IP limits (S20), behaviour at the limiter key cap, accepting client-supplied request ids, which personal fields the logger redacts |
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
| 2026-10-11 | `pnpm verify` (after second T-019 fix round) | exit 0; import-guard probes 42 of 42; 16 test files, 948 passed, 0 failed, 0 expected failures; build succeeded |
| 2026-10-11 | `pnpm verify` (after SEC-019 fix) | exit 0; import-guard probes 42 of 42; 16 test files, 1050 passed, 0 failed, 0 expected failures; build succeeded |
| 2026-10-11 | `pnpm verify` (second session, after D-025 follow-ups) | exit 0; import-guard probes 55 of 55; 18 test files, 1084 passed, 5 expected failures (SEC-020), 0 unexpected; build succeeded |
| 2026-10-11 | `pnpm verify` (third session, after the SEC-020 fix and re-check) | exit 0; import-guard probes 55 of 55; 19 test files, 1136 passed, 2 expected failures (SEC-021), 0 unexpected; build succeeded |
| 2026-10-11 | `pnpm verify` (third session, after the SEC-021 fix and re-check) | exit 0; import-guard probes 55 of 55; 19 test files, 1191 passed, 0 failed, 0 expected failures; build succeeded |
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
| 2026-10-11 | Second session: rule 7 lint allow-list, D-025 answers written into six documents and the UI primitives, SEC-019 closed, SEC-020 and questions OQ-25 to OQ-50 raised. Stopped on the usage limit before API_CONTRACTS.md. |
| 2026-10-11 | Third session: owner answers D-026 and D-028, rulings D-027 and D-029; SEC-020 and SEC-021 fixed and re-checked, SEC-008 re-checked; API_CONTRACTS.md rewritten; D-026 written into REQUIREMENTS.md, DATA_MODEL.md, SECURITY.md. |
