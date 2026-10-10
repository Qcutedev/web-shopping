# Deployment

Owner: devops agent.

**State on 2026-10-11: nothing is deployed. There is no staging URL and no production URL. No hosting provider is chosen, and no CI workflow or Dockerfile exists.** This document is the plan and the runbook skeleton. Sections marked `Planned` have not been exercised; the only exercised section is "Local databases". Task status is recorded only in [STATUS.md](STATUS.md); this document does not repeat it.

How to read the checks in this document: every check is either a command that can be run as written, or is marked **Manual** (a person looks and decides). A command marked **Planned** names the task that makes it runnable; until that task lands the command fails.

## Environments

| Environment | Purpose | State |
| --- | --- | --- |
| Local | Development and tests | Both databases run through Docker Compose (exercised 2026-10-11). What the application itself can do locally is in [STATUS.md](STATUS.md). |
| Staging | Pre-release verification with production-like configuration | Not configured |
| Production | Real users | Not configured; requires explicit human approval recorded in [DECISIONS.md](DECISIONS.md) |

## Developer machine

The tools and versions that were checked on the developer machine are listed in the environment table of [STATUS.md](STATUS.md) and pinned in [DECISIONS.md](DECISIONS.md) (D-020). What this document depends on:

- Windows 11 with PowerShell. Commands below are written for PowerShell; do not chain them with `&&`.
- Node.js and pnpm (through Corepack) at the versions in D-020. `package.json` pins the pnpm version.
- Docker Desktop with Compose, running on WSL. It must be started before any `docker` command.
- The git repository is on `main` with local commits only. There is no remote, and the GitHub CLI is installed but not logged in, so nothing has been pushed and no CI run exists (blocker B-04 in [STATUS.md](STATUS.md)).

Check the tools:

```powershell
node -v
pnpm -v
docker info --format "{{.ServerVersion}}"
docker compose version
```

## Local databases

Exercised on 2026-10-11 on Windows 11 with Docker 29.8.2 and Compose v5.5.1. Defined in [`docker-compose.yml`](../docker-compose.yml). Local use only: this file is not a staging or production configuration.

| | Development | Test |
| --- | --- | --- |
| Compose service | `db-dev` | `db-test` |
| Image | `postgres:18-trixie`, pinned by digest in `docker-compose.yml` (PostgreSQL 18.6) | same |
| Host address | `127.0.0.1:5432` | `127.0.0.1:5433` |
| Database | `marketplace_dev` | `marketplace_test` |
| User | `marketplace` | `marketplace` |
| Storage | Named volume `marketplace-db-dev-data`; survives stop, start, re-creating the container, and `docker compose down` | In memory (tmpfs); emptied every time the container stops |
| Connection variable | `DATABASE_URL` | `DATABASE_URL_TEST` |
| Encoding, time zone | `UTF8`, `UTC` | `UTF8`, `UTC` |

The user names, passwords, and database names are throwaway local defaults written in `docker-compose.yml` and `.env.example`. They are not secrets, the ports are bound to `127.0.0.1` only, and they must never be reused for staging or production (see "Environment variables" for the planned startup check, SEC-009). The test database also runs with durability switched off (`fsync=off`), which is safe only because its data is disposable.

Run every command from the repository root in PowerShell, with Docker Desktop running.

One-time setup, to give the application and tools their connection strings (`.env` is git-ignored):

```powershell
Copy-Item .env.example .env
```

Start both databases and wait until they are healthy (the first run downloads the image):

```powershell
docker compose up -d --wait
```

Check state. Both services must show `(healthy)`:

```powershell
docker compose ps
```

Check that each database answers a query. Each command must print one line starting with `PostgreSQL 18`, then `UTF8`, then `UTC`:

```powershell
docker compose exec -T db-dev psql -U marketplace -d marketplace_dev -At -c "SELECT version(); SHOW server_encoding; SHOW timezone;"
docker compose exec -T db-test psql -U marketplace -d marketplace_test -At -c "SELECT version(); SHOW server_encoding; SHOW timezone;"
```

Check that no environment file is tracked by git. The only line printed must be `.env.example`:

```powershell
git ls-files ".env*"
```

Stop both. Development data is kept; test data is discarded:

```powershell
docker compose stop
```

View logs (add `-f` to follow, Ctrl+C to leave):

```powershell
docker compose logs --tail 100 db-dev
docker compose logs --tail 100 db-test
```

Open `psql` (leave with `\q`). There is no `psql` on the host; it runs inside the container:

```powershell
docker compose exec db-dev psql -U marketplace -d marketplace_dev
docker compose exec db-test psql -U marketplace -d marketplace_test
```

Get an empty test database again:

```powershell
docker compose restart db-test
```

**Reset the development database. DESTRUCTIVE: this permanently deletes all local development data (every table, row, and applied migration). There is no undo.** The test database is not affected.

```powershell
docker compose rm --stop --force db-dev
docker volume rm marketplace-db-dev-data
docker compose up -d --wait
```

Notes:

- If a host port is already in use, set `POSTGRES_DEV_PORT` or `POSTGRES_TEST_PORT` in `.env` and change the port in the matching connection URL. The other overridable values are listed in `.env.example`.
- Changing `POSTGRES_DEV_USER`, `POSTGRES_DEV_PASSWORD`, or `POSTGRES_DEV_DB` has no effect on an existing development volume, because PostgreSQL reads them only when it first creates the data directory. Reset the development database to apply them.
- `docker compose down` removes the containers and network but keeps the development volume. `docker compose down --volumes` also deletes the development data.
- Verified on 2026-10-11: container health, the three queries above in both databases, persistence and reset behaviour, password login with both URLs' credentials from another container, and that re-creating the containers keeps the development data directory (same PostgreSQL system identifier before and after). Not yet verified: a connection from a Node.js process on the host using `DATABASE_URL`; that happens when Prisma is added (T-013).

### Updating the database image

The image is pinned by digest (SEC-008), so `docker compose pull` never changes what runs. The digest in `docker-compose.yml` is the multi-platform index digest of `postgres:18-trixie` as pulled on 2026-10-11. No dependency bot updates it yet: there is no remote repository, and the bot configuration is part of the CI task (T-070). Until then the update is done by hand:

1. Pull the current image behind the tag and print its digest:

   ```powershell
   docker pull postgres:18-trixie
   docker image inspect postgres:18-trixie --format "{{json .RepoDigests}}"
   ```

2. Put the printed `sha256:...` value into the `x-postgres-image` line of `docker-compose.yml` (one place; both services use it).
3. Re-create the containers and run the health and query checks above. The development volume is kept.

   ```powershell
   docker compose up -d --wait
   docker compose ps
   ```

4. Run `pnpm test:integration` (**Planned**, runnable from T-023) before committing the new digest.

A change of the major version (for example 18 to 19) is not an image update: PostgreSQL cannot open a data directory of another major version, so it needs a dump and restore of the development data and a decision recorded in DECISIONS.md.

## Runtime requirements (Planned)

- One long-running Node.js server process (`next start` or a container). Not serverless for the MVP, because rate limiting is in-process and uploads go to local disk.
- PostgreSQL, a current supported major version.
- A persistent volume for uploads until object storage is integrated.
- HTTPS terminated by the host or a reverse proxy.

### Reverse proxy conditions (Planned; required by SECURITY.md SR-01 and SR-05)

These bind whichever hosting setup is chosen. None has been exercised, because no proxy exists.

- When `TRUSTED_PROXY_HOPS` is greater than 0 or `TRUSTED_CLIENT_IP_HEADER` is set, the application port must be reachable only from the proxy (loopback or a private network). Otherwise a client can connect directly and forge its address.
- The proxy must append to or overwrite `X-Forwarded-For`, never pass a client-sent value through as the last entry, and must overwrite the header named in `TRUSTED_CLIENT_IP_HEADER`.
- The proxy must write the client address as plain IPv4, IPv6, or the dotted IPv4-mapped form, without a port. An `address:port` form makes every client share one rate-limit allowance.
- The hop count is confirmed on staging before production. **Manual**: send one request from a machine whose public address is known and compare it with the `clientIp` of the matching security log line.
- With the default configuration (no proxy trusted) every visitor shares one rate-limit allowance, so sign-in is limited for the whole site at once. That is intended; a real deployment must configure the proxy variables.
- A request body limit at the proxy is welcome as an outer layer. The application enforces its own limits (SR-05) and does not rely on it.

## Environment variables (Planned)

`.env.example` exists and currently holds only the two database URLs (local values) and the optional Compose overrides; the other variables below are added by the tasks that introduce them. `src/server/env.ts` does not exist yet (T-011); it will validate the list at startup and fail fast, naming the variable and never printing its value.

| Variable | Purpose | Secret |
| --- | --- | --- |
| `NODE_ENV` | `development`, `test`, `production` | no |
| `APP_URL` | Public origin; used for the `Origin` check and auth. Must be an absolute `http` or `https` URL | no |
| `DATABASE_URL` | PostgreSQL connection string | yes (the local value in `.env.example` is a throwaway, not a secret) |
| `DATABASE_URL_TEST` | PostgreSQL connection string for integration tests; local and CI only, never set in staging or production | no (throwaway) |
| `AUTH_SECRET` | Session signing secret, at least 32 random bytes | yes |
| `TRUSTED_PROXY_HOPS` | Number of operator-controlled reverse proxies in front of the application, integer 0 to 5 (SR-01). Must be set explicitly when `NODE_ENV=production` | no |
| `TRUSTED_CLIENT_IP_HEADER` | Name of a single-value header the hosting platform's proxy always overwrites with the client address (SR-01). Cannot be combined with `TRUSTED_PROXY_HOPS` greater than 0 | no |
| `UPLOAD_DIR` | Local storage directory | no |
| `LOG_LEVEL` | Logging verbosity | no |
| `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` | Read once by the bootstrap script; do not leave set | yes |

Secrets live in the host's secret manager or environment configuration. They are never committed, never printed, and never prefixed `NEXT_PUBLIC_`.

Planned startup refusals when `NODE_ENV=production` (SEC-009, lands with `src/server/env.ts` in T-011; not implemented today): the application does not start if `DATABASE_URL` contains one of the local placeholder passwords from `.env.example`, or if `DATABASE_URL_TEST` is set. Until then the only protection against reusing the local credentials is this instruction: never copy `.env.example` or `docker-compose.yml` to a staging or production host.

## Hosting options to decide

No provider is chosen. No paid service is added without approval.

| Option | Fits | Notes |
| --- | --- | --- |
| Container on a small VPS with Docker Compose | Yes | Cheapest fixed cost; you operate backups and updates |
| Managed container platform (Railway, Render, Fly.io) | Yes | Persistent disk and managed PostgreSQL available; low operations effort |
| Vercel with managed PostgreSQL | Only after changes | Needs object storage for uploads and a shared rate-limit store first |

Prices and free tiers change; check current terms before choosing. Whichever option is chosen must be able to meet "Log retention and access" below.

## CI pipeline (Planned, T-070)

Runs on pull requests and pushes to the default branch: install with frozen lockfile, format check, lint, type check, unit tests, integration tests against a PostgreSQL service container, production build, dependency audit, secret scan. End-to-end tests run as a separate job. Workflow rules are in `.claude/agents/devops.md`.

No workflow file exists, and no CI job has ever run. Two things are missing: the tooling behind `pnpm test:integration` and `pnpm test:e2e` is not installed yet (see the task table in [STATUS.md](STATUS.md)), and there is no remote repository to run a workflow on (blocker B-04). A workflow can be written before the remote exists, but it cannot be reported as working until it has run there.

The checks the workflow will run can be run locally today:

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs the format check, lint, type check, unit tests, and build. It does not run integration or end-to-end tests.

## Release procedure (Planned)

Never exercised: no environment exists to release to. Staging always goes first, with the same steps. Production additionally needs explicit human approval recorded in DECISIONS.md before step 3.

In the commands below `$baseUrl` is the origin of the environment being released. Set it first; no value is written here because no environment has been deployed.

| # | Step | Check |
| --- | --- | --- |
| 1 | All checks pass on the commit to release | `pnpm verify`, then `pnpm test:integration` (**Planned**, T-023) and `pnpm test:e2e` (**Planned**, T-060). Each must exit 0. Once CI exists (T-070), the CI run on that commit replaces the local run |
| 2 | No open Critical or High security finding | **Manual**: read the findings register in [SECURITY.md](SECURITY.md) |
| 3 | Back up the target database and confirm the backup is restorable | **Planned**: the commands depend on the hosting provider, which is not chosen. See "Database operations" |
| 4 | Apply migrations | `pnpm exec prisma migrate deploy` (**Planned**, lands with T-013; Prisma is not installed today and `package.json` has no script for this command yet, see below). Must exit 0 |
| 5 | Deploy the new application version | **Planned**: depends on the hosting provider |
| 6 | Health endpoint answers | `curl.exe --silent --show-error --output NUL --write-out "%{http_code}" "$baseUrl/api/health"` must print `200` (**Planned**: the endpoint lands with T-011) |
| 7 | One read path works | `curl.exe --silent --show-error --output NUL --write-out "%{http_code}" "$baseUrl/"` must print `200` (**Planned**: the homepage lands with T-021) |
| 8 | Log in and view one product | **Manual** in a browser, until the end-to-end suite can be pointed at a deployed environment (T-060) |
| 9 | Watch logs and error rate for 30 minutes | **Manual**; the tool depends on the hosting provider |
| 10 | Record the release in the release log below | **Manual** |

About step 4: `pnpm db:migrate` runs `prisma migrate dev`, which is for local development only. It can reset a database and must never be pointed at staging or production. The command for a deployed database is `prisma migrate deploy`, which only applies migrations that are already committed. A `package.json` script for it has been requested from the orchestrator; when it exists, this section will name the script instead of the underlying command.

## First administrator (Planned, T-016)

`scripts/bootstrap-admin.ts` does not exist yet, so `pnpm admin:bootstrap` fails today. Decided so far: there is no default admin and no web endpoint that grants admin, and in the MVP admins are created only by this script (owner answer OQ-13, D-025). The intended use is to run `pnpm admin:bootstrap` once per environment with `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` supplied for that single invocation, then remove them. The script is to refuse weak passwords. What it does when an admin already exists (review item S9) is defined by T-016, and this section is updated then.

## Database operations

- Seed scripts never run in production.
- Backups (**Planned**): daily automated backups from the managed provider or scheduled `pg_dump`, stored encrypted and separate from the database host. How long backups are kept is not decided. A restore is rehearsed on staging before the first production release. The exact backup and restore commands are written here when the hosting provider is chosen; none has been run.
- Destructive migrations require human approval and a written data plan.

## Rollback

- Application: redeploy the previous image or commit.
- Database: migrations are forward-only. There is no command that undoes one. If a migration must be undone, apply a corrective migration, or restore the pre-release backup and accept the loss of data written since. This is why step 3 of the release procedure is mandatory.
- Prefer backward-compatible (expand then contract) migrations so the previous application version still runs against the new schema.

## Health, logs, monitoring (Planned)

| Item | Plan |
| --- | --- |
| Health | `GET /api/health` checks process and database (T-011) |
| Logs | Structured JSON on stdout, collected by the host |
| Uptime | External check on the health endpoint (recommended) |
| Errors | Error tracking service (recommended, not selected) |
| Metrics to watch | 5xx rate, checkout failures, `INSUFFICIENT_STOCK` rate, login rate-limit hits, rate-limiter saturation warnings, database connections |

### Log retention and access (owner decision OQ-21, D-025; binding)

Server logs contain visitors' IP addresses on security events (SECURITY.md SR-04). An IP address is personal data. The owner decided on 2026-10-11:

- **Server logs are kept for 90 days** and are then deleted.
- **Only system administrators may read them.**

These are requirements that the hosting setup must meet. **Nothing implements them today**: no hosting provider is chosen, no log collector exists, and the mechanism (a retention setting in a managed log service, or log rotation and file permissions on a server that we operate) depends on that choice. When the provider is chosen, this section is replaced by the actual configuration and the checks that prove it. What the configuration must cover, whatever the provider:

- Every place a log line is stored: the host's log collector, any log files on disk, any error tracking or monitoring service that receives log lines, and any export or backup of logs. A copy kept longer than 90 days anywhere breaks the rule.
- Deletion after 90 days is automatic, not a task someone must remember.
- Read access is limited to named system administrator accounts. Sellers, shop admins using the admin screens, and support staff do not get access through the hosting console, the log service, or a shared login.
- Any third-party service that would receive log lines is a new paid or external service and needs owner approval first; it then holds personal data and falls under the same two rules.
- Local development is outside this rule: `docker compose logs` on a developer machine shows database logs only and holds no visitor data.

Checks for the production readiness checklist, both **Manual** until a provider is chosen: show the configured retention period, and list the accounts that can read logs.

## Production readiness checklist

Nothing below is done. Each item states how it is checked.

- [ ] Build and full test suite pass on the release commit. Check: `pnpm verify`, `pnpm test:integration` (**Planned**, T-023), `pnpm test:e2e` (**Planned**, T-060), each exit 0
- [ ] No open Critical or High security finding. **Manual**: findings register in SECURITY.md
- [ ] Environment variables set and validated, values not exposed. Check: the application starts (**Planned**, T-011 makes startup fail on an invalid variable); **Manual**: no secret is visible in logs or the hosting console's public settings
- [ ] `AUTH_SECRET` unique to the environment. **Manual**
- [ ] Database backup taken and restore rehearsed. **Planned**: commands depend on the hosting provider
- [ ] Migrations applied on staging first. Check: `pnpm exec prisma migrate status` against staging reports no pending migration (**Planned**, T-013)
- [ ] Health check and logs verified on staging. Check: release procedure step 6; **Manual** for logs
- [ ] Log retention of 90 days and administrator-only log access configured and shown (OQ-21). **Manual**
- [ ] Reverse proxy variables set and the hop count confirmed on staging (SR-01). **Manual**
- [ ] HTTPS and domain configured; HSTS enabled. Check: `curl.exe --silent --show-error --head "$baseUrl/"` shows a `strict-transport-security` header (**Planned**, T-072)
- [ ] Admin bootstrapped; bootstrap variables removed. **Manual**
- [ ] Seed data absent from production. **Manual**
- [ ] Mock payment disabled or clearly labelled, by explicit decision. **Manual**
- [ ] Uploads on persistent or object storage. **Manual**
- [ ] Rate limiting suitable for the number of instances. **Manual**
- [ ] Privacy notice and PDPA obligations addressed. **Manual**
- [ ] Rollback steps rehearsed. **Manual**
- [ ] Explicit human approval for production release recorded in DECISIONS.md. **Manual**

## Release log

| Date | Environment | Version | Result | Verified how |
| --- | --- | --- | --- | --- |
| | none | | | |
