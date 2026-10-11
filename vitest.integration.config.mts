import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// How many test files run at the same time. Each running file needs its own database, so this
// number is both Vitest's `maxWorkers` and the number of databases the global setup creates:
// global-setup.ts reads the resolved value from the project configuration and hands it to every
// worker, so the number is written in this one place (and `--maxWorkers` on the command line
// changes both together). Measured values are in docs/TEST_STRATEGY.md ("Integration harness as
// built").
const INTEGRATION_MAX_WORKERS = 4;

// Integration tests: real PostgreSQL, no mock of the database layer. Run with
// `pnpm test:integration`; needs the `db-test` container (docker compose up -d --wait).
//
// The unit run (`pnpm test`, vitest.config.mts) does not include tests/integration, and
// `pnpm verify` does not run this config, so neither needs a database.
//
// Isolation (docs/TEST_STRATEGY.md, "Test database reset under parallel files"):
// - global-setup.ts refuses any database but the local test one, refuses to start while another
//   integration run holds the run lock, migrates a template database, and creates one database
//   per worker from it;
// - worker-env.ts points DATABASE_URL at the worker's database before `@/server/db` is loaded;
// - worker-hooks.ts empties that database before the first test of every file.
// A worker runs one file at a time, so no two files ever share a database at the same moment.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    name: "integration",
    environment: "node",
    include: [
      "tests/integration/**/*.test.ts",
      // Security tests that need the database (owner: security). The suffix keeps them out of
      // the unit run, whose pattern is tests/security/**/*.test.ts.
      "tests/security/**/*.itest.ts",
    ],
    globalSetup: ["tests/integration/setup/global-setup.ts"],
    setupFiles: [
      "tests/integration/setup/worker-env.ts",
      "tests/integration/setup/worker-hooks.ts",
    ],
    pool: "forks",
    maxWorkers: INTEGRATION_MAX_WORKERS,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
