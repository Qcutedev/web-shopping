/**
 * Unit tests of the admin's moderation decision table (DATA_MODEL.md 4.2, 7.6; BR-36, D-028;
 * item 8.2-6) and the user activation table (DATA_MODEL.md 4.5). Every pair of stored states is
 * judged for every decision.
 */
import { describe, expect, it } from "vitest";

import { MODERATION_STATUSES, PRODUCT_STATUSES } from "@/modules/inventory";

import {
  activationMove,
  judgeModerationDecision,
  MODERATION_DECISIONS,
  type ModerationDecision,
  REVIEW_VISIBILITIES,
  REVIEW_VISIBILITY_TRANSITIONS,
  reviewVisibilityMove,
  reviewVisibilityOf,
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

describe("activationMove", () => {
  it("deactivate goes true to false, reactivate false to true", () => {
    expect(activationMove("deactivate")).toEqual({ from: true, to: false });
    expect(activationMove("reactivate")).toEqual({ from: false, to: true });
  });
});

describe("review visibility table (SEC-092; DATA_MODEL.md 6.15)", () => {
  it("has exactly hide PUBLIC to HIDDEN and unhide HIDDEN to PUBLIC", () => {
    expect(REVIEW_VISIBILITY_TRANSITIONS).toEqual([
      { action: "hide", from: "PUBLIC", to: "HIDDEN" },
      { action: "unhide", from: "HIDDEN", to: "PUBLIC" },
    ]);
    expect(Object.isFrozen(REVIEW_VISIBILITY_TRANSITIONS)).toBe(true);
    expect(reviewVisibilityMove("hide")).toEqual({ from: "PUBLIC", to: "HIDDEN" });
    expect(reviewVisibilityMove("unhide")).toEqual({ from: "HIDDEN", to: "PUBLIC" });
  });

  it("only hiddenAt decides the visibility", () => {
    expect(reviewVisibilityOf(null)).toBe("PUBLIC");
    expect(reviewVisibilityOf(new Date(0))).toBe("HIDDEN");
  });

  it("refuses a double hide and an un-hide of a public review (no row for the source)", () => {
    for (const visibility of REVIEW_VISIBILITIES) {
      const sources = REVIEW_VISIBILITY_TRANSITIONS.filter((row) => row.from === visibility);
      expect(sources).toHaveLength(1);
    }
    expect(reviewVisibilityMove("hide").from).not.toBe("HIDDEN");
    expect(reviewVisibilityMove("unhide").from).not.toBe("PUBLIC");
  });
});
