/**
 * Prepares the end-to-end database and the signed-in seller state, once per run.
 *
 * 0. Loading ./support/environment validates DATABASE_URL_TEST with the integration suite's rules
 *    (tests/helpers/test-database-url.ts) before anything below runs (CR-128).
 * 1. `check`: a child process connects to the validated test database, asks the database driver
 *    what it reads from the URL, and asks the server which database and user it reached. Nothing
 *    is created or migrated before this passes.
 * 2. Runs the committed migrations on `marketplace_e2e` (Prisma creates the database when it is
 *    missing; the URL differs from DATABASE_URL_TEST only in the database name).
 * 3. Empties every application table, so a run never depends on the one before.
 *    Then proves that the server on the e2e origin reads that database, with a canary category
 *    read through the public category list (SEC-077), before any request that writes.
 * 4. Registers the seller through the real sign-up endpoint.
 * 5. Promotes that user and gives it an approved store and products through the test factories.
 * 6. Signs in through the real sign-in endpoint and saves the session cookie for the specs.
 *
 * Step 5 uses the factories because the application's own seller onboarding is an end-to-end
 * journey of its own (journey 6), not a precondition of this check. Steps 1, 2, 3, and 5 run as
 * child processes (see tests/e2e-support/database.ts for why). Their environment has no PG*
 * variable and no DATABASE_URL_TEST, from the process or from `.env` (CR-41).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { request } from "@playwright/test";

import { redactConnectionSecrets } from "../tests/helpers/migrate-output";
import { inheritedDatabaseVariableNames } from "../tests/helpers/test-database-url";
import { assertServerShowsCanary, newCanarySlug } from "./support/server-identity";
import {
  E2E_BASE_DATABASE,
  E2E_DATABASE_URL,
  E2E_ORIGIN,
  E2E_UPLOAD_DIR,
  REPO_ROOT,
  SELLER,
  SELLER_STORAGE_STATE,
  readEnvFile,
} from "./support/environment";

/** Longest time one child step may take. `prisma migrate deploy` on an empty database takes seconds. */
const STEP_TIMEOUT_MS = 120_000;

const SECRET_URLS = [E2E_BASE_DATABASE.baseUrl, E2E_DATABASE_URL];

function childEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of inheritedDatabaseVariableNames(env)) {
    delete env[name];
  }
  // prisma7.config.ts loads `.env` without overriding a variable that is already set, so the
  // names the file holds (PG* and DATABASE_URL_TEST) are set to empty for the child, as the
  // integration setup does.
  for (const name of inheritedDatabaseVariableNames(readEnvFile())) {
    env[name] = "";
  }
  env["DATABASE_URL"] = databaseUrl;
  return env;
}

/** Runs `node <script> <args>` without a shell; failure text has the URLs' secrets removed (CR-29). */
function run(label: string, script: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [resolve(script), ...args], {
    env,
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: STEP_TIMEOUT_MS,
    killSignal: "SIGKILL",
    windowsHide: true,
  });
  if (result.status === 0 && result.error === undefined && result.signal === null) return;
  const facts = [
    result.status === null ? "no exit status" : `exit ${result.status}`,
    ...(result.signal !== null ? [`signal ${result.signal}`] : []),
    ...(result.error !== undefined ? [`error: ${result.error.message}`] : []),
  ].join("; ");
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  throw new Error(
    redactConnectionSecrets(
      `e2e setup: ${label} failed (${facts}).${output === "" ? "" : `\n${output}`}`,
      SECRET_URLS,
    ),
  );
}

const requireFromRepo = createRequire(join(REPO_ROOT, "package.json"));

/** Absolute path of a package's command-line entry, as its own `bin` field names it (CR-148). */
function binPath(packageName: string, binName: string): string {
  const manifestPath = requireFromRepo.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const relative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (relative === undefined) throw new Error(`e2e setup: ${packageName} has no bin ${binName}`);
  return resolve(dirname(manifestPath), relative);
}

const PRISMA_CLI = binPath("prisma", "prisma");
const TSX_CLI = binPath("tsx", "tsx");
const DATABASE_STEPS = resolve(REPO_ROOT, "tests/e2e-support/database.ts");

export default async function globalSetup(): Promise<void> {
  const e2eEnv = childEnvironment(E2E_DATABASE_URL);
  run(
    "server check",
    TSX_CLI,
    [DATABASE_STEPS, "check"],
    childEnvironment(E2E_BASE_DATABASE.baseUrl),
  );
  run("prisma migrate deploy", PRISMA_CLI, ["migrate", "deploy"], e2eEnv);
  run("empty", TSX_CLI, [DATABASE_STEPS, "empty"], e2eEnv);
  // SEC-075: the e2e upload root is emptied with the tables, so no file outlives its row.
  rmSync(E2E_UPLOAD_DIR, { recursive: true, force: true });
  mkdirSync(E2E_UPLOAD_DIR, { recursive: true });

  // SEC-077: prove the server on the origin reads the e2e database before anything is sent to it
  // that writes. The canary is removed by the seed step.
  const canarySlug = newCanarySlug();
  run("canary", TSX_CLI, [DATABASE_STEPS, "canary", canarySlug], e2eEnv);

  const api = await request.newContext({
    baseURL: E2E_ORIGIN,
    extraHTTPHeaders: { Origin: E2E_ORIGIN },
  });
  try {
    await assertServerShowsCanary(async () => {
      const response = await api.get("/api/v1/categories");
      return { status: response.status(), body: await response.text() };
    }, canarySlug);
    const signUp = await api.post("/api/v1/auth/sign-up", { data: SELLER });
    if (!signUp.ok()) {
      throw new Error(`e2e setup: sign-up answered ${signUp.status()}`);
    }
    run("seed", TSX_CLI, [DATABASE_STEPS, "seed"], e2eEnv);

    const signIn = await api.post("/api/v1/auth/sign-in", {
      data: { email: SELLER.email, password: SELLER.password },
    });
    if (!signIn.ok()) {
      throw new Error(`e2e setup: sign-in answered ${signIn.status()}`);
    }
    mkdirSync(dirname(SELLER_STORAGE_STATE), { recursive: true });
    // Written pretty-printed so that `pnpm format:check`, which reads the file, accepts it.
    const state = await api.storageState();
    writeFileSync(SELLER_STORAGE_STATE, `${JSON.stringify(state, null, 2)}\n`);
  } finally {
    await api.dispose();
  }
}
