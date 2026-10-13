import { describe, expect, it } from "vitest";

import * as catalog from "./index";
import * as visibility from "./visibility";
import { isSoldOut, PUBLIC_STORE_WHERE, VISIBLE_PRODUCT_WHERE } from "./visibility";

describe("one definition of visible (BR-05; CR-86)", () => {
  it("visibility.ts exports the query form and isSoldOut only, no pure restatement", () => {
    expect(Object.keys(visibility).sort()).toEqual([
      "PUBLIC_STORE_WHERE",
      "VISIBLE_PRODUCT_WHERE",
      "isSoldOut",
    ]);
  });

  it("the module surface carries no second check of the five conditions", () => {
    expect(catalog).not.toHaveProperty("isVisibleProduct");
    expect(catalog).not.toHaveProperty("isPublicStore");
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
