import { describe, expect, it } from "vitest";

import * as catalog from "./index";
import * as visibility from "./visibility";
import {
  isSoldOut,
  PUBLIC_STORE_WHERE,
  VISIBLE_PRODUCT_SQL,
  VISIBLE_PRODUCT_WHERE,
} from "./visibility";

describe("one definition of visible (BR-05; CR-86)", () => {
  it("visibility.ts exports the two query forms and isSoldOut only, no pure restatement", () => {
    expect(Object.keys(visibility).sort()).toEqual([
      "PUBLIC_STORE_WHERE",
      "VISIBLE_PRODUCT_SQL",
      "VISIBLE_PRODUCT_WHERE",
      "isSoldOut",
    ]);
  });

  it("the SQL form states the five conditions of the Prisma form, with no parameter (T-032)", () => {
    const text = VISIBLE_PRODUCT_SQL.sql.replace(/\s+/g, " ").trim();
    expect(VISIBLE_PRODUCT_SQL.values).toEqual([]);
    expect(text).toBe(
      `(p."status" = '${VISIBLE_PRODUCT_WHERE.status}'` +
        ` AND p."moderationStatus" = '${VISIBLE_PRODUCT_WHERE.moderationStatus}'` +
        ` AND s."status" = '${VISIBLE_PRODUCT_WHERE.store.status}'` +
        ` AND u."isActive" = ${String(VISIBLE_PRODUCT_WHERE.store.owner.isActive).toUpperCase()}` +
        ` AND c."isActive" = ${String(VISIBLE_PRODUCT_WHERE.category.isActive).toUpperCase()})`,
    );
    expect(text).not.toContain("stock");
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
