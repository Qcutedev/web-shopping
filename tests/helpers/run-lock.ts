/**
 * One integration run at a time per test database server.
 *
 * The global setup drops and recreates the template and the worker databases. A second run that
 * started while a first was still going would therefore destroy the databases under the first
 * one, and both would report failures that have nothing to do with the code under test. To
 * prevent that, the global setup takes a PostgreSQL advisory lock on the base test database
 * before it drops anything and holds it until the run ends. A run that cannot get the lock stops
 * with `ConcurrentRunError` and touches no database.
 *
 * How the lock is held. The database layer owns a connection pool, and an advisory lock belongs
 * to one connection, so the lock is taken inside an interactive transaction (which keeps one
 * connection for itself) with `pg_try_advisory_xact_lock`, and the transaction is kept open until
 * `release()` is called. PostgreSQL releases the lock by itself when the transaction ends or the
 * connection closes, so a run that crashes or is killed leaves no stale lock behind.
 *
 * Limits:
 * - the lock is scoped to the database the given client is connected to; two runs exclude each
 *   other because both connect to the same base test database;
 * - the transaction is held for at most `RUN_LOCK_HOLD_MS`. A run (or a watch session) that
 *   lasts longer loses the lock without notice.
 *
 * This module imports the database layer as a type only, so the global setup can load it before
 * DATABASE_URL is set.
 */
import type { Db } from "@/server/db";

/** Arbitrary, fixed key of the run lock. It only has to be the same in every run. */
export const RUN_LOCK_KEY = 4_023_001;

/** Longest time the lock is held: 24 hours. */
export const RUN_LOCK_HOLD_MS = 24 * 60 * 60 * 1000;

/** Thrown when another integration run holds the lock. The message holds no URL. */
export class ConcurrentRunError extends Error {
  constructor() {
    super(
      "Integration tests refused to start: another integration run is using the test database on this machine (it holds the run lock). " +
        "Wait for it to finish, or stop its vitest process, then run again. No database was touched.",
    );
    this.name = "ConcurrentRunError";
  }
}

export type RunLock = {
  /** Ends the transaction that holds the lock. Safe to call more than once. */
  release: () => Promise<void>;
};

/**
 * Takes the run lock on the database `db` is connected to, or throws `ConcurrentRunError` when
 * another session holds it. Never waits for the other session.
 */
export async function acquireRunLock(db: Db, key: number = RUN_LOCK_KEY): Promise<RunLock> {
  if (!Number.isSafeInteger(key)) {
    throw new Error("The run lock key is not an integer.");
  }

  let endHold: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => {
    endHold = resolve;
  });

  let report: (locked: boolean) => void = () => undefined;
  let reportFailure: (error: unknown) => void = () => undefined;
  const attempt = new Promise<boolean>((resolve, reject) => {
    report = resolve;
    reportFailure = reject;
  });

  const transaction = db.$transaction(
    async (tx) => {
      // `key` is a checked integer, not input: an advisory lock key cannot be needed elsewhere.
      const rows = await tx.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_xact_lock(${key}) AS locked`,
      );
      const locked = rows[0]?.locked === true;
      report(locked);
      if (locked) {
        await hold;
      }
    },
    { maxWait: 10_000, timeout: RUN_LOCK_HOLD_MS },
  );
  // Settled here so that a transaction that ends in an error after the lock was reported (the
  // hold time ran out, or the connection was lost) is not an unhandled rejection.
  const finished = transaction.then(
    () => undefined,
    (error: unknown) => {
      reportFailure(error);
    },
  );

  const locked = await attempt;
  if (!locked) {
    await finished;
    throw new ConcurrentRunError();
  }
  return {
    release: async () => {
      endHold();
      await finished;
    },
  };
}
