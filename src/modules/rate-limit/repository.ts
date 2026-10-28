/**
 * Per-user rate-limit windows in the database (docs/DATA_MODEL.md section 6.18; SECURITY.md
 * SEC-052 option (b), owner ruling 2026-10-29).
 *
 * Both statements run on the shared client `db`, never on a caller's transaction: a count must
 * survive whatever happens to the request afterwards (API_CONTRACTS section 6), and `now()` is
 * the start of the surrounding transaction, so a long transaction would move the window. Each
 * statement is its own implicit transaction.
 *
 * Raw statements are tagged templates with bound parameters only; no SQL text is built from a
 * value. Nothing here logs.
 */
import { randomUUID } from "node:crypto";

import { db } from "@/server/db";

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
 * clock. `now()` is returned as well, so the caller computes `Retry-After` on the same clock.
 */
export async function countRequest(input: {
  userId: string;
  rule: string;
  limit: number;
  windowMs: number;
}): Promise<CountedWindow> {
  const { userId, rule, limit, windowMs } = input;
  const rows = await db.$queryRaw<CountedWindow[]>`
    INSERT INTO "UserRateLimitWindow" ("id", "userId", "rule", "count", "resetAt", "updatedAt")
    VALUES (${randomUUID()}, ${userId}, ${rule}, 1,
            now() + (${windowMs}::int * interval '1 millisecond'), now())
    ON CONFLICT ("userId", "rule") DO UPDATE SET
      "count" = CASE WHEN "UserRateLimitWindow"."resetAt" <= now() THEN 1
                     ELSE LEAST("UserRateLimitWindow"."count" + 1, ${limit}::int + 1) END,
      "resetAt" = CASE WHEN "UserRateLimitWindow"."resetAt" <= now() THEN EXCLUDED."resetAt"
                       ELSE "UserRateLimitWindow"."resetAt" END,
      "updatedAt" = now()
    RETURNING "count", "resetAt", now() AS "now"`;
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
 * removing it changes no answer. Returns the number of rows removed.
 */
export async function purgeExpiredWindows(): Promise<number> {
  return db.$executeRaw`
    DELETE FROM "UserRateLimitWindow"
     WHERE "id" IN (SELECT "id" FROM "UserRateLimitWindow"
                     WHERE "resetAt" <= now()
                     LIMIT ${PURGE_BATCH_SIZE}::int)
       AND "resetAt" <= now()`;
}
