/**
 * Unit tests of the admin's moderation decision table (DATA_MODEL.md 4.2, 7.6; BR-36, D-028;
 * item 8.2-6) and the user activation table (DATA_MODEL.md 4.5). Every pair of stored states is
 * judged for every decision.
 */
import { describe, expect, it } from "vitest";

import { MODERATION_STATUSES, PRODUCT_STATUSES } from "@/modules/inventory";

import {
  activationMove,
  assertModerationDecision,
  judgeModerationDecision,
  MODERATION_DECISIONS,
  type ModerationDecision,
} from "./state";

const ALLOWED: Record<ModerationDecision, (status: string, moderation: string) => boolean> = {
  approve: (status, moderation) => moderation === "PENDING" && status === "PUBLISHED",
  reject: (status, moderation) => moderation === "PENDING" && status === "PUBLISHED",
  takedown: (_status, moderation) => moderation === "APPROVED",
};

describe("judgeModerationDecision", () => {
  for (const decision of MODERATION_DECISIONS) {
    for (const status of PRODUCT_STATUSES) {
      for (const moderationStatus of MODERATION_STATUSES) {
        const expected = ALLOWED[decision](status, moderationStatus) ? "ok" : "invalid-state";
        it(`${decision} on ${status}/${moderationStatus} with the current revision: ${expected}`, () => {
          expect(
            judgeModerationDecision(decision, { status, moderationStatus, contentRevision: 4 }, 4),
          ).toBe(expected);
        });
      }
    }
  }

  it("approve and reject refuse a product the seller has not published (BR-36, D-028)", () => {
    for (const decision of ["approve", "reject"] as const) {
      for (const status of ["DRAFT", "ARCHIVED"] as const) {
        expect(
          judgeModerationDecision(
            decision,
            { status, moderationStatus: "PENDING", contentRevision: 1 },
            1,
          ),
        ).toBe("invalid-state");
      }
    }
  });

  it("takedown has no condition on the seller's status", () => {
    for (const status of PRODUCT_STATUSES) {
      expect(
        judgeModerationDecision(
          "takedown",
          { status, moderationStatus: "APPROVED", contentRevision: 2 },
          2,
        ),
      ).toBe("ok");
    }
  });

  it("the revision is compared first: a stale revision is STALE_REVISION even when the state is wrong too (8.2-6)", () => {
    for (const decision of MODERATION_DECISIONS) {
      expect(
        judgeModerationDecision(
          decision,
          { status: "DRAFT", moderationStatus: "REJECTED", contentRevision: 5 },
          4,
        ),
      ).toBe("stale-revision");
      expect(
        judgeModerationDecision(
          decision,
          { status: "PUBLISHED", moderationStatus: "PENDING", contentRevision: 5 },
          6,
        ),
      ).toBe("stale-revision");
    }
  });

  it("a stale approve after a price-only resubmission is refused (D-031 point 2)", () => {
    // The admin opened the product at revision 3 before it was rejected; the seller's price-only
    // correction made it PENDING at revision 4.
    expect(
      judgeModerationDecision(
        "approve",
        { status: "PUBLISHED", moderationStatus: "PENDING", contentRevision: 4 },
        3,
      ),
    ).toBe("stale-revision");
  });
});

describe("assertModerationDecision", () => {
  it("throws 409 INVALID_STATE_TRANSITION outside the table", () => {
    expect(() =>
      assertModerationDecision("approve", { status: "PUBLISHED", moderationStatus: "APPROVED" }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }));
    expect(() =>
      assertModerationDecision("takedown", { status: "DRAFT", moderationStatus: "APPROVED" }),
    ).not.toThrow();
  });
});

describe("activationMove", () => {
  it("deactivate goes true to false, reactivate false to true", () => {
    expect(activationMove("deactivate")).toEqual({ from: true, to: false });
    expect(activationMove("reactivate")).toEqual({ from: false, to: true });
  });
});
