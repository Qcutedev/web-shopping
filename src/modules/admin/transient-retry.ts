/**
 * A bounded retry of a whole admin write transaction when PostgreSQL aborted it for a transient
 * conflict (SECURITY.md SEC-096 remediation (b)).
 *
 * The admin writes take their locks in one documented order (repository.ts, "Locks"; SEC-094 to
 * SEC-096), but the order cannot rule out every cycle with every other write of the marketplace:
 * one narrower race of the same family is known (SECURITY.md, Residual risks), and PostgreSQL
 * answers a cycle by aborting one transaction after `deadlock_timeout` with SQLSTATE `40P01`.
 * Without a retry that abort reaches the handler as a 500 although nothing was wrong with the
 * request.
 *
 * What is retried. Only an error that says the database aborted the transaction for a conflict
 * and wrote nothing:
 *
 *   - `P2034` (Prisma's "write conflict or deadlock", which `@prisma/adapter-pg` 7.10 reports for
 *     SQLSTATE `40P01` and `40001` of a model-API statement);
 *   - `P2010` (a raw statement failed) whose `meta.driverAdapterError.cause.originalCode` is
 *     `40P01` (`deadlock_detected`) or `40001` (`serialization_failure`). Every lock of the admin
 *     writes is a `$queryRaw`, so this is the form a deadlock takes there.
 *
 * Anything else goes on at once, on the first attempt: an `AppError` (401 of the acting-admin
 * check, 404, 409), a unique or foreign-key violation, a timeout of the interactive transaction
 * (`P2028`), a dropped connection, a plain `Error`. Only own properties of the error are read; the
 * message, the `DETAIL`, and the rest of `meta` are never read (SR-04).
 *
 * Why a retry is safe. The aborted transaction rolled back, so it wrote no change and no audit row.
 * `run` must start a new transaction on every call and do nothing outside it before it commits
 * (each caller passes the whole `db.$transaction(...)`), so every attempt runs every check again
 * from the start, the acting-admin check of SEC-088 and D-024 first: an admin deactivated while the
 * first attempt waited is refused 401 on the next one, and a state that moved in the meantime is
 * judged again under the lock (409). No rule is skipped and no result of an earlier attempt is
 * reused.
 *
 * Bounds. At most `ADMIN_WRITE_ATTEMPTS` (3) attempts; before attempt n + 1 a jittered pause of
 * `base * 2^(n-1) * [0.5, 1.5)` ms (base `ADMIN_RETRY_BASE_DELAY_MS`, 25), so two transactions
 * that met in a cycle do not meet again at once. After the last attempt the last error goes on
 * unchanged (a 500, as before). A deadlock already costs about `deadlock_timeout` (1 s by default),
 * so the pause adds little.
 *
 * This file imports nothing of another module, so the sellers module could use it without an
 * import cycle (as acting-admin.ts). Nothing here logs.
 */
import { Prisma } from "@/server/db";

/** How many times an admin write transaction is run at most. */
export const ADMIN_WRITE_ATTEMPTS = 3;

/** The base of the jittered pause between two attempts, in milliseconds. */
export const ADMIN_RETRY_BASE_DELAY_MS = 25;

/** PostgreSQL's `deadlock_detected`. */
export const DEADLOCK_SQLSTATE = "40P01";

/** PostgreSQL's `serialization_failure`. */
export const SERIALIZATION_FAILURE_SQLSTATE = "40001";

const TRANSIENT_SQLSTATES: readonly unknown[] = [DEADLOCK_SQLSTATE, SERIALIZATION_FAILURE_SQLSTATE];

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * True only when PostgreSQL aborted the transaction for a deadlock or a serialization failure:
 * `P2034`, or `P2010` with SQLSTATE `40P01` or `40001` in `meta.driverAdapterError.cause`.
 */
export function isTransientTransactionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  const cause = field(field(error.meta, "driverAdapterError"), "cause");
  return TRANSIENT_SQLSTATES.includes(field(cause, "originalCode"));
}

/**
 * The pause before attempt `failedAttempt + 1`, in whole milliseconds:
 * `base * 2^(failedAttempt-1) * (0.5 + random)`, with `random` in `[0, 1)`.
 */
export function retryDelayMs(failedAttempt: number, random: number, baseMs: number): number {
  const scale = baseMs * 2 ** (failedAttempt - 1);
  return Math.floor(scale * (0.5 + random));
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** For tests: the pause. */
  sleep?: (ms: number) => Promise<void>;
  /** For tests: a number in `[0, 1)`. */
  random?: () => number;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `run` and, while it fails with a transient conflict (`isTransientTransactionConflict`),
 * runs it again, at most `attempts` times in all. `run` must open its own transaction on every
 * call. Any other error, and the transient error of the last attempt, goes on unchanged.
 */
export async function retryTransientConflict<T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? ADMIN_WRITE_ATTEMPTS;
  const baseMs = options.baseDelayMs ?? ADMIN_RETRY_BASE_DELAY_MS;
  const sleep = options.sleep ?? pause;
  const random = options.random ?? Math.random;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("admin: the retry needs at least one attempt.");
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isTransientTransactionConflict(error)) throw error;
      await sleep(retryDelayMs(attempt, random(), baseMs));
    }
  }
}
