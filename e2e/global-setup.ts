/**
 * Prepares the end-to-end database and the signed-in seller state, once per run.
 *
 * 1. Runs the committed migrations on `marketplace_e2e` (Prisma creates the database when it is
 *    missing; the URL is built in support/environment.ts and names no other database).
 * 2. Empties every application table, so a run never depends on the one before.
 * 3. Registers the seller through the real sign-up endpoint.
 * 4. Promotes that user and gives it an approved store and products through the test factories.
 * 5. Signs in through the real sign-in endpoint and saves the session cookie for the specs.
 *
 * Step 4 uses the factories because the application's own seller onboarding is an end-to-end
 * journey of its own (journey 6), not a precondition of this check. Steps 1, 2, and 4 run as
 * child processes with the end-to-end DATABASE_URL (see tests/e2e-support/database.ts for why).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { request } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_ORIGIN, SELLER, SELLER_STORAGE_STATE } from "./support/environment";

function run(args: string[]): void {
  execFileSync("pnpm", ["exec", ...args], {
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: "pipe",
    shell: true,
  });
}

export default async function globalSetup(): Promise<void> {
  run(["prisma", "migrate", "deploy"]);
  run(["tsx", "tests/e2e-support/database.ts", "empty"]);

  const api = await request.newContext({
    baseURL: E2E_ORIGIN,
    extraHTTPHeaders: { Origin: E2E_ORIGIN },
  });
  try {
    const signUp = await api.post("/api/v1/auth/sign-up", { data: SELLER });
    if (!signUp.ok()) {
      throw new Error(`e2e setup: sign-up answered ${signUp.status()}`);
    }
    run(["tsx", "tests/e2e-support/database.ts", "seed"]);

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
