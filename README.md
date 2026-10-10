# Thai Multi-Vendor Marketplace

A Thai-language multi-vendor e-commerce marketplace: customers buy from many independent sellers through one storefront, sellers manage their own store, and administrators govern the platform.

> **Project state (2026-10-10): planning only.** This repository currently holds the plan, architecture, and AI agent definitions. There is no application code, nothing to install, and nothing deployed. See [docs/STATUS.md](docs/STATUS.md).

## สรุปสั้น ๆ (ภาษาไทย)

โปรเจกต์นี้คือเว็บ marketplace แบบหลายร้านค้า มี 3 บทบาท คือ ลูกค้า ผู้ขาย และผู้ดูแลระบบ ตอนนี้อยู่ในขั้นวางแผน ยังไม่มีโค้ดของแอป เอกสารทั้งหมดอยู่ในโฟลเดอร์ `docs/` และนิยามของ AI agent อยู่ใน `.claude/agents/`

## Planned stack

Next.js (App Router), TypeScript, React, Tailwind CSS, shadcn/ui, PostgreSQL, Prisma, Better Auth, Zod, Vitest, Playwright, GitHub Actions. All choices are proposals until validated; see [docs/DECISIONS.md](docs/DECISIONS.md).

## Prerequisites (to be installed)

| Tool | Why | Installed on the dev machine |
| --- | --- | --- |
| Node.js LTS | Runtime | No |
| pnpm (via Corepack) | Package manager | No |
| PostgreSQL, or Docker Desktop to run it | Database | No |
| Git | Version control | Yes |
| GitHub CLI (optional) | Pull requests and CI checks | No |

## Getting started

Not available yet. Setup commands will be written here after the scaffold task (T-010) and will be tested by following them literally. The intended flow:

1. Install dependencies.
2. Copy `.env.example` to `.env` and fill in local values.
3. Start PostgreSQL.
4. Apply migrations and seed sample data.
5. Create the first administrator with the bootstrap script.
6. Start the development server.

## Feature status

`Implemented` works in this repository. `Simulated` works but fakes an external system. `Planned` is not built.

| Area | Status |
| --- | --- |
| Customer registration, login, profile, addresses | Planned |
| Catalog: home, categories, search, product, store pages | Planned |
| Cart with items from several sellers | Planned |
| Checkout and orders | Planned |
| Payment | Planned, will be Simulated (mock provider) |
| Shipping and tracking | Planned, will be Simulated (manual entry) |
| Reviews | Planned |
| Seller onboarding, products, inventory, orders | Planned |
| Admin: approvals, moderation, categories, users, orders, settings, audit log | Planned |
| CI pipeline | Planned |
| Deployment | Planned; no environment exists |

## Repository layout

```
.claude/agents/   AI agent definitions (12 roles)
.github/          pull request and issue templates, security policy
docs/             plan, architecture, contracts, and policies
CLAUDE.md         conventions every agent follows
CONTRIBUTING.md   workflow for humans and agents
```

Application directories (`src/`, `prisma/`, `tests/`, `e2e/`) are described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and do not exist yet.

## Documentation

| Document | Contents |
| --- | --- |
| [REQUIREMENTS](docs/REQUIREMENTS.md) | User stories, business rules, acceptance criteria |
| [PROJECT_PLAN](docs/PROJECT_PLAN.md) | Phases, tasks, dependencies |
| [STATUS](docs/STATUS.md) | Current status, blockers, results |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Layers, modules, request and checkout flow |
| [DATA_MODEL](docs/DATA_MODEL.md) | Tables, constraints, integrity rules |
| [API_CONTRACTS](docs/API_CONTRACTS.md) | Endpoints, envelopes, error codes |
| [DESIGN_SYSTEM](docs/DESIGN_SYSTEM.md) | Tokens, components, accessibility, Thai copy |
| [SECURITY](docs/SECURITY.md) | Threat model, controls, findings |
| [TEST_STRATEGY](docs/TEST_STRATEGY.md) | Test levels, matrix, results |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | Environments, release, rollback |
| [KNOWN_LIMITATIONS](docs/KNOWN_LIMITATIONS.md) | Simulated and missing capabilities |
| [DECISIONS](docs/DECISIONS.md) | Decision log |
| [AGENT_WORKFLOW](docs/AGENT_WORKFLOW.md) | Agent team, ownership, handoffs |

## Important notices

- Payments in the first release are simulated. No real money is processed.
- Seeded stores and products are sample data and are labelled as such.
- This software has not been security-audited by a human professional.
