/**
 * Unit tests of the seller product request schemas (docs/API_CONTRACTS.md sections 1.1, 1.7, and
 * 5.7.2; BR-02, BR-34; REQ-S-05).
 */
import { describe, expect, it } from "vitest";

import {
  createProductBodySchema,
  listSellerProductsQuerySchema,
  MAX_PRICE_SATANG,
  MAX_SELLER_STOCK,
  MIN_PRICE_SATANG,
  productIdParamsSchema,
  PRODUCT_SKU_MAX,
  PRODUCT_TITLE_MAX,
  stockBodySchema,
  updateProductBodySchema,
} from "./schema";

const VALID = {
  title: "  เสื้อยืด  ",
  description: "บรรทัดหนึ่ง\r\nบรรทัดสอง  ",
  sku: "TS-1",
  categoryId: "cat-1",
  priceSatang: 25_900,
  stock: 4,
};

describe("createProductBodySchema", () => {
  it("accepts a valid body and normalises the texts", () => {
    expect(createProductBodySchema.parse(VALID)).toEqual({
      ...VALID,
      title: "เสื้อยืด",
      description: "บรรทัดหนึ่ง\nบรรทัดสอง",
    });
  });

  it.each([
    "storeId",
    "status",
    "moderationStatus",
    "moderationNote",
    "contentRevision",
    "slug",
    "isSample",
  ])("refuses the unknown key %s", (key) => {
    const result = createProductBodySchema.safeParse({ ...VALID, [key]: "x" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("price bounds 100 to 100,000,000 satang, integer (BR-02)", () => {
    for (const ok of [MIN_PRICE_SATANG, MAX_PRICE_SATANG]) {
      expect(createProductBodySchema.safeParse({ ...VALID, priceSatang: ok }).success).toBe(true);
    }
    for (const bad of [MIN_PRICE_SATANG - 1, MAX_PRICE_SATANG + 1, 100.5, "25900", null]) {
      expect(createProductBodySchema.safeParse({ ...VALID, priceSatang: bad }).success).toBe(false);
    }
  });

  it("stock bounds 0 to 1,000,000 (BR-34)", () => {
    for (const ok of [0, MAX_SELLER_STOCK]) {
      expect(createProductBodySchema.safeParse({ ...VALID, stock: ok }).success).toBe(true);
    }
    for (const bad of [-1, MAX_SELLER_STOCK + 1, 1.5]) {
      expect(createProductBodySchema.safeParse({ ...VALID, stock: bad }).success).toBe(false);
    }
  });

  it("text limits and the display-text rule", () => {
    expect(
      createProductBodySchema.safeParse({ ...VALID, title: "a".repeat(PRODUCT_TITLE_MAX) }).success,
    ).toBe(true);
    for (const title of ["", "   ", "a".repeat(PRODUCT_TITLE_MAX + 1), "a\nb", "a\u202Eb"]) {
      expect(createProductBodySchema.safeParse({ ...VALID, title }).success).toBe(false);
    }
    expect(
      createProductBodySchema.safeParse({ ...VALID, sku: "S".repeat(PRODUCT_SKU_MAX + 1) }).success,
    ).toBe(false);
    expect(
      createProductBodySchema.safeParse({ ...VALID, description: "ok\n\u200Ebad" }).success,
    ).toBe(false);
  });

  it("imageKeys: at most 8, no key twice, no U+0000", () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${String(i)}`);
    expect(createProductBodySchema.safeParse({ ...VALID, imageKeys: keys(8) }).success).toBe(true);
    expect(createProductBodySchema.safeParse({ ...VALID, imageKeys: [] }).success).toBe(true);
    for (const imageKeys of [keys(9), ["a", "a"], ["a\u0000"], [""], "a"]) {
      expect(createProductBodySchema.safeParse({ ...VALID, imageKeys }).success).toBe(false);
    }
  });
});

describe("updateProductBodySchema", () => {
  it("takes any of the editable fields, at least one", () => {
    expect(updateProductBodySchema.parse({ priceSatang: 500 })).toEqual({ priceSatang: 500 });
    const empty = updateProductBodySchema.safeParse({});
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]).toMatchObject({ code: "custom", path: [] });
  });

  it("refuses stock and every key the seller may not set", () => {
    for (const key of ["stock", "status", "moderationStatus", "storeId", "slug", "isSample"]) {
      expect(updateProductBodySchema.safeParse({ title: "x", [key]: 1 }).success).toBe(false);
    }
  });
});

describe("stockBodySchema", () => {
  it("exactly one of set and adjust", () => {
    expect(stockBodySchema.parse({ set: 0 })).toEqual({ set: 0 });
    expect(stockBodySchema.parse({ adjust: -5 })).toEqual({ adjust: -5 });
    for (const body of [{}, { set: 1, adjust: 1 }]) {
      expect(stockBodySchema.safeParse(body).success).toBe(false);
    }
  });

  it("bounds: set 0 to 1,000,000; adjust non-zero within +-1,000,000; integers only", () => {
    for (const ok of [
      { set: MAX_SELLER_STOCK },
      { adjust: MAX_SELLER_STOCK },
      { adjust: -MAX_SELLER_STOCK },
    ]) {
      expect(stockBodySchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of [
      { set: -1 },
      { set: MAX_SELLER_STOCK + 1 },
      { adjust: 0 },
      { adjust: MAX_SELLER_STOCK + 1 },
      { adjust: -MAX_SELLER_STOCK - 1 },
      { set: 0.5 },
      { set: "1" },
      { set: 1, storeId: "x" },
    ]) {
      expect(stockBodySchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("listSellerProductsQuerySchema", () => {
  it("defaults, filters, and strips unknown parameters such as storeId", () => {
    expect(listSellerProductsQuerySchema.parse({ storeId: "other" })).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(
      listSellerProductsQuerySchema.parse({
        status: "DRAFT",
        moderationStatus: "REJECTED",
        lowStock: "true",
        soldOut: "true",
      }),
    ).toMatchObject({
      status: "DRAFT",
      moderationStatus: "REJECTED",
      lowStock: true,
      soldOut: true,
    });
  });

  it("refuses page size over 50, unknown statuses, and flags other than true", () => {
    for (const query of [
      { pageSize: "51" },
      { page: "0" },
      { status: "GONE" },
      { moderationStatus: "OK" },
      { lowStock: "false" },
      { soldOut: "1" },
    ]) {
      expect(listSellerProductsQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe("productIdParamsSchema", () => {
  it("checks the form only", () => {
    expect(productIdParamsSchema.parse({ id: "abc" })).toEqual({ id: "abc" });
    for (const id of ["", "a".repeat(201), "a\u0000b", "\uD800"]) {
      expect(productIdParamsSchema.safeParse({ id }).success).toBe(false);
    }
  });
});
