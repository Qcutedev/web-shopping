import { describe, expect, it } from "vitest";
import { parseListQuery } from "./list-query";

describe("parseListQuery", () => {
  it("applies the catalog defaults", () => {
    expect(parseListQuery({})).toEqual({ page: 1, pageSize: 20, sort: "newest" });
  });

  it("trims q and treats blank q as absent", () => {
    expect(parseListQuery({ q: "  ชา  " })?.q).toBe("ชา");
    expect(parseListQuery({ q: "   " })?.q).toBeUndefined();
  });

  it("refuses a repeated parameter, a bad page, and an unknown sort", () => {
    expect(parseListQuery({ q: ["a", "b"] })).toBeNull();
    expect(parseListQuery({ page: "0" })).toBeNull();
    expect(parseListQuery({ page: "1.5" })).toBeNull();
    expect(parseListQuery({ sort: "random" })).toBeNull();
  });

  it("lets the path category replace a category in the query string", () => {
    expect(parseListQuery({ category: "x" }, { category: "tea" })?.category).toBe("tea");
  });

  it("ignores parameters it does not know, such as storeId", () => {
    expect(parseListQuery({ storeId: "s1" })).toEqual({ page: 1, pageSize: 20, sort: "newest" });
  });
});
