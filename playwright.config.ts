import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { E2E_DATABASE_URL, E2E_ORIGIN, E2E_PORT, E2E_UPLOAD_DIR } from "./e2e/support/environment";
import { e2eServerCommand, e2eServerEnvironment } from "./e2e/support/server-environment";

// The suite registers many users from one address; the default limit is 5 sign-ups per hour.
// Passed through webServer.env only (CR-S116-03): the Playwright runner process and its workers
// never get it. src/server/env.ts and getAuthRuntime refuse it when NODE_ENV=production.
const SIGN_UP_RATE_LIMIT = "1000";

/**
 * Playwright configuration (T-060, first part: the stacked Table check, CR-118).
 *
 * The suite runs against its own database (`marketplace_e2e` on the local db-test container),
 * created and migrated by `e2e/global-setup.ts`, and against its own `next dev` server on a port
 * that is not the development port. Neither touches the development database or the integration
 * databases. Run with `pnpm test:e2e`; needs the db-test container (`docker compose up -d db-test`)
 * and the Chromium browser (`pnpm exec playwright install chromium`).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: e2eServerCommand(),
    // Wait for the port, not /api/health: the health route needs the database, which
    // global-setup creates after the server is listening.
    port: E2E_PORT,
    reuseExistingServer: false,
    timeout: 180_000,
    // AUTH_SECRET is generated per run and never logged (SEC-075).
    env: {
      ...e2eServerEnvironment({
        databaseUrl: E2E_DATABASE_URL,
        origin: E2E_ORIGIN,
        uploadDir: E2E_UPLOAD_DIR,
        authSecret: randomBytes(32).toString("hex"),
      }),
      SIGN_UP_RATE_LIMIT,
    },
  },
});
