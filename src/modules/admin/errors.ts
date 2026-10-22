/**
 * Admin errors (docs/API_CONTRACTS.md sections 2.3 and 5.9).
 *
 * - An unknown id (user, store, product, category, order, seller order): `404 NOT_FOUND`,
 *   `details` `{}`. An admin may see every row, so "foreign" does not arise.
 * - A move that the state tables do not allow (already inactive, already suspended, a moderation
 *   decision on a product that is not in the state the decision needs, a fulfilment move outside
 *   the admin's rows): `409 INVALID_STATE_TRANSITION`, `details` `{}`.
 * - `409 CONFLICT` with one reason each:
 *     SELF_DEACTIVATION       an admin deactivating their own account (REQ-A-02);
 *     LAST_ADMIN              deactivating the last active admin (REQ-A-02);
 *     STALE_REVISION          a moderation decision whose `contentRevision` is not the product's
 *                             current one (section 5.9.3);
 *     CATEGORY_HAS_PRODUCTS   deleting a category that any product references (REQ-A-06).
 */
import { type AppError, conflict, notFound } from "@/server/errors";

export const SELF_DEACTIVATION = "SELF_DEACTIVATION";
export const LAST_ADMIN = "LAST_ADMIN";
export const STALE_REVISION = "STALE_REVISION";
export const CATEGORY_HAS_PRODUCTS = "CATEGORY_HAS_PRODUCTS";

export function adminNotFound(): AppError {
  return notFound();
}

export function selfDeactivation(): AppError {
  return conflict(SELF_DEACTIVATION);
}

export function lastAdmin(): AppError {
  return conflict(LAST_ADMIN);
}

export function staleRevision(): AppError {
  return conflict(STALE_REVISION);
}

export function categoryHasProducts(): AppError {
  return conflict(CATEGORY_HAS_PRODUCTS);
}
