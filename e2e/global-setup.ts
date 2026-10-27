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
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { request } from "@playwright/test";

import {
  ADMIN,
  ADMIN_STORAGE_STATE,
  SELLER_TWO,
  SELLER_TWO_STORAGE_STATE,
} from "./support/accounts";
import { PRISMA_CLI, TSX_CLI, childEnvironment, run } from "./support/child-steps";
import { assertServerShowsCanary, newCanarySlug } from "./support/server-identity";
import {
  E2E_BASE_DATABASE,
  E2E_DATABASE_URL,
  E2E_ORIGIN,
  E2E_UPLOAD_DIR,
  REPO_ROOT,
  SELLER,
  SELLER_STORAGE_STATE,
} from "./support/environment";

const DATABASE_STEPS = resolve(REPO_ROOT, "tests/e2e-support/database.ts");
const EXTRA_SEED_STEP = resolve(REPO_ROOT, "tests/e2e-support/seed-extra.ts");

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
    // The admin and the second seller sign up through the real endpoint too; the extra seed then
    // promotes them and gives the second seller a store (tests/e2e-support/seed-extra.ts).
    for (const account of [ADMIN, SELLER_TWO]) {
      const response = await api.post("/api/v1/auth/sign-up", { data: account });
      if (!response.ok()) {
        throw new Error(`e2e setup: sign-up of ${account.name} answered ${response.status()}`);
      }
    }
    run("seed", TSX_CLI, [DATABASE_STEPS, "seed"], e2eEnv);
    run("seed extra", TSX_CLI, [EXTRA_SEED_STEP], e2eEnv);
  } finally {
    await api.dispose();
  }
  // Roles are read from the database on each request, but a fresh sign-in per account keeps the
  // saved state free of cookies from the sign-up calls above.
  await saveSignedInState(SELLER, SELLER_STORAGE_STATE);
  await saveSignedInState(ADMIN, ADMIN_STORAGE_STATE);
  await saveSignedInState(SELLER_TWO, SELLER_TWO_STORAGE_STATE);
}

async function saveSignedInState(
  account: { email: string; password: string },
  path: string,
): Promise<void> {
  const api = await request.newContext({
    baseURL: E2E_ORIGIN,
    extraHTTPHeaders: { Origin: E2E_ORIGIN },
  });
  try {
    const signIn = await api.post("/api/v1/auth/sign-in", {
      data: { email: account.email, password: account.password },
    });
    if (!signIn.ok()) {
      throw new Error(`e2e setup: sign-in answered ${signIn.status()}`);
    }
    mkdirSync(dirname(path), { recursive: true });
    // Written pretty-printed so that `pnpm format:check`, which reads the file, accepts it.
    const state = await api.storageState();
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  } finally {
    await api.dispose();
  }
}
