# CLAUDE.md

Project instructions for Claude Code and every subagent working in this repository.

## What this project is

A Thai-language multi-vendor e-commerce marketplace (Shopee/Lazada style) with three roles: customer, seller, admin. Modular monolith. Correctness and security take priority over feature count.

Current state: **early build; most features do not exist yet.** See [docs/STATUS.md](docs/STATUS.md) before assuming anything exists.

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

## Stack (proposed, see DECISIONS.md)

Next.js (App Router) + TypeScript strict, React, Tailwind CSS, shadcn/ui, PostgreSQL, Prisma, Better Auth, Zod, Vitest, Playwright, GitHub Actions. Exact versions are pinned when the project is scaffolded and recorded in DECISIONS.md.

## Commands

All script names below exist in `package.json` (T-010). `test:integration`, `test:e2e`, `db:migrate`, `db:seed`, and `admin:bootstrap` fail until their tooling lands (T-012 to T-016, T-060); see [docs/STATUS.md](docs/STATUS.md). `pnpm verify` runs format check, lint, type check, unit tests, and build.

Next.js 16 differs from older versions (Cache Components are on). Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code; see [AGENTS.md](AGENTS.md).

| Purpose | Command |
| --- | --- |
| Install | `pnpm install --frozen-lockfile` |
| Dev server | `pnpm dev` |
| Format check | `pnpm format:check` |
| Lint | `pnpm lint` |
| Type check | `pnpm typecheck` |
| Unit tests | `pnpm test` |
| Integration tests (needs database) | `pnpm test:integration` |
| E2E tests | `pnpm test:e2e` |
| Production build | `pnpm build` |
| Migrate (dev) | `pnpm db:migrate` |
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
7. Only `src/server/db` imports the Prisma client; only `src/modules/*` imports `src/server/db`.
8. No secrets in source, logs, client bundles, or docs. `.env.example` holds placeholders only.

## Verification before claiming anything

- A task is `IMPLEMENTED` when code exists; `VERIFIED` only after its acceptance checks actually ran and passed in this environment.
- Report the exact command and its real output summary. If a command could not run, say so and say why.
- Never skip, delete, or weaken a test, an auth check, or a lint rule to get a green result.
- Mock payment and simulated shipping must be labelled as such in UI, docs, and database records.

## Needs human approval

Production deployment, production migrations, destructive data or git operations, real payment operations, DNS changes, adding paid services, and anything requiring credentials that are not already provided.

## Subagents

Definitions live in [.claude/agents/](.claude/agents/). The main Claude Code session is the orchestrator; subagents cannot launch other subagents. Each agent edits only the paths it owns and ends with the report format in [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md).
