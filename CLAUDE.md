# CLAUDE.md

Project instructions for Claude Code and every subagent working in this repository.

## What this project is

A Thai-language multi-vendor e-commerce marketplace (Shopee/Lazada style) with three roles: customer, seller, admin. Modular monolith. Correctness and security take priority over feature count.

Current state: customer, seller, and admin areas, checkout with a mock payment, orders, reviews, and uploads are implemented locally; most tasks are IMPLEMENTED but not VERIFIED, nothing is deployed, and CI ran green once on GitHub (run 40889555775). See [docs/STATUS.md](docs/STATUS.md) for the state of each task before assuming anything works.

## Where the truth lives

| Question | File |
| --- | --- |
| What must the product do? | [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) |
| What tasks exist and what depends on what? | [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) |
| What is the status of each task? | [docs/STATUS.md](docs/STATUS.md) (the only place status is recorded) |
| Why was a choice made? | [docs/DECISIONS.md](docs/DECISIONS.md) |
| How is the system structured? | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATA_MODEL.md](docs/DATA_MODEL.md) |
| What does an endpoint accept and return? | [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md) |
| How do agents hand work to each other? | [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md) |

Do not duplicate status or requirements into other files. Link instead.

## Language

- Customer-facing UI text: **Thai**. Keep strings in `src/i18n/th.ts`, not scattered in components.
- Code, identifiers, comments, commit messages, technical docs, agent instructions: **English**.
- Currency: THB, formatted with `Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })`.
- Dates: `th-TH` locale, Asia/Bangkok timezone for display; store UTC.

## Stack (installed; choices in DECISIONS.md)

Next.js (App Router) + TypeScript strict, React, Tailwind CSS, shadcn/ui, PostgreSQL, Prisma, Better Auth, Zod, Vitest, Playwright, GitHub Actions. Exact versions are pinned in `package.json` (Node 24 or later, pnpm 12.11.2, Next.js 16.4.3, React 19.3.0, Prisma 7.10.0, Better Auth 1.7.7). shadcn/ui is not installed (no `components.json`); the primitives in `src/components/ui/` are written in the repository. Several decisions in DECISIONS.md are still `PROPOSED`; the owner has not confirmed them.

## Commands

All script names below exist in `package.json`. `test:integration`, `test:e2e`, `db:migrate`, `db:seed`, and `admin:bootstrap` need the Docker databases running; see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and the README. `pnpm verify` runs format check, lint, type check, unit tests, and build.

Next.js 16 differs from older versions (Cache Components are on). Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code; see [AGENTS.md](AGENTS.md).

| Purpose | Command |
| --- | --- |
| Install | `pnpm install --frozen-lockfile` |
| Dev server | `pnpm dev` |
| Start built app | `pnpm start` |
| Format (writes files) | `pnpm format` |
| Format check | `pnpm format:check` |
| Lint | `pnpm lint` |
| Type check | `pnpm typecheck` |
| Unit tests | `pnpm test` |
| Integration tests (needs database) | `pnpm test:integration` |
| E2E tests | `pnpm test:e2e` |
| Production build | `pnpm build` |
| Migrate (dev) | `pnpm db:migrate` |
| Migrate (apply existing migrations) | `pnpm db:migrate:deploy` |
| Seed | `pnpm db:seed` |
| Create first admin | `pnpm admin:bootstrap` |
| All pre-merge checks | `pnpm verify` |

Shell is PowerShell on Windows. Do not chain with `&&`.

## Architecture boundaries

```
src/app/(storefront)/   customer pages          -> frontend
src/app/seller/         seller dashboard        -> frontend
src/app/admin/          admin dashboard         -> frontend
src/app/api/v1/         thin route handlers     -> backend-api
src/modules/<domain>/   business logic          -> backend-api
src/server/auth/        sessions, guards, RBAC  -> auth
src/server/db/          Prisma client           -> database
src/components/ui/      design-system parts     -> ui-ux-design
src/components/         feature components      -> frontend
src/i18n/               Thai strings            -> frontend
prisma/                 schema, migrations, seed-> database
tests/, e2e/            cross-cutting tests     -> qa
.github/, scripts/, Dockerfile, compose         -> devops
docs/                   see owners in AGENT_WORKFLOW.md
```

Rules that are not negotiable:

1. Route handlers and pages contain no business logic. They parse input with Zod, call a guard, call a module service, and map the result.
2. Every service function that touches a protected resource takes an explicit `actor` and checks role **and** ownership. Hidden buttons are not a security control.
3. Prices, totals, discounts, shipping fees, and stock are computed on the server from database values. Client-sent amounts are ignored.
4. Money is integer satang (`Int`). No floating-point arithmetic on money.
5. Checkout, stock changes, and status transitions run inside a database transaction.
6. Seller queries are always scoped by `storeId` derived from the session, never from the request body or URL alone.
7. Only `src/server/db` imports the Prisma client. `src/server/db` is imported only by `src/modules/**`, `src/server/auth/**`, `src/server/health.ts`, `prisma/seed.ts`, `scripts/**`, and `tests/**`. Pages, route handlers, and components never import it. (Owner approved 2026-10-11, D-021.)
8. No secrets in source, logs, client bundles, or docs. `.env.example` holds placeholders only.

## Starting a session and resuming interrupted work

A session can end on the usage limit while a task is half done. [docs/STATUS.md](docs/STATUS.md) is then stale, but the files on disk are not. Never redo work that already exists.

1. Before starting any task, run `git status` and `git diff`, and read "Resume here" in [docs/STATUS.md](docs/STATUS.md). Compare the two: uncommitted files are evidence of work that STATUS.md may not record.
2. If uncommitted work exists, inspect it before anything else: read the files and run the checks that apply to them.
   - If it is sound, continue from where it stopped, finish it, commit it, and update STATUS.md.
   - If it is broken or far from complete, summarise it for the owner in Thai and ask whether to keep or discard it. Do not delete or overwrite it without that answer.
3. Do not start a new task, or relaunch an agent on the same task, on top of uncommitted work that has not been inspected. A relaunched agent is told which files already exist and to continue from them.
4. Before launching an agent, record in "Resume here" which task is starting, which agent runs it, and which paths it will touch, and commit that.
5. During a long task, commit each finished part that passes its checks instead of holding everything for one final commit, so an interruption loses only the last part.

## Verification before claiming anything

- A task is `IMPLEMENTED` when code exists; `VERIFIED` only after its acceptance checks actually ran and passed in this environment.
- Report the exact command and its real output summary. If a command could not run, say so and say why.
- Never skip, delete, or weaken a test, an auth check, or a lint rule to get a green result.
- Mock payment and simulated shipping must be labelled as such in UI, docs, and database records.

## Needs human approval

Production deployment, production migrations, destructive data or git operations, real payment operations, DNS changes, adding paid services, and anything requiring credentials that are not already provided.

## Subagents

Definitions live in [.claude/agents/](.claude/agents/). The main Claude Code session is the orchestrator; subagents cannot launch other subagents. Each agent edits only the paths it owns and ends with the report format in [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).
