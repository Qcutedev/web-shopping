import { describe, expect, it } from "vitest";
import { hrefParamsOf, listHref } from "./list-href";

describe("listHref", () => {
  it("is the plain path for the first page of the default order", () => {
    expect(listHref("/search", {}, 1)).toBe("/search");
    expect(listHref("/search", { sort: "newest", q: "" }, 1)).toBe("/search");
  });

  it("keeps q and sort, and adds page only above 1", () => {
    expect(listHref("/search", { q: "กาแฟ", sort: "price_asc" }, 3)).toBe(
      `/search?q=${encodeURIComponent("กาแฟ")}&sort=price_asc&page=3`,
    );
  });

  it("carries category and both price bounds, including 0", () => {
    expect(
      listHref(
        "/search",
        { q: "a", category: "tea", minPriceSatang: 0, maxPriceSatang: 50000, sort: "price_desc" },
        2,
      ),
    ).toBe("/search?q=a&category=tea&minPriceSatang=0&maxPriceSatang=50000&sort=price_desc&page=2");
  });

  it("hrefParamsOf takes every filter from a parsed query and honours overrides", () => {
    const query = {
      page: 4,
      pageSize: 20,
      q: "x",
      category: "tea",
      minPriceSatang: 100,
      maxPriceSatang: 900,
      sort: "price_asc" as const,
    };
    expect(listHref("/search", hrefParamsOf(query), 1)).toBe(
      "/search?q=x&category=tea&minPriceSatang=100&maxPriceSatang=900&sort=price_asc",
    );
    expect(listHref("/categories/tea", hrefParamsOf(query, { category: undefined }), 1)).toBe(
      "/categories/tea?q=x&minPriceSatang=100&maxPriceSatang=900&sort=price_asc",
    );
    expect(listHref("/search", hrefParamsOf(query, { sort: "newest" }), 1)).not.toContain("sort=");
  });

  it("encodes text that could change the query", () => {
    expect(listHref("/search", { q: "a&page=9#x" }, 1)).toBe("/search?q=a%26page%3D9%23x");
  });
});
