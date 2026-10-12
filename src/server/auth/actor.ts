/**
 * The acting user of a request, and the pure permission helpers (D-022).
 *
 * This file has no database and no framework import, so modules, route handlers, and pages may
 * import it. `requireActor` and `getActor`, which turn a session into an `Actor`, live in
 * session.ts and are the only part of the auth layer that reads the database.
 *
 * Every field of an `Actor` is read from the database for the session's user on every request
 * (SECURITY.md TM-26): `role`, `storeId`, and `storeStatus` never come from the request, a cookie
 * cache, or the session record.
 *
 * The two helpers below are the checks of step 4 of the order of refusals
 * (docs/API_CONTRACTS.md section 1.8; D-032 point 1):
 *
 *   - `requireRole(actor, ...roles)`: the role only. 403 FORBIDDEN for any other role.
 *   - `requireApprovedSeller(actor)`: role `SELLER` first (403 FORBIDDEN otherwise), then a store
 *     with status `APPROVED` (403 SELLER_NOT_APPROVED otherwise). Returns the store id the service
 *     scopes by.
 *
 * Both are refusals made sooner. Every service repeats the check that matters to it, and a seller
 * service's write carries the store condition itself (CLAUDE.md rule 2; DATA_MODEL.md section
 * 7.7).
 */
import { forbidden, sellerNotApproved } from "../errors";

/** The roles of `User.role` (prisma/schema.prisma, enum Role). */
export const ROLES = ["CUSTOMER", "SELLER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** The statuses of `Store.status` (prisma/schema.prisma, enum StoreStatus). */
export const STORE_STATUSES = ["APPROVED", "SUSPENDED"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export interface Actor {
  readonly userId: string;
  readonly role: Role;
  /** The id of the store the user owns, or null. Only a `SELLER` owns a store. */
  readonly storeId: string | null;
  /** The status of that store, or null when the user owns none. */
  readonly storeStatus: StoreStatus | null;
}

/**
 * 403 FORBIDDEN unless `actor.role` is one of `roles`. At least one role must be named; a call
 * without one is a programming error and throws a TypeError, so it can never pass by accident.
 */
export function requireRole(actor: Actor, ...roles: readonly Role[]): void {
  if (roles.length === 0) {
    throw new TypeError("requireRole: name at least one role.");
  }
  if (!roles.includes(actor.role)) throw forbidden();
}

/**
 * For an endpoint whose access level is `seller` (docs/API_CONTRACTS.md section 1.8): the role
 * is judged first, so a customer or an admin gets 403 FORBIDDEN, never SELLER_NOT_APPROVED. A
 * seller whose store is not `APPROVED` (or, against the data model, has none) gets 403
 * SELLER_NOT_APPROVED. Returns the caller's own store id, the only store id a seller service may
 * scope by (CLAUDE.md rule 6).
 */
export function requireApprovedSeller(actor: Actor): { storeId: string } {
  requireRole(actor, "SELLER");
  if (actor.storeId === null || actor.storeStatus !== "APPROVED") throw sellerNotApproved();
  return { storeId: actor.storeId };
}
