import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_ORIGIN, E2E_PORT } from "./e2e/support/environment";

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
    command: `pnpm exec next dev --port ${E2E_PORT}`,
    // Wait for the port, not /api/health: the health route needs the database, which
    // global-setup creates after the server is listening.
    port: E2E_PORT,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      APP_URL: E2E_ORIGIN,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
