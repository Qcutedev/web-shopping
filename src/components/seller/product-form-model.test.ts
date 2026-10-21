import { describe, expect, it } from "vitest";
import { th } from "@/i18n/th";
import type { SellerProductDto } from "@/modules/inventory/schema";
import {
  EMPTY_PRODUCT_VALUES,
  parseIntegerInput,
  parsePriceInput,
  validateCreate,
  validateEdit,
  valuesOfProduct,
} from "./product-form-model";

const product: SellerProductDto = {
  id: "p1",
  slug: "s",
  title: "เสื้อ",
  description: "รายละเอียด",
  sku: "SKU-1",
  category: { id: "c1", name: "แฟชั่น", isActive: true },
  priceSatang: 25_900,
  stock: 4,
  lowStock: true,
  soldOut: false,
  status: "PUBLISHED",
  moderationStatus: "APPROVED",
  moderationNote: null,
  images: [
    { key: "a", url: "/api/files/a" },
    { key: "b", url: "/api/files/b" },
  ],
  isSample: false,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

describe("parsePriceInput", () => {
  it("converts baht to integer satang without floats", () => {
    expect(parsePriceInput("259")).toEqual({ ok: true, satang: 25_900 });
    expect(parsePriceInput("259.5")).toEqual({ ok: true, satang: 25_950 });
    expect(parsePriceInput("0.29")).toEqual({ ok: true, satang: 29 });
    expect(parsePriceInput("1.15")).toEqual({ ok: true, satang: 115 });
  });

  it("separates blank from malformed", () => {
    expect(parsePriceInput("  ")).toEqual({ ok: false, kind: "required" });
    expect(parsePriceInput("1.234")).toEqual({ ok: false, kind: "invalid" });
    expect(parsePriceInput("-5")).toEqual({ ok: false, kind: "invalid" });
    expect(parsePriceInput("1e3")).toEqual({ ok: false, kind: "invalid" });
  });
});

describe("parseIntegerInput", () => {
  it("accepts whole numbers, signed only when asked", () => {
    expect(parseIntegerInput("12")).toEqual({ ok: true, value: 12 });
    expect(parseIntegerInput("-3", true)).toEqual({ ok: true, value: -3 });
    expect(parseIntegerInput("-3")).toEqual({ ok: false, kind: "invalid" });
    expect(parseIntegerInput("1.5")).toEqual({ ok: false, kind: "invalid" });
    expect(parseIntegerInput("")).toEqual({ ok: false, kind: "required" });
  });
});

describe("validateCreate", () => {
  const filled = {
    ...EMPTY_PRODUCT_VALUES,
    title: "เสื้อ",
    description: "รายละเอียด",
    sku: "SKU-1",
    categoryId: "c1",
    price: "259",
    stock: "10",
  };

  it("builds the body with satang and omits imageKeys when there are no pictures", () => {
    expect(validateCreate(filled)).toEqual({
      ok: true,
      body: {
        title: "เสื้อ",
        description: "รายละเอียด",
        sku: "SKU-1",
        categoryId: "c1",
        priceSatang: 25_900,
        stock: 10,
      },
    });
  });

  it("sends the keys of the pictures in order", () => {
    const result = validateCreate({ ...filled, images: product.images });
    expect(result.ok && result.body.imageKeys).toEqual(["a", "b"]);
  });

  it("gives Thai messages per field for an empty form", () => {
    const result = validateCreate(EMPTY_PRODUCT_VALUES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      title: th.seller.fieldErrors.title.required,
      description: th.seller.fieldErrors.description.required,
      sku: th.seller.fieldErrors.sku.required,
      categoryId: th.seller.fieldErrors.categoryId.required,
      priceSatang: th.seller.fieldErrors.priceSatang.required,
      stock: th.seller.fieldErrors.stock.required,
    });
  });

  it("refuses a price above the limit, a stock above the limit, and a ninth picture", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ key: `k${index}`, url: "/x" }));
    const result = validateCreate({ ...filled, price: "1000001", stock: "1000001", images: many });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.priceSatang).toBe(th.seller.fieldErrors.priceSatang.tooLong);
    expect(result.errors.stock).toBe(th.seller.fieldErrors.stock.tooLong);
    expect(result.errors.imageKeys).toBe(th.seller.fieldErrors.imageKeys.tooLong);
  });
});

describe("validateEdit", () => {
  const same = valuesOfProduct(product);

  it("reports no change for the stored values", () => {
    expect(validateEdit(product, same)).toEqual({ kind: "nochange" });
  });

  it("shows the stored price in baht", () => {
    expect(same.price).toBe("259");
  });

  it("sends only the changed fields", () => {
    const result = validateEdit(product, { ...same, title: "เสื้อใหม่", price: "300" });
    expect(result).toEqual({
      kind: "checked",
      ok: true,
      body: { title: "เสื้อใหม่", priceSatang: 30_000 },
    });
  });

  it("treats a reorder of pictures as a change and sends the whole order", () => {
    const result = validateEdit(product, { ...same, images: [...same.images].reverse() });
    expect(result).toEqual({ kind: "checked", ok: true, body: { imageKeys: ["b", "a"] } });
  });

  it("does not count a line-break difference of the description as a change", () => {
    const stored = { ...product, description: "ก\nข" };
    expect(validateEdit(stored, { ...valuesOfProduct(stored), description: "ก\r\nข" })).toEqual({
      kind: "nochange",
    });
  });

  it("reports an invalid price even when nothing else changed", () => {
    const result = validateEdit(product, { ...same, price: "abc" });
    expect(result).toMatchObject({
      kind: "checked",
      ok: false,
      errors: { priceSatang: th.seller.fieldErrors.priceSatang.invalid },
    });
  });
});
