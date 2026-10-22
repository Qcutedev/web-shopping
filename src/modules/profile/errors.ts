/**
 * Profile errors.
 *
 * An address id that the acting user does not own is answered exactly like an id that does not
 * exist: `404 NOT_FOUND`, the default message, `details` `{}` (docs/API_CONTRACTS.md section 1.8;
 * D-015). The id is in the path, so no `details.resource` is given.
 *
 * A profile read or write whose user is no longer active (deactivated between the guard and the
 * query) is `401 UNAUTHENTICATED`, as for a caller without a session (REQ-A-02).
 *
 * Creating an address when the user already holds MAX_ADDRESSES_PER_USER (50) is `409 CONFLICT`
 * with `details.reason` `ADDRESS_LIMIT` and nothing else in `details` (D-044 point 4; the same
 * shape as the cart's `CART_LINE_LIMIT`).
 */
import { type AppError, conflict, notFound, unauthenticated } from "@/server/errors";

import { ADDRESS_LIMIT_REASON } from "./schema";

export function addressNotFound(): AppError {
  return notFound();
}

/** D-044 point 4: a create by a user who already holds the maximum. Nothing is written. */
export function addressLimitReached(): AppError {
  return conflict(ADDRESS_LIMIT_REASON);
}

export function profileGone(): AppError {
  return unauthenticated();
}
