/**
 * Profile errors.
 *
 * An address id that the acting user does not own is answered exactly like an id that does not
 * exist: `404 NOT_FOUND`, the default message, `details` `{}` (docs/API_CONTRACTS.md section 1.8;
 * D-015). The id is in the path, so no `details.resource` is given.
 *
 * A profile read or write whose user is no longer active (deactivated between the guard and the
 * query) is `401 UNAUTHENTICATED`, as for a caller without a session (REQ-A-02).
 */
import { type AppError, notFound, unauthenticated } from "@/server/errors";

export function addressNotFound(): AppError {
  return notFound();
}

export function profileGone(): AppError {
  return unauthenticated();
}
