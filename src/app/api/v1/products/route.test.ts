/**
 * Route-level tests of `GET /api/v1/products` (docs/API_CONTRACTS.md sections 2.2, 5.2, 5.2.1).
 *
 * No database is reached: the catalog service is replaced by mocks, so these tests cover only
 * what the handler and its frame decide (query validation, the envelope, the error mapping, the
 * order of `connection()` and the service). Filtering and ordering of rows are covered by the
 * integration tests under tests/integration/catalog.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ListProductsQuery, ProductListItemDto } from "@/modules/catalog";
import { listProducts } from "@/modules/catalog/service";
import { notFound } from "@/server/errors";

import * as routeModule from "./route";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 } }),
}));
vi.mock("@/modules/catalog/service", () => ({
  getProduct: vi.fn(),
  getStore: vi.fn(),
  listCategories: vi.fn(),
  listProductReviews: vi.fn(),
  listProducts: vi.fn(),
  listStoreProducts: vi.fn(),
}));

const { GET } = routeModule;
const connectionMock = vi.mocked(connection);
const listProductsMock = vi.mocked(listProducts);

const ORIGIN = "http://localhost";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANARY = "Zq7SECRETcanary";

const DEFAULT_QUERY: ListProductsQuery = { page: 1, pageSize: 20, sort: "newest" };

const ITEM: ProductListItemDto = {
  id: "prod_1",
  slug: "t-shirt-a1b2c3d4",
  title: "เสื้อยืด",
  priceSatang: 25_900,
  image: { key: "uploads/a.webp", url: "/api/files/uploads%2Fa.webp" },
  soldOut: false,
  isSample: true,
  store: { name: "ร้านตัวอย่าง", slug: "sample-store", isSample: true },
};

interface FieldError {
  path: string;
  code: string;
  message: string;
}
interface ErrorEnvelope {
  error: { code: string; message: string; details: { fields?: FieldError[] }; requestId: string };
}

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  connectionMock.mockReset();
  connectionMock.mockResolvedValue(undefined);
  listProductsMock.mockReset();
  listProductsMock.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function get(query = "", headers: HeadersInit = {}): Promise<Response> {
  return GET(new Request(`${ORIGIN}/api/v1/products${query}`, { headers }));
}

async function expectValidationError(response: Response): Promise<FieldError[]> {
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as ErrorEnvelope;
  expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message", "requestId"]);
  expect(body.error.code).toBe("VALIDATION_ERROR");
  expect(body.error.message).toBe("The request is invalid.");
  expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  expect(listProductsMock).not.toHaveBeenCalled();
  return body.error.details.fields ?? [];
}

describe("GET /api/v1/products: the route module", () => {
  it("exports GET only, so every other method is the framework's 405", () => {
    expect(Object.keys(routeModule)).toEqual(["GET"]);
  });

  it("imports only the catalog surface and the shared frame: no Prisma, no db, no service internals", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.sort()).toEqual([
      "@/modules/catalog",
      "@/server/http",
      "@/server/public-get",
    ]);
    expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
    expect(source).not.toMatch(/requireActor|rate-?limit|cookies\s*\(/i);
  });
});

describe("GET /api/v1/products: success", () => {
  it("calls the service once with the defaults and answers the list envelope", async () => {
    listProductsMock.mockResolvedValue({ items: [ITEM], page: 1, pageSize: 20, total: 21 });

    const response = await get();

    expect(listProductsMock).toHaveBeenCalledTimes(1);
    expect(listProductsMock).toHaveBeenCalledWith(DEFAULT_QUERY);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    expect(await response.json()).toEqual({
      data: [ITEM],
      meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
    });
    expect(lines).toEqual([]);
  });

  it("hands every filter to the service in its parsed form", async () => {
    const query = new URLSearchParams({
      q: "  เสื้อ 100%_\\  ",
      category: "clothes",
      minPriceSatang: "0",
      maxPriceSatang: "100000000",
      sort: "price_desc",
      page: "2",
      pageSize: "10",
    });

    const response = await get(`?${query.toString()}`);

    expect(response.status).toBe(200);
    expect(listProductsMock).toHaveBeenCalledWith({
      q: "เสื้อ 100%_\\",
      category: "clothes",
      minPriceSatang: 0,
      maxPriceSatang: 100_000_000,
      sort: "price_desc",
      page: 2,
      pageSize: 10,
    });
  });

  it("treats a blank q as no q", async () => {
    await get("?q=%20%20%20");
    const [query] = listProductsMock.mock.calls[0] ?? [];
    expect(query?.q).toBeUndefined();
  });

  it("accepts equal price bounds", async () => {
    const response = await get("?minPriceSatang=500&maxPriceSatang=500");
    expect(response.status).toBe(200);
    expect(listProductsMock).toHaveBeenCalledWith({
      ...DEFAULT_QUERY,
      minPriceSatang: 500,
      maxPriceSatang: 500,
    });
  });

  it("decodes a percent-encoded category slug and normalises it to NFC", async () => {
    // "e" + combining acute (NFD), percent-encoded once more than the URL parser removes.
    await get("?category=caf%2565%25CC%2581");
    expect(listProductsMock).toHaveBeenCalledWith({ ...DEFAULT_QUERY, category: "café" });
  });

  it("drops unknown parameters, storeId, userId, and role included, and ignores a session cookie", async () => {
    const response = await get("?storeId=s1&userId=u1&role=ADMIN&minPrice=1&maxPrice=2", {
      cookie: "better-auth.session_token=abc",
    });

    expect(response.status).toBe(200);
    expect(listProductsMock).toHaveBeenCalledWith(DEFAULT_QUERY);
    const [query] = listProductsMock.mock.calls[0] ?? [];
    expect(Object.keys(query ?? {}).sort()).toEqual(["page", "pageSize", "sort"]);
  });
});

describe("GET /api/v1/products: query validation (400)", () => {
  it.each([
    ["pageSize above 50", "?pageSize=51", "pageSize", "too_big"],
    ["page 0", "?page=0", "page", "too_small"],
    ["an unknown sort", "?sort=popular", "sort", "invalid_value"],
    ["an empty sort", "?sort=", "sort", "invalid_value"],
    ["a sort given twice", "?sort=newest&sort=price_asc", "sort", "invalid_type"],
    ["a negative price", "?minPriceSatang=-1", "minPriceSatang", "invalid_format"],
    ["a fractional price", "?minPriceSatang=10.5", "minPriceSatang", "invalid_format"],
    ["a price in exponent form", "?maxPriceSatang=1e3", "maxPriceSatang", "invalid_format"],
    ["a price above the bound", "?maxPriceSatang=100000001", "maxPriceSatang", "too_big"],
    ["full-width digits", "?page=%EF%BC%91", "page", "invalid_format"],
    ["q over 100 characters", `?q=${"a".repeat(101)}`, "q", "too_big"],
    ["q with U+0000", "?q=a%00b", "q", "custom"],
    ["a category with a broken escape", "?category=%25E0%25B8", "category", "custom"],
    ["an empty category", "?category=", "category", "too_small"],
  ])("refuses %s", async (_label, query, path, code) => {
    const fields = await expectValidationError(await get(query));
    expect(fields).toEqual([expect.objectContaining({ path, code })]);
  });

  it("refuses maxPriceSatang below minPriceSatang on the path maxPriceSatang (code custom)", async () => {
    const fields = await expectValidationError(await get("?minPriceSatang=500&maxPriceSatang=499"));
    expect(fields).toEqual([
      { path: "maxPriceSatang", code: "custom", message: "Must not be lower than minPriceSatang." },
    ]);
  });

  it("never hands the service a lone surrogate: the URL decoder turns the bytes into U+FFFD", async () => {
    // %ED%A0%80 is the UTF-8 form of U+D800, which is not valid UTF-8. URLSearchParams decodes
    // it with replacement characters, so the schema's lone-surrogate check cannot be reached
    // through a query string; what arrives is well-formed text and is searched as such.
    const response = await get("?q=%ED%A0%80");
    expect(response.status).toBe(200);
    const [query] = listProductsMock.mock.calls[0] ?? [];
    expect(query?.q).toBe("���");
    expect(query?.q?.isWellFormed()).toBe(true);
  });

  it("reports every invalid parameter, and never the rejected value", async () => {
    const response = await get(`?page=${CANARY}&sort=${CANARY}`);
    const text = await response.clone().text();
    expect(text).not.toContain(CANARY);
    const fields = await expectValidationError(response);
    expect(fields.map((field) => field.path).sort()).toEqual(["page", "sort"]);
  });
});

describe("GET /api/v1/products: service errors and the frame", () => {
  it("maps the service's 404 (unknown or inactive category) to the envelope with empty details", async () => {
    listProductsMock.mockRejectedValue(notFound());

    const response = await get("?category=missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "The resource was not found.",
        details: {},
        requestId: response.headers.get("x-request-id"),
      },
    });
    expect(lines).toEqual([]);
  });

  it("turns an unknown error into a 500 that discloses nothing and is logged once", async () => {
    listProductsMock.mockRejectedValue(new TypeError(`prisma.product.findMany ${CANARY}`));

    const response = await get();

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain("prisma");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "INTERNAL_ERROR", details: {} } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(CANARY);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      level: "error",
      err: { errorClass: "TypeError" },
    });
  });

  it("awaits connection() before the service runs, and stops when the build interrupts it", async () => {
    await get();
    expect(connectionMock.mock.invocationCallOrder[0]).toBeLessThan(
      listProductsMock.mock.invocationCallOrder[0] ?? 0,
    );

    listProductsMock.mockClear();
    const interruption = new Error("needs to bail out of prerendering");
    connectionMock.mockRejectedValue(interruption);
    await expect(get()).rejects.toBe(interruption);
    expect(listProductsMock).not.toHaveBeenCalled();
  });
});
