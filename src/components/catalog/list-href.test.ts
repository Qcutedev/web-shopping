import { describe, expect, it } from "vitest";
import { listHref } from "./list-href";

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

  it("encodes text that could change the query", () => {
    expect(listHref("/search", { q: "a&page=9#x" }, 1)).toBe("/search?q=a%26page%3D9%23x");
  });
});
