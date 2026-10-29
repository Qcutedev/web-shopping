# Staging runbook

Owner: devops agent. **Status: the image build and a local container run are exercised (see "What was run"). Nothing is deployed: no hosting provider is chosen, there is no staging URL, and no step below that touches a host has been run.** Backup, restore, rollback, logs, and the production checklist are in [DEPLOYMENT.md](DEPLOYMENT.md); this file does not repeat them. Task status is in [STATUS.md](STATUS.md).

Staging always goes before production. Production needs explicit human approval recorded in [DECISIONS.md](DECISIONS.md) before any step of this runbook is run against it.

## The image

[`Dockerfile`](../Dockerfile), two targets built from one file:

| Target | Used for | Holds | Receives |
| --- | --- | --- | --- |
| `runtime` (default) | Serving requests | Production dependencies only (`pnpm install --prod --ignore-scripts`), `.next`, the generated Prisma client, `next.config.ts`. No `prisma` CLI, no development dependency, no `.env`. Runs as `node` (uid 1000), `next start` on port 3000 | All variables of "Environment variables" in DEPLOYMENT.md |
| `migrate` | `prisma migrate deploy`, one-off ops scripts | Full dependencies and source, with the schema engine already inside the image (fetched at build time). Never serves requests | `DATABASE_URL` only |

Rules the Dockerfile follows (CR-16): the build uses the full install so `postinstall` runs `prisma generate`; the runtime stage skips scripts and takes the generated client from the build stage instead of generating it; migrations never run from the runtime image; the migration step downloads nothing. Base image `node:24.20.0-bookworm-slim` is pinned by digest (D-020). The standalone output is not used: `next.config.ts` does not set it, and the production-only install gives the same separation without changing that file.

### Build arguments and variables

- `APP_URL` is a **build argument and a run-time variable, and the two must be equal.** `headers()` in `next.config.ts` runs during `next build` and the result is stored in the build output, so the CSP directive `upgrade-insecure-requests` (T-072, D-046) is present only when the build saw an `https://` `APP_URL`. At run time `APP_URL` is also the allowed origin of the `Origin` check. Staging and production use `https://`. It is a public URL, not a secret.
- `NODE_ENV=production` is set in the image. Production rules of `src/server/env.ts` therefore apply to staging too (no placeholder passwords, `TRUSTED_PROXY_HOPS` and `UPLOAD_DIR` required, `DATABASE_URL_TEST` forbidden). This is intended: staging proves the production configuration.
- `UPLOAD_DIR` defaults to `/data/uploads` and is declared a volume. **Mount a persistent volume there**; without one, uploads are lost on every redeploy. Single instance only (DEPLOYMENT.md, "Uploaded files").
- No secret is read at build time and none is written into an image layer. Pass `DATABASE_URL` and `AUTH_SECRET` as environment variables or the host's secret mechanism when the container starts. Never pass them as build arguments (they would be recorded in the image history).
- Container port 3000. `HOSTNAME=0.0.0.0` is set so the port is reachable from outside the container; publish it only to the reverse proxy (DEPLOYMENT.md, "Reverse proxy conditions").

### Health check

The image has a `HEALTHCHECK` that requests `GET /api/health` on the container's own port: healthy means the process is up and the database answers (200); a database outage gives 503 and the container turns unhealthy. The body carries no version or configuration.

## Steps (staging)

Placeholders: `<registry>/marketplace` is the image name of the chosen registry, `<tag>` the commit hash, `<staging-url>` the https origin. None exists yet.

1. **Checks pass on the commit.** `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, and the CI run (`.github/workflows/ci.yml`: jobs `verify`, `integration`, `e2e`, `audit`, `secret-scan`). The workflow ran green on GitHub (run 40889555775, 2026-10-29); check that the run for the commit being deployed is green too. CI does not build or push images. Check [SECURITY.md](SECURITY.md) for open Critical or High findings (**Manual**).
2. **Build both images from a clean checkout**, with the staging origin:

   ```powershell
   docker build --target runtime --build-arg APP_URL=<staging-url> -t <registry>/marketplace:<tag> .
   docker build --target migrate --build-arg APP_URL=<staging-url> -t <registry>/marketplace-migrate:<tag> .
   ```

3. **Back up the staging database** (DEPLOYMENT.md, "Database backups"). Migrations are forward-only: a failed or wrong migration is repaired by a restore, not by a down migration (DEPLOYMENT.md, "Rollback").
4. **Apply migrations** with the migrate image. It needs the database and nothing else:

   ```powershell
   docker run --rm -e DATABASE_URL=<value from the secret store> <registry>/marketplace-migrate:<tag>
   ```

   Must exit 0. The same image and command are used on production after approval.
5. **Start the runtime image** with the variables of "Environment variables", `APP_URL=<staging-url>` (equal to the build argument), and the upload volume mounted at `/data/uploads`. A bad configuration stops the process with exit code 1 and one log line naming the variable.
6. **Verify**, from outside the host:

   ```powershell
   curl.exe --silent --show-error --write-out "`n%{http_code}`n" "<staging-url>/api/health"
   curl.exe --silent --show-error --output NUL --write-out "%{http_code}`n" "<staging-url>/"
   curl.exe --silent --head "<staging-url>/"
   ```

   Health must print `{"status":"ok","database":"up"}` and `200`; the read path `200`; the headers must include `content-security-policy` (with `upgrade-insecure-requests`), `strict-transport-security`, `x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy`, `cross-origin-opener-policy`, and no `x-powered-by`.
7. **Reverse proxy and hops.** Set `TRUSTED_PROXY_HOPS` to the real number and confirm it as in DEPLOYMENT.md ("Reverse proxy conditions", **Manual**).
8. **Scheduled work** runs in the server process (DEPLOYMENT.md, "Scheduled work"): the host must not stop an idle container.
9. **First admin**, if the staging database has none: run `scripts/bootstrap-admin.ts` from the `migrate` image (full dependencies, `tsx`), with the bootstrap variables for that one run only. **Not yet run in a container.**
10. **Record** the release in the release log of DEPLOYMENT.md and set the staging row of STATUS.md only after step 6 passed on the real host.

### Rollback of the application

Redeploy the previous image tag. This is safe only while the database schema is compatible with the old code. A migration that has been applied cannot be rolled back (forward-only); schema changes must therefore be written so the previous version still works (expand, then contract in a later release). If that is not possible, restore the pre-release backup (DEPLOYMENT.md, "Restore procedure"), which also discards data written since.

## Local check of the image

[`scripts/container-smoke.ps1`](../scripts/container-smoke.ps1) does steps 2, 4, 5, and 6 locally with a throwaway PostgreSQL and generated secrets, then removes everything. It deploys nothing and pushes nothing.

```powershell
powershell -NoProfile -File scripts/container-smoke.ps1
```

The Docker build ignores the local `.next` and `node_modules`, so it is safe to run while `pnpm dev` or `pnpm build` is running. It uses host port 3217.

## What was run (2026-10-26, Windows 11, Docker 29.8.2)

`scripts/container-smoke.ps1` exited 0 ("SMOKE OK"). Observed: both images build; `prisma migrate deploy` applies the 3 committed migrations to an empty PostgreSQL 18 on a Docker network with **no route to the internet**; the runtime container started as uid 1000 with `NODE_ENV=production` and an `https://` `APP_URL`; `GET /api/health` returned `200` and `{"status":"ok","database":"up"}`; `GET /` returned `200`; the CSP (with `upgrade-insecure-requests`), HSTS, nosniff, frame, referrer, permissions, and cross-origin-opener headers were present and `x-powered-by` was absent; there is no `prisma` CLI and no `.env` file in the runtime image; the Docker `HEALTHCHECK` reported `healthy`.

Not run: any deployment, a registry push, a persistent upload volume, the first-admin script in a container, a read path that needs data (the database is empty), the multi-platform (arm64) build, an image vulnerability scan (none is chosen), a secret scan of the image layers.

## Open points for the owner

- No hosting provider or registry is chosen (DEPLOYMENT.md, "Hosting options to decide"). Steps 3, 5, 7, 8 and 10 depend on that choice.
- The runtime image carries all production `node_modules` (not the traced subset). `output: "standalone"` in `next.config.ts` would shrink it; it is optional and is a change to an orchestrator-owned file.
