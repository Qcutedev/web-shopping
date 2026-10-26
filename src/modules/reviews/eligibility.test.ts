/**
 * Unit tests of BR-11 as a pure decision (eligibility.ts): only a `DELIVERED` item without a
 * review is eligible; every other fulfilment status is `NOT_DELIVERED`; a second review is
 * `DUPLICATE_REVIEW`.
 */
import { describe, expect, it } from "vitest";

import { FULFILMENT_STATUSES } from "@/modules/orders/state";

import { judgeReviewEligibility } from "./eligibility";

describe("judgeReviewEligibility (BR-11)", () => {
  it("allows a delivered item that has no review", () => {
    expect(judgeReviewEligibility({ fulfilmentStatus: "DELIVERED", hasReview: false })).toBe(
      "ELIGIBLE",
    );
  });

  it("refuses a delivered item that already has a review", () => {
    expect(judgeReviewEligibility({ fulfilmentStatus: "DELIVERED", hasReview: true })).toBe(
      "DUPLICATE_REVIEW",
    );
  });

  it("refuses every status other than DELIVERED, with or without a review", () => {
    const others = FULFILMENT_STATUSES.filter((status) => status !== "DELIVERED");
    expect(others).toEqual(["PENDING", "PROCESSING", "SHIPPED", "CANCELLED"]);
    for (const fulfilmentStatus of others) {
      for (const hasReview of [false, true]) {
        expect(judgeReviewEligibility({ fulfilmentStatus, hasReview })).toBe("NOT_DELIVERED");
      }
    }
  });
});
