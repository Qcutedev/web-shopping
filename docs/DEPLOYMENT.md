# Deployment

Owner: devops agent.

**State on 2026-10-10: nothing is deployed. There is no staging URL and no production URL. No hosting provider, CI workflow, or Dockerfile exists yet.** This document is the plan and the runbook skeleton; sections are marked `Planned` until they have been exercised.

## Environments

| Environment | Purpose | State |
| --- | --- | --- |
| Local | Development and tests | Not runnable yet (prerequisites missing) |
| Staging | Pre-release verification with production-like configuration | Not configured |
| Production | Real users | Not configured; requires explicit human approval |

## Runtime requirements (Planned)

- One long-running Node.js server process (`next start` or a container). Not serverless for the MVP, because rate limiting is in-process and uploads go to local disk.
- PostgreSQL, a current supported major version.
- A persistent volume for uploads until object storage is integrated.
- HTTPS terminated by the host or a reverse proxy.

## Environment variables (Planned)

The authoritative list is `.env.example` once it exists; `src/server/env.ts` validates it at startup.

| Variable | Purpose | Secret |
| --- | --- | --- |
| `NODE_ENV` | `development`, `test`, `production` | no |
| `APP_URL` | Public origin; used for the `Origin` check and auth | no |
| `DATABASE_URL` | PostgreSQL connection string | yes |
| `AUTH_SECRET` | Session signing secret, at least 32 random bytes | yes |
| `UPLOAD_DIR` | Local storage directory | no |
| `LOG_LEVEL` | Logging verbosity | no |
| `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` | Read once by the bootstrap script; do not leave set | yes |

Secrets live in the host's secret manager or environment configuration. They are never committed, never printed, and never prefixed `NEXT_PUBLIC_`.

## Hosting options to decide

No provider is chosen. No paid service is added without approval.

| Option | Fits | Notes |
| --- | --- | --- |
| Container on a small VPS with Docker Compose | Yes | Cheapest fixed cost; you operate backups and updates |
| Managed container platform (Railway, Render, Fly.io) | Yes | Persistent disk and managed PostgreSQL available; low operations effort |
| Vercel with managed PostgreSQL | Only after changes | Needs object storage for uploads and a shared rate-limit store first |

Prices and free tiers change; check current terms before choosing.

## CI pipeline (Planned, T-070)

Runs on pull requests and pushes to the default branch: install with frozen lockfile, format check, lint, type check, unit tests, integration tests against a PostgreSQL service container, production build, dependency audit, secret scan. End-to-end tests run as a separate job. Workflow rules are in `.claude/agents/devops.md`.

The workflow file is deliberately not written yet: the scripts it calls do not exist, and a workflow that cannot pass would be noise.

## Release procedure (Planned)

1. All CI checks green on the commit to release.
2. Review open findings in [SECURITY.md](SECURITY.md); no open Critical or High.
3. Back up the target database and confirm the backup is restorable.
4. Apply migrations: `pnpm prisma migrate deploy`.
5. Deploy the new application version.
6. Verify: `/api/health` returns 200; load the homepage; log in; view one product.
7. Watch logs and error rate.
8. Record the release in the release log below.

Staging always goes first, with the same steps.

## First administrator

Run `pnpm admin:bootstrap` once per environment with `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` supplied for that single invocation, then remove them. The script refuses weak passwords and does nothing if the admin already exists. There is no default admin and no web endpoint that grants admin.

## Database operations

- Seed scripts never run in production.
- Backups (Planned): daily automated backups from the managed provider or scheduled `pg_dump`, stored encrypted and separate from the database host, with a retention period decided at launch. A restore is rehearsed on staging before the first production release.
- Destructive migrations require human approval and a written data plan.

## Rollback

- Application: redeploy the previous image or commit.
- Database: migrations are forward-only. If a migration must be undone, apply a corrective migration, or restore the pre-release backup and accept the loss of data written since. This is why step 3 is mandatory.
- Prefer backward-compatible (expand then contract) migrations so the previous application version still runs against the new schema.

## Health, logs, monitoring

| Item | Plan |
| --- | --- |
| Health | `GET /api/health` checks process and database |
| Logs | Structured JSON on stdout, collected by the host |
| Uptime | External check on the health endpoint (recommended) |
| Errors | Error tracking service (recommended, not selected) |
| Metrics to watch | 5xx rate, checkout failures, `INSUFFICIENT_STOCK` rate, login rate-limit hits, database connections |

## Production readiness checklist

Nothing below is done.

- [ ] Build and full test suite pass on the release commit
- [ ] No open Critical or High security finding
- [ ] Environment variables set and validated, values not exposed
- [ ] `AUTH_SECRET` unique to the environment
- [ ] Database backup taken and restore rehearsed
- [ ] Migrations applied on staging first
- [ ] Health check and logs verified on staging
- [ ] HTTPS and domain configured; HSTS enabled
- [ ] Admin bootstrapped; bootstrap variables removed
- [ ] Seed data absent from production
- [ ] Mock payment disabled or clearly labelled, by explicit decision
- [ ] Uploads on persistent or object storage
- [ ] Rate limiting suitable for the number of instances
- [ ] Privacy notice and PDPA obligations addressed
- [ ] Rollback steps rehearsed
- [ ] Explicit human approval for production release recorded in DECISIONS.md

## Release log

| Date | Environment | Version | Result | Verified how |
| --- | --- | --- | --- | --- |
| | none | | | |
