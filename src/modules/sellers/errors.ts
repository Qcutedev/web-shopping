/**
 * Seller application and store errors (docs/API_CONTRACTS.md sections 2.3, 5.7.1, 5.9.2).
 *
 * - No application of the caller (`GET /seller/application`), no store of the caller, an unknown
 *   application id (admin): `404 NOT_FOUND`, `details` `{}`.
 * - A `logoKey` that is not an upload of the caller's store, unknown and foreign alike:
 *   `404 NOT_FOUND` with `details.resource` `"upload"` (section 1.8: a 404 caused by a value in the
 *   body names the kind of thing, never whether it exists).
 * - A second application while one is `PENDING`: `409 CONFLICT`, reason `OPEN_APPLICATION`.
 * - Approving an application whose applicant is no longer a `CUSTOMER`: `409 CONFLICT`, reason
 *   `APPLICANT_NOT_CUSTOMER`.
 * - Approving an application whose applicant's account is deactivated (`isActive = false`):
 *   `409 CONFLICT`, reason `APPLICANT_INACTIVE`; nothing changes and the application stays
 *   `PENDING` so it can be rejected (D-040 point 1).
 * - A store name whose key (DATA_MODEL.md section 21.7) another store already has, on the
 *   application, the approval, and a rename: `409 CONFLICT`, reason `STORE_NAME_TAKEN` (SEC-058,
 *   D-041 point 1). Nothing changes; a refused approval leaves the application `PENDING`.
 * - A store name whose key, punctuation and symbols removed, contains a reserved name
 *   (`RESERVED_STORE_NAMES`, `containsReservedName`), on the same three: `409 CONFLICT`, reason
 *   `STORE_NAME_RESERVED` (D-041 point 3, widened by D-042 point 1). Nothing changes.
 * - A decision on an application that is not `PENDING`, including one that lost a race:
 *   `409 INVALID_STATE_TRANSITION` (state.ts).
 * - A write to a store that is not `APPROVED`: `403 SELLER_NOT_APPROVED` (DATA_MODEL.md section
 *   7.7: zero rows because of the store condition is that refusal, not a conflict).
 */
import { type AppError, conflict, notFound, sellerNotApproved } from "@/server/errors";

export const OPEN_APPLICATION = "OPEN_APPLICATION";
export const APPLICANT_NOT_CUSTOMER = "APPLICANT_NOT_CUSTOMER";
export const APPLICANT_INACTIVE = "APPLICANT_INACTIVE";
export const STORE_NAME_TAKEN = "STORE_NAME_TAKEN";
export const STORE_NAME_RESERVED = "STORE_NAME_RESERVED";

export function applicationNotFound(): AppError {
  return notFound();
}

export function storeNotFound(): AppError {
  return notFound();
}

export function uploadNotFound(): AppError {
  return notFound({ details: { resource: "upload" } });
}

export function openApplication(cause?: unknown): AppError {
  return conflict(OPEN_APPLICATION, cause === undefined ? {} : { cause });
}

export function applicantNotCustomer(): AppError {
  return conflict(APPLICANT_NOT_CUSTOMER);
}

export function applicantInactive(): AppError {
  return conflict(APPLICANT_INACTIVE);
}

/** No cause is attached: the database error's `meta` holds the name (DATA_MODEL.md 21.5). */
export function storeNameTaken(): AppError {
  return conflict(STORE_NAME_TAKEN);
}

export function storeNameReserved(): AppError {
  return conflict(STORE_NAME_RESERVED);
}

export function storeNotApproved(): AppError {
  return sellerNotApproved();
}
