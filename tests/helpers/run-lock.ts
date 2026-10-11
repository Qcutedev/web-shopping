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
 *   lasts longer loses the lock;
 * - a lock that is lost while the run goes on (the hold time ran out, the connection that held
 *   it was closed, the server restarted) is not noticed at that moment: nothing watches the
 *   connection. It is noticed at the end: `release()` throws `RunLockLostError`, and the global
 *   teardown lets that fail the run.
 *
 * This module imports the database layer as a type only. It needs no client of its own: the
 * caller hands in `db`, which creates its client on first use from the DATABASE_URL of that
 * moment, so the caller must have set DATABASE_URL to a test database before the first use.
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

/**
 * Thrown by `release()` when the lock was not held until then. The message holds no URL and
 * nothing of the database error that ended the hold.
 */
export class RunLockLostError extends Error {
  constructor() {
    super(
      "The integration run lost its run lock before it ended (the connection that held it was closed, or the hold time ran out). " +
        "Another integration run may have started meanwhile and recreated the test databases under this one, so the results of this run cannot be trusted. Run it again.",
    );
    this.name = "RunLockLostError";
  }
}

export type RunLock = {
  /**
   * Ends the transaction that holds the lock. Safe to call more than once. Throws
   * `RunLockLostError`, every time it is called, when the transaction did not end cleanly: the
   * lock was then lost at some moment before this call.
   */
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
  // Settled here so that a transaction that ends in an error is not an unhandled rejection.
  // Before the lock was reported, the error is the result of the attempt. After that, `attempt`
  // is already settled and rejecting it does nothing, so the failure is remembered instead: the
  // transaction ended in an error (the hold time ran out, the connection was closed), and with
  // it the lock, at some moment the caller was not told about.
  let lost = false;
  const finished = transaction.then(
    () => undefined,
    (error: unknown) => {
      lost = true;
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
      if (lost) {
        throw new RunLockLostError();
      }
    },
  };
}
