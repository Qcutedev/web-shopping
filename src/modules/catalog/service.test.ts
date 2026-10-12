/**
 * The pure mapping from rows to response shapes. The reads themselves are covered against a
 * real database in tests/integration/catalog.
 */
import { describe, expect, it } from "vitest";

import { imageRef } from "./image";
import { escapeLikePattern } from "./repository";
import {
  toCategoryDto,
  toProductDetailDto,
  toProductListItemDto,
  toReviewDto,
  toReviewSummary,
  toStoreDto,
} from "./service";

const store = { name: "ร้านทดสอบ", slug: "ร้านทดสอบ-abcdefgh", isSample: false };

describe("toReviewSummary", () => {
  it("is null when there is no review", () => {
    expect(toReviewSummary({ count: 0, ratingSum: 0 })).toBeNull();
  });

  it("rounds the mean to one decimal place from integer figures", () => {
    expect(toReviewSummary({ count: 8, ratingSum: 36 })).toEqual({ averageRating: 4.5, count: 8 });
    expect(toReviewSummary({ count: 3, ratingSum: 14 })).toEqual({ averageRating: 4.7, count: 3 });
    expect(toReviewSummary({ count: 3, ratingSum: 13 })).toEqual({ averageRating: 4.3, count: 3 });
    expect(toReviewSummary({ count: 1, ratingSum: 5 })).toEqual({ averageRating: 5, count: 1 });
    expect(toReviewSummary({ count: 20, ratingSum: 89 })).toEqual({
      averageRating: 4.5,
      count: 20,
    });
  });
});

describe("toProductListItemDto", () => {
  const row = {
    id: "p1",
    slug: "p-1",
    title: "สินค้า",
    priceSatang: 25_900,
    stock: 0,
    isSample: true,
    store,
    images: [{ upload: { storageKey: "k1" } }],
  };

  it("passes the price on as integer satang and marks stock 0 as sold out", () => {
    const dto = toProductListItemDto(row);
    expect(dto).toEqual({
      id: "p1",
      slug: "p-1",
      title: "สินค้า",
      priceSatang: 25_900,
      image: { key: "k1", url: "/api/files/k1" },
      soldOut: true,
      isSample: true,
      store,
    });
    expect(Number.isInteger(dto.priceSatang)).toBe(true);
  });

  it("has a null image when the product has none, and is not sold out with stock", () => {
    const dto = toProductListItemDto({ ...row, stock: 3, images: [] });
    expect(dto.image).toBeNull();
    expect(dto.soldOut).toBe(false);
  });

  it("never carries the stock figure, a SKU, a moderation field, or an owner id", () => {
    const keys = Object.keys(toProductListItemDto(row));
    expect(keys).not.toContain("stock");
    expect(keys).not.toContain("sku");
    expect(keys).not.toContain("moderationStatus");
    expect(keys).not.toContain("ownerId");
  });
});

describe("toProductDetailDto", () => {
  it("keeps the picture order and carries stock for the quantity selector", () => {
    const dto = toProductDetailDto(
      {
        id: "p1",
        slug: "p-1",
        title: "t",
        description: "d",
        priceSatang: 100,
        stock: 12,
        isSample: false,
        category: { name: "c", slug: "c-1" },
        store,
        images: [{ upload: { storageKey: "a" } }, { upload: { storageKey: "b" } }],
      },
      { count: 2, ratingSum: 9 },
    );
    expect(dto.images.map((image) => image.key)).toEqual(["a", "b"]);
    expect(dto.stock).toBe(12);
    expect(dto.soldOut).toBe(false);
    expect(dto.reviewSummary).toEqual({ averageRating: 4.5, count: 2 });
    expect(Object.keys(dto).sort()).toEqual(
      [
        "id",
        "slug",
        "title",
        "description",
        "priceSatang",
        "stock",
        "soldOut",
        "images",
        "category",
        "store",
        "reviewSummary",
        "isSample",
      ].sort(),
    );
  });
});

describe("toStoreDto", () => {
  it("maps the logo and never carries the contact phone or the owner", () => {
    const dto = toStoreDto({
      id: "s1",
      name: "n",
      slug: "s",
      description: null,
      isSample: false,
      logoUpload: { storageKey: "logo" },
    });
    expect(dto).toEqual({
      id: "s1",
      name: "n",
      slug: "s",
      description: null,
      logo: { key: "logo", url: "/api/files/logo" },
      isSample: false,
    });
    expect(
      toStoreDto({
        id: "s1",
        name: "n",
        slug: "s",
        description: "x",
        isSample: false,
        logoUpload: null,
      }).logo,
    ).toBeNull();
  });
});

describe("toCategoryDto and toReviewDto", () => {
  it("map the documented keys only", () => {
    expect(toCategoryDto({ id: "c", name: "n", slug: "s", isSample: true })).toEqual({
      id: "c",
      name: "n",
      slug: "s",
      isSample: true,
    });
    expect(
      toReviewDto({
        id: "r",
        rating: 4,
        comment: "<b>ดี</b>",
        createdAt: new Date("2026-10-11T03:20:00.000Z"),
      }),
    ).toEqual({ id: "r", rating: 4, comment: "<b>ดี</b>", createdAt: "2026-10-11T03:20:00.000Z" });
  });
});

describe("imageRef", () => {
  it("percent-encodes the key into the file path", () => {
    expect(imageRef("a/../b c")).toEqual({ key: "a/../b c", url: "/api/files/a%2F..%2Fb%20c" });
  });
});

describe("escapeLikePattern", () => {
  it("escapes the LIKE wildcards and the escape character", () => {
    expect(escapeLikePattern("50%_off\\x")).toBe("50\\%\\_off\\\\x");
    expect(escapeLikePattern("ผ้าไหม")).toBe("ผ้าไหม");
  });
});
