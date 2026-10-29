/**
 * The acting admin is still an active admin when an admin write commits (SECURITY.md SEC-088;
 * DECISIONS.md D-024).
 *
 * The actor of a request is read once, when the guard runs. An admin who is deactivated between
 * that moment and the write transaction (for example while the request waits on a row lock held
 * by the deactivation itself) must not complete the write: every admin write transaction, and the
 * sellers module's application decisions, call `assertActingAdmin` before any other statement.
 *
 * The admin's `User` row is locked `FOR SHARE`, so a concurrent deactivation of that admin (which
 * locks every active admin row `FOR UPDATE`) either commits first and is seen here, or waits until
 * this transaction ends. A row that is missing, inactive, or no longer `ADMIN` is 401
 * UNAUTHENTICATED: the request's session is gone (deactivation deletes every session), so it is
 * answered as one without a session. The error rolls the whole transaction back, so no change and
 * no audit row is written.
 *
 * `deactivateUser` with an admin target does not call this helper: it already locks every active
 * admin row `FOR UPDATE`, and a `FOR SHARE` taken before that lock would let two admins
 * deactivating each other deadlock. It refuses with `actingAdminRefused` when the acting admin is
 * not among the rows it locked.
 *
 * `reactivateUser` calls it first too (SEC-096). To keep two admins reactivating each other from
 * deadlocking (SEC-094), it answers an already active admin target before it locks the target.
 *
 * This file imports nothing of another module, so the sellers module can use it without an import
 * cycle (the admin module imports the sellers module).
 */
import type { DbTransaction } from "@/server/db";
import { type AppError, unauthenticated } from "@/server/errors";

/** The refusal of an admin write whose acting admin is no longer an active `ADMIN`. */
export function actingAdminRefused(): AppError {
  return unauthenticated();
}

/**
 * Locks the acting admin's row `FOR SHARE` and throws 401 UNAUTHENTICATED unless it is an active
 * `ADMIN`. Call it first inside the write transaction; the throw rolls the transaction back.
 */
export async function assertActingAdmin(tx: DbTransaction, adminId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ role: string; isActive: boolean }[]>`
    SELECT "role"::text AS "role", "isActive" FROM "User" WHERE "id" = ${adminId} FOR SHARE`;
  const row = rows[0];
  if (row?.role !== "ADMIN" || !row.isActive) throw actingAdminRefused();
}
