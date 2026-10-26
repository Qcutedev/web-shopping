/**
 * Reviews errors (docs/API_CONTRACTS.md sections 1.8, 2.3, and 5.6; BR-11).
 *
 * An order that is not the caller's, and an item that is not in that order, are answered exactly
 * like ids that do not exist: `404 NOT_FOUND`, the default message, `details` `{}` (D-015). The
 * ids are in the path, so no `details.resource` is given.
 */
import { type AppError, conflict, notFound } from "@/server/errors";

/** `details.reason` of a review of an item whose seller order is not `DELIVERED` (BR-11). */
export const NOT_DELIVERED_REASON = "NOT_DELIVERED";
/** `details.reason` of a second review of one order item (BR-11). */
export const DUPLICATE_REVIEW_REASON = "DUPLICATE_REVIEW";

export function reviewTargetNotFound(): AppError {
  return notFound();
}

export function notDelivered(): AppError {
  return conflict(NOT_DELIVERED_REASON);
}

export function duplicateReview(): AppError {
  return conflict(DUPLICATE_REVIEW_REASON);
}
