/**
 * The two refusals of the global setup, tried on the real thing: a second `vitest` process is
 * started with the integration configuration while this run is going.
 *
 * - With DATABASE_URL_TEST naming anything but the local test database, the second process stops
 *   before it connects, and its output holds no part of the URL.
 * - With the right DATABASE_URL_TEST, it stops on the run lock (tests/helpers/run-lock.ts),
 *   because this run holds it, and the databases of this run are the same ones afterwards.
 *
 * If the run lock did not work, the second process would drop this run's databases; the last
 * test fails then, and so does most of the run. The second process is given one test file that
 * needs no database, so that it could not start a third process even in that case.
 *
 * The lock helper itself is tried first, on this worker's own database and with a key of its
 * own: advisory locks are per database, so it cannot meet the lock of the run.
 */
import { execFile } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, inject, it } from "vitest";

import { db } from "@/server/db";

import { createCategory } from "../../helpers/factories";
import { acquireRunLock, ConcurrentRunError, RUN_LOCK_KEY } from "../../helpers/run-lock";

const CHILD_TIMEOUT_MS = 90_000;
// Invented values. They are distinctive so that a leak into the output is found by text.
const SECRET_USER = "user-must-not-leak";
const SECRET_PASSWORD = "pw-MUST-NOT-LEAK-91c2";
const SECRET_HOST = "host-must-not-leak.invalid";

type ChildRun = { exitCode: number | string | null; output: string };

/** Starts a second integration run with the given DATABASE_URL_TEST and waits for it to end. */
function runSecondIntegrationRun(testUrl: string): Promise<ChildRun> {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const [name, value] of Object.entries(process.env)) {
    // Not the worker's own database URL, and nothing that tells Vitest it is inside a worker.
    if (name !== "DATABASE_URL" && !name.toUpperCase().startsWith("VITEST")) {
      env[name] = value;
    }
  }
  env["DATABASE_URL_TEST"] = testUrl;

  return new Promise((done) => {
    execFile(
      process.execPath,
      [
        resolve(process.cwd(), "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "vitest.integration.config.mts",
        "tests/integration/harness/test-database-url.test.ts",
      ],
      { cwd: process.cwd(), env, timeout: CHILD_TIMEOUT_MS, windowsHide: true },
      (error, stdout, stderr) => {
        const exitCode = error === null ? 0 : (error.code ?? null);
        done({ exitCode, output: `${stdout}\n${stderr}` });
      },
    );
  });
}

/** Every database of the server with its object id; a recreated database gets a new id. */
async function listDatabases(): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ entry: string }[]>(
    "SELECT datname::text || ':' || oid::text AS entry FROM pg_database ORDER BY datname",
  );
  return rows.map((row) => row.entry);
}

describe("acquireRunLock", () => {
  // Not the key of the run, so that these cases say nothing about, and change nothing in, the
  // lock the global setup holds (which is on another database in any case).
  const key = RUN_LOCK_KEY + 1;

  it("gives the lock to the first caller and refuses the second while it is held", async () => {
    const first = await acquireRunLock(db, key);
    try {
      await expect(acquireRunLock(db, key)).rejects.toBeInstanceOf(ConcurrentRunError);
      // Refused every time, and at once: the second caller never waits for the first.
      const startedAt = performance.now();
      await expect(acquireRunLock(db, key)).rejects.toThrow(
        "Integration tests refused to start: another integration run is using the test database on this machine",
      );
      expect(performance.now() - startedAt).toBeLessThan(5_000);
    } finally {
      await first.release();
    }
  });

  it("gives the lock again once it was released, and release can be called twice", async () => {
    const first = await acquireRunLock(db, key);
    await first.release();
    await first.release();

    const second = await acquireRunLock(db, key);
    await second.release();
  });

  it("holds the lock in the database, on one key only", async () => {
    const held = async (lockKey: number) => {
      const rows = await db.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pg_locks
         WHERE locktype = 'advisory' AND granted
           AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND classid = 0 AND objid = ${lockKey}`,
      );
      return rows[0]?.n;
    };
    expect(await held(key)).toBe(0);

    const lock = await acquireRunLock(db, key);
    try {
      expect(await held(key)).toBe(1);
      // Another key is free while this one is held.
      const other = await acquireRunLock(db, key + 1);
      await other.release();
    } finally {
      await lock.release();
    }

    expect(await held(key)).toBe(0);
  });

  it("says nothing about the database in its refusal", () => {
    const message = new ConcurrentRunError().message;

    expect(message).not.toContain("://");
    expect(message).not.toContain("marketplace");
    expect(message).toContain("No database was touched.");
  });

  it("refuses a key that is not an integer", async () => {
    await expect(acquireRunLock(db, 1.5)).rejects.toThrow("The run lock key is not an integer.");
  });
});

describe("a second integration run started during this one", () => {
  it.each([
    [
      "a host that is not this machine",
      `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@${SECRET_HOST}:5433/marketplace_test`,
      "the host in DATABASE_URL_TEST is not this machine",
    ],
    [
      "a database name that is not a test name",
      `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@127.0.0.1:5433/name_must_not_leak`,
      "the database name in DATABASE_URL_TEST is not a test database name",
    ],
  ])(
    "is refused for %s, and prints no part of the URL",
    async (_label, testUrl, reason) => {
      const before = await listDatabases();

      const child = await runSecondIntegrationRun(testUrl);

      expect(child.exitCode).toBe(1);
      expect(child.output).toContain("Integration tests refused to start:");
      expect(child.output).toContain(reason);
      expect(child.output).toContain("No database was touched.");
      expect(child.output).not.toContain(SECRET_PASSWORD);
      expect(child.output).not.toContain(SECRET_USER);
      expect(child.output).not.toContain(SECRET_HOST);
      expect(child.output).not.toContain("name_must_not_leak");
      expect(child.output).not.toContain("postgresql://");
      // It never got as far as the databases, and it ran no test.
      expect(child.output).not.toContain("[integration] template migrated");
      expect(child.output).not.toMatch(/Tests\s+\d+ passed/);
      expect(await listDatabases()).toEqual(before);
    },
    CHILD_TIMEOUT_MS + 10_000,
  );

  it(
    "is refused by the run lock, and leaves this run's databases as they are",
    async () => {
      const provided = inject("integrationDatabase");
      const password = decodeURIComponent(new URL(provided.baseUrl).password);
      const marker = await createCategory();
      const before = await listDatabases();
      // Besides the base database, exactly the template and one database per worker exist: the
      // global setup also removed the worker databases an earlier, wider run left behind.
      const ownDatabases = before
        .map((entry) => entry.slice(0, entry.lastIndexOf(":")))
        .filter((name) => name.startsWith(`${provided.baseName}_`));
      const expected = [
        `${provided.baseName}_template`,
        ...Array.from({ length: provided.workerCount }, (_, i) => `${provided.baseName}_w${i + 1}`),
      ];
      expect(ownDatabases.sort()).toEqual(expected.sort());

      const child = await runSecondIntegrationRun(provided.baseUrl);

      expect(child.exitCode).toBe(1);
      expect(child.output).toContain(
        "Integration tests refused to start: another integration run is using the test database on this machine",
      );
      expect(child.output).toContain("No database was touched.");
      expect(child.output).not.toContain("[integration] template migrated");
      expect(child.output).not.toMatch(/Tests\s+\d+ passed/);
      expect(child.output).not.toContain("postgresql://");
      // The password is looked for as it stands in a URL: on its own it may be an ordinary word.
      expect(child.output).not.toContain(`:${password}@`);

      // No database was dropped or recreated, and this worker's rows are still there.
      expect(await listDatabases()).toEqual(before);
      expect(await db.category.count({ where: { id: marker.id } })).toBe(1);
    },
    CHILD_TIMEOUT_MS + 10_000,
  );
});
