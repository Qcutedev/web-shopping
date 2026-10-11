/**
 * First setup file of every integration test file. It runs before the test file and before
 * worker-hooks.ts, and it must not import anything that loads `@/server/db`: the database
 * client is created at import from DATABASE_URL and is one per process.
 *
 * It points DATABASE_URL at the database of this worker. If the global setup did not run, or the
 * worker id is not one a database was created for, it throws, and no client is ever created.
 */
import { inject } from "vitest";

import { workerDatabaseUrl } from "../../helpers/test-database-url";

const database = inject("integrationDatabase");
if (database === undefined) {
  throw new Error(
    "The integration global setup did not provide a test database. Run the suite with `pnpm test:integration`.",
  );
}

const poolId = Number(process.env["VITEST_POOL_ID"]);
if (!Number.isInteger(poolId) || poolId < 1 || poolId > database.workerCount) {
  throw new Error(
    `VITEST_POOL_ID is not between 1 and ${database.workerCount}; no database exists for this worker.`,
  );
}

process.env["DATABASE_URL"] = workerDatabaseUrl(database.baseUrl, database.baseName, poolId);
// The test database URL of the environment is not needed by any test, and the development one
// must not be reachable from a test by accident.
delete process.env["DATABASE_URL_TEST"];
