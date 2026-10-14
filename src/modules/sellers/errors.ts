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
 * - A decision on an application that is not `PENDING`, including one that lost a race:
 *   `409 INVALID_STATE_TRANSITION` (state.ts).
 * - A write to a store that is not `APPROVED`: `403 SELLER_NOT_APPROVED` (DATA_MODEL.md section
 *   7.7: zero rows because of the store condition is that refusal, not a conflict).
 */
import { type AppError, conflict, notFound, sellerNotApproved } from "@/server/errors";

export const OPEN_APPLICATION = "OPEN_APPLICATION";
export const APPLICANT_NOT_CUSTOMER = "APPLICANT_NOT_CUSTOMER";
export const APPLICANT_INACTIVE = "APPLICANT_INACTIVE";

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

export function storeNotApproved(): AppError {
  return sellerNotApproved();
}
