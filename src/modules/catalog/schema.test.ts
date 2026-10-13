import { describe, expect, it } from "vitest";

import { parseInput } from "@/server/http";
import { AppError } from "@/server/errors";

import {
  DEFAULT_PAGE_SIZE,
  listCategoriesQuerySchema,
  listProductsQuerySchema,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  MAX_SEARCH_TEXT_LENGTH,
  MAX_SLUG_LENGTH,
  queryRecord,
  slugParamsSchema,
} from "./schema";

function products(query: string) {
  return parseInput(listProductsQuerySchema, queryRecord(new URLSearchParams(query)));
}

function fieldsOf(run: () => unknown): { path: string; code: string }[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("VALIDATION_ERROR");
    expect(appError.status).toBe(400);
    return (appError.details["fields"] as { path: string; code: string }[]).map((field) => ({
      path: field.path,
      code: field.code,
    }));
  }
  throw new Error("expected a validation error");
}

describe("pagination", () => {
  it("defaults to page 1 and page size 20", () => {
    expect(products("")).toMatchObject({ page: 1, pageSize: DEFAULT_PAGE_SIZE, sort: "newest" });
    expect(DEFAULT_PAGE_SIZE).toBe(20);
  });

  it("accepts page size 1 to 50 and refuses 51 instead of clamping it", () => {
    expect(MAX_PAGE_SIZE).toBe(50);
    expect(products("pageSize=1").pageSize).toBe(1);
    expect(products("pageSize=50").pageSize).toBe(50);
    expect(fieldsOf(() => products("pageSize=51"))).toEqual([
      { path: "pageSize", code: "too_big" },
    ]);
    expect(fieldsOf(() => products("pageSize=1000"))[0]?.path).toBe("pageSize");
  });

  it.each(["0", "-1", "+1", "1.5", "1e1", "0x10", " 1", "1 ", "", "abc", "１"])(
    "refuses page %j",
    (value) => {
      expect(fieldsOf(() => products(`page=${encodeURIComponent(value)}`))[0]?.path).toBe("page");
    },
  );

  it.each(["0", "-5", "2.0", "", "51"])("refuses pageSize %j", (value) => {
    expect(fieldsOf(() => products(`pageSize=${encodeURIComponent(value)}`))[0]?.path).toBe(
      "pageSize",
    );
  });

  it("accepts a very large page (an empty page, not an error) up to 14 digits", () => {
    expect(products("page=99999999999999").page).toBe(99_999_999_999_999);
    expect(fieldsOf(() => products("page=100000000000000"))[0]?.path).toBe("page");
    expect(fieldsOf(() => products("page=999999999999999"))[0]?.path).toBe("page");
  });

  it("keeps the offset of the largest page a safe integer (CR-84)", () => {
    expect(MAX_PAGE).toBe(99_999_999_999_999);
    const largestOffset = (MAX_PAGE - 1) * MAX_PAGE_SIZE;
    expect(Number.isSafeInteger(largestOffset)).toBe(true);
  });

  it("refuses a known parameter given twice", () => {
    expect(fieldsOf(() => products("page=1&page=2"))).toEqual([
      { path: "page", code: "invalid_type" },
    ]);
    expect(fieldsOf(() => products("sort=newest&sort=price_asc"))[0]?.path).toBe("sort");
  });

  it("ignores unknown parameters, storeId and userId included", () => {
    const query = products("storeId=s1&userId=u1&role=ADMIN&foo=1&foo=2");
    expect(query).not.toHaveProperty("storeId");
    expect(query).not.toHaveProperty("userId");
    expect(query).not.toHaveProperty("role");
    expect(query).not.toHaveProperty("foo");
  });

  it("the category list has the same pagination", () => {
    const parse = (text: string) =>
      parseInput(listCategoriesQuerySchema, queryRecord(new URLSearchParams(text)));
    expect(parse("")).toEqual({ page: 1, pageSize: 20 });
    expect(() => parse("pageSize=51")).toThrow(AppError);
  });
});

describe("price filter", () => {
  it("accepts integer satang from 0 to 100,000,000", () => {
    expect(products("minPriceSatang=0&maxPriceSatang=100000000")).toMatchObject({
      minPriceSatang: 0,
      maxPriceSatang: 100_000_000,
    });
  });

  it.each(["-1", "100000001", "1.5", "10.00", "1e3", "abc"])("refuses %j", (value) => {
    expect(fieldsOf(() => products(`minPriceSatang=${encodeURIComponent(value)}`))[0]?.path).toBe(
      "minPriceSatang",
    );
    expect(fieldsOf(() => products(`maxPriceSatang=${encodeURIComponent(value)}`))[0]?.path).toBe(
      "maxPriceSatang",
    );
  });

  it("refuses a maximum lower than the minimum, and accepts equal bounds", () => {
    expect(fieldsOf(() => products("minPriceSatang=500&maxPriceSatang=499"))).toEqual([
      { path: "maxPriceSatang", code: "custom" },
    ]);
    expect(products("minPriceSatang=500&maxPriceSatang=500")).toMatchObject({
      minPriceSatang: 500,
      maxPriceSatang: 500,
    });
  });

  it("the old names minPrice and maxPrice are not interpreted", () => {
    const query = products("minPrice=1&maxPrice=2");
    expect(query.minPriceSatang).toBeUndefined();
    expect(query.maxPriceSatang).toBeUndefined();
  });
});

describe("sort", () => {
  it.each(["newest", "price_asc", "price_desc"])("accepts %s", (sort) => {
    expect(products(`sort=${sort}`).sort).toBe(sort);
  });

  it.each(["", "NEWEST", "price", "createdAt"])("refuses %j", (sort) => {
    expect(fieldsOf(() => products(`sort=${sort}`))[0]?.path).toBe("sort");
  });
});

describe("search text", () => {
  it("trims the text, and blank is the same as no search", () => {
    expect(products("q=%20%20ผ้า%20").q).toBe("ผ้า");
    expect(products("q=").q).toBeUndefined();
    expect(products("q=%20%20").q).toBeUndefined();
  });

  it("keeps LIKE wildcards as text", () => {
    expect(products("q=50%25_off").q).toBe("50%_off");
  });

  it(`accepts ${MAX_SEARCH_TEXT_LENGTH} characters and refuses one more`, () => {
    expect(products(`q=${"ก".repeat(MAX_SEARCH_TEXT_LENGTH)}`).q).toHaveLength(
      MAX_SEARCH_TEXT_LENGTH,
    );
    expect(fieldsOf(() => products(`q=${"a".repeat(MAX_SEARCH_TEXT_LENGTH + 1)}`))[0]?.path).toBe(
      "q",
    );
  });

  it("refuses U+0000 and a lone surrogate", () => {
    expect(fieldsOf(() => products("q=a%00b"))[0]?.path).toBe("q");
    expect(fieldsOf(() => parseInput(listProductsQuerySchema, { q: "a\ud83d" }))[0]?.path).toBe(
      "q",
    );
  });
});

describe("slugs", () => {
  const slug = (value: unknown) => parseInput(slugParamsSchema, { slug: value }).slug;

  it("passes a plain slug through", () => {
    expect(slug("ผ้าไหม-k3m9x2qa")).toBe("ผ้าไหม-k3m9x2qa");
  });

  it("decodes a percent-encoded slug once and normalises it to NFC", () => {
    expect(slug(encodeURIComponent("ผ้าไหม-k3m9x2qa"))).toBe("ผ้าไหม-k3m9x2qa");
    expect(slug("é-abc")).toBe("é-abc");
  });

  it("decodes a % left by the framework once more, as accepted in CR-90", () => {
    // `/products/%2541` reaches the schema as `%41` once the framework has decoded it.
    expect(slug("%41")).toBe("A");
    // Given still encoded, `%2541` is decoded once only, to a slug that matches nothing.
    expect(slug("%2541")).toBe("%41");
  });

  it("refuses a broken escape, an empty slug, U+0000, and an absurd length", () => {
    expect(() => slug("%E0%B8")).toThrow(AppError);
    expect(() => slug("")).toThrow(AppError);
    expect(() => slug("a%00b")).toThrow(AppError);
    expect(() => slug("a".repeat(MAX_SLUG_LENGTH + 1))).toThrow(AppError);
    expect(slug("a".repeat(MAX_SLUG_LENGTH))).toHaveLength(MAX_SLUG_LENGTH);
  });

  it("validates the category parameter in the same way", () => {
    expect(products(`category=${encodeURIComponent("เสื้อ-abcdefgh")}`).category).toBe(
      "เสื้อ-abcdefgh",
    );
    expect(fieldsOf(() => products("category="))[0]?.path).toBe("category");
  });
});

describe("queryRecord", () => {
  it("gives a single value as a string and a repeated one as a list", () => {
    const record = queryRecord(new URLSearchParams("a=1&b=2&b=3"));
    expect(record["a"]).toBe("1");
    expect(record["b"]).toEqual(["2", "3"]);
  });

  it("does not let __proto__ reach the prototype", () => {
    const record = queryRecord(new URLSearchParams("__proto__=x&constructor=y"));
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(record["__proto__"]).toBe("x");
    expect(products("__proto__=x")).toMatchObject({ page: 1 });
  });
});
