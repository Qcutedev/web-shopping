# Deployment

Owner: devops agent.

**State on 2026-10-11: nothing is deployed. There is no staging URL and no production URL. No hosting provider is chosen, and no CI workflow or Dockerfile exists.** This document is the plan and the runbook skeleton. Sections marked `Planned` have not been exercised; the exercised sections are "Local databases" and, since 2026-10-12, "Environment variables" and "Health endpoint" (local runs only). Task status is recorded only in [STATUS.md](STATUS.md); this document does not repeat it.

**Also true on 2026-10-11: no server log is collected anywhere, no backup of any database exists, and nothing in the system runs on a schedule.** The owner's rules on logs, sessions, and backups (D-025 OQ-21; D-026 OQ-47 to OQ-50; D-028) are written below as requirements for the staging runbook (T-071) and for T-015. Every one of them is marked **NOT IMPLEMENTED**: that label means no configuration, script, job, or check for it exists, and nothing in this document is evidence that the rule is met.

**Added on 2026-10-12, documents only; no command was run for it and nothing was built.** The security rulings of D-032 point 3 (every restore deletes every session and re-applies restrictions; backups are encrypted and stored apart from the database host) are written into "Database backups" and "Restore procedure" as requirements. Code-review finding CR-16 is written into "Build and migration image" as a design for T-070 and T-071. The Prisma schema, its migrations, and the `db:migrate:deploy` script exist since T-013; no migration has been applied to any deployed database, because none exists.

**Added on 2026-10-12 with T-011; these parts were built and run on the developer machine.** `src/server/env.ts` validates the environment, `src/instrumentation.ts` runs that validation when the server starts, and `GET /api/health` exists. "Environment variables" and "Health endpoint" describe them as built, with the output of the runs. Nothing was deployed: every run was local. The owner's answers of D-033 points 7 to 13 are written into "Log retention and access", "Database backups", and "Scheduled work", and close DEP-Q1, DEP-Q2, DEP-Q3, DEP-Q5, DEP-Q6, DEP-Q8, and DEP-Q9. The answers are rules now; everything they govern is still **NOT IMPLEMENTED**, because no deployed environment exists.

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

The user names, passwords, and database names are throwaway local defaults written in `docker-compose.yml` and `.env.example`. They are not secrets, the ports are bound to `127.0.0.1` only, and they must never be reused for staging or production (the server refuses them at start when `NODE_ENV=production`; see "Environment variables", SEC-009). The test database also runs with durability switched off (`fsync=off`), which is safe only because its data is disposable.

Run every command from the repository root in PowerShell, with Docker Desktop running.

One-time setup, to give the application and tools their connection strings (`.env` is git-ignored):

```powershell
Copy-Item .env.example .env
```

A `.env` copied before T-011 (2026-10-12) lacks `APP_URL`, and the server then stops at start with `APP_URL is required`. Copy the lines from `APP_URL` to `LOG_LEVEL` out of `.env.example` into it.

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
- Verified on 2026-10-11: container health, the three queries above in both databases, persistence and reset behaviour, password login with both URLs' credentials from another container, and that re-creating the containers keeps the development data directory (same PostgreSQL system identifier before and after). A connection from a Node.js process on the host using `DATABASE_URL` was verified on 2026-10-12: the development server answered `GET /api/health` with `200` and `"database":"up"` ("Health endpoint").

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

4. Run `pnpm test:integration` (it exists since T-023; it must exit 0) before committing the new digest.

A change of the major version (for example 18 to 19) is not an image update: PostgreSQL cannot open a data directory of another major version, so it needs a dump and restore of the development data and a decision recorded in DECISIONS.md.

## Runtime requirements (Planned)

- One long-running Node.js server process (`next start` or a container). Not serverless for the MVP, because rate limiting is in-process and uploads go to local disk.
- PostgreSQL, a current supported major version.
- A persistent volume for uploads until object storage is integrated.
- HTTPS terminated by the host or a reverse proxy.
- Something that runs two jobs with no visitor present: the expired-session purge and the payment timeout sweep. Both run as in-process timers started by `src/instrumentation.ts` (the sweep: **IMPLEMENTED and wired, not yet run on a deployment**); see "Scheduled work". If the recommended in-process timer is chosen, the server process must stay running when there is no traffic: a host that stops or sleeps an idle container would stop the jobs without any error.
- Server logs and database backups stored only where the rules in "Log retention and access" and "Database backups" can be met.

### Reverse proxy conditions (Planned; required by SECURITY.md SR-01 and SR-05)

These bind whichever hosting setup is chosen. None has been exercised, because no proxy exists.

- When `TRUSTED_PROXY_HOPS` is greater than 0 or `TRUSTED_CLIENT_IP_HEADER` is set, the application port must be reachable only from the proxy (loopback or a private network). Otherwise a client can connect directly and forge its address.
- The proxy must append to or overwrite `X-Forwarded-For`, never pass a client-sent value through as the last entry, and must overwrite the header named in `TRUSTED_CLIENT_IP_HEADER`.
- The proxy must write the client address as plain IPv4, IPv6, or the dotted IPv4-mapped form, without a port. An `address:port` form makes every client share one rate-limit allowance.
- The hop count is confirmed on staging before production. **Manual**: send one request from a machine whose public address is known and compare it with the `clientIp` of the matching security log line.
- With the default configuration (no proxy trusted) every visitor shares one rate-limit allowance, so sign-in is limited for the whole site at once. That is intended; a real deployment must configure the proxy variables.
- A request body limit at the proxy is welcome as an outer layer. The application enforces its own limits (SR-05) and does not rely on it.

## Environment variables

Built in T-011 and exercised on the developer machine on 2026-10-12. `src/server/env.ts` is the one place that reads the application's variables, and the tables below are its rules. `.env.example` holds a local placeholder for every variable of the first table except two, which are deliberately absent from it: `NODE_ENV`, which the framework sets and which must not be written in `.env`, and `PGPASSWORD`, which this project does not use.

### Variables the server validates

| Variable | Rule | When not set | Secret |
| --- | --- | --- | --- |
| `NODE_ENV` | `development`, `test`, or `production`. The framework sets it (`next dev`, `next build`, `next start`); it is not written in `.env` | `development` | no |
| `APP_URL` | An absolute `http` or `https` URL. The public origin; its scheme, host, and port are the allowed origin of the `Origin` check | Refused: required | no |
| `DATABASE_URL` | A `postgresql://` or `postgres://` URL | Refused: required | yes (the local value in `.env.example` is a throwaway, not a secret) |
| `AUTH_SECRET` | A string of at least 32 characters; it signs the session cookie (CR-66). Generate at least 32 random bytes, for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. No default in any environment | Refused: required | yes |
| `DATABASE_URL_TEST` | Not read by the application. Used by the integration tests, locally and in CI. Its only rule is the production refusal below | Nothing happens | no (throwaway) |
| `PGPASSWORD` | Not used by this project: the password belongs in `DATABASE_URL`. The database driver reads the variable by itself as the password when the URL carries none, so it has one rule, the production refusal below | Nothing happens | yes |
| `TRUSTED_PROXY_HOPS` | One digit, `0` to `5`: the number of operator-controlled reverse proxies in front of the application (SR-01). `1.0`, `+1`, `true`, and a value with a blank are refused; there is no on/off switch for trusting a proxy | `0`, except in production (below) | no |
| `TRUSTED_CLIENT_IP_HEADER` | A header name matching `^[A-Za-z0-9-]{1,64}$`: a single-value header that the hosting platform's proxy always overwrites with the client address (SR-01). Not `X-Forwarded-For`, `Forwarded`, `Cookie`, `Authorization`, or `Host`, in any letter case. Refused when `TRUSTED_PROXY_HOPS` is greater than 0 | No header is trusted | no |
| `PAYMENT_TIMEOUT_MINUTES` | An integer from `1` to `1440`, written in digits only: how long an order may await payment before the sweep fails it (D-028). It is configuration so that tests can shorten it (DATA_MODEL.md section 4.3) | `15` | no |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error`. Lines below the level are not written, except lines written through `security()`, which the level never filters (SR-04). See "What `LOG_LEVEL` reaches" below | `info` | no |
| `UPLOAD_DIR` | An absolute directory path (T-041): where the local disk upload adapter keeps files. Refused when relative or blank, in every `NODE_ENV`. See "Uploaded files" below | Outside production: no value, and the upload and file endpoints answer `500` until it is set. Production: refused, required | no |

How the rules are applied:

- A variable that is set to an empty string counts as not set.
- A variable that `src/server/env.ts` does not know is ignored, except the four variables of the auth library, which are refused when set (SEC-045, below).
- Every variable at fault is reported in one failure, not only the first.

Refusals that apply only when `NODE_ENV=production`:

| Variable | Refused when | Why |
| --- | --- | --- |
| `DATABASE_URL` | It contains one of the two local placeholder passwords of `.env.example` and `docker-compose.yml`, as written or in a form the database driver turns into one (below) | SEC-009, SEC-025 |
| `PGPASSWORD` | It contains one of the two placeholder passwords, as written | SEC-025 |
| `AUTH_SECRET` | It contains `not_a_secret`, the marker of every throwaway value in `.env.example` | SEC-009 |
| `AUTH_SECRET` | It is not a random-looking value (below): a character outside printable ASCII, fewer than 8 distinct characters, a repeated pattern, a run of 8 characters in steady steps, a pattern at a distance of 1 to 8 characters, or a published value or its prefix | SEC-044, SEC-047, SEC-049 |
| `DATABASE_URL_TEST` | It is set at all | SEC-009 |
| `TRUSTED_PROXY_HOPS` | It is not set. `0` is accepted, but it must be written | SR-01: no silent default |
| `UPLOAD_DIR` | It is not set. No directory is guessed: a default could be one that is not persistent | T-041 |

The weak-secret rule for `AUTH_SECRET` (SEC-044, SEC-047, SEC-049). A value that is at least 32 characters long and does not contain `not_a_secret` is still refused when `NODE_ENV=production` if any of these holds:

- It has fewer than 8 distinct characters (counted by code point). `aaaaaaaa...` and 32 blanks fail.
- It is one shorter unit written two or more times, for example `abcdefgh` repeated four times. The test is on the whole string, UTF-16 code unit by code unit.
- It has a character outside printable ASCII (U+0021 to U+007E): a blank, an invisible character, a letter with an accent. Every documented generator writes ASCII only.
- Some run of 8 characters occurs twice in it (`password` four times plus `1` fails; so does `a` 25 times followed by `bcdefgh`).
- It holds a run of 8 characters with a constant code-point step: `abcdefgh`, `12345678`, `hgfedcba`, `aaaaaaaa`.
- It contains one of the published values that must never be used: the built-in default of the auth library (`better-auth-secret-12345678901234567890`) and the secret of the integration tests (`integration-test-secret-0123456789-abcdefghij`). The comparison ignores case and is made as a substring, so an upper-case copy, a copy with a character added, and a copy inside a longer value are refused.
- It starts with `better-auth-secret` or `integration-test-secret`, in any case, so a published value with its tail changed is refused too (SEC-049).
- For some distance (lag) from 1 to 8 characters, one and the same difference between the code points that far apart covers at least half of the positions (SEC-049). This refuses a word with a counter (`secret1secret2secret3...`), a short unit with changing separators (`abcdefg!abcdefg@...`), two interleaved sequences (`a1b2c3d4...`), and counting in hexadecimal (`000102030405...`).

This is a floor against copy and paste mistakes, not a measure of randomness. A value that passes is not thereby random; generate it as shown in the table above. A random value from the documented command is refused with a probability of about 1 in 500,000 (measured over 500,000 values per form in the SEC-047 re-check: 0 of base64url-43, base64-44, and hex-32, and 1 of hex-64; the SEC-049 lag rule refused 0 of 1,000,000 in each of 6 forms, base64-32 and upper-case hex-32 included); if it ever happens, generate another. A keyboard row such as `qwertyuiop` is not recognised.

What the operator sees. The server does not start. The log line of "What a failure looks like" lists the variable and one fixed rule text, never the value:

```
{"component":"env","issues":[{"variable":"AUTH_SECRET","rule":"must be a randomly generated value when NODE_ENV=production: printable ASCII only, with enough distinct characters, no repeated or sequential pattern, and not a published value"}],"level":"error",...}
```

Fix: replace the value with one generated by the command in the `AUTH_SECRET` row, store it in the host's secret manager, and restart. Do not reuse the value of another environment (the checklist asks for one secret per environment). Changing `AUTH_SECRET` signs every user out, because existing session cookies no longer verify. Other texts for the same variable: "is required" (not set or empty), "must be at least 32 characters long", and "must not be a placeholder from .env.example when NODE_ENV=production" (the `not_a_secret` rule above). The same rules are applied when the auth layer reads the secret on first use, so a process that skipped the start-up hook (see `NEXT_PHASE` below) still refuses a weak value at its first sign-in or session check.

The auth library's own variables (SEC-045, SEC-046), refused in every `NODE_ENV`, not only in production:

| Variable | Why it is refused |
| --- | --- |
| `BETTER_AUTH_SECRET` | The library would read it by itself. This application passes `AUTH_SECRET` explicitly, so the operator would believe one secret is in force while another is |
| `BETTER_AUTH_SECRETS` | The library would use it as a list of signing secrets, behind the validation of `AUTH_SECRET` |
| `BETTER_AUTH_URL` | The library would read a base URL other than `APP_URL` |
| `BETTER_AUTH_TRUSTED_ORIGINS` | The library would add trusted origins that the `Origin` check of `APP_URL` does not know |
| `BETTER_AUTH_TELEMETRY` | The library ORs it with the option, so it turns telemetry on although `telemetry: { enabled: false }` is set in `src/server/auth/auth.ts` (SEC-046) |
| `BETTER_AUTH_TELEMETRY_ENDPOINT` | With the one above, the library posts an event holding host details (CPU model, memory, platform) to this address (SEC-046) |
| `BETTER_AUTH_TELEMETRY_DEBUG` | The library writes the telemetry event to its log (SEC-046) |

What the operator sees: one issue per variable set, with the rule "must not be set; this application reads AUTH_SECRET and APP_URL only", and exit code 1. Only the name is reported, because the value may be a secret. Fix: delete the variable from the environment, the `.env` file, the compose file, and the host's settings; configure `AUTH_SECRET` and `APP_URL` instead. If the variable was set because a guide for the library said so, remove it and keep the value only as `AUTH_SECRET` if it is a strong random value. An empty value counts as not set and is not refused.

How the placeholder rule reads `DATABASE_URL` (SEC-025). The database driver does not use the variable as written: it parses it as a URL, percent-decodes the password, prefers a `password` query parameter to the password in front of the host, and falls back to `PGPASSWORD` when the URL has no password. The rule therefore looks for the two placeholders in:

- the whole text as written (this also finds a placeholder outside the password, for example in the user name);
- the whole text with every well-formed escape (`%` and two hexadecimal digits) decoded, so `local%5Fdev_only_not_a_secret` is refused like the plain spelling, in whatever part of the URL it stands;
- the user name, the password, and every `password` query parameter as the URL parser gives them, again as written and decoded. The parser drops tabs and line breaks, so a placeholder split by one is found here.

An escape that is not well formed (`%ZZ`, a `%` at the end) is not a refusal by itself and cannot make the validation throw; the well-formed escapes beside it are still decoded and judged. `PGPASSWORD` is judged as written, because the driver uses it as written. As with every rule, the refusal names the variable (`DATABASE_URL` or `PGPASSWORD`) and a fixed rule text and never a value. Not covered: a password file (`PGPASSFILE`), which the driver itself calls deprecated, and a decoding other than the one percent-decoding the driver does (a placeholder that is escaped twice in front of the host is a different password to the driver and is accepted).

One warning, also only when `NODE_ENV=production`: if no proxy is trusted (`TRUSTED_PROXY_HOPS=0` and no `TRUSTED_CLIENT_IP_HEADER`), the server writes one `warn` line at start saying that every per-address rate limit is shared by all clients (SR-01). The server starts. The line is written through `security("warn", ...)`, which `LOG_LEVEL` never filters, so no level silences it (unit test in `src/server/env.test.ts`; observed with `LOG_LEVEL=error` before this change, below).

A consequence on a developer machine: `pnpm start` runs with `NODE_ENV=production` and reads the local `.env`, so it is refused, as intended (observed, below). Local work uses `pnpm dev`. Never copy `.env.example` or `docker-compose.yml` to a staging or production host; the refusals above are the check behind that instruction, and they act only where `NODE_ENV=production`.

What `LOG_LEVEL` reaches (code changed after the measurements of 2026-10-12, Next.js 16.4.0; the production-mode run after the change was not done):

- After a successful validation, `loadEnvAtStartup` hands the validated level to the process-wide logger with `setLogLevel` of `src/server/logger.ts`. The level is kept once per process, on `globalThis` under a `Symbol.for` key, and read at every line, so the start-up hook, the proxy file, and the route handlers all use it. A failed validation leaves the level alone, so the error line is written at `info`.
- The framework still compiles the start-up hook and the route handlers separately, and each gets its own copy of `src/server/logger.ts` (ARCHITECTURE.md, module-copy measurement). Before the level moved to `globalThis`, that kept it from reaching handlers: with `LOG_LEVEL=warn` the `info` line of the health check was still written, in production and development mode. Since the change, the backend-api agent observed in development mode only that `error` or `warn` writes the `error` line and drops the `info` line. Not run in production mode, because the local databases are refused there.
- Lines written through `logger.security(level, ...)` are not subject to `LOG_LEVEL`: the SR-01 start-up warning, the rate limiter's saturation warning (SR-02 item 4), and later the SR-04 security events (SR-04; SEC-031). `LOG_LEVEL=error` therefore cannot hide them.
- Every other `warn` line is dropped at `LOG_LEVEL=error`, among them the one for a request body that broke off (SECURITY.md SR-05 item 10). `warn` is the highest level recommended for a deployed environment.
- `NEXT_PHASE` must not be set at run time. The framework sets `NEXT_PHASE=phase-production-build` itself during `next build`, and the start-up hook (`src/instrumentation.ts`) skips validation in that phase. A server started with that value in its environment (an `.env` file, a container setting, a service unit) skips the start-up validation and the exit on an invalid configuration (SEC-029). Reproduced: `next start` with that value answered the health check `200` on the placeholder password. The database layer now reads its URL through `readDatabaseUrl()` at first use, which applies the production refusals again, so that case now fails at the first query instead of passing; the start-up check is still skipped. Never write `NEXT_PHASE` in `.env`, a compose file, or a deployment setting. **Manual**: before a deployment, look for the name in the environment of the process and delete it.

Where each validated variable is read (checked against `src` on 2026-10-13):

- `PAYMENT_TIMEOUT_MINUTES`: read once at start by `src/instrumentation.ts`, which passes it to the payment timeout sweep schedule (`src/modules/orders/timeout-sweep.ts`). A change needs a restart.
- `TRUSTED_PROXY_HOPS`, `TRUSTED_CLIENT_IP_HEADER`, and the origin of `APP_URL`: read through `getEnv()` by the auth route layer (`src/server/auth/routes.ts`) and by `src/server/public-get.ts`.
- `DATABASE_URL`: the database layer (`src/server/db/client.ts`) takes it from `readDatabaseUrl()` of `src/server/env.ts` on first use, so the production refusals apply there too (CR-23, SEC-029). Importing the module still reads nothing (D-033 point 1).
- `AUTH_SECRET`: read through `readAuthSecret()` by the auth layer on first use, and by `getEnv()` at start.

### Variables not validated yet (Planned)

Not read by `src/server/env.ts` (`AUTH_SECRET` is, since CR-66: see the table above). Each is added to it, and to `.env.example`, by the task that introduces its reader.

| Variable | Purpose | Secret |
| --- | --- | --- |
| `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` | Read once by the bootstrap script (T-016); do not leave set | yes |
| `ADMIN_BOOTSTRAP_NAME` | Optional display name of the admin the bootstrap script creates; default `Admin` | no |

### Uploaded files

`UPLOAD_DIR` (T-041, `src/modules/uploads/`; contract in API_CONTRACTS.md section 5.8.1). The validation in `src/server/env.ts` is the same test as the upload module's own reader (`isAbsolute`, not blank), plus a refusal of a NUL byte, so a value that starts the server is a value the module accepts. The module still reads the variable itself through `readUploadDir`; moving it to `getEnv().uploadDir` is a change in `src/modules/uploads/` (backend-api).

- **Layout.** Files live at `<UPLOAD_DIR>/<first two hex digits>/<32 hex digit key>`, written once with an exclusive create. The key is random; no user-supplied name is part of a path.
- **Permissions.** The user that runs the server needs read, write, and create-directory permission on `UPLOAD_DIR` and nothing else is needed. No other account should be able to write to it, and the web server or proxy must not serve it as static files: files are served only through the file endpoint, which applies the access rules. Create the directory before the first start with the right owner; the adapter creates missing directories recursively (the two-digit subdirectories, and `UPLOAD_DIR` itself if its parent allows), so a missing directory under a root-owned parent fails at the first upload.
- **Persistence.** On a container or a platform with an ephemeral file system, mount `UPLOAD_DIR` on a persistent volume. A directory inside the container image or its writable layer is lost on redeploy. With more than one server instance, the local adapter is wrong: instances do not share a local disk. Use one instance, a shared volume that supports exclusive create, or a new storage adapter (the module has a `StorageProvider` interface for this); that choice is the owner's and is not made yet.
- **Backup.** The database holds the metadata of each file and the directory holds the bytes; neither is useful without the other. Back them up together, and take the directory copy at about the same time as the database dump. Restoring only the database leaves rows without bytes; restoring only the directory leaves bytes without rows (harmless but wasted). Backup tooling is **not set up**; this is manual until a hosting provider is chosen.
- **Rollback.** Deleting the directory loses every uploaded file, and no migration can recreate them. Treat it as data, not as a cache.
- **Local development.** Set `UPLOAD_DIR` in `.env` to a directory of yours, for example `C:\dev\web shoping\uploads` on this machine; `/uploads/` in the repository root is git-ignored. Without it, `pnpm dev` starts but the upload and file endpoints answer `500`. The integration tests set the variable themselves to a temporary directory.
- **What the operator sees.** In production, a missing value stops the start with `UPLOAD_DIR must be set when NODE_ENV=production`; a relative value, in any environment, with `UPLOAD_DIR must be an absolute directory path`. The value is never in the message.

Not verified: that the directory is writable by the server user. Validation checks the form of the path, not the file system. Check it on staging by uploading one file and reading it back.

Secrets live in the host's secret manager or environment configuration. They are never committed, never printed, and never prefixed `NEXT_PUBLIC_`.

### When the validation runs

- **At server start.** `src/instrumentation.ts` exports the framework's `register` function. The framework calls it once when a server instance starts; it calls `loadEnvAtStartup` of `src/server/env.ts`.
- **Not during `next build`.** The build needs no application variable (D-033 point 1; review item V4). Importing `src/server/env.ts` reads nothing; a variable is read only when `getEnv()` is first called.
- **Only in the Node.js runtime.**

What a failure looks like. One JSON log line on stdout, then the process ends with exit code 1:

```
{"component":"env","issues":[{"variable":"APP_URL","rule":"is required"}],"level":"error","timestamp":"...","message":"Environment validation failed. The server cannot start."}
```

The line and the error name each variable and the rule it broke. They never contain a value, of a refused variable or of any other: every rule text is a constant of `src/server/env.ts`. The JSON line on stdout is the report to rely on: the exit waits for it. After it the framework starts to print the same error with a stack trace on stderr, with the same names and rules and no value, but the exit does not wait for stderr, so that text may be cut off or missing. In the runs below it was complete each time.

The exit is requested when standard output reports that the line was taken. If it never reports (a pipe that nobody reads), the process ends anyway after 2 seconds, still with exit code 1 (unit test with a write that never reports back; not reproduced with a real blocked pipe).

Why the hook ends the process itself (measured with Next.js 16.4.0 on 2026-10-12): when `register` throws, `next dev` exits with code 1 on its own, but `next start` printed the error, reported `Ready`, stayed up, and answered every request, the health endpoint included, with `500 Internal Server Error`. A process that stays up is not restarted or reported as failed by whatever supervises it. `src/instrumentation.ts` therefore ends the process with exit code 1 after the log line is written. In both modes the framework prints `Ready` before the hook has run; that line is not evidence that the configuration is valid. The health endpoint is.

Also measured: with this application, `next build` does not call `register` at all, with or without the build check inside it. The check stays in the file so that a later framework version or route cannot make a build depend on the deployment's variables.

### Runs on 2026-10-12

On the developer machine (Windows 11, Next.js 16.4.0). Each server was started directly (`node node_modules/next/dist/bin/next dev` or `start`, with `-p` for the port), one at a time, and stopped afterwards. A variable was removed by setting it to an empty string in the process environment, which wins over `.env` and counts as not set. No value of any variable appeared in any output; the runs with an invented database password were searched for it and it was not there.

| Run | Result |
| --- | --- |
| Development mode (`next dev`) with the local `.env` | Started. `GET /api/health`: `200`, `{"status":"ok","database":"up"}`, `cache-control: no-store` |
| Development mode, `APP_URL` empty | Log line `"variable":"APP_URL","rule":"is required"`; the process exited by itself with code 1; no request was answered |
| Production mode (`next start`) with the local `.env` | Refused: `DATABASE_URL` "must not contain a local placeholder password from .env.example when NODE_ENV=production" and `DATABASE_URL_TEST` "must not be set when NODE_ENV=production"; exit code 1; no request was answered |
| Production mode, `APP_URL` empty, `DATABASE_URL_TEST` empty, `DATABASE_URL` with an invented password | Log line naming `APP_URL` only; exit code 1; no request was answered |
| The two production-mode runs above, before the hook ended the process itself | The process stayed up and answered `/api/health` with `500` and the body `Internal Server Error`. This is the framework behaviour the hook now covers |
| `pnpm build` with `APP_URL`, `DATABASE_URL`, `DATABASE_URL_TEST`, `TRUSTED_PROXY_HOPS`, `PAYMENT_TIMEOUT_MINUTES`, and `LOG_LEVEL` empty | Exit 0. In the route table `/api/health` is dynamic (rendered on demand), not prerendered |

Not run with the two local databases of `docker-compose.yml`: a production-mode start that passes validation and reaches one of them. The only password they accept is the published placeholder, which production mode refuses by design. A production-mode `200` was observed later the same day against a throwaway database (next table). Also not run: a build on a machine with no `.env` file at all; the variables were emptied in the process environment instead.

### Runs on 2026-10-12, after the follow-ups (SEC-025, SEC-026, `LOG_LEVEL`)

Same machine and method, on the build of `pnpm verify`. The servers were started from Git Bash, because Windows PowerShell 5.1 deletes a variable that is assigned an empty string and `.env` then fills it again. No value of any variable appeared in any output; each log was searched for the password of its run.

| Run | Result |
| --- | --- |
| Development mode with the local `.env` | Started. `GET /api/health`: `200`, `{"status":"ok","database":"up"}`, `cache-control: no-store`, `x-request-id` |
| Development mode, `APP_URL` empty | Log line `"variable":"APP_URL","rule":"is required"`; exit code 1 |
| Production mode, `DATABASE_URL_TEST` empty, `DATABASE_URL` with the development placeholder written as `local%5Fdev_only_not_a_secret` | Refused: `DATABASE_URL` "must not contain a local placeholder password from .env.example when NODE_ENV=production"; exit code 1; no request was answered. Before the fix this start reported `Ready` and answered `/api/health` with `200` (SECURITY.md SEC-025) |
| Production mode, `DATABASE_URL_TEST` empty, `DATABASE_URL` without a password, `PGPASSWORD` set to the development placeholder | Refused: `PGPASSWORD` "must not hold a local placeholder password from .env.example when NODE_ENV=production"; exit code 1; no request was answered |
| Production mode, `DATABASE_URL_TEST` empty, `DATABASE_URL` with an invented password and a closed local port, `LOG_LEVEL=error` | Started. The SR-01 `warn` line was written. Health requests: see "Health endpoint" |
| Production mode against a throwaway PostgreSQL container (the image of `docker-compose.yml`, published on `127.0.0.1` only, a password generated for the run, removed afterwards with its volume), `DATABASE_URL_TEST` empty | Started; with the container running, `GET /api/health`: `200`, `{"status":"ok","database":"up"}`. **This is the first `200` observed in production mode.** It is a local run, not a deployment |

The throwaway container is not part of the repository's set-up; it existed for these runs only. How end-to-end tests are to reach a database in production mode is an open question (code-review finding CR-49); these runs show one way that works and decide nothing.

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
| Are backups encrypted where they are stored and on the way there, and stored somewhere other than the database host? If that needs a paid plan, it is a paid addition and needs approval | "Database backups" (SECURITY.md SR-07; D-032 point 3) |
| Does the server process keep running with no traffic, or can a scheduled command be run without a paid add-on? | "Scheduled work" (OQ-49) |

## CI pipeline (Implemented, NOT RUN: T-070)

**Status: the workflow file exists and its YAML parses. It has never run: the repository has no remote, so no GitHub Actions run, passing or failing, has been observed.** T-070 is acceptable only after a real run on a push or pull request (PROJECT_PLAN.md). Everything below describes what the file does, not what a run showed.

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`, with `permissions: contents: read`, one concurrency group per ref (a newer push to a pull request cancels the older run), and actions pinned by major version only (`actions/checkout@v5`, `actions/setup-node@v5`; pinning to a full commit SHA is still to do and needs network access to look the SHAs up). Node is exactly 24.20.0 and pnpm is taken from `packageManager` through Corepack (D-020). Three jobs:

| Job | Steps | Notes |
| --- | --- | --- |
| `verify` | `pnpm install --frozen-lockfile`, then `pnpm verify` (format check, lint, type check, unit tests, build) | The build runs with `NODE_ENV=production`, so it gets per-run random `AUTH_SECRET` and `DATABASE_URL` (port 5432, nothing listens; the build does not connect) and no `DATABASE_URL_TEST` (SEC-009) |
| `integration` | `docker compose up -d --wait db-test`, then `pnpm test:integration` | Same digest-pinned image as local. The password is generated per run and handed to Compose as `POSTGRES_TEST_PASSWORD`; `DATABASE_URL_TEST` is `127.0.0.1:5433`, `DATABASE_URL` is another server (`127.0.0.1:5432`, nothing listening), as `tests/helpers/test-database-url.ts` requires. Migrations are applied by the suite's global setup |
| `audit` | `pnpm audit --prod` | Unfiltered, no exception list (D-034) |

Secrets: no repository secret is used. Generated values are masked with `::add-mask::` and exist only inside the run.

Not in the workflow: Playwright end-to-end tests (T-060 is not built, and CR-49, how e2e reaches a production-mode database, is an open owner decision), a secret scan (no scanner chosen), dependency-update bot configuration, and any deployment. Workflow rules are in `.claude/agents/devops.md`.

What was checked locally on 2026-10-13 (Windows, PowerShell): the YAML parses with `js-yaml`; `pnpm build` exits 0 with the per-run variables above and an unreachable `DATABASE_URL`; `pnpm audit --prod` reports "No known vulnerabilities found"; `pnpm format:check` and `pnpm lint` pass. Not checked: the `integration` job's commands (Docker was not running on the machine), the Linux runner, Corepack on the runner, or the cache.

Dependency audit: `pnpm audit --prod` must exit 0 and is run without an exception list. The unused optional peer `mysql2` of `better-auth` is removed from the tree by an override in `pnpm-workspace.yaml` (SEC-036, D-034), so it no longer reports. `pnpm audit` over development dependencies still reports advisories (SEC-010); they are not in the production tree.

No workflow file exists, and no CI job has ever run. Two things are missing: the tooling behind `pnpm test:integration` and `pnpm test:e2e` is not installed yet (see the task table in [STATUS.md](STATUS.md)), and there is no remote repository to run a workflow on (blocker B-04). A workflow can be written before the remote exists, but it cannot be reported as working until it has run there.

The checks the workflow will run can be run locally today:

```powershell
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs the format check, lint, type check, unit tests, and build. It does not run integration or end-to-end tests.

Two things the workflow depends on, from "Build and migration image" (CR-16): the install is the full install, because `postinstall` runs `prisma generate` and `prisma` is a development dependency; and the first `prisma` command of a job downloads the schema engine, so the job that applies migrations to the PostgreSQL service container needs network access at that step. Neither has been run in CI.

## Release procedure (Planned)

Never exercised: no environment exists to release to. Staging always goes first, with the same steps. Production additionally needs explicit human approval recorded in DECISIONS.md before step 3.

In the commands below `$baseUrl` is the origin of the environment being released. Set it first; no value is written here because no environment has been deployed.

| # | Step | Check |
| --- | --- | --- |
| 1 | All checks pass on the commit to release | `pnpm verify`, then `pnpm test:integration` (exists since T-023) and `pnpm test:e2e` (**Planned**, T-060). Each must exit 0. Once CI exists (T-070), the CI run on that commit replaces the local run |
| 2 | No open Critical or High security finding | **Manual**: read the findings register in [SECURITY.md](SECURITY.md) |
| 3 | Back up the target database and confirm the backup is restorable | **Planned**: the commands depend on the hosting provider, which is not chosen. See "Database backups". The pre-release backup is a database backup like any other: it is stored in the same place, readable by the same people, and deleted automatically after 30 days |
| 4 | Apply migrations | `pnpm db:migrate:deploy`, which runs `prisma migrate deploy`, with `DATABASE_URL` set to the target database for that command. Must exit 0. **Planned** (T-071): the script exists since T-013, but where it runs in a deployment is not built; see "Build and migration image" below. On production this is a production migration and needs explicit human approval recorded in DECISIONS.md (CLAUDE.md, "Needs human approval") |
| 5 | Deploy the new application version | **Planned**: depends on the hosting provider |
| 6 | Health endpoint answers | `curl.exe --silent --show-error --output NUL --write-out "%{http_code}" "$baseUrl/api/health"` must print `200`. The endpoint exists since T-011 and was exercised locally ("Health endpoint"); against a deployed environment the step is **Planned**, because none exists |
| 7 | One read path works | `curl.exe --silent --show-error --output NUL --write-out "%{http_code}" "$baseUrl/"` must print `200` (**Planned**: the homepage lands with T-021) |
| 8 | Log in and view one product | **Manual** in a browser, until the end-to-end suite can be pointed at a deployed environment (T-060) |
| 9 | Watch logs and error rate for 30 minutes | **Manual**, by a person who is allowed to read server logs ("Log retention and access"); the tool depends on the hosting provider |
| 10 | Scheduled work is running after the release | **Wired in code, not yet run on a deployment** (`src/instrumentation.ts` starts the session purge, T-015, and the payment timeout sweep, T-032): each job writes one run line at start ("Expired sessions removed", "Payment timeout sweep ran"; there is no separate registration line) and then one per interval, and the two check queries in "Scheduled work" return 0. **Manual**: not yet done on any host |
| 11 | Record the release in the release log below | **Manual** |

About step 4: `pnpm db:migrate` runs `prisma migrate dev`, which is for local development only. It can reset a database and must never be pointed at staging or production. The command for a deployed database is `prisma migrate deploy`, which only applies migrations that are already committed; the `package.json` script for it is `db:migrate:deploy`. The Prisma CLI reads its configuration from `prisma7.config.ts` at the repository root (DATA_MODEL.md section 21.1): that file names the schema file and the migrations folder and takes the database address from `DATABASE_URL`. It loads a `.env` file only when one exists, and a variable already set in the environment wins. A deployed host has no `.env` file: `DATABASE_URL` comes from the host's secret configuration and is set for the command.

### Build and migration image (Planned, T-070 and T-071; code-review finding CR-16)

**NOT IMPLEMENTED. This is a design. No Dockerfile, image, or workflow exists, and no part of this section has been built or run.** It is built and verified in the Dockerfile task (T-071) and the CI task (T-070); until then every statement below about what an install or an image does is a requirement to check, not an observation.

The finding: `postinstall` in `package.json` runs `prisma generate`, and `prisma` is a development dependency. A production-only install (`pnpm install --prod`) therefore fails: the script runs and the `prisma` command is not installed.

Requirements that follow:

1. **No production-only install is run, in the image build or anywhere in a deployment.** The image is built in a stage with the full install (`pnpm install --frozen-lockfile`), which runs `postinstall` and writes the generated client to `prisma/generated/prisma`. That stage runs `pnpm build`.
2. **The runtime image ships the Next.js standalone output of that build**, not a second install. `next.config.ts` does not set the standalone output today; it is an orchestrator-owned file, and the setting is requested for T-071. T-071 checks that the standalone output contains everything the server needs at run time, the generated client and the database driver included.
3. **`--ignore-scripts` alone is not a fix.** It makes the production-only install succeed, but `prisma generate` then never runs and the generated client is missing.
4. **`prisma migrate deploy` does not run from the runtime image.** It needs four things that the standalone output does not carry: the `prisma` package, `prisma7.config.ts`, the schema and migration files under `prisma/`, and the schema engine. The install scripts of `prisma` and `@prisma/engines` are refused in `pnpm-workspace.yaml`, so the engine is not part of an install: the CLI downloads it the first time a command needs it, unless it was fetched in advance (DATA_MODEL.md section 21.1).
5. **Migrations therefore run from the build image or from a dedicated migration image, with the schema engine already fetched** when the image is built. A migration step that downloads the engine at release time depends on network access from inside the deployment and on a download at the moment of a release; that is not accepted. How the engine is fetched in advance with the pinned Prisma version is established in T-071; no command for it is written here because none has been tried.
6. The image that runs migrations holds development dependencies and the full source. It is run for the migration step only, receives `DATABASE_URL` and no other secret, and is not what serves requests.
7. Production migrations still need explicit human approval recorded in DECISIONS.md (CLAUDE.md, "Needs human approval"). Nothing in this design applies a migration automatically on production; staging goes first with the same image.

Checks for T-071 (**Planned**; none runnable today, because no Dockerfile exists):

- The image builds from a clean checkout, and no step of the build runs a production-only install.
- The migration image applies the committed migrations to an empty PostgreSQL database with network access switched off, and `prisma migrate status` then reports no pending migration.
- The runtime image starts, and release procedure step 6 passes against it, with no `prisma` package and no development dependency inside it.

## First administrator (T-016)

There is no default admin and no web endpoint that grants admin; in the MVP admins are created only by `pnpm admin:bootstrap` (`scripts/bootstrap-admin.ts`; owner answers OQ-13, OQ-37; BR-26). **Not runnable yet:** the script entry uses `tsx`, which is not installed (`'tsx' is not recognized`); devops adds and pins the runner. The logic (`src/modules/auth/bootstrap-admin.ts`) is tested against the test database.

Input is read from the environment only, never from command-line arguments, so the password stays out of shell history and the process list. Supply the variables for one invocation and remove them afterwards. The form below runs in Windows PowerShell 5.1, the project shell, and in PowerShell 7. `Read-Host -AsSecureString` keeps the typed password off the screen and out of history; the conversion back to text is needed because an environment variable holds text. (`Read-Host -MaskInput` is not used: it exists only from PowerShell 7.1.)

```powershell
$env:ADMIN_BOOTSTRAP_EMAIL = "admin@example.com"
$secure = Read-Host -AsSecureString "Admin password"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:ADMIN_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
pnpm admin:bootstrap
Remove-Item Env:ADMIN_BOOTSTRAP_EMAIL, Env:ADMIN_BOOTSTRAP_PASSWORD
```

`DATABASE_URL` must point at the target database (a local `.env` is loaded without overriding set variables; never put the bootstrap variables in it).

| Input | Result | Exit |
| --- | --- | --- |
| Email with no account | Creates one active `ADMIN` (one `User`, one credential `Account`); it signs in at `POST /api/v1/auth/sign-in` | 0 |
| Email of an existing admin (any letter case) | No change; the password given is not used | 0 |
| Email of a customer or seller (any letter case) | Refused; nothing changes; the account is never promoted | 3 |
| Missing variable, invalid email, password outside 8 to 128 characters | Nothing changes; the message names the variable and rule, never the value | 2 |
| Other failure (database unreachable) | Error class and Prisma code only | 1 |

Running it again with a new email creates a further admin. The output names the account by user id and never prints the password or the email.

## Scheduled work (owner decisions OQ-49, D-026; D-028; D-029)

**IMPLEMENTED and wired, not yet run on a deployment.** Both jobs run as in-process timers (candidate A below) started by `register` in `src/instrumentation.ts`: the expired-session purge (`src/server/auth/session-purge.ts`, T-015) and the payment timeout sweep (`src/modules/orders/timeout-sweep.ts`, T-032, wired in commit `35903a1`). The hook starts them only in the Node.js runtime, only after the environment validated, not during `next build`, and not when `NODE_ENV=test`. Each runs once at start and then on its interval. The condition that the host keeps the process running with no traffic is not yet met or checked by any host, and the check queries below have not been run against a deployed database. The candidates below remain the comparison that led here; the recommendation in this section is not an owner decision on hosting.

### The two jobs

| | Expired-session purge | Payment timeout sweep |
| --- | --- | --- |
| Owner's rule | The IP address and browser details of an expired session must be gone within one day of its expiry; a daily clean-up is enough (D-026, OQ-49) | An order still awaiting payment after 15 minutes is failed (D-028). Its items return to the cart as after any failed payment (D-026, OQ-27) |
| What it does | Deletes every `Session` row past its `expiresAt`: `DELETE FROM "Session" WHERE "expiresAt" < now()` (DATA_MODEL.md section 6.1). Safe to run at any time and any number of times | Calls the guarded payment-failure transaction (DATA_MODEL.md section 7.2) for every order with `"paymentStatus" = 'PENDING'` and `"createdAt"` older than the timeout (section 4.3). An order that was paid or failed in the meantime is left alone, so two runs at once do no harm |
| Interval | Every hour (`SESSION_PURGE_INTERVAL_MS`, `src/server/auth/config.ts`). One day is the owner's limit; the hourly run is the margin DATA_MODEL.md section 6.1 asks for, so that one late or failed run does not break the limit | **Every minute. Decided by the owner (D-033 point 12)**: an unpaid order is failed within about 16 minutes. It is the constant `PAYMENT_SWEEP_INTERVAL_MS` (60,000) in `src/server/env.ts`, not a setting |
| Who writes the function | auth agent, T-015 | backend-api agent, T-032 (D-023 point 6: one service function that a script and the checkout path can call) |
| What a stopped job causes | Addresses and browser details of abandoned sessions stay in the database past the one-day limit. Nobody sees an error | Unpaid orders stay `PENDING`, and the stock they took at checkout stays unavailable to other customers until something fails them. Nobody sees an error |
| State | **IMPLEMENTED and wired** (T-015): `src/instrumentation.ts` calls `startSessionPurgeSchedule`, same conditions as the sweep; one `security()` info line per run. Not yet run on a deployment | **IMPLEMENTED and wired** (T-032): `src/instrumentation.ts` starts `startPaymentTimeoutSweepSchedule` after environment validation, in the Node.js runtime, never in the build phase and not with `NODE_ENV=test`. It runs once at start, then every 60 s (`PAYMENT_SWEEP_INTERVAL_MS`), one schedule per process, no overlapping runs, timer unref'd. Each run writes one `security()` info line with counts (`component: payment-timeout-sweep`), or an error line with the error class. **Several instances each run it**: harmless (guarded transaction) but wasteful. Not yet run on a deployment |

The scheduler was built in T-015 as an in-process timer; the sweep was added to it as a second job in T-032 without a new mechanism.

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
| A. In-process timer | The server process registers both jobs when it starts and runs them on a timer. Built: `register` in `src/instrumentation.ts` validates the environment, then starts both timers. Their behaviour under `next start` on a real host has not been observed | No extra service, no extra cost, the same on every host and on a developer machine. The run at start (requirement 2) comes with it. No new endpoint and no second place that holds the database credentials | It runs only while the process runs. **On a host that stops or sleeps an idle container the jobs stop without any error**, exactly when there is no traffic, which is the case the rules are about; they resume only when a visitor wakes the host. With several instances every instance runs the jobs (harmless, requirement 5, but wasteful). The start-up hook file is owned by devops for T-011 by an orchestrator ruling (STATUS.md, seventh session); what T-015 adds to it is agreed with devops then, and AGENT_WORKFLOW.md does not list the file yet |
| B. Platform scheduled command | The host runs a command on a schedule (a cron entry or timer on a server we operate, or the provider's scheduled-job feature) that calls the same two functions through a script in `scripts/` and exits | Independent of traffic and of the web process, so it also works on a host that sleeps the web container. The host usually shows a run history and exit codes | Depends on the provider: the feature may be a paid add-on (needs owner approval), and its shortest interval may be longer than a minute, which matters for the sweep. The database credentials are configured in a second place. A script and a `package.json` script name are needed (request to the orchestrator). No run at application start unless the start command also calls it |
| C. External cron calling an endpoint | A service outside the deployment (a hosted cron service, or a scheduled CI workflow) sends a request on a schedule to an endpoint that runs the jobs | Wakes a sleeping host | A new endpoint that changes state and is reachable from the internet: it needs its own secret, a `POST`, rate limiting, and a security review. It adds an outside service the rules then depend on (a new external or paid service needs owner approval). Scheduled CI workflows are not exact to the minute, and there is no remote repository to run one on (blocker B-04 in [STATUS.md](STATUS.md)) |

**Recommendation (devops, for T-015; not decided): candidate A, on the condition that the chosen host keeps the server process running with no traffic.** That condition is already a hosting requirement ("Runtime requirements") and a question to answer before choosing a provider ("Hosting options to decide"). If the only acceptable host sleeps idle containers, A does not meet the rules and B is the fallback. C is not recommended. Whichever is chosen, the two check queries below are what shows that it works; a mechanism that merely exists proves nothing.

Not recommended as a fix for a sleeping host: an outside uptime monitor that requests a page every few minutes to keep the container awake. It makes the two rules depend on a third-party service that can stop without notice, and it is not what the provider's idle rule intends.

### Check queries (written, not yet run against a deployment)

Both must return `0`. They are what release procedure step 10 refers to. They prove a breach; they prevent nothing.

Query 1, the one-day limit on expired sessions (the check of DATA_MODEL.md section 6.1):

```sql
SELECT count(*) FROM "Session" WHERE "expiresAt" < now() - interval '1 day';
```

Query 2, no order is still awaiting payment long after the timeout:

```sql
SELECT count(*) FROM "Order" WHERE "paymentStatus" = 'PENDING' AND "createdAt" < now() - interval '20 minutes';
```

The 20 minutes are the 15-minute timeout (D-028) plus 5 minutes for the one-minute sweep interval and its run time. The owner approved both numbers (D-033 point 12: failed within about 16 minutes; the check query allows 20). If the timeout setting of an environment is not 15, the interval in query 2 changes with it.

The tables and both jobs now exist; the queries have not been run against a deployed database:

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

### Database backups (Planned; owner decisions OQ-50, D-026; D-028; security requirements D-032 point 3)

**NOT IMPLEMENTED** (staging runbook, T-071). No backup of any database exists, no backup or restore command has ever been run, and no hosting provider is chosen, so there is no place where a backup could be stored. Everything below is a requirement on the runbook. The exact commands are written here when the provider is chosen.

The owner's rules:

- **Database backups are kept 30 days** (D-026, OQ-50). **30 days is both the longest and the shortest time: one backup a day, each kept 30 days and then deleted** (D-033 point 11). A provider plan that costs money is a separate approval.
- A backup contains every table, session rows included, so it holds the IP address and browser details of sessions that existed when it was taken, for up to 30 days after those sessions are gone from the live database. **The owner accepted this** (D-028). The one-day limit of "Scheduled work" describes the live database only.
- **A restore ends with the expired-session clean-up, before the application serves** (D-028). The security requirement of D-032 point 3 contains this and goes further: every restore deletes every session ("Restore procedure").

Security requirements, not owner choices and not recommendations (SECURITY.md SR-07 "Database backups"; D-032 point 3). A backup holds every password hash and every address, outside the database's access control:

- **Every backup is stored encrypted.**
- **Every backup is encrypted on the way to where it is stored.**
- **A backup is not kept only on the database host.** It is stored apart from it.

What the runbook must provide, whatever the provider (from SECURITY.md SR-07, "Database backups"):

| Requirement | State |
| --- | --- |
| Every backup is deleted automatically 30 days after it was taken. Not a task someone must remember | **NOT IMPLEMENTED** (T-071) |
| The 30 days cover every copy of a backup: the provider's automatic backups and snapshots, any point-in-time recovery window, a `pg_dump` file, a copy moved to other storage, a copy downloaded to a person's machine, and a database restored from a backup for a rehearsal | **NOT IMPLEMENTED** (T-071) |
| A backup is readable, downloadable, and restorable only by the named people of "Log retention and access": individual accounts, no shared login, no application role. The list of accounts that can reach backups is shown together with the log access list | **NOT IMPLEMENTED** (T-071) |
| The pre-release backup of release procedure step 3 is a database backup like any other: same storage, same people, deleted automatically after 30 days. It is not kept "just in case" beyond that | **NOT IMPLEMENTED** (T-071) |
| Backups of logs are not database backups. They follow "Log retention and access" and its 90 days | **NOT IMPLEMENTED** (T-071) |
| Encryption where the backup is stored. It covers every copy in the second row: a provider backup or snapshot, a `pg_dump` file, a copy moved to other storage, a copy on a person's machine. The runbook shows the setting or the command that encrypts each kind. The key or passphrase is a secret: it is kept in the host's secret configuration, reachable by the named people only, never beside the backup it opens, and never written into this document or a log | **NOT IMPLEMENTED** (T-071) |
| Encryption on the way to the storage: a backup is never sent over an unencrypted connection, from the database to the tool that takes it or from there to where it is stored | **NOT IMPLEMENTED** (T-071) |
| Storage apart from the database host: the loss of the database host or its disk does not take the backups with it. A dump file that exists only on the database host does not meet this | **NOT IMPLEMENTED** (T-071) |

One automatic backup a day is the owner's rule (D-033 point 11); whether it comes from the managed provider or from a scheduled `pg_dump` is settled with the provider (T-071). A backup service that costs money is a paid addition and needs owner approval first; that includes a plan needed only to meet the encryption or storage requirement. A provider that cannot meet the three security requirements is not usable for backups without a second mechanism that does.

Not covered by any decision: uploaded files live on a disk volume, not in the database, so a database backup does not contain them. Whether and how the upload volume is backed up is an open point for T-071.

The local development and test databases hold no real person's data and are outside these rules. They are not backed up.

### Restore procedure (Planned, T-071; security requirements SECURITY.md SR-07 "Restore", D-032 point 3)

**NOT IMPLEMENTED** and never rehearsed. A restore overwrites a database: on production it is a destructive data operation and needs explicit human approval recorded in [DECISIONS.md](DECISIONS.md) before step 2. The same steps apply to staging, to a rehearsal, and to the rollback in "Rollback".

Two security requirements bind every restore, into every database the application serves from, staging and a rehearsal with real data included (SR-07 "Restore"; D-032 point 3). They are not owner choices and not options of this procedure:

- **Every session is deleted, before the application serves a request** (step 6).
- **A restore does not lift a restriction.** Every user deactivation, store suspension, and product takedown or rejection that was in force just before the restore is in force again before the application serves (steps 3 and 7).

| # | Step | Check |
| --- | --- | --- |
| 1 | One of the named people records which backup is restored, into which database, and why | **Manual**: an entry in the release log |
| 2 | Stop the application so that it serves no request. It stays stopped until step 8 is done | **Planned** (T-071): depends on the hosting provider. Release procedure step 6 must fail at this point |
| 3 | **List the restrictions in force, before anything is overwritten.** See "Steps 3 and 7" below for the two sources | **Planned** (T-071). **Manual**: the release log entry of step 1 says which source was used and, when the source was the server log, which period could not be reconstructed |
| 4 | Restore the backup into the database | **Planned** (T-071): depends on the hosting provider |
| 5 | Bring the schema to what the application version to be started expects, with `DATABASE_URL` set to the restored database for each command | `pnpm exec prisma migrate status` reports no pending migration; if it reports any, `pnpm db:migrate:deploy` must exit 0. **Planned** (T-071): where these commands run in a deployment is in "Build and migration image". On production this is a production migration and is covered by the approval of this restore only if that approval says so |
| 6 | **Delete every session. Not optional, at every restore, whatever its reason.** If T-015 finds that another table of the auth library holds something that works like a credential with a lifetime (`Verification`), it is emptied in the same step | **Planned** (T-015 validates the table name): the check below returns `0` |
| 7 | **Re-apply the restrictions listed in step 3** to the restored database. Each one is written to the audit log like the admin action it repeats (SECURITY.md TM-25) | **Planned** (T-071): no script or query for it exists. Every id on the list that exists in the restored database carries the restricted status again |
| 8 | Delete the list of step 3 and any other copy made for this restore: a downloaded backup file, a scratch database | **Manual**. A backup copy falls under the 30-day rule and holds session data; the list is deleted when the restore is finished (SR-07) |

The application is started only after step 8, and only if the check of step 6, run once more immediately before the start, still returns `0`.

Step 6, the statement (everyone signs in again):

```sql
DELETE FROM "Session";
```

Step 6, the check; it must return `0` before the application is started:

```sql
SELECT count(*) FROM "Session";
```

Both are **Planned** against a deployed database: the table exists since T-013 and its names are validated in T-015, and how a statement is run against a deployed database depends on the hosting provider (T-071). Neither has been run as part of a restore, because no restore has ever been done. If T-015 provides a function that ends every session, the runbook calls it through a script instead of raw SQL; no such script exists and its name is a request to the orchestrator.

Why step 6 deletes every session and not only the expired ones (SR-07 "Restore" item 1):

- A restored database contains the `Session` rows of the day the backup was taken. Those that have expired since then come back with their IP address and browser details, although the live database had already removed them. The owner required the expired-session clean-up for this (D-028); deleting every session contains it.
- **A session that was ended after the backup was taken and has not expired yet is a valid session again in the restored database**: the user signed out, perhaps because the device was shared or lost, or the user was deactivated. Nothing in a restored row says whether it had been ended, and the expired-session clean-up does not touch it. Ending a session on the server is the owner's decision D-027; a restore must not undo it.
- The cost is that every user signs in once after a restore. The owner is told this consequence; it is not a choice between two acceptable options (DEP-Q7, closed). Starting the application on a restored database with its old sessions would have to be recorded in SECURITY.md as an accepted risk with the owner as approver. This procedure has no such path.

#### Steps 3 and 7: restrictions (SR-07 "Restore" item 2)

Deleting sessions does not undo the other half: a user deactivated after the backup is active again in the restored database and can sign in, a store suspended after it is approved again, and a product taken down or rejected after it is on sale again. These are put back **before the application serves**, not repeated by an admin afterwards while the application is already open.

Where the list of step 3 comes from. SECURITY.md SR-07 names two sources and no other:

| Case | Source | Conditions |
| --- | --- | --- |
| The database that is being replaced can still be read (a rollback) | That database. The ids under each restriction are listed from it before it is overwritten | The list holds ids and statuses only. It is reachable only by the named people of "Log retention and access". It is deleted when the restore is finished (step 8) |
| It cannot be read (a loss) | The admin-action lines of the server log (SECURITY.md SR-04). They are the only source | They may not reach back far enough, because logs are kept at least 30 days only where the host offers it without extra cost, and nowhere longer than 90 days ("How long logs are kept"; D-033 point 13). The record of the restore then says which period could not be reconstructed, **and the shop admin is told before the application serves** |

What is not written anywhere yet, and is not invented here (DEP-Q12): the queries that produce the list from the database being replaced; the form and the place of the list; the mechanism that re-applies a restriction while the application is stopped, and which actor its audit log entry names; and how the admin-action log lines are turned into a list. SR-07 leaves "how" to T-071. The table and column names are those of DATA_MODEL.md; no statement is given here because none has been written or tried.

What steps 3 and 7 do not give back:

- Everything else written since the backup is lost, including orders and the audit log entries written since the backup. The re-applied restrictions get new audit log entries (step 7); the original entries are gone.
- A restriction that was lifted after the backup (a user reactivated, a store's suspension ended) is in force again in the restored database, because the backup holds it. SR-07 does not cover this case. **Manual**: the shop admin lifts it again.
- An id on the list that does not exist in the restored database (an account or product created after the backup) is skipped: there is nothing to restrict.
- Orders that were awaiting payment in the backup are older than the timeout after a restore. The first run of the payment timeout sweep fails them and returns their items to the carts.

After the restore: start the application, then run release procedure steps 6 to 11.

A restore is rehearsed on staging, with a staging backup, before the first production release. The rehearsal includes steps 3, 6, and 7. A production backup restored anywhere else brings real people's data with it, and that place then falls under the same rules for access, encryption, the 30 days, the deletion of every session, and the restrictions.

## Rollback

- Application: redeploy the previous image or commit.
- Database: migrations are forward-only. There is no command that undoes one. If a migration must be undone, apply a corrective migration, or restore the pre-release backup by the "Restore procedure" (it deletes every session and re-applies the restrictions in force before the application starts) and accept the loss of data written since. In a rollback the database being replaced can still be read, so the restrictions are listed from it (restore step 3). This is why step 3 of the release procedure is mandatory.
- The pre-release backup can be used for a rollback only while it exists: it is deleted automatically after 30 days ("Database backups").
- Prefer backward-compatible (expand then contract) migrations so the previous application version still runs against the new schema.

## Health, logs, monitoring

The health endpoint is built (T-011). Every other row is a plan.

| Item | State |
| --- | --- |
| Health | Built and exercised locally: `GET /api/health`, see "Health endpoint" below |
| Logs | Structured JSON on stdout (`src/server/logger.ts`). **Planned**: collection by the host. No collector exists; where the lines may be stored and who may read them is bound by "Log retention and access" |
| Scheduled work | **Planned**: a log line per run of each job, and the two check queries in "Scheduled work" (T-015, T-032). An uptime check on the health endpoint does not notice a job that stopped |
| Uptime | **Planned**: external check on the health endpoint (recommended) |
| Errors | **Planned**: error tracking service (recommended, not selected) |
| Metrics to watch | **Planned**: 5xx rate, checkout failures, `INSUFFICIENT_STOCK` rate, login rate-limit hits, rate-limiter saturation warnings, database connections |

### Health endpoint

`GET /api/health` (contract: API_CONTRACTS.md). Public, no sign-in. Code: `src/app/api/health/route.ts` maps the result of `src/server/health.ts` to a response.

| Case | Status | Body |
| --- | --- | --- |
| The database answered `SELECT 1` | `200` | `{"status":"ok","database":"up"}` |
| The database did not answer, answered with an error, or did not answer within 2 seconds | `503` | `{"status":"unavailable","database":"down"}` |

What it does and does not do:

- The body is the whole answer in both cases. It holds no version, no configuration, no host name, and no error text. The cause of a failure goes to the server log only ("What the health check logs" below).
- Every response carries `Cache-Control: no-store` and an `X-Request-Id` that the server generated. A request id sent by the client is not used.
- It is never prerendered and never cached: the handler runs for every request and never during `next build`.
- The wait for the database is bounded at 2 seconds. A database that does not answer cannot hang the caller.
- Requests that arrive while a query is running share that query, so a flood of health requests does not become a flood of queries. The endpoint is not rate limited. A query that has not settled after 30 seconds is given up and the next request starts a new one.
- It reads no environment variable. When `DATABASE_URL` is not set, the check reports the database as down and the log line says that the variable is not set (unit test; in a running server that case does not occur, because the server ends at start).
- A `200` says that the process answers and the database answers a trivial query. It says nothing about migrations, about the scheduled jobs, or about any page.
- When the environment is invalid the server has ended at start ("Environment variables"), so the endpoint does not answer at all.

What the health check logs (SECURITY.md SEC-026). The endpoint is public and not rate limited, so the log follows the outage and the clock, not the number of requests:

- A failure writes one `error` line with `component: "health"`, a `reason`, and `failedChecks`. The reasons: `error` (the query failed; the line also has the error's class name, its code, and its message clipped to 300 characters, in which the logger masks credentials), `timeout` (no answer within 2 seconds; the line has `timeoutMs`), and `internal` (the check itself failed; not expected to happen).
- Requests that shared one failed query produce one line for all of them, not one each.
- At most one failure line is written in 30 seconds, whatever the reason. Failed checks in between write nothing and are counted; `failedChecks` on a line is the number of checks that failed since the previous failure line, the one that wrote the line included.
- When the database answers again after a failure line, one `info` line is written: "Health check recovered: the database answers again.", with the `failedChecks` that no line had reported yet. No such line is written when no failure line preceded it. A database that goes up and down therefore writes at most one `error` and one `info` line in 30 seconds.
- The request id on a line is that of the first check the line reports. Every response still carries its own `X-Request-Id`, so most `503` responses of an outage have a request id that is in no log line.
- For alerting: one `error` line with `component: "health"` means an outage began or is going on; the absence of further lines within 30 seconds does not mean it ended. The recovery line, or a `200` from the endpoint, does. Mind that the recovery line is `info`.
- None of this changes the response: every caller gets its `503` or `200` exactly as before, within the same 2 seconds.

Runs on 2026-10-12 on the developer machine, with both local databases up (`docker compose ps`: `db-dev` and `db-test` healthy). The servers were started and stopped as described in "Environment variables".

| Run | Status | Body | Time of the request | Headers seen |
| --- | --- | --- | --- | --- |
| Development mode, local `.env` | `200` | `{"status":"ok","database":"up"}` | 3.30 s for the first request (the route is compiled on first use), 0.02 s for the second | `cache-control: no-store`, `content-type: application/json`, `x-request-id` |
| Production mode, `DATABASE_URL` pointing at a closed local port | `503` | `{"status":"unavailable","database":"down"}` | 0.67 s, then 0.005 s | the same |
| Production mode, `DATABASE_URL` pointing at an address that never answers | `503` | `{"status":"unavailable","database":"down"}` | 2.61 s, then 2.00 s | the same |

In the two `503` runs the server log held one `error` line per request (`reason: "error"` with `Can't reach database server` for the closed port; `reason: "timeout"`, `timeoutMs: 2000` for the silent address) and the response body held none of it. That was the behaviour before SEC-026 was fixed; the runs below replace it.

Runs on 2026-10-12 after the SEC-026 fix, production mode (`next start`), started as described in "Environment variables":

| Run | Responses | Lines of the health check in the server log |
| --- | --- | --- |
| `DATABASE_URL` pointing at a closed local port; 20 requests one after another, then 20 at the same moment, then 1 | `503` with `{"status":"unavailable","database":"down"}` every time, `cache-control: no-store` and an `x-request-id` | 1 `error` line (`reason: "error"`, `failedChecks: 1`, `Can't reach database server`); before the fix this was one line per request |
| The same with `LOG_LEVEL=error` | the same | the same 1 `error` line |
| A throwaway database, stopped when the server started: 10 requests; then the database started: 10 requests | `503` ten times, then `200` with `{"status":"ok","database":"up"}` ten times | 1 `error` line, then 1 `info` line "Health check recovered: the database answers again." with `failedChecks: 10` (the ten requests of the run; the `error` line itself came from the request with which the run script waited for the server to listen) |
| The same with `LOG_LEVEL=warn`, in production mode and in development mode | the same | The same 2 lines. Measured before the level moved to `globalThis`: the `info` line should not have been written at this level, because `LOG_LEVEL` did not reach the handlers' logger. Not repeated since; see "What `LOG_LEVEL` reaches" |

Not run: the 30-second interval with a real clock (a second `error` line after 30 seconds of outage; covered by unit tests with an injected clock), the `timeout` reason after the fix, and the endpoint against any deployed environment.

Pool and timeouts (code-review finding CR-23; `src/server/db/pool-config.ts`, constants, not environment variables): at most 10 connections per server process, 5 seconds to wait for a connection, 10 seconds before an idle connection is closed, `statement_timeout` of 30 seconds (the server cancels the statement), and `query_timeout` of 35 seconds (the driver stops waiting). The health check keeps its own 2-second bound on top. A `statement_timeout` or `query_timeout` parameter in `DATABASE_URL` replaces the constant of that name; `max` and the two other timings cannot be changed from the URL. Known limit: a connection pooler in transaction mode (PgBouncer) refuses or ignores the start-up parameter `statement_timeout`; none is in front of the database today. Migrations use the Prisma CLI's own connection and are not cut short by these limits.

### Log retention and access (owner decisions OQ-21, D-025; OQ-47 and OQ-48, D-026; binding)

Server logs contain visitors' IP addresses on security events (SECURITY.md SR-04). An IP address is personal data. The owner decided on 2026-10-11:

- **Server logs are kept for at most 90 days** and are then deleted, in every copy (OQ-21, OQ-48).
- **Only system administrators may read them, and "system administrators" are only the named people who operate the servers.** The application's `ADMIN` role gives no access to logs (OQ-47).
- **One exception to the 90 days:** log lines that are evidence in an open security investigation may be kept until the investigation is closed, limited to the relevant lines, with a written record of what is kept and why (OQ-48).

The detailed rule is SECURITY.md SR-06; this section is its deployment side. **NOT IMPLEMENTED** (staging runbook, T-071): no hosting provider is chosen, no log collector exists, no account that could read a log exists, and the mechanism (a retention setting in a managed log service, or log rotation and file permissions on a server that we operate) depends on that choice. When the provider is chosen, the requirements below are replaced by the actual configuration and the checks that prove it. The rules apply to every deployed environment, staging included. Local development is outside them as long as it handles no real visitor data: `docker compose logs` on a developer machine shows database logs only.

#### Who may read server logs (OQ-47)

| Requirement | State |
| --- | --- |
| Access is given to named individual accounts, one per person, for the people who operate the servers. **The owner is the only system administrator, and approves each further person individually** (D-033 point 7) | **NOT IMPLEMENTED** (T-071) |
| No shared login: no account used by two people, and no password, token, or key for the hosting console, the log service, or a server passed between people | **NOT IMPLEMENTED** (T-071) |
| Shop admins are not included. The application's `ADMIN` role, the seller role, and support staff get no access through the hosting console, the log service, a server login, or any screen of the application. The application offers no page, endpoint, or download that shows log lines (SR-06 item 4) | **NOT IMPLEMENTED** (T-071). No such page or endpoint exists or is planned |
| The same people, and nobody else, can reach database backups ("Database backups") and any log line set aside under an investigation hold | **NOT IMPLEMENTED** (T-071) |

How access is granted, reviewed, and removed. Who approves a person and how often the list is checked are the owner's rules (D-033 points 7 and 8). The steps still marked "proposed" are devops proposals that no decision covers, not rules.

| Event | What happens | State |
| --- | --- | --- |
| Grant | The owner approves each person individually (D-033 point 7); until the owner approves someone else, the owner is the only one. That person gets an individual account with the least permission that lets them operate the servers, and a line in the access list: person, the systems the account reaches (hosting console, log store, database, backups), date granted, approved by. The list holds no password, token, or key | **NOT IMPLEMENTED** (T-071) |
| Review | The access list is compared with the accounts that really exist on the provider; an account that is not on the list is removed. **Before every production release and at least every 90 days** (D-033 point 8) | **NOT IMPLEMENTED** (T-071). **Manual** |
| Removal | When a person stops operating the servers, their account is removed or disabled, and the list records the date. Proposed: on the same day, and every secret that person could read (database password, `AUTH_SECRET`, deploy tokens) is replaced | **NOT IMPLEMENTED** (T-071). **Manual** |

The access list is part of the deployment evidence (SR-06 item 3) and is reviewed by the security agent before a production release. Where it is kept is settled in T-071; none exists today.

#### How long logs are kept (OQ-48)

**90 days is a maximum, not a promise that logs are available that long.** A deployment that keeps logs for a shorter time, or loses them when a container is replaced at a release, does not break the rule. The owner set no minimum, so an incident found later than the logs lasted cannot be investigated from them; the owner's answer to that is the next paragraph.

**Logs are kept at least 30 days where the chosen host offers it without extra cost** (D-033 point 13). Anything paid is a separate approval. This depends on the host: on a host that offers less without extra cost, logs last a shorter time. The 90-day maximum stands.

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
| Place the hold | A person who may read the logs selects the relevant lines and sets them aside. **The system administrators place and close a hold, and the owner is told each time** (D-033 point 9) | **Manual** |
| Record it at the same time, not afterwards | The record names the investigation, the lines or the selection that produced them (time range and filter), the reason, who set them aside, and the date. The record contains no log line and no IP address | **Manual** |
| Keep the lines | Under the same access rule as the logs (the named people only) and the same content rule (SR-04). Where the lines and the record are kept depends on the hosting provider and is settled in T-071 with the security agent (DEP-Q4); no place exists today | **Manual** |
| Review the hold | **Every open hold is reviewed every 30 days** (D-033 point 10). Each look is added to the record with its date, who looked, and whether the investigation is still open. The interval is never longer than 90 days; a hold with no recorded look for more than 90 days is treated as a breach of SR-06 (item 8). The 30 days are the owner's interval within that ceiling | **Manual** |
| Normal deletion goes on | The hold stops nothing else: every line that was not set aside is still deleted at 90 days | **Planned** (T-071): the retention setting is shown unchanged |
| Close the investigation | The system administrators close it and tell the owner (D-033 point 9). The lines that were set aside are deleted in every copy when the investigation is closed, and the record says when. The record itself stays | **Manual** |

Not said by the owner: how long an investigation may stay open. How often an open hold is looked at again is decided: every 30 days, with the review added to the record (D-033 point 10). The security minimum stays underneath it (SECURITY.md SR-06 item 8 and "Scheduled work: security minimums"): a dated review of every open hold, added to the record, at intervals of 90 days at most. 90 days is the period the hold is an exception to (OQ-48: a maximum for every copy), so a hold with no recorded review for more than 90 days is a breach whatever else is agreed. The hold itself still has no upper limit other than the closing of the investigation; the review is what shows that the lines are still evidence in an open investigation.

#### Checks

For the production readiness checklist, all **Manual** until a provider is chosen, then written here as commands where the provider allows it (T-071):

- Show the configured retention period of every place in the first row of the table under "How long logs are kept", and that none is above 90 days.
- List the accounts that can read logs, held lines, and database backups, and compare the list with the access list.
- Show that no shared login exists.
- Show the hold records, or state that no hold has been placed. For every open hold, show that the last recorded review is not older than 90 days.

## Production readiness checklist

Nothing below is done. Each item states how it is checked.

- [ ] Build and full test suite pass on the release commit. Check: `pnpm verify`, `pnpm test:integration` (exists since T-023), `pnpm test:e2e` (**Planned**, T-060), each exit 0
- [ ] No open Critical or High security finding. **Manual**: findings register in SECURITY.md
- [ ] Environment variables set and validated, values not exposed. Check: the application starts and release procedure step 6 passes (since T-011 an invalid variable ends the server at start with exit code 1 and names the variable); **Manual**: no secret is visible in logs or the hosting console's public settings
- [ ] `AUTH_SECRET` unique to the environment. **Manual**
- [ ] Database backup taken and restore rehearsed on staging, with every session deleted and the restrictions re-applied before the application starts ("Restore procedure" steps 3, 6, and 7; D-032 point 3). **Planned** (T-071): commands depend on the hosting provider
- [ ] Backups deleted automatically after 30 days in every copy, and reachable only by the named people (OQ-50). **Manual** ("Database backups")
- [ ] Backups encrypted where they are stored and on the way there, and stored apart from the database host (SR-07; D-032 point 3). **Manual** ("Database backups")
- [ ] The runtime image is built without a production-only install and holds no `prisma` package; migrations run from the build image or a migration image with the schema engine already fetched (CR-16). **Planned** (T-071): the checks in "Build and migration image"
- [ ] Migrations applied on staging first. Check: `pnpm exec prisma migrate status` with `DATABASE_URL` set to the staging database reports no pending migration (**Planned**, T-071: no staging database exists)
- [ ] Health check and logs verified on staging. Check: release procedure step 6; **Manual** for logs
- [ ] No copy of the logs kept longer than 90 days, the platform's router or proxy log and log backups included, with automatic deletion (OQ-21, OQ-48). **Manual** ("Log retention and access", "Checks")
- [ ] Log access limited to named individual accounts of the people who operate the servers; no shared login; access list compared with the real accounts (OQ-47). **Manual**
- [ ] Investigation hold procedure has a place for the held lines and for the record, and every open hold is reviewed every 30 days (D-033 point 10), never later than 90 days (OQ-48; SR-06 item 8). **Manual**
- [ ] Session purge and payment timeout sweep run with no visitor present (OQ-49, D-028). Check: the two check queries in "Scheduled work" return 0 (jobs wired in `src/instrumentation.ts`, T-015 and T-032; not yet run on a deployment); **Manual**: run lines of both jobs on a staging day without visitors
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
| DEP-Q1 | **CLOSED** (D-033 point 7). Was: which people are the "system administrators" who operate the servers, and who approves adding one? Answer: the owner is the only system administrator, and approves each further person individually | closed | None: decided | "Who may read server logs" |
| DEP-Q2 | **CLOSED** (D-033 point 8). Was: how often is the list of people with access checked against the accounts that really exist? Answer: before every production release and at least every 90 days | closed | None: decided | "Who may read server logs" |
| DEP-Q3 | **CLOSED** (D-033 point 9). Was: who may decide that an investigation hold is placed, and that an investigation is closed? Answer: the system administrators place and close a hold, and the owner is told each time | closed | None: decided | "Investigation hold" |
| DEP-Q4 | Where are held log lines and the hold record kept? | devops and security, T-071 | Depends on the hosting provider; the record is kept apart from the lines and contains none of them | "Investigation hold" |
| DEP-Q5 | **CLOSED** (D-033 point 10). Was: how often is an open hold reviewed, within security's ceiling of 90 days? Answer: every open hold is reviewed every 30 days, and the review is added to the record. The 90-day ceiling of SECURITY.md SR-06 item 8 stays | closed | None: decided | "Investigation hold" |
| DEP-Q6 | **CLOSED** (D-033 point 11). Was: is 30 days only the longest a database backup may be kept, or also the least? Answer: both. One backup a day, each kept 30 days and then deleted. A provider plan that costs money is a separate approval | closed | None: decided | "Database backups" |
| DEP-Q7 | **CLOSED** (D-032 point 3; SECURITY.md SR-07 "Restore"). Was: after a restore, are all sessions deleted, or only the expired ones? Ruling: every restore deletes every session before the application serves, so everyone signs in once after a restore. It is a security requirement, not an owner choice; it contains the expired-session clean-up of D-028. The same ruling requires restrictions to be re-applied before the application serves | closed; the owner is told the consequence | None: ruled, not recommended | "Restore procedure" |
| DEP-Q8 | **CLOSED** (D-033 point 12). Was: how soon after the 15 minutes must an unpaid order actually be failed? Answer: the payment-timeout sweep runs every minute; an unpaid order is failed within about 16 minutes; the check query allows 20. The interval is the constant `PAYMENT_SWEEP_INTERVAL_MS` in `src/server/env.ts` since T-011; the sweep is T-032, wired in `src/instrumentation.ts` (commit `35903a1`) | closed | None: decided | "Scheduled work" |
| DEP-Q9 | **CLOSED** (D-033 point 13). Was: is there a least time that logs must be kept? Answer: at least 30 days where the chosen host offers it without extra cost. Anything paid is a separate approval. The 90-day maximum (OQ-48) stands | closed | None: decided | "How long logs are kept" |
| DEP-Q10 | Which mechanism runs the two jobs? | auth with devops, T-015 (D-029) | Candidate A, the in-process timer, if the host keeps the process running with no traffic | "Scheduled work" |
| DEP-Q11 | Is the upload volume backed up, and under which retention? | devops, T-071; owner if it costs money | Not formed yet | "Database backups" |
| DEP-Q12 | How are restrictions listed and re-applied at a restore? SR-07 "Restore" item 2 names the two sources (the database being replaced when it can be read, otherwise the admin-action lines of the server log) and leaves the rest to T-071: the queries that produce the list, its form and place, the mechanism that re-applies a restriction while the application is stopped, which actor the audit log entry names, and how log lines become a list | devops and security, T-071; backend-api if a service function or script is needed | Not formed yet. A script that calls the same service functions as the admin actions would keep the audit log entry in one place; no such function exists | "Restore procedure" |
| DEP-Q13 | How is the schema engine fetched in advance into the image that runs migrations, and is that image the build image or a dedicated one (CR-16)? | devops, T-071 and T-070 | A dedicated migration image, so that the build image is not kept and run in a deployment; to be tried in T-071 | "Build and migration image" |

## Release log

| Date | Environment | Version | Result | Verified how |
| --- | --- | --- | --- | --- |
| | none | | | |
