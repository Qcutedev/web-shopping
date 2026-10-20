/**
 * Unit tests of the seller product state table and the moderation effect of a save
 * (docs/API_CONTRACTS.md section 3.3; BR-17 to BR-19; D-026 OQ-35 and OQ-36; D-028; D-031 point 2).
 */
import { describe, expect, it } from "vitest";

import {
  assertProductTransition,
  classifySave,
  type ModerationStatusValue,
  type ModerationView,
  MODERATION_STATUSES,
  type ProductAction,
  productActionSourceStates,
  PRODUCT_STATUSES,
  PRODUCT_TRANSITIONS,
  productTransitionTarget,
} from "./state";

const ACTIONS: ProductAction[] = ["publish", "unpublish", "archive"];

describe("PRODUCT_TRANSITIONS", () => {
  it("is exactly the table of section 3.3", () => {
    expect(PRODUCT_TRANSITIONS).toEqual([
      { action: "publish", from: "DRAFT", to: "PUBLISHED" },
      { action: "unpublish", from: "PUBLISHED", to: "DRAFT" },
      { action: "archive", from: "DRAFT", to: "ARCHIVED" },
      { action: "archive", from: "PUBLISHED", to: "ARCHIVED" },
    ]);
    expect(Object.isFrozen(PRODUCT_TRANSITIONS)).toBe(true);
  });

  it("ARCHIVED is final: no action leaves it", () => {
    for (const action of ACTIONS) {
      expect(productTransitionTarget(action, "ARCHIVED")).toBeNull();
      expect(() => assertProductTransition(action, "ARCHIVED")).toThrow(
        expect.objectContaining({ status: 409, code: "INVALID_STATE_TRANSITION" }),
      );
    }
  });

  it("every pair not in the table is 409 INVALID_STATE_TRANSITION", () => {
    for (const action of ACTIONS) {
      for (const from of PRODUCT_STATUSES) {
        const row = PRODUCT_TRANSITIONS.find((r) => r.action === action && r.from === from);
        if (row === undefined) {
          expect(() => assertProductTransition(action, from)).toThrow(
            expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }),
          );
        } else {
          expect(assertProductTransition(action, from)).toBe(row.to);
        }
      }
    }
  });

  it("source states of each action come from the table", () => {
    expect(productActionSourceStates("publish")).toEqual(["DRAFT"]);
    expect(productActionSourceStates("unpublish")).toEqual(["PUBLISHED"]);
    expect(productActionSourceStates("archive")).toEqual(["DRAFT", "PUBLISHED"]);
  });
});

const STORED: ModerationView = {
  title: "เสื้อ",
  description: "ผ้าฝ้าย",
  categoryId: "cat-1",
  priceSatang: 10_000,
  uploadIds: ["u1", "u2"],
};

describe("classifySave", () => {
  it.each([
    ["title", { title: "ใหม่" }],
    ["description", { description: "ใหม่" }],
    ["category", { categoryId: "cat-2" }],
    ["a picture added", { uploadIds: ["u1", "u2", "u3"] }],
    ["a picture removed", { uploadIds: ["u1"] }],
    ["a picture replaced", { uploadIds: ["u1", "u9"] }],
  ])(
    "a moderated change (%s) sends every status to PENDING and raises the revision",
    (_l, change) => {
      for (const status of MODERATION_STATUSES) {
        const effect = classifySave(status, STORED, { ...STORED, ...change });
        expect(effect.moderatedContentChanged).toBe(true);
        expect(effect.moderationStatus).toBe("PENDING");
        expect(effect.bumpRevision).toBe(true);
        // A PENDING product keeps its place in the queue.
        expect(effect.setRequestedAt).toBe(status !== "PENDING");
        expect(effect.resubmits).toBe(status === "REJECTED" || status === "TAKEN_DOWN");
      }
    },
  );

  it("a pure reorder of the pictures changes nothing in moderation (OQ-35)", () => {
    for (const status of MODERATION_STATUSES) {
      const effect = classifySave(status, STORED, { ...STORED, uploadIds: ["u2", "u1"] });
      expect(effect).toEqual({
        moderatedContentChanged: false,
        resubmits: false,
        moderationStatus: status,
        bumpRevision: false,
        setRequestedAt: false,
      });
    }
  });

  it("a price change applies at once on APPROVED and PENDING", () => {
    for (const status of ["APPROVED", "PENDING"] as ModerationStatusValue[]) {
      const effect = classifySave(status, STORED, { ...STORED, priceSatang: 9_900 });
      expect(effect.moderationStatus).toBe(status);
      expect(effect.bumpRevision).toBe(false);
    }
  });

  it("a price change resubmits REJECTED and TAKEN_DOWN, with a revision (BR-19, D-028, D-031)", () => {
    for (const status of ["REJECTED", "TAKEN_DOWN"] as ModerationStatusValue[]) {
      expect(classifySave(status, STORED, { ...STORED, priceSatang: 9_900 })).toEqual({
        moderatedContentChanged: false,
        resubmits: true,
        moderationStatus: "PENDING",
        bumpRevision: true,
        setRequestedAt: true,
      });
    }
  });

  it("a save in which nothing differs never resubmits and never produces APPROVED", () => {
    for (const status of MODERATION_STATUSES) {
      const effect = classifySave(status, STORED, { ...STORED });
      expect(effect.moderationStatus).toBe(status);
      expect(effect.resubmits).toBe(false);
      expect(effect.bumpRevision).toBe(false);
    }
    for (const status of ["PENDING", "REJECTED", "TAKEN_DOWN"] as ModerationStatusValue[]) {
      expect(classifySave(status, STORED, { ...STORED, title: "x" }).moderationStatus).not.toBe(
        "APPROVED",
      );
    }
  });
});
