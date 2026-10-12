import { describe, expect, it } from "vitest";

import {
  isPublicStore,
  isSoldOut,
  isVisibleProduct,
  PUBLIC_STORE_WHERE,
  VISIBLE_PRODUCT_WHERE,
  type VisibilityFacts,
} from "./visibility";

const VISIBLE: VisibilityFacts = {
  status: "PUBLISHED",
  moderationStatus: "APPROVED",
  storeStatus: "APPROVED",
  ownerIsActive: true,
  categoryIsActive: true,
};

describe("isVisibleProduct (BR-05)", () => {
  it("is true when all five conditions hold", () => {
    expect(isVisibleProduct(VISIBLE)).toBe(true);
  });

  it.each<[string, Partial<VisibilityFacts>]>([
    ["draft", { status: "DRAFT" }],
    ["archived", { status: "ARCHIVED" }],
    ["awaiting approval or re-approval", { moderationStatus: "PENDING" }],
    ["rejected", { moderationStatus: "REJECTED" }],
    ["taken down", { moderationStatus: "TAKEN_DOWN" }],
    ["store suspended", { storeStatus: "SUSPENDED" }],
    ["owner deactivated (BR-27)", { ownerIsActive: false }],
    ["category inactive (BR-23)", { categoryIsActive: false }],
  ])("is false when %s", (_name, change) => {
    expect(isVisibleProduct({ ...VISIBLE, ...change })).toBe(false);
  });
});

describe("isPublicStore", () => {
  it("needs an approved store and an active owner", () => {
    expect(isPublicStore({ storeStatus: "APPROVED", ownerIsActive: true })).toBe(true);
    expect(isPublicStore({ storeStatus: "SUSPENDED", ownerIsActive: true })).toBe(false);
    expect(isPublicStore({ storeStatus: "APPROVED", ownerIsActive: false })).toBe(false);
  });
});

describe("isSoldOut (BR-24)", () => {
  it("is stock equal to 0", () => {
    expect(isSoldOut(0)).toBe(true);
    expect(isSoldOut(1)).toBe(false);
  });
});

describe("the query conditions", () => {
  it("state the same five conditions, and stock is not one of them", () => {
    expect(VISIBLE_PRODUCT_WHERE).toEqual({
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      store: { status: "APPROVED", owner: { isActive: true } },
      category: { isActive: true },
    });
    expect(PUBLIC_STORE_WHERE).toEqual({ status: "APPROVED", owner: { isActive: true } });
    expect(JSON.stringify(VISIBLE_PRODUCT_WHERE)).not.toContain("stock");
  });
});
