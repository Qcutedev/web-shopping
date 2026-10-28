# Thai Multi-Vendor Marketplace

A Thai-language multi-vendor e-commerce marketplace: customers buy from many independent sellers through one storefront, sellers manage their own store, and administrators govern the platform.

> **Project state: early build, local development only.** The application runs on a developer machine against a local PostgreSQL. Nothing is deployed: there is no staging or production environment, no hosting provider, and no GitHub remote, so the CI workflow has never run. Payment is a mock and shipping is entered by hand. Task status is recorded only in [docs/STATUS.md](docs/STATUS.md); many items there are implemented but not yet verified.

## สรุปสั้น ๆ (ภาษาไทย)

โปรเจกต์นี้คือเว็บ marketplace แบบหลายร้านค้า มี 3 บทบาท คือ ลูกค้า ผู้ขาย และผู้ดูแลระบบ ตอนนี้รันได้บนเครื่องนักพัฒนาเท่านั้น (ยังไม่ได้ deploy) การชำระเงินเป็นระบบจำลอง ไม่มีเงินจริงเคลื่อนไหว

เริ่มใช้งานแบบย่อ (PowerShell ในโฟลเดอร์โปรเจกต์):

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
docker compose up -d --wait db-dev
pnpm db:migrate
pnpm db:seed
pnpm dev
```

จากนั้นเปิด http://localhost:3000 สร้างผู้ดูแลระบบคนแรกด้วย `pnpm admin:bootstrap` (ดูหัวข้อ "Creating the first administrator") บัญชีตัวอย่างจาก seed ใช้บนเครื่องตัวเองเท่านั้น

## Stack

Next.js 16 (App Router, Cache Components), React 19, TypeScript strict, Tailwind CSS 4, PostgreSQL 18, Prisma 7, Better Auth, Zod 4, Vitest, Playwright, GitHub Actions. Exact versions are in `package.json` and [docs/DECISIONS.md](docs/DECISIONS.md). Read [AGENTS.md](AGENTS.md) before writing Next.js code: version 16 differs from older releases.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Windows 11 with PowerShell | PowerShell 5.1 or later | Commands below are PowerShell; do not chain them with `&&` |
| Node.js | 24.x (`engines` is `>=24`; CI and the Docker image use 24.20.0) | Runtime |
| pnpm | 12.11.2, pinned by `packageManager`; enable with `corepack enable` | Package manager |
| Docker Desktop with Compose | Any current version (developed with Docker 29.8.2, Compose v5.5.1) | Runs PostgreSQL 18 (`docker-compose.yml`); there is no database on the host |
| Git | Any current version | Version control |

The GitHub CLI is optional and is not needed to run the app.

## Setup

Run from the repository root. Docker Desktop must be running.

1. Install dependencies. `postinstall` runs `prisma generate`.

   ```powershell
   pnpm install --frozen-lockfile
   ```

2. Create the environment file. `.env` is git-ignored; `.env.example` holds local placeholders only.

   ```powershell
   Copy-Item .env.example .env
   ```

   Optional: set `UPLOAD_DIR` in `.env` to an absolute directory of yours (for example `C:\dev\web shoping\uploads`; `/uploads/` is git-ignored). Without it, `pnpm dev` starts but the upload and file endpoints answer `500`, so product pictures do not work. Every variable is explained in [`.env.example`](.env.example) and in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) ("Environment variables").

3. Start the development database and wait until it is healthy.

   ```powershell
   docker compose up -d --wait db-dev
   ```

4. Apply migrations, then load sample data.

   ```powershell
   pnpm db:migrate
   pnpm db:seed
   ```

   `pnpm db:migrate` runs `prisma migrate dev` and is for local databases only. The seed is idempotent and refuses to run when `NODE_ENV=production`.

5. Start the development server and open <http://localhost:3000>.

   ```powershell
   pnpm dev
   ```

   Do not run `pnpm dev` and `pnpm build` at the same time: both use `.next`.

`pnpm start` runs the production build with `NODE_ENV=production`, which refuses the local placeholders in `.env` by design. Use `pnpm dev` locally.

## Creating the first administrator

There is no default admin and no web page that grants admin. Create one with the bootstrap script, which reads the email and password from the environment of that one command, never from arguments. The database from step 3 must be running.

```powershell
$env:ADMIN_BOOTSTRAP_EMAIL = "admin@example.com"
$secure = Read-Host -AsSecureString "Admin password"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:ADMIN_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
pnpm admin:bootstrap
Remove-Item Env:ADMIN_BOOTSTRAP_EMAIL, Env:ADMIN_BOOTSTRAP_PASSWORD
```

The password must be 8 to 128 characters. An optional `ADMIN_BOOTSTRAP_NAME` sets the display name (default `Admin`). `.env.example` lists these variables as commented placeholders so they are discoverable; leave them commented out and never put a real password in `.env`, because `.env` stays on disk. Use the session-only `$env:` steps above instead. Exit codes and behaviour are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) ("First administrator"). Then sign in at <http://localhost:3000/sign-in> and open `/admin`.

## Sample accounts (local only)

`pnpm db:seed` creates sample accounts for local development. They are not real people, share a published password, and must never exist on a staging or production database.

| Email | Role | Password |
| --- | --- | --- |
| `sample-customer-1@example.com` | Customer | `sample_dev_only_not_a_secret` |
| `sample-seller-1@example.com` | Seller (approved sample store) | same |
| `sample-seller-2@example.com` | Seller (approved sample store) | same |

The seed also creates 4 sample categories and 9 sample products, all flagged as sample data. It creates no admin. Source of truth: [docs/DATA_MODEL.md](docs/DATA_MODEL.md) section 18.

## Commands

All of these exist in `package.json`.

| Purpose | Command |
| --- | --- |
| Dev server | `pnpm dev` |
| Format (write) | `pnpm format` |
| Format check | `pnpm format:check` |
| Lint (ESLint with zero warnings, then import-guard check) | `pnpm lint` |
| Type check (`next typegen`, then `tsc --noEmit`) | `pnpm typecheck` |
| Unit tests | `pnpm test` |
| Integration tests (need the `db-test` container: `docker compose up -d --wait db-test`) | `pnpm test:integration` |
| End-to-end tests (need `db-test` and Chromium: `pnpm exec playwright install chromium`) | `pnpm test:e2e` |
| Production build | `pnpm build` |
| Start the production build | `pnpm start` |
| Apply migrations to a local database | `pnpm db:migrate` |
| Apply committed migrations to a deployed database | `pnpm db:migrate:deploy` |
| Seed sample data | `pnpm db:seed` |
| Create the first admin | `pnpm admin:bootstrap` |
| Format check, lint, type check, unit tests, build | `pnpm verify` |

`pnpm verify` does not run integration or end-to-end tests. Do not run two e2e suites at once: they share port 3100 and the database `marketplace_e2e`. Test counts and run dates are kept in [docs/STATUS.md](docs/STATUS.md) and [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md), not here.

Other scripts: `scripts/container-smoke.ps1` builds and runs the Docker images locally ([docs/RUNBOOK-STAGING.md](docs/RUNBOOK-STAGING.md)); `scripts/build-probe.ps1` runs a build with a separate dist directory and restores `tsconfig.json` afterwards ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), "CI pipeline").

## Project structure

```
src/app/(storefront)/   customer pages
src/app/seller/         seller dashboard pages
src/app/admin/          admin dashboard pages
src/app/api/v1/         thin route handlers
src/modules/<domain>/   business logic (admin, auth, cart, catalog, checkout, inventory,
                        orders, payments, profile, reviews, sellers, uploads)
src/server/             env validation, logger, rate limiting, health
src/server/auth/        sessions, guards, RBAC
src/server/db/          Prisma client (imported only by allowed paths)
src/components/         feature components; src/components/ui/ design-system parts
src/i18n/th.ts          Thai UI strings
prisma/                 schema, migrations, seed
tests/                  integration, security, and unit tests
e2e/                    Playwright specs
scripts/                bootstrap-admin, import-guard check, container smoke, build probe
.github/                CI workflow, dependabot, templates
.claude/agents/         AI agent definitions
docs/                   plan, architecture, contracts, policies
Dockerfile              runtime and migrate images (not deployed)
docker-compose.yml      local PostgreSQL databases (development and test)
```

Boundaries and rules: [CLAUDE.md](CLAUDE.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Feature status

`Implemented` works in this repository. `Simulated` works but fakes an external system. `Planned` is not built. Implemented does not mean verified: see [docs/STATUS.md](docs/STATUS.md) for review and browser-check state per task.

| Area | Status |
| --- | --- |
| Customer registration, sign-in, profile, addresses | Implemented |
| Catalog: home, categories, search, product, store pages | Implemented |
| Cart with items from several sellers | Implemented |
| Checkout and orders | Implemented |
| Payment | Simulated (mock provider, refused in a production server; no money moves) |
| Shipping fee and tracking | Simulated (seller enters tracking and marks status by hand; no carrier) |
| Reviews | Implemented |
| Seller onboarding, products, inventory, orders | Implemented |
| Admin: approvals, moderation, categories, users, orders, reports, settings, audit log | Implemented |
| File storage | Simulated (local disk; no object storage or CDN) |
| End-to-end test suite | Implemented (see [docs/TEST_STRATEGY.md](docs/TEST_STRATEGY.md) for what it covers and does not) |
| CI workflow (`.github/workflows/ci.yml`) | Implemented, never run: no GitHub remote |
| Container images (`Dockerfile`) | Implemented, built and run locally only |
| Deployment (staging, production) | Planned; no environment exists |
| Password recovery, email verification, notifications | Planned |
| Backups, log collection, monitoring | Planned |

Full list of simulated and missing capabilities: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## Troubleshooting

- **The server stops at start with `APP_URL is required` (or another variable name).** `.env` is missing or old. Copy it again from `.env.example`; the log line names the variable, never its value. Details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **`pnpm start` refuses to start with a placeholder-password message.** Intended: production mode rejects the local placeholders. Use `pnpm dev`.
- **Upload and file endpoints answer `500`.** `UPLOAD_DIR` is not set in `.env` (absolute path required).
- **`docker` commands fail or hang.** Start Docker Desktop first.
- **Port 5432 or 5433 is already in use.** Set `POSTGRES_DEV_PORT` or `POSTGRES_TEST_PORT` in `.env` and change the port in the matching URL.
- **A changed `POSTGRES_DEV_PASSWORD` has no effect.** PostgreSQL reads it only when it first creates the data volume. Resetting the development database deletes its data; the steps are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) ("Local databases").
- **Odd build or type errors after running `pnpm dev` and `pnpm build` together.** They share `.next`. Stop the dev server and rebuild.
- **E2E fails to start the server.** Another e2e run, or something else, holds port 3100; stop it and rerun.
- **Integration tests refuse to run.** `DATABASE_URL_TEST` must point at a different host and port than `DATABASE_URL` (`tests/helpers/test-database-url.ts`); start `db-test`.

## Documentation

| Document | Contents |
| --- | --- |
| [REQUIREMENTS](docs/REQUIREMENTS.md) | User stories, business rules, acceptance criteria |
| [PROJECT_PLAN](docs/PROJECT_PLAN.md) | Phases, tasks, dependencies |
| [STATUS](docs/STATUS.md) | Current status, blockers, results |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Layers, modules, request and checkout flow |
| [DATA_MODEL](docs/DATA_MODEL.md) | Tables, constraints, integrity rules, seed data |
| [API_CONTRACTS](docs/API_CONTRACTS.md) | Endpoints, envelopes, error codes |
| [DESIGN_SYSTEM](docs/DESIGN_SYSTEM.md) | Tokens, components, accessibility, Thai copy |
| [SECURITY](docs/SECURITY.md) | Threat model, controls, findings |
| [TEST_STRATEGY](docs/TEST_STRATEGY.md) | Test levels, matrix, results |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Environments, variables, CI, release, rollback |
| [RUNBOOK-STAGING](docs/RUNBOOK-STAGING.md) | Container images and staging steps |
| [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md) | Simulated and missing capabilities |
| [DECISIONS](docs/DECISIONS.md) | Decision log |
| [AGENT_WORKFLOW](docs/AGENT_WORKFLOW.md) | Agent team, ownership, handoffs |
| [CONTRIBUTING](CONTRIBUTING.md) | Workflow for humans and agents |

## Important notices

- Payments are simulated. No real money is processed, and the interface says so.
- Seeded stores and products are sample data and are labelled as such.
- This software has not been security-audited by a human professional.
