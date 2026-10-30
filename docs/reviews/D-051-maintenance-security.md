# Security review: D-051 scheduled-maintenance endpoint

Reviewer: security agent. Date: 2026-10-30. Range: `4c460df..bc3717a` (the brief named `4c460df..HEAD`; HEAD moved from `4e38a16` to `bc3717a` during the review, and that commit is included).

Findings continue the numbering of [../SECURITY.md](../SECURITY.md): SEC-097 to SEC-101. They are copied into the SECURITY.md register, which holds the current status of each; the `Status:` lines below are as of the review and are not updated.

Reproductions: `tests/security/d051-maintenance.test.ts` (no database, no server). `it` cases are controls that hold; `it.fails` cases demonstrate an open finding. Each `it.fails` case was flipped to `it` in a temporary copy and failed on its flaw assertion (output below).

A clean test or scanner run is evidence that those checks found nothing, not that the endpoint is secure.

## Scope and what was read

- `src/app/api/v1/internal/maintenance/route.ts`
- `src/modules/maintenance/{authorization,service,schema,index}.ts`
- `src/server/maintenance-jobs.ts`, `src/server/request-frame.ts`
- `src/server/env.ts` (diff: `MAINTENANCE_VIA_HTTP`, `CRON_SECRET`, production checks)
- `src/instrumentation.ts` (diff)
- `src/proxy.ts`, `next.config.ts` (headers, matcher)
- `src/server/logger.ts` (Bearer and `authorization` redaction), `src/server/http.ts` (`no-store`)
- `.github/workflows/maintenance.yml` (at `4e38a16` and at `bc3717a`)
- `src/modules/uploads/{schema,reader,errors}.ts`, `src/i18n/th.ts` (diff), `src/components/seller/image-set-editor.tsx`, `prisma/migrations/20261011121529_init_schema_v1/migration.sql`
- `.env.example`, `docs/API_CONTRACTS.md` 5.11 and the env table, `docs/DEPLOYMENT.md` "Scheduled work"

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm vitest run --project unit tests/security` (as briefed) | `No test files found, exiting with code 1`. The `unit` project includes `src/**/*.test.ts` and `tests/unit/**` only; security tests live in the `security` project. |
| `pnpm exec vitest run --project security` (before the new file) | 52 files, 1781 passed, 31 expected fail |
| `pnpm exec vitest run --project unit src/modules/maintenance src/app/api/v1/internal src/server/maintenance-jobs.test.ts src/server/env.test.ts src/instrumentation.test.ts src/modules/uploads` | 13 files, 489 passed |
| `pnpm exec vitest run --project security tests/security/d051-maintenance.test.ts` | 1 file, 11 passed, 6 expected fail |
| Same file, every `it.fails` flipped to `it` in a temporary copy (deleted afterwards) | 6 failed, each on its flaw assertion: `expected true to be false` (SEC-097), `expected false to be true` (SEC-099 burst), `expected '/**\n * POST ...' to match /\.security\(.../` (SEC-099 level), `expected 'if [ -z "${MAINTENANCE_URL}" ] ...' not to match /exit 0/` (SEC-100), `expected '/**\n * Health check ...' to match /maintenance\|sweep\|lastRun/i` (SEC-100), `expected 5242880 to be 4194304` (SEC-101) |
| `pnpm exec vitest run --project security` (after) | 53 files, 1792 passed, 37 expected fail |
| `pnpm exec tsc --noEmit -p .`; `pnpm exec eslint tests/security/d051-maintenance.test.ts`; `pnpm exec prettier --check` same file | exit 0, exit 0, clean |
| curl config quoting (Git Bash, curl 8.21.0, local Node echo server on 127.0.0.1) | see SEC-097 |
| gitleaks | not installed; no secret scan was run. `git diff 4c460df..HEAD` holds no `CRON_SECRET=<value>`; test secrets are assembled at run time. |
| `pnpm audit` | not run: `package.json` and `pnpm-lock.yaml` are unchanged in the range. |
| `pnpm test:integration tests/integration/maintenance` | not run: needs the Docker database, not started in this review. |

## Controls checked that hold

- **Authentication.** `Authorization: Bearer <secret>` only; no session or cookie is read. Requests carrying `Cookie` or `Origin` are refused even with the right secret (tested). `CRON_SECRET` unset or empty refuses every request, the right header included (tested). One uniform `401` for every refusal, `Cache-Control: no-store`.
- **Timing-safe compare.** Both sides are SHA-256 hashed and compared with `crypto.timingSafeEqual` (`authorization.ts:36-38`); the unconfigured branch hashes once too. The only early exit is on the presented header's own length (no information about the configured secret).
- **Header length bound.** `MAX_AUTHORIZATION_HEADER_LENGTH = 263` is checked before the regular expression; the regular expression is linear (`^bearer ([!-~]+)$`). Two `Authorization` headers are joined by `Headers.get` with `", "` and fail the pattern.
- **CSRF / CORS.** No CORS headers are emitted anywhere (`next.config.ts`); a browser cannot send a custom `Authorization` cross-site without a preflight nobody answers, and `Origin` is refused anyway.
- **Proxy interplay.** `src/proxy.ts` matches only `/seller`, `/admin`, `/account`; it never sees `/api/v1/internal/*`. Global security headers apply.
- **Log leakage.** The handler logs a fixed message with no request data; the logger also redacts the `authorization` key and `Bearer <token>` text. Test: three requests (right, longer, prefix) leave no 16-character prefix of the secret in stdout. Response body holds counts only (strict Zod schemas).
- **Env.** `CRON_SECRET` 32 to 256 printable ASCII, must differ from `AUTH_SECRET`, production refuses the placeholder marker and weak values, required in production when `MAINTENANCE_VIA_HTTP=true`. `MAINTENANCE_VIA_HTTP` is exactly `true`/`false`.
- **`MAINTENANCE_VIA_HTTP=false` with `CRON_SECRET` set.** The endpoint still works next to the timers. Documented by design (API_CONTRACTS env table); overlap safety reasoned from the jobs (guarded failure transaction, `SKIP LOCKED`, `deleteMany`), not re-tested here.
- **Replay / repeated calls.** No request input reaches any job: the timeout comes from env, the cleanup keeps its grace period, the purge deletes expired rows only. A replayed valid request only runs the jobs early. One run per process at a time (`runMaintenanceOnce`). Only a secret holder can trigger work.
- **Workflow.** `permissions: {}`, no `uses:` (no third-party action, not even checkout), no `${{ }}` inside `run:` (secrets only via `env:`, no expression injection), triggers are `schedule` and `workflow_dispatch` only (no fork PR path to secrets), `https://` required, no redirect following, the secret goes to curl on stdin, `concurrency` prevents overlapping runs. At `bc3717a`: no `--retry`, `--max-time 75` above `maxDuration = 60`.
- **Upload limit.** `MAX_UPLOAD_FILE_BYTES = 4,194,304`; `MAX_UPLOAD_BODY_BYTES = 4,210,688` < 4,500,000 (and < 4.5 MiB). The seller UI pre-check uses the same constant.

## Findings

### SEC-097 CRON_SECRET may hold characters that the workflow's curl config string alters
Severity: Low
Status: OPEN
Owner: devops (workflow) or backend-api (`src/server/env.ts` rule)
Location: .github/workflows/maintenance.yml:52; src/server/env.ts (`CRON_SECRET_PATTERN = /^[!-~]+$/`)
Description: the workflow writes `header = "Authorization: Bearer %s"` into a curl config read from stdin. Inside double quotes curl ends the value at `"` and treats `\` as an escape (`\t` becomes a tab, `\x` drops the backslash). The env rule accepts both characters, so an operator-chosen secret containing them is sent altered and every scheduled call gets `401`. With `--fail-with-body` the run turns red, so the failure is visible; the impact is availability of the scheduled jobs (SEC-055 control), not exposure. The logger's Bearer mask alphabet (`[A-Za-z0-9._~+/=-]`) is also narrower than the env alphabet; the secret is not logged today, so this is defence in depth only. The documented generator (`openssl rand -base64 48`) produces safe characters.
Reproduction: Git Bash, local echo server printing the received `Authorization`:
`printf 'header = "Authorization: Bearer %s"\n' "$S" | curl --silent -X POST --config - http://127.0.0.1:$P/`
`Abc123def456"ghi789jkl012mno345pq` arrived as `Bearer Abc123def456`; `Abc123def456\tghi...` arrived with a tab; `Abc123def456\ghi...` arrived without the backslash. Test: `tests/security/d051-maintenance.test.ts`, describe "SEC-097" (`it.fails` env rule refuses `"` and `\`).
Remediation: restrict `CRON_SECRET_PATTERN` to the base64/base64url alphabet (`^[A-Za-z0-9+/=_-]+$`), which also matches the logger's Bearer mask; or escape `\` and `"` before `printf` in the workflow. The first is simpler and closes both points.
Re-check evidence: none yet.

### SEC-098 The workflow re-sent the maintenance POST on 5xx and on timeout
Severity: Low
Status: FIXED (re-checked 2026-10-30)
Owner: devops
Location: .github/workflows/maintenance.yml:53 (at `4e38a16`: `--max-time 60 --retry 2`)
Description: curl `--retry` re-sends on a timeout and on HTTP 408, 429, 500, 502, 503, 504. The endpoint answers `500` when any job fails, so a persistent job failure re-ran all three jobs three times per tick; and `--max-time 60` equal to `maxDuration = 60` could abort the client while the server run continued, then start an overlapping run. Overlap is designed to be safe, so the impact was load and noise.
Reproduction: static, `tests/security/d051-maintenance.test.ts`, describe "SEC-098".
Remediation: drop `--retry`; client timeout above `maxDuration`.
Re-check evidence: commit `bc3717a` (devops, landed during this review) removed `--retry` and set `--max-time 75`. `pnpm exec vitest run --project security tests/security/d051-maintenance.test.ts`: the two SEC-098 cases (no `--retry`; `--max-time` 75 > `maxDuration` 60) pass as plain `it`.

### SEC-099 Refused maintenance requests are not rate limited, and their log line obeys LOG_LEVEL
Severity: Low
Status: OPEN
Owner: backend-api
Location: src/app/api/v1/internal/maintenance/route.ts:35-38
Description: any anonymous client on the internet can POST to the endpoint as often as it likes. Every refusal writes one `warn` line ("Maintenance request refused") through `log.warn`, with no rate limit counting it and no suppression. Two consequences: (1) log volume is attacker-controlled (each request is cheap for both sides: two SHA-256 of at most 263 bytes, no database), the same class as SEC-026; (2) with `LOG_LEVEL=error`, which production accepts, every refusal disappears, so guessing attempts against a machine credential leave no trace. SECURITY.md SR-04 rule (4) says a client-causable security event is "bounded by the rate limit that counts it, not by `LOG_LEVEL`". Brute force itself is not practical (at least 32 random printable characters, production weak-value rules), which is why this is Low.
Reproduction: `tests/security/d051-maintenance.test.ts`, describe "SEC-099": 200 refused requests give 200 `401` answers and 200 refusal lines (flipped: `expected false to be true`); the route source has no `security("warn", ...)` call (flipped: `expected '/**\n * POST ...' to match ...`).
Remediation: count refusals in the existing rate limiter (for example a `maintenance-refused` rule keyed by client IP, answer `429` past it) and write the refusal through `log.security("warn", ...)` so it is bounded by that limit rather than by `LOG_LEVEL`; or, at minimum, the same once-per-interval suppression with a `suppressed` count that the health check uses (SEC-026).
Re-check evidence: none yet.

### SEC-100 A scheduler that stops calling the endpoint goes unnoticed, and the workflow passes when its secrets are missing
Severity: Medium
Status: OPEN
Owner: devops (workflow, monitoring) with backend-api (a liveness signal)
Location: .github/workflows/maintenance.yml:39-42; src/instrumentation.ts (no timer when `MAINTENANCE_VIA_HTTP=true`); src/server/health.ts (no maintenance signal)
Description: with `MAINTENANCE_VIA_HTTP=true` the payment timeout sweep, upload cleanup, and session purge run only when GitHub calls the endpoint. That is the SEC-055 control (unpaid orders hold stock until the sweep fails them). Three ordinary events stop it with nothing turning red: (1) the `MAINTENANCE_URL` or `CRON_SECRET` repository secret is deleted, renamed, or never set after deployment: the job prints a notice and `exit 0`, green; (2) GitHub disables the schedule after 60 days without repository activity; (3) GitHub delays or skips scheduled runs. Nothing in the application records when maintenance last succeeded, so neither the health endpoint nor a log alert can show it. DEPLOYMENT.md documents (2) and (3) and asks for manual check queries, but no automatic signal exists. Impact: stock held by abandoned `PENDING` orders is never released (availability and stock integrity), exactly the SEC-055 failure mode, silently. Medium because it depends on deployment configuration and needs no attacker, but an attacker who notices can exploit it by placing unpaid orders.
Reproduction: `tests/security/d051-maintenance.test.ts`, describe "SEC-100": the skip branch contains `exit 0` (flipped: `expected 'if [ -z "${MAINTENANCE_URL}" ] ...' not to match /exit 0/`); `src/server/health.ts` holds no maintenance or sweep signal (flipped: `... to match /maintenance|sweep|lastRun/i`).
Remediation: (a) make the skip conditional on a repository variable that says nothing is deployed yet (for example `vars.MAINTENANCE_ENABLED != 'true'` skips, otherwise missing secrets `exit 1`), so a deployed setup with a lost secret fails red; (b) record the time of the last successful maintenance run (a small table row or the newest `failedAt`/purge time) and have the health check, or a `security("error", ...)` line, report when it is older than about 30 minutes; (c) add an external alert on the GitHub workflow failing or not running. (a) is required before relying on `MAINTENANCE_VIA_HTTP=true`; (b) or (c) is recommended.
Re-check evidence: none yet.

### SEC-101 The database still allows 5 MiB uploads after the application limit became 4 MiB
Severity: Low
Status: OPEN
Owner: database
Location: prisma/migrations/20261011121529_init_schema_v1/migration.sql:591 (`CHECK ("sizeBytes" BETWEEN 1 AND 5242880)`); tests/integration/schema/check-constraints.test.ts:166-170
Description: `MAX_UPLOAD_FILE_BYTES` was lowered to 4,194,304 in `dc8aeaf`, but the `Upload_sizeBytes_check` constraint still accepts up to 5,242,880. The application enforces the new limit (reader, schema, seller UI), so this is not exploitable today; the constraint is the second line that would catch a code path that skips the reader, and it now lags by 1 MiB. Hygiene. Also cosmetic: the Thai text says "4 MB" for 4 MiB; files from 4,000,001 to 4,194,304 bytes are accepted though the label suggests otherwise (lenient direction, no security impact).
Reproduction: `tests/security/d051-maintenance.test.ts`, describe "SEC-101" (flipped: `expected 5242880 to be 4194304`).
Remediation: a migration that replaces the check with `BETWEEN 1 AND 4194304` (after confirming no existing row exceeds it), and update `check-constraints.test.ts`.
Re-check evidence: none yet.

## Not reviewed / residual risks

- Not run: the integration test `tests/integration/maintenance/endpoint.test.ts` and any real `next start` or deployment of the endpoint; nothing is deployed. Behaviour of the platform (Vercel) body limit, `maxDuration`, and header limits was taken from the code comments, not measured.
- Not re-verified: the overlap safety of the three jobs under concurrent runs across instances (the reasoning in `service.ts` was read; the jobs' own earlier reviews, SEC-055, SEC-065, SEC-073, are relied on).
- Not run: a secret scan (gitleaks not installed) and `pnpm audit` (no dependency change in range).
- Deployment-dependent: the strength and storage of `CRON_SECRET` in the host and in GitHub secrets; who has repository write access (any of them can run `workflow_dispatch` and read the run log, which shows counts only); TLS of `MAINTENANCE_URL`; whether `MAINTENANCE_VIA_HTTP=true` is set where timers cannot run, and `false` where they can.
- Accepted by design (API_CONTRACTS env table): the endpoint stays usable when `MAINTENANCE_VIA_HTTP=false` and `CRON_SECRET` is set.
