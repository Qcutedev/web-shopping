/**
 * The catalog endpoints against a real database: success shapes, pagination and its cap of 50,
 * search, filters, sort, validation failures, and that no GET writes anything (D-029 point 1).
 *
 * All six endpoints are `public` (docs/API_CONTRACTS.md section 5.2), so there is no
 * unauthenticated, wrong-role, or wrong-owner refusal to test. What stands in for them: a
 * request with a session cookie, an `X-Request-Id`, or a `storeId` in the query gets the same
 * answer as one without.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createCategory,
  createProduct,
  createProductImage,
  createReview,
  createStore,
  createUpload,
} from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import {
  callCategories,
  callProduct,
  callProductRawSlug,
  callProductReviews,
  callProducts,
  callStore,
  callStoreProducts,
  type ErrorBody,
  type ListBody,
} from "./call";

// The handlers await `connection()` first (src/server/public-get.ts), which throws outside a
// Next.js request scope. Here it resolves, as it does at request time.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

type Item = {
  id: string;
  slug: string;
  title: string;
  priceSatang: number;
  image: { key: string; url: string } | null;
  soldOut: boolean;
  isSample: boolean;
  store: { name: string; slug: string; isSample: boolean };
};

const WORD = "endpointcase";
const THAI_SLUG = "ผ้าไหมไทย-k3m9x2qa";

let storeA: { id: string; slug: string };
let storeB: { id: string; slug: string };
let categoryX: { id: string; slug: string };
let categoryY: { id: string; slug: string };
let products: { id: string; slug: string; priceSatang: number; createdAt: Date }[];
let reviewed: { id: string; slug: string };
let thai: { id: string; slug: string };

beforeAll(async () => {
  storeA = await createStore({ slug: "store-a", name: "Store A", description: "About A" });
  storeB = await createStore({ slug: "store-b", isSample: true });
  categoryX = await createCategory({ slug: "category-x", sortOrder: 2 });
  categoryY = await createCategory({ slug: "category-y", sortOrder: 1 });

  // Sixty products: prices 1,000 to 60,000 satang in steps of 1,000, created one second
  // apart, alternating stores and categories. Two share a price, to test the id tie-breaker.
  products = [];
  const start = Date.UTC(2026, 9, 1);
  for (let index = 0; index < 60; index += 1) {
    const price = index === 59 ? 30_000 : (index + 1) * 1_000;
    const product = await createProduct({
      storeId: index % 2 === 0 ? storeA.id : storeB.id,
      categoryId: index % 3 === 0 ? categoryX.id : categoryY.id,
      title: `${WORD} item ${String(index).padStart(2, "0")}`,
      slug: `item-${index}`,
      priceSatang: price,
      createdAt: new Date(start + index * 1_000),
    });
    products.push(product);
  }

  reviewed = await createProduct({
    storeId: storeA.id,
    categoryId: categoryX.id,
    title: "Reviewed product",
    slug: "reviewed",
    priceSatang: 25_900,
    stock: 12,
  });
  const second = await createUpload({ storeId: storeA.id, storageKey: "key-second" });
  const first = await createUpload({ storeId: storeA.id, storageKey: "key-first" });
  await createProductImage({ productId: reviewed.id, uploadId: second.id, sortOrder: 1 });
  await createProductImage({ productId: reviewed.id, uploadId: first.id, sortOrder: 0 });
  const reviewTimes = [Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 3), Date.UTC(2026, 9, 4)];
  const ratings = [5, 4, 5];
  for (const [index, rating] of ratings.entries()) {
    await createReview({
      productId: reviewed.id,
      rating,
      comment: index === 0 ? "<script>alert(1)</script>" : null,
      createdAt: new Date(reviewTimes[index] ?? 0),
    });
  }

  thai = await createProduct({
    storeId: storeA.id,
    categoryId: categoryX.id,
    title: "ผ้าไหมไทย สีแดง",
    slug: THAI_SLUG,
  });
  await createProduct({
    storeId: storeA.id,
    categoryId: categoryX.id,
    title: "Discount 50%_off \\ special",
    slug: "wildcard",
  });
});

describe("GET /products", () => {
  it("returns the list envelope with integer satang and no hidden fields", async () => {
    const result = await callProducts<ListBody<Item>>(`q=${WORD}`);
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("X-Request-Id")).toBeTruthy();
    expect(result.body.meta).toEqual({ page: 1, pageSize: 20, total: 60, totalPages: 3 });
    expect(result.body.data).toHaveLength(20);
    for (const item of result.body.data) {
      expect(Number.isInteger(item.priceSatang)).toBe(true);
      expect(Object.keys(item).sort()).toEqual(
        ["id", "slug", "title", "priceSatang", "image", "soldOut", "isSample", "store"].sort(),
      );
      expect(Object.keys(item.store).sort()).toEqual(["isSample", "name", "slug"]);
    }
  });

  it("caps the page size at 50: 50 is served, 51 is 400", async () => {
    const fifty = await callProducts<ListBody<Item>>(`q=${WORD}&pageSize=50`);
    expect(fifty.status).toBe(200);
    expect(fifty.body.data).toHaveLength(50);
    expect(fifty.body.meta).toEqual({ page: 1, pageSize: 50, total: 60, totalPages: 2 });

    const tooMany = await callProducts<ErrorBody>(`q=${WORD}&pageSize=51`);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe("VALIDATION_ERROR");
    expect(tooMany.body.error.details["fields"]).toEqual([
      expect.objectContaining({ path: "pageSize", code: "too_big" }),
    ]);
  });

  it("serves the last partial page and an empty page beyond it with the true total", async () => {
    const last = await callProducts<ListBody<Item>>(`q=${WORD}&pageSize=50&page=2`);
    expect(last.body.data).toHaveLength(10);
    const beyond = await callProducts<ListBody<Item>>(`q=${WORD}&pageSize=50&page=99`);
    expect(beyond.status).toBe(200);
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta).toEqual({ page: 99, pageSize: 50, total: 60, totalPages: 2 });
    const far = await callProducts<ListBody<Item>>(`q=${WORD}&page=999999999999999`);
    expect(far.status).toBe(200);
    expect(far.body.data).toEqual([]);
  });

  it("pages are disjoint and together hold every row once", async () => {
    const ids: string[] = [];
    for (let page = 1; page <= 7; page += 1) {
      const result = await callProducts<ListBody<Item>>(`q=${WORD}&pageSize=9&page=${page}`);
      ids.push(...result.body.data.map((item) => item.id));
    }
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
  });

  it("sorts newest first by default, with id as the tie-breaker", async () => {
    const result = await callProducts<ListBody<Item>>(`q=${WORD}&pageSize=50`);
    const expected = [...products]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, 50)
      .map((product) => product.id);
    expect(result.body.data.map((item) => item.id)).toEqual(expected);
  });

  it("sorts by price ascending and descending, with id as the tie-breaker", async () => {
    const byPrice = (direction: 1 | -1) =>
      [...products]
        .sort((a, b) => direction * (a.priceSatang - b.priceSatang) || (a.id < b.id ? -1 : 1))
        .map((product) => product.id);
    const ascending: string[] = [];
    const descending: string[] = [];
    for (const page of [1, 2]) {
      const up = await callProducts<ListBody<Item>>(
        `q=${WORD}&sort=price_asc&pageSize=50&page=${page}`,
      );
      ascending.push(...up.body.data.map((item) => item.id));
      const down = await callProducts<ListBody<Item>>(
        `q=${WORD}&sort=price_desc&pageSize=50&page=${page}`,
      );
      descending.push(...down.body.data.map((item) => item.id));
    }
    expect(ascending).toEqual(byPrice(1));
    expect(descending).toEqual(byPrice(-1));
  });

  it("filters by price, both bounds inclusive", async () => {
    const result = await callProducts<ListBody<Item>>(
      `q=${WORD}&minPriceSatang=10000&maxPriceSatang=12000&sort=price_asc`,
    );
    expect(result.body.data.map((item) => item.priceSatang)).toEqual([10_000, 11_000, 12_000]);
    const exact = await callProducts<ListBody<Item>>(
      `q=${WORD}&minPriceSatang=30000&maxPriceSatang=30000`,
    );
    expect(exact.body.meta.total).toBe(2);
  });

  it("filters by category slug", async () => {
    const result = await callProducts<ListBody<Item>>(`q=${WORD}&category=category-x&pageSize=50`);
    expect(result.body.meta.total).toBe(20);
  });

  it("searches the title case-insensitively, as a substring", async () => {
    const result = await callProducts<ListBody<Item>>(`q=${WORD.toUpperCase()}%20ITEM%200`);
    expect(result.body.data.map((item) => item.title).sort()).toEqual(
      Array.from({ length: 10 }, (_, index) => `${WORD} item 0${index}`),
    );
  });

  it("searches Thai text", async () => {
    const result = await callProducts<ListBody<Item>>(`q=${encodeURIComponent("ไหมไทย")}`);
    expect(result.body.data.map((item) => item.id)).toEqual([thai.id]);
  });

  it("treats %, _, and backslash in the search text as plain characters", async () => {
    const percent = await callProducts<ListBody<Item>>(`q=${encodeURIComponent("%")}`);
    expect(percent.body.data.map((item) => item.slug)).toEqual(["wildcard"]);
    const underscore = await callProducts<ListBody<Item>>(`q=${encodeURIComponent("0%_o")}`);
    expect(underscore.body.data.map((item) => item.slug)).toEqual(["wildcard"]);
    const backslash = await callProducts<ListBody<Item>>(`q=${encodeURIComponent("\\")}`);
    expect(backslash.body.data.map((item) => item.slug)).toEqual(["wildcard"]);
    const lone = await callProducts<ListBody<Item>>(`q=_`);
    expect(lone.body.data.map((item) => item.slug)).toEqual(["wildcard"]);
  });

  it.each([
    ["pageSize=0", "pageSize"],
    ["page=0", "page"],
    ["page=abc", "page"],
    ["sort=cheapest", "sort"],
    ["minPriceSatang=-1", "minPriceSatang"],
    ["maxPriceSatang=100000001", "maxPriceSatang"],
    ["minPriceSatang=10.5", "minPriceSatang"],
    ["minPriceSatang=500&maxPriceSatang=100", "maxPriceSatang"],
    ["page=1&page=2", "page"],
    ["q=a%00b", "q"],
    [`q=${"a".repeat(101)}`, "q"],
  ])("refuses %s with 400 on %s, echoing nothing", async (query, path) => {
    const result = await callProducts<ErrorBody>(query);
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
    const fields = result.body.error.details["fields"] as { path: string }[];
    expect(fields.map((field) => field.path)).toContain(path);
    expect(JSON.stringify(result.body)).not.toContain("cheapest");
    expect(result.body.error.requestId).toBe(result.headers.get("X-Request-Id"));
  });

  it("ignores storeId, userId, and role in the query, and a session cookie", async () => {
    const plain = await callProducts<ListBody<Item>>(`q=${WORD}&pageSize=50`);
    const tampered = await callProducts<ListBody<Item>>(
      `q=${WORD}&pageSize=50&storeId=${storeA.id}&userId=x&role=ADMIN`,
      { Cookie: "better-auth.session_token=forged", "X-Request-Id": "client-chosen-0001" },
    );
    expect(tampered.status).toBe(200);
    expect(tampered.body).toEqual(plain.body);
    expect(tampered.headers.get("X-Request-Id")).not.toBe("client-chosen-0001");
  });
});

describe("GET /products/{slug}", () => {
  it("returns the detail shape with ordered pictures and the review summary", async () => {
    const result = await callProduct<{ data: Record<string, unknown> }>(reviewed.slug);
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({
      id: reviewed.id,
      slug: "reviewed",
      title: "Reviewed product",
      description: "Test product description",
      priceSatang: 25_900,
      stock: 12,
      soldOut: false,
      images: [
        { key: "key-first", url: "/api/files/key-first" },
        { key: "key-second", url: "/api/files/key-second" },
      ],
      category: { name: expect.any(String), slug: "category-x" },
      store: { name: "Store A", slug: "store-a", isSample: false },
      reviewSummary: { averageRating: 4.7, count: 3 },
      isSample: false,
    });
  });

  it("has reviewSummary null without reviews, and the list image is the first picture", async () => {
    const other = products[0];
    if (other === undefined) throw new Error("fixture missing");
    const detail = await callProduct<{ data: { reviewSummary: unknown; images: unknown[] } }>(
      other.slug,
    );
    expect(detail.body.data.reviewSummary).toBeNull();
    expect(detail.body.data.images).toEqual([]);

    const list = await callProducts<ListBody<Item>>(`q=${encodeURIComponent("Reviewed product")}`);
    expect(list.body.data[0]?.image).toEqual({ key: "key-first", url: "/api/files/key-first" });
  });

  it("finds a Thai slug sent percent-encoded, raw, or decomposed", async () => {
    expect((await callProduct(THAI_SLUG)).status).toBe(200);
    expect((await callProductRawSlug(encodeURIComponent(THAI_SLUG))).status).toBe(200);
    expect((await callProductRawSlug(THAI_SLUG)).status).toBe(200);
  });

  it("answers 404 for an unknown slug and 400 for a broken escape", async () => {
    const unknown = await callProduct<ErrorBody>("does-not-exist");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatchObject({ code: "NOT_FOUND", details: {} });
    const broken = await callProductRawSlug<ErrorBody>("%E0%B8");
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /products/{slug}/reviews", () => {
  it("lists reviews newest first, comment returned exactly as stored", async () => {
    const result = await callProductReviews<
      ListBody<{ id: string; rating: number; comment: string | null; createdAt: string }>
    >(reviewed.slug);
    expect(result.status).toBe(200);
    expect(result.body.meta).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    expect(result.body.data.map((review) => review.createdAt)).toEqual([
      "2026-10-04T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
    ]);
    expect(result.body.data[2]?.comment).toBe("<script>alert(1)</script>");
    for (const review of result.body.data) {
      expect(Object.keys(review).sort()).toEqual(["comment", "createdAt", "id", "rating"]);
    }
  });

  it("paginates and refuses pageSize 51", async () => {
    const page = await callProductReviews<ListBody<unknown>>(reviewed.slug, "pageSize=2&page=2");
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect((await callProductReviews(reviewed.slug, "pageSize=51")).status).toBe(400);
  });

  it("answers 404 for an unknown product", async () => {
    expect((await callProductReviews("does-not-exist")).status).toBe(404);
  });
});

describe("GET /categories", () => {
  it("orders by sortOrder then id and has the documented shape", async () => {
    const result = await callCategories<ListBody<Record<string, unknown>>>("pageSize=50");
    expect(result.status).toBe(200);
    const ours = result.body.data.filter(
      (category) => category["slug"] === "category-x" || category["slug"] === "category-y",
    );
    expect(ours.map((category) => category["slug"])).toEqual(["category-y", "category-x"]);
    expect(Object.keys(ours[0] ?? {}).sort()).toEqual(["id", "isSample", "name", "slug"]);
  });

  it("paginates and refuses pageSize 51", async () => {
    const result = await callCategories<ListBody<unknown>>("pageSize=1");
    expect(result.body.data).toHaveLength(1);
    expect((await callCategories("pageSize=51")).status).toBe(400);
  });
});

describe("GET /stores/{slug} and /stores/{slug}/products", () => {
  it("returns the store shape without phone or owner", async () => {
    const result = await callStore<{ data: Record<string, unknown> }>(storeA.slug);
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({
      id: storeA.id,
      name: "Store A",
      slug: "store-a",
      description: "About A",
      logo: null,
      isSample: false,
    });
  });

  it("lists only that store's products with the same query as /products", async () => {
    const result = await callStoreProducts<ListBody<Item>>(
      storeB.slug,
      `q=${WORD}&sort=price_asc&pageSize=50`,
    );
    expect(result.status).toBe(200);
    expect(result.body.meta.total).toBe(30);
    expect(result.body.data.every((item) => item.store.slug === "store-b")).toBe(true);
    expect(result.body.data.every((item) => item.store.isSample)).toBe(true);
    const prices = result.body.data.map((item) => item.priceSatang);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect((await callStoreProducts(storeB.slug, "pageSize=51")).status).toBe(400);
    expect((await callStoreProducts(storeB.slug, "category=no-such")).status).toBe(404);
  });
});

describe("GET never writes (D-029 point 1)", () => {
  it("leaves every table and sequence unchanged across every endpoint and outcome", async () => {
    const before = await snapshotDatabase();
    await callCategories();
    await callProducts(`q=${WORD}&sort=price_desc&category=category-x&minPriceSatang=1`);
    await callProducts("pageSize=51");
    await callProduct(reviewed.slug);
    await callProduct("does-not-exist");
    await callProductReviews(reviewed.slug);
    await callStore(storeA.slug);
    await callStore("does-not-exist");
    await callStoreProducts(storeA.slug, `q=${WORD}`);
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });
});
