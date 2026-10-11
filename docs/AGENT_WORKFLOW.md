# Agent Workflow

How the agent team is organised, who owns which files, and how work is handed over.

## How delegation actually works here

- The **main Claude Code session is the orchestrator**. It launches subagents with the Agent tool using the definitions in `.claude/agents/`.
- Subagents **cannot launch other subagents**. `orchestrator.md` exists as the written playbook for the main session, not as something to spawn.
- A subagent starts with no memory of the conversation. Every task brief must be self-contained (see template below).
- Parallel subagents share one working tree unless launched with worktree isolation. Worktrees require a git repository with at least one commit.
- Delegation has not yet been exercised in this repository. Task T-003 verifies it; until then treat it as unverified.

## The team

| Agent | File | Mode | Primary output |
| --- | --- | --- | --- |
| Orchestrator | `orchestrator.md` | main session | plan, integration, status |
| Product Requirements | `product-requirements.md` | writes docs | `docs/REQUIREMENTS.md` |
| UI/UX Design | `ui-ux-design.md` | writes docs + tokens | `docs/DESIGN_SYSTEM.md`, `src/components/ui/` |
| Frontend | `frontend.md` | writes code | pages, feature components |
| Backend and API | `backend-api.md` | writes code | modules, route handlers |
| Database | `database.md` | writes code | Prisma schema, migrations, seed |
| Auth | `auth.md` | writes code | sessions, guards, RBAC |
| QA | `qa.md` | writes tests | integration, E2E, regression tests |
| Security | `security.md` | review + security tests | findings, threat model |
| Code Review | `code-review.md` | read-only | review verdicts |
| DevOps | `devops.md` | writes config | CI, Docker, scripts |
| Documentation | `documentation.md` | writes docs | README, runbooks |

## File ownership

One owner per path. An agent that needs a change outside its paths requests it in its report; it does not make the edit.

| Path | Owner |
| --- | --- |
| `prisma/**` (including generated client output), `src/server/db/**` | database |
| `src/server/auth/**`, `src/app/api/auth/**`, the request middleware or proxy file, `scripts/bootstrap-admin.ts` | auth |
| `src/modules/**`, `src/app/api/v1/**`, `src/app/api/files/**`, `src/server/**` (other) | backend-api |
| `src/server/env.ts`, `src/server/health.ts`, `src/app/api/health/**`, `src/instrumentation.ts` | devops |
| `src/app/(storefront)/**`, `src/app/seller/**`, `src/app/admin/**`, `src/app/layout.tsx`, root `error`, `not-found`, and `loading` files, `public/**`, `src/components/**` (except `ui`), `src/i18n/**`, `src/lib/**` (except `utils.ts`) | frontend |
| `src/components/ui/**`, `src/lib/utils.ts`, `src/app/globals.css`, Tailwind theme, `docs/DESIGN_SYSTEM.md` | ui-ux-design |
| `tests/**` (except `tests/security`), `e2e/**`, `vitest.integration.config.*`, Playwright config, `docs/TEST_STRATEGY.md` | qa |
| `tests/security/**`, `docs/SECURITY.md` | security |
| `.github/**`, `Dockerfile`, `docker-compose*.yml`, `scripts/**` (other), `.env.example`, `docs/DEPLOYMENT.md` | devops |
| `docs/REQUIREMENTS.md` | product-requirements |
| `docs/API_CONTRACTS.md` | backend-api |
| `docs/DATA_MODEL.md` | database |
| `README.md`, `CONTRIBUTING.md`, `docs/KNOWN_LIMITATIONS.md` | documentation |
| `CLAUDE.md`, `AGENTS.md`, `.claude/agents/**`, `docs/PROJECT_PLAN.md`, `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/AGENT_WORKFLOW.md`, `docs/reviews/**`, `package.json`, lockfile, `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `tsconfig.json`, other root config | orchestrator |

Colocated unit tests (`*.test.ts` next to the source file) belong to the owner of that source file. A task brief may lend a path to another agent for that task only; the brief says so explicitly. An agent that needs a change in an orchestrator-owned config (for example security headers in `next.config.ts`) requests it in its report or is lent the file in its brief.

## Contract-first rule

Shared interfaces are written down before the code that depends on them:

1. Database agent lands the schema and updates `docs/DATA_MODEL.md`.
2. Backend agent writes the endpoint in `docs/API_CONTRACTS.md` and exports its Zod schemas and types from `src/modules/<domain>/schema.ts`.
3. Frontend integrates only against what is documented. If the contract is missing or wrong, it reports a blocker instead of guessing.

A contract change after frontend work has started needs an entry in `docs/DECISIONS.md`.

## Parallel vs serial

- Parallel: agents whose owned paths do not overlap and whose inputs already exist (for example frontend catalog pages and backend order module once the schema is merged).
- Serial: schema before services, services before UI integration, implementation before review, review before `VERIFIED`.
- Shared files (`package.json`, lockfile, `prisma/schema.prisma`) are edited by one agent at a time. Dependency additions go through the orchestrator.

## Task brief template (orchestrator to agent)

```
Task: T-0xx <title>
Goal: <what done looks like, in one or two sentences>
Requirements covered: <REQ ids>
Read first: <files>
You own: <paths you may edit>
Do not touch: <paths>
Contracts to honour: <API or schema sections>
Acceptance checks: <commands that must pass, behaviours that must hold>
Known constraints: <environment limits, decisions already made>
Return: the standard report
```

## Standard report (agent to orchestrator)

Every agent ends with this, and only claims what it observed.

```
## Report: T-0xx <title>
Status: IMPLEMENTED | VERIFIED | BLOCKED | FAILED

### Files changed
- path (created | modified | deleted)

### Commands run
- `<command>` -> exit code, pass/fail counts or key output line

### Not run
- <check> : <reason>

### Acceptance criteria
- [x] criterion : evidence
- [ ] criterion : why not met

### Requests for other owners
- <owner>: <change needed and why>

### Risks and open concerns
- ...
```

## Review gates

A task moves to `VERIFIED` only when all of these are true:

1. Owner report shows the acceptance commands passing.
2. Orchestrator re-ran the relevant checks on the integrated tree.
3. Code Review agent returned `APPROVE` (or its required changes were made and re-reviewed).
4. For anything touching auth, authorization, checkout, payments, uploads, or admin actions: Security agent reviewed it and no Critical or High finding is open.

## Finding severity

| Severity | Meaning | Handling |
| --- | --- | --- |
| Critical | Account takeover, cross-tenant data access, payment or stock corruption, secret exposure | Stop feature work, fix immediately |
| High | Exploitable authorization or integrity flaw with limited scope | Fix before the milestone closes |
| Medium | Defence-in-depth gap, hard-to-exploit issue | Fix or schedule with an owner |
| Low | Hardening or hygiene | Backlog |

Findings are recorded in `docs/SECURITY.md` with an id (`SEC-001`), status, and re-check evidence.

## Status labels

`NOT STARTED`, `IN PROGRESS`, `BLOCKED`, `IMPLEMENTED`, `VERIFIED`, `FAILED`. Recorded only in `docs/STATUS.md`.
