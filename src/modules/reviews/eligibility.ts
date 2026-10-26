/**
 * BR-11 as a pure decision (docs/API_CONTRACTS.md section 5.6; REQ-C-14): a customer may review a
 * product once per purchased order item, only after that item's seller order is `DELIVERED`.
 *
 * The facts come from the locked order item (repository.ts), which is found only through the
 * caller's own order, so "the reviewer is the buyer" is already true for any item judged here.
 * The order of the outcomes follows the contract's table: not delivered before duplicate. An item
 * that is not delivered cannot carry a review, so the order matters only against bad data.
 *
 * Pure: no database and no framework import.
 */
import type { FulfilmentStatusValue } from "@/modules/orders/state";

export type ReviewEligibility = "ELIGIBLE" | "NOT_DELIVERED" | "DUPLICATE_REVIEW";

export function judgeReviewEligibility(facts: {
  fulfilmentStatus: FulfilmentStatusValue;
  hasReview: boolean;
}): ReviewEligibility {
  if (facts.fulfilmentStatus !== "DELIVERED") return "NOT_DELIVERED";
  if (facts.hasReview) return "DUPLICATE_REVIEW";
  return "ELIGIBLE";
}
