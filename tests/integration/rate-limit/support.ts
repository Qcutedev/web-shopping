/**
 * Helpers for the per-user rate-limit windows kept in the database (SEC-052 option (b);
 * docs/DATA_MODEL.md section 6.18). `resetProcessRateLimiter` (../auth/support) empties only the
 * in-process limiter; these rows survive it, as they survive a restart.
 */
import { db } from "@/server/db";

/** The table name, for `snapshotDatabase({ excludeTables })`. */
export const USER_RATE_LIMIT_TABLE = "UserRateLimitWindow";

/** Removes the per-user windows of `userIds`, so a case can send more requests than one window. */
export async function resetUserRateLimits(...userIds: string[]): Promise<void> {
  await db.userRateLimitWindow.deleteMany({ where: { userId: { in: userIds } } });
}

/** The counted requests of `userId` under `rule` in the stored window, or 0 without a row. */
export async function windowCount(userId: string, rule: string): Promise<number> {
  const row = await db.userRateLimitWindow.findUnique({
    where: { userId_rule: { userId, rule } },
    select: { count: true },
  });
  return row?.count ?? 0;
}
