import { describe, expect, it } from "vitest";
import type { SellerProductDto } from "@/modules/inventory/schema";
import { productEditableKey, storeEditableKey } from "./editable-key";

const product: SellerProductDto = {
  id: "p1",
  slug: "s",
  title: "title",
  description: "description",
  sku: "SKU-1",
  category: { id: "c1", name: "cat", isActive: true },
  priceSatang: 25_900,
  stock: 4,
  lowStock: true,
  soldOut: false,
  status: "PUBLISHED",
  moderationStatus: "APPROVED",
  moderationNote: null,
  images: [],
  isSample: false,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

const store = {
  name: "shop",
  description: "about" as string | null,
  contactPhone: "0812345678",
  logo: null,
};

describe("productEditableKey", () => {
  it("is stable for the same record", () => {
    expect(productEditableKey(product)).toBe(productEditableKey({ ...product }));
  });

  it("differs from the key of no product", () => {
    expect(productEditableKey(undefined)).toBe("null");
    expect(productEditableKey(product)).not.toBe(productEditableKey(undefined));
  });

  it("changes when an editable field changes", () => {
    const base = productEditableKey(product);
    expect(productEditableKey({ ...product, title: "other" })).not.toBe(base);
    expect(productEditableKey({ ...product, description: "other" })).not.toBe(base);
    expect(productEditableKey({ ...product, sku: "SKU-2" })).not.toBe(base);
    expect(productEditableKey({ ...product, priceSatang: 100 })).not.toBe(base);
    expect(
      productEditableKey({ ...product, category: { id: "c2", name: "cat", isActive: true } }),
    ).not.toBe(base);
    expect(
      productEditableKey({ ...product, images: [{ key: "k", url: "/u", alt: "" } as never] }),
    ).not.toBe(base);
  });

  it("ignores stock and fields the form does not edit", () => {
    const base = productEditableKey(product);
    expect(productEditableKey({ ...product, stock: 99 })).toBe(base);
    expect(productEditableKey({ ...product, status: "ARCHIVED" })).toBe(base);
    expect(productEditableKey({ ...product, updatedAt: "2026-10-21T00:00:00.000Z" })).toBe(base);
  });
});

describe("storeEditableKey", () => {
  it("is stable for the same fields", () => {
    expect(storeEditableKey(store)).toBe(storeEditableKey({ ...store }));
  });

  it("changes when an editable field changes", () => {
    const base = storeEditableKey(store);
    expect(storeEditableKey({ ...store, name: "other" })).not.toBe(base);
    expect(storeEditableKey({ ...store, description: null })).not.toBe(base);
    expect(storeEditableKey({ ...store, contactPhone: "0899999999" })).not.toBe(base);
    expect(storeEditableKey({ ...store, logo: { key: "k", url: "/u" } as never })).not.toBe(base);
  });

  it("does not confuse a field boundary", () => {
    expect(storeEditableKey({ ...store, name: "a", description: "bc" })).not.toBe(
      storeEditableKey({ ...store, name: "ab", description: "c" }),
    );
  });
});
