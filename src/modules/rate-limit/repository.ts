/**
 * Per-user rate-limit windows in the database (docs/DATA_MODEL.md section 6.18; SECURITY.md
 * SEC-052 option (b), owner ruling 2026-10-29).
 *
 * Both statements run on the shared client `db`, never on a caller's transaction: a count must
 * survive whatever happens to the request afterwards (API_CONTRACTS section 6), and `now()` is
 * the start of the surrounding transaction, so a long transaction would move the window. Each
 * statement runs in a short transaction of its own (a Prisma batch transaction: BEGIN, the
 * timeout, the statement, COMMIT), which sets STATEMENT_TIMEOUT_MS with `set_config(...,
 * true)`, the function form of `SET LOCAL`. The setting ends with that transaction, so the
 * pooled connection goes back with the pool's own 30-second timeout (src/server/db/pool-config.ts).
 *
 * Raw statements are tagged templates with bound parameters only; no SQL text is built from a
 * value. Nothing here logs.
 */
import { randomUUID } from "node:crypto";

import { db } from "@/server/db";

/**
 * Longest time, 2 seconds, that the server lets one counting or purge statement run, a wait for a
 * row lock included; then it cancels the statement with SQLSTATE 57014 (`query_canceled`). Both
 * statements touch one row or one bounded batch through an index and take milliseconds, so the
 * bound is reached only when something is stuck (a lock held by another session, a saturated
 * server). The count then rejects and the route answers the generic `500` without reading the
 * body (fails closed, service.ts); a purge that times out is logged and changes no answer. Much
 * shorter than the pool-wide STATEMENT_TIMEOUT_MS of 30 seconds, because the count runs on the
 * path of every request to the two endpoints and the purge is awaited by one of them.
 */
export const STATEMENT_TIMEOUT_MS = 2_000;

/** Sets STATEMENT_TIMEOUT_MS for the rest of the current transaction only. */
function localStatementTimeout() {
  return db.$queryRaw`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`;
}

export interface CountedWindow {
  /** Requests counted in the current window, this one included; at most `limit + 1`. */
  count: number;
  /** End of the window. */
  resetAt: Date;
  /** The database's `now()` of the statement. */
  now: Date;
}

/**
 * The counting statement of DATA_MODEL.md section 6.18: one atomic `INSERT ... ON CONFLICT DO
 * UPDATE`, never a read followed by a write, so two concurrent requests of one user never both
 * see the old count. An expired window (`resetAt <= now()`) starts again at 1 in the same
 * statement. The count stops at `limit + 1`. The window and the expiry test use the database
 * clock. `now()` is returned as well, so the caller computes `Retry-After` on the same clock. It
 * is returned at the column's precision, `timestamptz(3)`: the column rounds `resetAt` to the
 * millisecond, and a `now()` with its microseconds cut off by the driver could fall up to 1 ms
 * before the rounded start, which made `Retry-After` one second longer than the window.
 */
export async function countRequest(input: {
  userId: string;
  rule: string;
  limit: number;
  windowMs: number;
}): Promise<CountedWindow> {
  const { userId, rule, limit, windowMs } = input;
  const [, rows] = await db.$transaction([
    localStatementTimeout(),
    db.$queryRaw<CountedWindow[]>`
    INSERT INTO "UserRateLimitWindow" ("id", "userId", "rule", "count", "resetAt", "updatedAt")
    VALUES (${randomUUID()}, ${userId}, ${rule}, 1,
            now() + (${windowMs}::int * interval '1 millisecond'), now())
    ON CONFLICT ("userId", "rule") DO UPDATE SET
      "count" = CASE WHEN "UserRateLimitWindow"."resetAt" <= now() THEN 1
                     ELSE LEAST("UserRateLimitWindow"."count" + 1, ${limit}::int + 1) END,
      "resetAt" = CASE WHEN "UserRateLimitWindow"."resetAt" <= now() THEN EXCLUDED."resetAt"
                       ELSE "UserRateLimitWindow"."resetAt" END,
      "updatedAt" = now()
    RETURNING "count", "resetAt", now()::timestamptz(3) AS "now"`,
  ]);
  const row = rows[0];
  if (row === undefined) {
    throw new Error("The rate-limit counting statement returned no row.");
  }
  return row;
}

/** How many expired windows one purge removes at most, so that one purge stays short. */
export const PURGE_BATCH_SIZE = 1_000;

/**
 * Removes up to PURGE_BATCH_SIZE expired windows (`resetAt <= now()`; DATA_MODEL.md section
 * 6.18, served by `UserRateLimitWindow_resetAt_idx`). An expired window counts as no row, so
 * removing it changes no answer. Returns the number of rows removed. Bounded by
 * STATEMENT_TIMEOUT_MS like the count, because the service awaits it on a request's path.
 */
export async function purgeExpiredWindows(): Promise<number> {
  const [, removed] = await db.$transaction([
    localStatementTimeout(),
    db.$executeRaw`
    DELETE FROM "UserRateLimitWindow"
     WHERE "id" IN (SELECT "id" FROM "UserRateLimitWindow"
                     WHERE "resetAt" <= now()
                     LIMIT ${PURGE_BATCH_SIZE}::int)
       AND "resetAt" <= now()`,
  ]);
  return removed;
}
