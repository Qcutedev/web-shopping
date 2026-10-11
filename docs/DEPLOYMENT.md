# Deployment

Owner: devops agent.

**State on 2026-10-11: nothing is deployed. There is no staging URL and no production URL. No hosting provider is chosen, and no CI workflow or Dockerfile exists.** This document is the plan and the runbook skeleton. Sections marked `Planned` have not been exercised; the only exercised section is "Local databases". Task status is recorded only in [STATUS.md](STATUS.md); this document does not repeat it.

**Also true on 2026-10-11: no server log is collected anywhere, no backup of any database exists, and nothing in the system runs on a schedule.** The owner's rules on logs, sessions, and backups (D-025 OQ-21; D-026 OQ-47 to OQ-50; D-028) are written below as requirements for the staging runbook (T-071) and for T-015. Every one of them is marked **NOT IMPLEMENTED**: that label means no configuration, script, job, or check for it exists, and nothing in this document is evidence that the rule is met.

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
- Something that runs two jobs with no visitor present: the expired-session purge and the payment timeout sweep. **NOT IMPLEMENTED**; see "Scheduled work". If the recommended in-process timer is chosen, the server process must stay running when there is no traffic: a host that stops or sleeps an idle container would stop the jobs without any error.
- Server logs and database backups stored only where the rules in "Log retention and access" and "Database backups" can be met.

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
| Payment timeout in minutes (name not chosen; devops proposes `PAYMENT_TIMEOUT_MINUTES`) | How long an order may wait for payment before the sweep fails it. Default 15 (D-028). It is configuration so that tests can shorten it (DATA_MODEL.md section 4.3). **NOT IMPLEMENTED**: the name is fixed and validated in T-011 (`src/server/env.ts`), and the sweep that reads it lands with T-032; see "Scheduled work" | no |
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

Prices and free tiers change; check current terms before choosing.

Whichever option is chosen must be able to meet the owner's rules. None of the options has been checked against them; these are the questions to answer from the provider's current terms before choosing (**Manual**):

| Question | Rule it comes from |
| --- | --- |
| Can every person who operates the servers have an individual account, with no shared login? Do extra accounts cost money (then it is a paid addition and needs approval)? | "Log retention and access" (OQ-47) |
| Is every copy of the logs, including the platform's own router or proxy log and any log export, deleted automatically within 90 days? A shorter period is acceptable | "Log retention and access" (OQ-48) |
| Can database backups, snapshots, and any point-in-time recovery window be limited to 30 days with automatic deletion, and can access to them be limited to the same named people? | "Database backups" (OQ-50) |
| Does the server process keep running with no traffic, or can a scheduled command be run without a paid add-on? | "Scheduled work" (OQ-49) |

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
| 3 | Back up the target database and confirm the backup is restorable | **Planned**: the commands depend on the hosting provider, which is not chosen. See "Database backups". The pre-release backup is a database backup like any other: it is stored in the same place, readable by the same people, and deleted automatically after 30 days |
| 4 | Apply migrations | `pnpm exec prisma migrate deploy` (**Planned**, lands with T-013; Prisma is not installed today and `package.json` has no script for this command yet, see below). Must exit 0 |
| 5 | Deploy the new application version | **Planned**: depends on the hosting provider |
| 6 | Health endpoint answers | `curl.exe --silent --show-error --output NUL --write-out "%{http_code}" "$baseUrl/api/health"` must print `200` (**Planned**: the endpoint lands with T-011) |
| 7 | One read path works | `curl.exe --silent --show-error --output NUL --write-out "%{http_code}" "$baseUrl/"` must print `200` (**Planned**: the homepage lands with T-021) |
| 8 | Log in and view one product | **Manual** in a browser, until the end-to-end suite can be pointed at a deployed environment (T-060) |
| 9 | Watch logs and error rate for 30 minutes | **Manual**, by a person who is allowed to read server logs ("Log retention and access"); the tool depends on the hosting provider |
| 10 | Scheduled work is running after the release | **Planned** (T-015 for the session purge and for what runs the jobs; T-032 for the payment timeout sweep): a start line and a first run line for each job appear in the logs, and the two check queries in "Scheduled work" return 0 |
| 11 | Record the release in the release log below | **Manual** |

About step 4: `pnpm db:migrate` runs `prisma migrate dev`, which is for local development only. It can reset a database and must never be pointed at staging or production. The command for a deployed database is `prisma migrate deploy`, which only applies migrations that are already committed. A `package.json` script for it has been requested from the orchestrator; when it exists, this section will name the script instead of the underlying command.

## First administrator (Planned, T-016)

`scripts/bootstrap-admin.ts` does not exist yet, so `pnpm admin:bootstrap` fails today. Decided so far: there is no default admin and no web endpoint that grants admin, and in the MVP admins are created only by this script (owner answer OQ-13, D-025). The intended use is to run `pnpm admin:bootstrap` once per environment with `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` supplied for that single invocation, then remove them. The script is to refuse weak passwords. What it does when an admin already exists (review item S9) is defined by T-016, and this section is updated then.

## Scheduled work (Planned; owner decisions OQ-49, D-026; D-028; D-029)

**NOT IMPLEMENTED.** Nothing in the system runs on a schedule today, neither of the two functions below exists, and no table they act on exists. The mechanism that runs them is **not chosen**: D-029 places that choice in T-015, made by the auth agent together with devops. This section states what the mechanism must do, compares the candidates, and gives a recommendation. The recommendation is not a decision.

### The two jobs

| | Expired-session purge | Payment timeout sweep |
| --- | --- | --- |
| Owner's rule | The IP address and browser details of an expired session must be gone within one day of its expiry; a daily clean-up is enough (D-026, OQ-49) | An order still awaiting payment after 15 minutes is failed (D-028). Its items return to the cart as after any failed payment (D-026, OQ-27) |
| What it does | Deletes every `Session` row past its `expiresAt`: `DELETE FROM "Session" WHERE "expiresAt" < now()` (DATA_MODEL.md section 6.1). Safe to run at any time and any number of times | Calls the guarded payment-failure transaction (DATA_MODEL.md section 7.2) for every order with `"paymentStatus" = 'PENDING'` and `"createdAt"` older than the timeout (section 4.3). An order that was paid or failed in the meantime is left alone, so two runs at once do no harm |
| Planned interval | Every hour. One day is the owner's limit; the hourly run is the margin DATA_MODEL.md section 6.1 asks for, so that one late or failed run does not break the limit | Not set by any decision. Devops proposes every minute; see DEP-Q8 in "Open questions" |
| Who writes the function | auth agent, T-015 | backend-api agent, T-032 (D-023 point 6: one service function that a script and the checkout path can call) |
| What a stopped job causes | Addresses and browser details of abandoned sessions stay in the database past the one-day limit. Nobody sees an error | Unpaid orders stay `PENDING`, and the stock they took at checkout stays unavailable to other customers until something fails them. Nobody sees an error |
| State | **NOT IMPLEMENTED** (T-015) | **NOT IMPLEMENTED** (T-032; the timeout setting in T-011) |

The scheduler is chosen and built in T-015, before the sweep function exists. Whatever is chosen must take the sweep as a second job in T-032 without a new decision.

### What any mechanism must do

1. **Run with no visitor present.** An abandoned session and an abandoned order produce no request, so a job that runs only when a request arrives does not meet either rule (SECURITY.md SR-07 item 5).
2. **Run once when the application starts, before or as it begins serving**, so that a deployment that was stopped for a while catches up at once (DATA_MODEL.md section 6.1).
3. **Make a missed run visible** (SR-07): one log line when a job is registered at start, and one log line per run with the job name, the result, the number of rows affected, and the duration. No session token, address, browser details, order content, or other personal data in those lines (SR-04). The field names are fixed in T-015. These are server logs, so only the people named in "Log retention and access" can read them.
4. **A failed run is logged as an error and does not stop the next run or the server process.**
5. **Be safe when two copies run at once** (two server instances, or a manual run during a scheduled one). Both statements already are; the mechanism must not add state that is not.
6. **Never be triggered by a `GET`** (D-029 point 1: a `GET` never changes state).

### Candidates

No candidate has been built or tried. "Free" and "paid" below are to be checked against a provider's current terms when one is chosen (**Manual**); nothing paid is added without owner approval.

| Candidate | How it works | For | Against |
| --- | --- | --- | --- |
| A. In-process timer | The server process registers both jobs when it starts and runs them on a timer. The framework's start-up hook for this is to validate in T-015 against the installed Next.js version (`node_modules/next/dist/docs/`) | No extra service, no extra cost, the same on every host and on a developer machine. The run at start (requirement 2) comes with it. No new endpoint and no second place that holds the database credentials | It runs only while the process runs. **On a host that stops or sleeps an idle container the jobs stop without any error**, exactly when there is no traffic, which is the case the rules are about; they resume only when a visitor wakes the host. With several instances every instance runs the jobs (harmless, requirement 5, but wasteful). The file that holds the start-up hook has no owner in AGENT_WORKFLOW.md yet |
| B. Platform scheduled command | The host runs a command on a schedule (a cron entry or timer on a server we operate, or the provider's scheduled-job feature) that calls the same two functions through a script in `scripts/` and exits | Independent of traffic and of the web process, so it also works on a host that sleeps the web container. The host usually shows a run history and exit codes | Depends on the provider: the feature may be a paid add-on (needs owner approval), and its shortest interval may be longer than a minute, which matters for the sweep. The database credentials are configured in a second place. A script and a `package.json` script name are needed (request to the orchestrator). No run at application start unless the start command also calls it |
| C. External cron calling an endpoint | A service outside the deployment (a hosted cron service, or a scheduled CI workflow) sends a request on a schedule to an endpoint that runs the jobs | Wakes a sleeping host | A new endpoint that changes state and is reachable from the internet: it needs its own secret, a `POST`, rate limiting, and a security review. It adds an outside service the rules then depend on (a new external or paid service needs owner approval). Scheduled CI workflows are not exact to the minute, and there is no remote repository to run one on (blocker B-04 in [STATUS.md](STATUS.md)) |

**Recommendation (devops, for T-015; not decided): candidate A, on the condition that the chosen host keeps the server process running with no traffic.** That condition is already a hosting requirement ("Runtime requirements") and a question to answer before choosing a provider ("Hosting options to decide"). If the only acceptable host sleeps idle containers, A does not meet the rules and B is the fallback. C is not recommended. Whichever is chosen, the two check queries below are what shows that it works; a mechanism that merely exists proves nothing.

Not recommended as a fix for a sleeping host: an outside uptime monitor that requests a page every few minutes to keep the container awake. It makes the two rules depend on a third-party service that can stop without notice, and it is not what the provider's idle rule intends.

### Check queries (Planned)

Both must return `0`. They are what release procedure step 10 refers to. They prove a breach; they prevent nothing.

Query 1, the one-day limit on expired sessions (the check of DATA_MODEL.md section 6.1):

```sql
SELECT count(*) FROM "Session" WHERE "expiresAt" < now() - interval '1 day';
```

Query 2, no order is still awaiting payment long after the timeout:

```sql
SELECT count(*) FROM "Order" WHERE "paymentStatus" = 'PENDING' AND "createdAt" < now() - interval '20 minutes';
```

The 20 minutes are the 15-minute timeout (D-028) plus 5 minutes for the sweep interval and its run time. The 5 minutes are a devops proposal, not an owner rule (DEP-Q8). If the timeout setting of an environment is not 15, the interval in query 2 changes with it.

**Planned** until the tables and the jobs exist:

- The table and column names are those of DATA_MODEL.md sections 6.1 and 6.10. The `Session` names are the auth library's expected shape and are validated in T-015; if they differ, these queries are corrected then.
- Both tables land with T-013. Before that, each query fails with `relation ... does not exist`; this was observed for query 1 against the local development database on 2026-10-11 with the command below.
- From T-013 on, the queries run but return 0 on an empty database, which says nothing. Query 1 means something once T-015 has landed and sessions exist; query 2 once T-032 has landed.
- How a query is run against a deployed database depends on the hosting provider and is written into the runbook in T-071. It is run by one of the named people, because it needs database access.

Against the local development database the form is (PowerShell; the query is passed on standard input because the double quotes do not survive as a command-line argument):

```powershell
@'
SELECT count(*) FROM "Session" WHERE "expiresAt" < now() - interval '1 day';
'@ | docker compose exec -T db-dev psql -U marketplace -d marketplace_dev -At -v ON_ERROR_STOP=1
```

For the production readiness checklist, **Manual** until T-015: read the logs of a staging day on which nobody visited and find the run lines of both jobs for that day.

## Database operations

- Seed scripts never run in production.
- Backups and restores follow "Database backups" below.
- Destructive migrations require human approval and a written data plan.

### Database backups (Planned; owner decisions OQ-50, D-026; D-028)

**NOT IMPLEMENTED** (staging runbook, T-071). No backup of any database exists, no backup or restore command has ever been run, and no hosting provider is chosen, so there is no place where a backup could be stored. Everything below is a requirement on the runbook. The exact commands are written here when the provider is chosen.

The owner's rules:

- **Database backups are kept 30 days** (D-026, OQ-50).
- A backup contains every table, session rows included, so it holds the IP address and browser details of sessions that existed when it was taken, for up to 30 days after those sessions are gone from the live database. **The owner accepted this** (D-028). The one-day limit of "Scheduled work" describes the live database only.
- **A restore ends with the expired-session clean-up, before the application serves** (D-028).

What the runbook must provide, whatever the provider (from SECURITY.md SR-07, "Database backups"):

| Requirement | State |
| --- | --- |
| Every backup is deleted automatically 30 days after it was taken. Not a task someone must remember | **NOT IMPLEMENTED** (T-071) |
| The 30 days cover every copy of a backup: the provider's automatic backups and snapshots, any point-in-time recovery window, a `pg_dump` file, a copy moved to other storage, a copy downloaded to a person's machine, and a database restored from a backup for a rehearsal | **NOT IMPLEMENTED** (T-071) |
| A backup is readable, downloadable, and restorable only by the named people of "Log retention and access": individual accounts, no shared login, no application role. The list of accounts that can reach backups is shown together with the log access list | **NOT IMPLEMENTED** (T-071) |
| The pre-release backup of release procedure step 3 is a database backup like any other: same storage, same people, deleted automatically after 30 days. It is not kept "just in case" beyond that | **NOT IMPLEMENTED** (T-071) |
| Backups of logs are not database backups. They follow "Log retention and access" and its 90 days | **NOT IMPLEMENTED** (T-071) |

Plan made by devops, not an owner rule: one automatic backup a day, from the managed provider or a scheduled `pg_dump`, stored encrypted and separate from the database host. Whether 30 days is also the least a backup must be kept is not said by the decision (DEP-Q6). A backup service that costs money is a paid addition and needs owner approval first.

Not covered by any decision: uploaded files live on a disk volume, not in the database, so a database backup does not contain them. Whether and how the upload volume is backed up is an open point for T-071.

The local development and test databases hold no real person's data and are outside these rules. They are not backed up.

### Restore procedure (Planned, T-071)

**NOT IMPLEMENTED** and never rehearsed. A restore overwrites a database: on production it is a destructive data operation and needs explicit human approval recorded in [DECISIONS.md](DECISIONS.md) before step 2. The same steps apply to staging, to a rehearsal, and to the rollback in "Rollback".

| # | Step | Check |
| --- | --- | --- |
| 1 | One of the named people records which backup is restored, into which database, and why | **Manual**: an entry in the release log |
| 2 | Stop the application so that it serves no request. It stays stopped until step 6 is done | **Planned** (T-071): depends on the hosting provider. Release procedure step 6 must fail at this point |
| 3 | Restore the backup into the database | **Planned** (T-071): depends on the hosting provider |
| 4 | Bring the schema to what the application version to be started expects | `pnpm exec prisma migrate status` reports no pending migration (**Planned**, T-013); if it reports any, `pnpm exec prisma migrate deploy` must exit 0 |
| 5 | Delete any other copy made for this restore: a downloaded backup file, a scratch database | **Manual**. Such a copy is a backup copy under the 30-day rule and holds session data |
| 6 | **Session clean-up. Always the last step, and the restore is not finished without it.** Run the purge of "Scheduled work" against the restored database. If the restore answers a security incident, delete every session instead (SECURITY.md SR-07) | **Planned** (T-015): the check below returns `0` |

Step 6, the statement (the same purge the scheduled job runs; DATA_MODEL.md section 6.1):

```sql
DELETE FROM "Session" WHERE "expiresAt" < now();
```

Step 6, when the restore answers a security incident (everyone signs in again):

```sql
DELETE FROM "Session";
```

Step 6, the check; it must return `0`:

```sql
SELECT count(*) FROM "Session" WHERE "expiresAt" < now();
```

All three are **Planned**: the table lands with T-013 and its names are validated in T-015. When T-015 provides the purge as a function, the runbook calls that function through a script instead of raw SQL; the script does not exist and its name is a request to the orchestrator.

Why step 6 exists: a restored database contains the `Session` rows of the day the backup was taken. Those that have expired since then come back with their IP address and browser details, although the live database had already removed them.

What the expired-session clean-up does not cover, stated so that nobody assumes it does:

- **A session that ended by sign-out after the backup was taken, and has not expired yet, is valid again after the restore.** The same holds for the sessions of a user who was deactivated after the backup: the restore also brings the user back as active. D-027 says sessions end on sign-out and on deactivation; no decision says what a restore does to them. Deleting every session at every restore would close this. Devops recommends it, and it is not decided (DEP-Q7).
- Everything written since the backup is lost, including orders, deactivations, store suspensions, and product takedowns. **Manual**: the admin repeats the admin actions taken since the backup. The restored database has no record of them; the server logs record admin actions (SR-04) and can be read only by the named people.
- Orders that were awaiting payment in the backup are older than the timeout after a restore. The first run of the payment timeout sweep fails them and returns their items to the carts.

After the restore: start the application, then run release procedure steps 6 to 11.

A restore is rehearsed on staging, with a staging backup, before the first production release. A production backup restored anywhere else brings real people's data with it, and that place then falls under the same rules for access, the 30 days, and the session clean-up.

## Rollback

- Application: redeploy the previous image or commit.
- Database: migrations are forward-only. There is no command that undoes one. If a migration must be undone, apply a corrective migration, or restore the pre-release backup by the "Restore procedure" (it ends with the session clean-up) and accept the loss of data written since. This is why step 3 of the release procedure is mandatory.
- The pre-release backup can be used for a rollback only while it exists: it is deleted automatically after 30 days ("Database backups").
- Prefer backward-compatible (expand then contract) migrations so the previous application version still runs against the new schema.

## Health, logs, monitoring (Planned)

| Item | Plan |
| --- | --- |
| Health | `GET /api/health` checks process and database (T-011) |
| Logs | Structured JSON on stdout, collected by the host. No collector exists; where the lines may be stored and who may read them is bound by "Log retention and access" |
| Scheduled work | A log line per run of each job, and the two check queries in "Scheduled work" (T-015, T-032). An uptime check on the health endpoint does not notice a job that stopped |
| Uptime | External check on the health endpoint (recommended) |
| Errors | Error tracking service (recommended, not selected) |
| Metrics to watch | 5xx rate, checkout failures, `INSUFFICIENT_STOCK` rate, login rate-limit hits, rate-limiter saturation warnings, database connections |

### Log retention and access (owner decisions OQ-21, D-025; OQ-47 and OQ-48, D-026; binding)

Server logs contain visitors' IP addresses on security events (SECURITY.md SR-04). An IP address is personal data. The owner decided on 2026-10-11:

- **Server logs are kept for at most 90 days** and are then deleted, in every copy (OQ-21, OQ-48).
- **Only system administrators may read them, and "system administrators" are only the named people who operate the servers.** The application's `ADMIN` role gives no access to logs (OQ-47).
- **One exception to the 90 days:** log lines that are evidence in an open security investigation may be kept until the investigation is closed, limited to the relevant lines, with a written record of what is kept and why (OQ-48).

The detailed rule is SECURITY.md SR-06; this section is its deployment side. **NOT IMPLEMENTED** (staging runbook, T-071): no hosting provider is chosen, no log collector exists, no account that could read a log exists, and the mechanism (a retention setting in a managed log service, or log rotation and file permissions on a server that we operate) depends on that choice. When the provider is chosen, the requirements below are replaced by the actual configuration and the checks that prove it. The rules apply to every deployed environment, staging included. Local development is outside them as long as it handles no real visitor data: `docker compose logs` on a developer machine shows database logs only.

#### Who may read server logs (OQ-47)

| Requirement | State |
| --- | --- |
| Access is given to named individual accounts, one per person, for the people who operate the servers. Nobody is named yet (DEP-Q1) | **NOT IMPLEMENTED** (T-071) |
| No shared login: no account used by two people, and no password, token, or key for the hosting console, the log service, or a server passed between people | **NOT IMPLEMENTED** (T-071) |
| Shop admins are not included. The application's `ADMIN` role, the seller role, and support staff get no access through the hosting console, the log service, a server login, or any screen of the application. The application offers no page, endpoint, or download that shows log lines (SR-06 item 4) | **NOT IMPLEMENTED** (T-071). No such page or endpoint exists or is planned |
| The same people, and nobody else, can reach database backups ("Database backups") and any log line set aside under an investigation hold | **NOT IMPLEMENTED** (T-071) |

How access is granted, reviewed, and removed. The owner's answer says who may have access; it does not say who approves a person or how often the list is checked. The steps marked "proposed" are devops proposals waiting for DEP-Q1 and DEP-Q2, not rules.

| Event | What happens | State |
| --- | --- | --- |
| Grant | Proposed: the owner approves each person. That person gets an individual account with the least permission that lets them operate the servers, and a line in the access list: person, the systems the account reaches (hosting console, log store, database, backups), date granted, approved by. The list holds no password, token, or key | **NOT IMPLEMENTED** (T-071) |
| Review | The access list is compared with the accounts that really exist on the provider; an account that is not on the list is removed. Proposed: before every production release and at least every 90 days | **NOT IMPLEMENTED** (T-071). **Manual** |
| Removal | When a person stops operating the servers, their account is removed or disabled, and the list records the date. Proposed: on the same day, and every secret that person could read (database password, `AUTH_SECRET`, deploy tokens) is replaced | **NOT IMPLEMENTED** (T-071). **Manual** |

The access list is part of the deployment evidence (SR-06 item 3) and is reviewed by the security agent before a production release. Where it is kept is settled in T-071; none exists today.

#### How long logs are kept (OQ-48)

**90 days is a maximum, not a promise that logs are available that long.** A deployment that keeps logs for a shorter time, or loses them when a container is replaced at a release, does not break the rule. The owner set no minimum, so an incident found later than the logs lasted cannot be investigated from them; whether a minimum is wanted is DEP-Q9.

| Requirement | State |
| --- | --- |
| The 90 days cover every copy of a log line: the host's log collector; log files on disk; **the platform's own router or proxy access log**, which records a visitor's address and request even though the application did not write it; any error tracking or monitoring service that receives log lines; any export; and any backup of logs. A copy kept longer anywhere breaks the rule | **NOT IMPLEMENTED** (T-071) |
| Deletion is automatic in every one of those places. Not a task someone must remember | **NOT IMPLEMENTED** (T-071) |
| A copy that a person makes by hand (a downloaded export, lines pasted into a ticket or a chat) is a copy too. Outside an investigation hold, it is never kept later than 90 days after the lines were written (the rule), and devops practice is to delete it as soon as the work it was made for is done | **NOT IMPLEMENTED** (T-071). **Manual** |
| Any third-party service that would receive log lines is a new external or paid service and needs owner approval first. It then holds personal data and falls under the same rules | No such service is selected |
| The 90 days say how long the permitted content is kept, not that more may be logged. What a log line may contain stays SR-04 | Rule for application code; see SECURITY.md |

#### Investigation hold (OQ-48)

The only way a log line may be kept past 90 days. **NOT IMPLEMENTED** (T-071): no hold has ever been placed, and there is no place to keep held lines or the record.

The owner's three conditions, all of which must hold:

1. Only log lines that are evidence in an **open security investigation**. A customer dispute or a performance problem is not one (SR-06 item 8).
2. **Only the relevant lines**, not the whole log and not a whole day of it.
3. **A written record of what is kept and why**, and the lines are kept only **until the investigation is closed**.

The procedure, following SR-06 item 8:

| Step | What happens | Check |
| --- | --- | --- |
| Place the hold | A person who may read the logs selects the relevant lines and sets them aside. Who may decide that a hold is placed is not said by the owner; until someone is named it is the system administrators (SR-06; DEP-Q3) | **Manual** |
| Record it at the same time, not afterwards | The record names the investigation, the lines or the selection that produced them (time range and filter), the reason, who set them aside, and the date. The record contains no log line and no IP address | **Manual** |
| Keep the lines | Under the same access rule as the logs (the named people only) and the same content rule (SR-04). Where the lines and the record are kept depends on the hosting provider and is settled in T-071 with the security agent (DEP-Q4); no place exists today | **Manual** |
| Normal deletion goes on | The hold stops nothing else: every line that was not set aside is still deleted at 90 days | **Planned** (T-071): the retention setting is shown unchanged |
| Close the investigation | The lines that were set aside are deleted in every copy when the investigation is closed, and the record says when. The record itself stays | **Manual** |

Not said by the owner: how long an investigation may stay open, and whether an open hold is looked at again at fixed intervals (DEP-Q5). Until that is answered there is no upper limit on a hold other than the closing of the investigation.

#### Checks

For the production readiness checklist, all **Manual** until a provider is chosen, then written here as commands where the provider allows it (T-071):

- Show the configured retention period of every place in the first row of the table under "How long logs are kept", and that none is above 90 days.
- List the accounts that can read logs, held lines, and database backups, and compare the list with the access list.
- Show that no shared login exists.
- Show the hold records, or state that no hold has been placed.

## Production readiness checklist

Nothing below is done. Each item states how it is checked.

- [ ] Build and full test suite pass on the release commit. Check: `pnpm verify`, `pnpm test:integration` (**Planned**, T-023), `pnpm test:e2e` (**Planned**, T-060), each exit 0
- [ ] No open Critical or High security finding. **Manual**: findings register in SECURITY.md
- [ ] Environment variables set and validated, values not exposed. Check: the application starts (**Planned**, T-011 makes startup fail on an invalid variable); **Manual**: no secret is visible in logs or the hosting console's public settings
- [ ] `AUTH_SECRET` unique to the environment. **Manual**
- [ ] Database backup taken and restore rehearsed on staging, ending with the session clean-up ("Restore procedure"). **Planned** (T-071): commands depend on the hosting provider
- [ ] Backups deleted automatically after 30 days in every copy, and reachable only by the named people (OQ-50). **Manual** ("Database backups")
- [ ] Migrations applied on staging first. Check: `pnpm exec prisma migrate status` against staging reports no pending migration (**Planned**, T-013)
- [ ] Health check and logs verified on staging. Check: release procedure step 6; **Manual** for logs
- [ ] No copy of the logs kept longer than 90 days, the platform's router or proxy log and log backups included, with automatic deletion (OQ-21, OQ-48). **Manual** ("Log retention and access", "Checks")
- [ ] Log access limited to named individual accounts of the people who operate the servers; no shared login; access list compared with the real accounts (OQ-47). **Manual**
- [ ] Investigation hold procedure has a place for the held lines and for the record (OQ-48). **Manual**
- [ ] Session purge and payment timeout sweep run with no visitor present (OQ-49, D-028). Check: the two check queries in "Scheduled work" return 0 (**Planned**, T-015 and T-032); **Manual**: run lines of both jobs on a staging day without visitors
- [ ] The open questions below that bind a production release are answered. **Manual**
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

## Open questions

Points the decisions do not cover. Nothing in this document treats a recommendation below as a rule. Questions for the owner are put by the orchestrator; the others are settled in the task named.

| Id | Question | For | Recommendation (not decided) | Section |
| --- | --- | --- | --- | --- |
| DEP-Q1 | Which people are the "system administrators" who operate the servers, and who approves adding one? OQ-47 describes the group and names nobody | owner | The owner approves each person and is the only such person until someone else is approved | "Who may read server logs" |
| DEP-Q2 | How often is the list of people with access checked against the accounts that really exist? | owner | Before every production release and at least every 90 days | "Who may read server logs" |
| DEP-Q3 | Who may decide that an investigation hold is placed, and that an investigation is closed? SECURITY.md SR-06 uses the system administrators until someone is named | owner | The system administrators, and the owner is told each time | "Investigation hold" |
| DEP-Q4 | Where are held log lines and the hold record kept? | devops and security, T-071 | Depends on the hosting provider; the record is kept apart from the lines and contains none of them | "Investigation hold" |
| DEP-Q5 | May a hold stay open without limit while the investigation is open, or is it looked at again at fixed intervals? | owner | Each open hold is reviewed every 30 days and the review is added to the record | "Investigation hold" |
| DEP-Q6 | Is 30 days only the longest a database backup may be kept, or also the least (a backup must still exist 30 days back)? OQ-50 says "kept 30 days" | owner | Both: one backup a day, each kept 30 days and then deleted. If the provider's plan that does this costs money, that is a separate approval | "Database backups" |
| DEP-Q7 | After a restore, are all sessions deleted (everyone signs in again), or only the expired ones? D-028 requires the expired-session clean-up; SR-07 adds all sessions after a security incident; nothing covers sessions that were ended after the backup and come back valid | owner | Delete all sessions at every restore | "Restore procedure" |
| DEP-Q8 | How soon after the 15 minutes must an unpaid order actually be failed? D-028 gives the 15 minutes, not the delay allowed on top | owner, then T-032 | The sweep runs every minute; an order is failed within about 16 minutes; the check query allows 20 | "Scheduled work" |
| DEP-Q9 | Is there a least time that logs must be kept, so that an incident can still be investigated? OQ-48 sets only the maximum | owner | Aim for at least 30 days where the chosen host offers it without extra cost; anything paid is a separate approval | "How long logs are kept" |
| DEP-Q10 | Which mechanism runs the two jobs? | auth with devops, T-015 (D-029) | Candidate A, the in-process timer, if the host keeps the process running with no traffic | "Scheduled work" |
| DEP-Q11 | Is the upload volume backed up, and under which retention? | devops, T-071; owner if it costs money | Not formed yet | "Database backups" |

## Release log

| Date | Environment | Version | Result | Verified how |
| --- | --- | --- | --- | --- |
| | none | | | |
