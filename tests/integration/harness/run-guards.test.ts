/**
 * The refusals of the global setup, tried on the real thing: a second `vitest` process is
 * started with the integration configuration while this run is going.
 *
 * - With DATABASE_URL_TEST naming anything but the local test database (another host, a host
 *   given in the query, a name that is not a test name), with a DATABASE_URL on the same server,
 *   or with a variable the driver applies on top of the URL, the second process stops before it
 *   connects, and its output holds no part of the URL.
 * - With the right DATABASE_URL_TEST, it stops on the run lock (tests/helpers/run-lock.ts),
 *   because this run holds it, and the databases of this run are the same ones afterwards.
 *
 * If the run lock did not work, the second process would drop this run's databases; the last
 * test fails then, and so does most of the run. The second process is given one test file that
 * needs no database, so that it could not start a third process even in that case.
 *
 * The lock helper itself is tried first, on this worker's own database and with a key of its
 * own: advisory locks are per database, so it cannot meet the lock of the run. That is also
 * where a lost lock is tried: the connection that holds the helper's own lock is closed from
 * the server side, which leaves the lock of the run alone.
 *
 * No case here connects anywhere but to this worker's own database: the refused URLs name
 * invented hosts under `.invalid`, and they are refused before any connection.
 */
import { resolve } from "node:path";

import { describe, expect, inject, it } from "vitest";

import { db } from "@/server/db";

import { createCategory } from "../../helpers/factories";
import { killProcessTree, runProcess, type ProcessRun } from "../../helpers/process-tree";
import {
  acquireRunLock,
  ConcurrentRunError,
  RUN_LOCK_KEY,
  RunLockLostError,
} from "../../helpers/run-lock";

const CHILD_TIMEOUT_MS = 90_000;
// Invented values. They are distinctive so that a leak into the output is found by text.
const SECRET_USER = "user-must-not-leak";
const SECRET_PASSWORD = "pw-MUST-NOT-LEAK-91c2";
const SECRET_HOST = "host-must-not-leak.invalid";
const SECRET_NAME = "name_must_not_leak";
const SECRET_OPTION = "option-must-not-leak";

/**
 * Starts a second integration run with the given DATABASE_URL_TEST, and with `extraEnv` on top
 * of this process's environment, and waits for it to end. When it does not end in time, it and
 * the workers it forked are stopped (tests/helpers/process-tree.ts).
 */
function runSecondIntegrationRun(
  testUrl: string,
  extraEnv: Record<string, string> = {},
): Promise<ProcessRun> {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const [name, value] of Object.entries(process.env)) {
    // Not the worker's own database URL, and nothing that tells Vitest it is inside a worker.
    if (name !== "DATABASE_URL" && !name.toUpperCase().startsWith("VITEST")) {
      env[name] = value;
    }
  }
  env["DATABASE_URL_TEST"] = testUrl;
  Object.assign(env, extraEnv);

  return runProcess(
    process.execPath,
    [
      resolve(process.cwd(), "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "vitest.integration.config.mts",
      "tests/integration/harness/test-database-url.test.ts",
    ],
    { cwd: process.cwd(), env, timeoutMs: CHILD_TIMEOUT_MS },
  );
}

/** Every database of the server with its object id; a recreated database gets a new id. */
async function listDatabases(): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ entry: string }[]>(
    "SELECT datname::text || ':' || oid::text AS entry FROM pg_database ORDER BY datname",
  );
  return rows.map((row) => row.entry);
}

/** The server processes that hold the advisory lock `lockKey` on this worker's database. */
async function lockHolders(lockKey: number): Promise<number[]> {
  const rows = await db.$queryRawUnsafe<{ pid: number }[]>(
    `SELECT pid FROM pg_locks
     WHERE locktype = 'advisory' AND granted
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
       AND classid = 0 AND objid = ${lockKey}`,
  );
  return rows.map((row) => row.pid);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until `condition` holds, for at most `limitMs`. Returns whether it held in the end. */
async function eventually(
  condition: () => boolean | Promise<boolean>,
  limitMs: number,
): Promise<boolean> {
  const deadline = performance.now() + limitMs;
  for (;;) {
    if (await condition()) {
      return true;
    }
    if (performance.now() > deadline) {
      return false;
    }
    await new Promise((wake) => setTimeout(wake, 50));
  }
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
    expect(await lockHolders(key)).toHaveLength(0);

    const lock = await acquireRunLock(db, key);
    try {
      expect(await lockHolders(key)).toHaveLength(1);
      // Another key is free while this one is held.
      const other = await acquireRunLock(db, key + 1);
      await other.release();
    } finally {
      await lock.release();
    }

    expect(await lockHolders(key)).toHaveLength(0);
  });

  // CR-26: before the fix `release()` resolved normally here, so a run whose lock was gone
  // (and whose databases another run could have recreated) still ended as a clean run.
  it("fails the release when the connection that held the lock was closed during the run", async () => {
    const lock = await acquireRunLock(db, key);
    const holders = await lockHolders(key);
    expect(holders).toHaveLength(1);

    // The server closes the connection of the lock holder; the holder is not told.
    const terminated = await db.$queryRawUnsafe<{ done: boolean }[]>(
      `SELECT pg_terminate_backend(${Number(holders[0])}) AS done`,
    );
    expect(terminated[0]?.done).toBe(true);
    // The lock is gone in the database, while this side still believes it holds it.
    expect(await eventually(async () => (await lockHolders(key)).length === 0, 5_000)).toBe(true);

    await expect(lock.release()).rejects.toBeInstanceOf(RunLockLostError);
    // Every time it is asked, not only the first.
    await expect(lock.release()).rejects.toThrow(
      "The integration run lost its run lock before it ended",
    );

    // Nothing else was harmed: the lock can be taken again, and this worker's client works.
    const again = await acquireRunLock(db, key);
    await again.release();
    expect(await lockHolders(key)).toHaveLength(0);
  });

  it("says nothing about the database when the lock was lost", () => {
    const message = new RunLockLostError().message;

    expect(message).not.toContain("://");
    expect(message).not.toContain("marketplace");
    expect(message).toContain("the results of this run cannot be trusted");
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

describe("runProcess", () => {
  const options = { cwd: process.cwd(), env: process.env, timeoutMs: 30_000 };

  it("returns the exit status and the output of a process that ends in time", async () => {
    const script = 'console.log("to stdout"); console.error("to stderr"); process.exit(3);';

    const run = await runProcess(process.execPath, ["-e", script], options);

    expect(run).toMatchObject({ exitCode: 3, timedOut: false });
    expect(run.output).toContain("to stdout");
    expect(run.output).toContain("to stderr");
  });

  // CR-35: with `execFile` and its `timeout` option only the process itself was stopped on
  // Windows, and what it had started lived on.
  it("stops the process and the process it started when the time limit runs out", async () => {
    // A process that starts a second one, prints both process ids, and never ends by itself.
    //
    // The second one is started the way that survives its parent on this platform, so that the
    // case fails when only the parent is stopped. On Windows that needs `detached`: Node puts
    // an ordinary child into a job that ends with its parent, and only a detached one is left
    // out of it (taskkill still finds it, by parent id). Elsewhere an ordinary child survives
    // its parent, and a detached one would leave the process group that is signalled.
    const inner = "setInterval(() => undefined, 1000);";
    const detached = process.platform === "win32";
    const outer =
      'const { spawn } = require("node:child_process");' +
      `const inner = spawn(process.execPath, ["-e", ${JSON.stringify(inner)}], { stdio: "ignore", detached: ${String(detached)} });` +
      'console.log("PIDS " + process.pid + " " + inner.pid);' +
      "setInterval(() => undefined, 1000);";

    const run = await runProcess(process.execPath, ["-e", outer], { ...options, timeoutMs: 3_000 });

    const pids = /PIDS ([0-9]+) ([0-9]+)/.exec(run.output);
    const outerPid = Number(pids?.[1]);
    const innerPid = Number(pids?.[2]);
    try {
      expect(run).toMatchObject({ exitCode: null, timedOut: true });
      expect(Number.isInteger(outerPid) && Number.isInteger(innerPid)).toBe(true);
      expect(outerPid).not.toBe(innerPid);
      expect(await eventually(() => !isAlive(outerPid), 5_000)).toBe(true);
      // The one that matters: the process started by the process that was stopped.
      expect(await eventually(() => !isAlive(innerPid), 5_000)).toBe(true);
    } finally {
      // Leaves nothing behind when an assertion above failed.
      for (const pid of [outerPid, innerPid]) {
        if (Number.isInteger(pid) && isAlive(pid)) {
          killProcessTree(pid);
        }
      }
    }
  }, 30_000);
});

describe("a second integration run started during this one", () => {
  it.each([
    [
      "a host that is not this machine",
      `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@${SECRET_HOST}:5433/marketplace_test`,
      {},
      "the host in DATABASE_URL_TEST is not this machine",
    ],
    [
      "a database name that is not a test name",
      `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@127.0.0.1:5433/${SECRET_NAME}`,
      {},
      "the database name in DATABASE_URL_TEST is not a test database name",
    ],
    [
      // CR-25: this machine in the authority, another host in the query. The driver would
      // connect to the host of the query.
      "another host given in the query",
      `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@127.0.0.1:5433/marketplace_test?host=${SECRET_HOST}`,
      {},
      "DATABASE_URL_TEST has a query parameter that is not allowed (only `schema` is)",
    ],
    [
      // CR-34: a test name on the server that DATABASE_URL names.
      "a DATABASE_URL on the same host and port",
      `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@127.0.0.1:5433/marketplace_test`,
      {
        DATABASE_URL: `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@localhost:5433/${SECRET_NAME}`,
      },
      "DATABASE_URL_TEST names the same server (host and port) as DATABASE_URL",
    ],
    [
      "PGOPTIONS set in the environment",
      `postgresql://${SECRET_USER}:${SECRET_PASSWORD}@127.0.0.1:5433/marketplace_test`,
      { PGOPTIONS: `-c application_name=${SECRET_OPTION}` },
      "PGOPTIONS is set in the environment",
    ],
  ])(
    "is refused for %s, and prints no part of the URL",
    async (_label, testUrl, extraEnv, reason) => {
      const before = await listDatabases();

      const child = await runSecondIntegrationRun(testUrl, extraEnv);

      expect(child.timedOut).toBe(false);
      expect(child.exitCode).toBe(1);
      expect(child.output).toContain("Integration tests refused to start:");
      expect(child.output).toContain(reason);
      expect(child.output).toContain("No database was touched.");
      expect(child.output).not.toContain(SECRET_PASSWORD);
      expect(child.output).not.toContain(SECRET_USER);
      expect(child.output).not.toContain(SECRET_HOST);
      expect(child.output).not.toContain(SECRET_NAME);
      expect(child.output).not.toContain(SECRET_OPTION);
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

      expect(child.timedOut).toBe(false);
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
