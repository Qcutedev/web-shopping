/**
 * Runs once, in the main Vitest process, before any worker starts.
 *
 * 1. Refuses to continue unless DATABASE_URL_TEST names the local test database
 *    (tests/helpers/test-database-url.ts). Nothing is connected to before that check passes.
 * 2. Sets DATABASE_URL of this process to the test URL, so that nothing started from here can
 *    inherit the development URL.
 * 3. Connects, asks the server which database and user it reached, and refuses to continue when
 *    the answer is not what DATABASE_URL_TEST names. Only reads happen before this check passes.
 * 4. Takes the run lock on the base test database (tests/helpers/run-lock.ts) and refuses to
 *    continue when another integration run holds it. Nothing is dropped before the lock is held,
 *    and it is held until the teardown this function returns has run. The teardown fails the run
 *    when the lock was lost on the way.
 * 5. Recreates the template database and applies the migrations to it with
 *    `prisma migrate deploy`.
 * 6. Recreates one database per worker as a copy of the template.
 *
 * The test PostgreSQL keeps its data in memory, so nothing is assumed to exist from an earlier
 * run, and everything this file creates is dropped and created again on every run.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

import type { TestProject } from "vitest/node";

import { describeMigrateFailure } from "../../helpers/migrate-output";
import { acquireRunLock, type RunLock } from "../../helpers/run-lock";
import { quoteIdentifier } from "../../helpers/sql";
import {
  assertConnectedToTestDatabase,
  assertNoDriverEnvironmentOverride,
  resolveTestDatabase,
  staleWorkerDatabaseNames,
  workerDatabaseName,
  type ConnectedTarget,
  type TestDatabase,
} from "../../helpers/test-database-url";

/** Longest time `prisma migrate deploy` may take on the template database. It takes about 1.5 s. */
const MIGRATE_TIMEOUT_MS = 120_000;

declare module "vitest" {
  export interface ProvidedContext {
    /**
     * The validated test database, handed to every worker by the global setup. `workerCount` is
     * the number of worker databases that exist (`maxWorkers` of vitest.integration.config.mts).
     */
    integrationDatabase: { baseUrl: string; baseName: string; workerCount: number };
  }
}

/**
 * Reads `.env` without putting anything into `process.env`: the file also holds the development
 * DATABASE_URL, which must not become the environment of a test worker.
 */
function readEnvFile(): Record<string, string | undefined> {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) {
    return {};
  }
  return parseEnv(readFileSync(path, "utf8"));
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function migrateTemplate(database: TestDatabase): void {
  const cli = resolve(process.cwd(), "node_modules/prisma/build/index.js");
  // prisma7.config.ts reads DATABASE_URL and never overrides a variable that is already set.
  // The time limit stops the CLI process itself. On Windows a process it started (the schema
  // engine) is not stopped with it; that one ends when its pipes close.
  const result = spawnSync(process.execPath, [cli, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: database.templateUrl },
    encoding: "utf8",
    timeout: MIGRATE_TIMEOUT_MS,
    killSignal: "SIGKILL",
    windowsHide: true,
  });
  const failure = describeMigrateFailure(
    {
      status: result.status,
      signal: result.signal,
      errorMessage: result.error?.message,
      stdout: result.stdout,
      stderr: result.stderr,
    },
    [database.baseUrl, database.templateUrl],
    MIGRATE_TIMEOUT_MS,
  );
  if (failure !== undefined) {
    throw new Error(failure);
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // One database per worker: the resolved `maxWorkers` is the highest VITEST_POOL_ID there can be.
  const workerCount = project.config.maxWorkers;
  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error("The integration configuration has no usable maxWorkers value.");
  }

  const fileEnv = readEnvFile();
  // Variables the driver applies on top of any URL. The `.env` file is checked too: it is not
  // loaded into this process, but prisma7.config.ts loads it into the migration CLI.
  assertNoDriverEnvironmentOverride(process.env, "the environment");
  assertNoDriverEnvironmentOverride(fileEnv, "the .env file");
  const database = resolveTestDatabase({
    testUrl: nonEmpty(process.env["DATABASE_URL_TEST"]) ?? nonEmpty(fileEnv["DATABASE_URL_TEST"]),
    otherUrls: [process.env["DATABASE_URL"], fileEnv["DATABASE_URL"]],
  });

  // From here on the only database URL this process and its children know is a test one.
  process.env["DATABASE_URL"] = database.baseUrl;
  const { db } = await import("@/server/db");

  const startedAt = performance.now();
  let runLock: RunLock | undefined;
  try {
    let connected: ConnectedTarget[];
    try {
      connected = await db.$queryRawUnsafe<ConnectedTarget[]>(
        `SELECT current_database()::text AS "database", session_user::text AS "sessionUser", current_user::text AS "currentUser"`,
      );
    } catch {
      throw new Error(
        "The test database named by DATABASE_URL_TEST cannot be reached. Start it with `docker compose up -d --wait`.",
      );
    }
    // Before the lock and before anything is dropped, created, or migrated: the server says
    // which database and user this connection reached. Throws TestDatabaseRefusedError.
    assertConnectedToTestDatabase(
      database,
      connected[0] ?? { database: undefined, sessionUser: undefined, currentUser: undefined },
    );

    // Before anything is dropped: a second run at the same time would destroy the databases of
    // the first. Throws ConcurrentRunError when another run holds the lock.
    runLock = await acquireRunLock(db);

    // Names come from resolveTestDatabase, which admits lower-case letters, digits, and
    // underscores only; a database name cannot be a bound parameter, so each one is quoted.
    const workerNames = Array.from({ length: workerCount }, (_, index) =>
      workerDatabaseName(database.baseName, index + 1),
    );
    // Worker databases of an earlier run are dropped too, whatever their number: a run with
    // more workers than this one would otherwise leave its extra databases behind.
    const existing = await db.$queryRawUnsafe<{ name: string }[]>(
      "SELECT datname::text AS name FROM pg_database",
    );
    // Exactly `<base>_w<n>`: a worker database of another base is not this run's to drop.
    const staleNames = staleWorkerDatabaseNames(
      existing.map((row) => row.name),
      database.baseName,
      workerNames,
    );
    const template = quoteIdentifier(database.templateName);
    for (const name of [...workerNames, ...staleNames, database.templateName]) {
      await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`);
    }
    await db.$executeRawUnsafe(`CREATE DATABASE ${template}`);
    migrateTemplate(database);
    const migratedAt = performance.now();
    for (const name of workerNames) {
      await db.$executeRawUnsafe(`CREATE DATABASE ${quoteIdentifier(name)} TEMPLATE ${template}`);
    }
    const readyAt = performance.now();
    console.log(
      `[integration] template migrated in ${Math.round(migratedAt - startedAt)} ms; ` +
        `${workerNames.length} worker databases created in ${Math.round(readyAt - migratedAt)} ms`,
    );
  } catch (error) {
    try {
      // The first failure is the one to report; a lost lock on top of it would only hide it.
      await runLock?.release().catch(() => undefined);
    } finally {
      await db.$disconnect();
    }
    throw error;
  }

  project.provide("integrationDatabase", {
    baseUrl: database.baseUrl,
    baseName: database.baseName,
    workerCount,
  });

  // Teardown: the run lock is held, and this process keeps its connection, until every test
  // file has finished. `release` throws RunLockLostError when the lock did not last that long;
  // that fails the run, because another run may have recreated the databases under this one.
  const heldLock = runLock;
  return async () => {
    try {
      await heldLock.release();
    } finally {
      await db.$disconnect();
    }
  };
}
