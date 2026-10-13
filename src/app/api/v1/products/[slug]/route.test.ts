/**
 * Route-level tests of `GET /api/v1/products/{slug}` (docs/API_CONTRACTS.md sections 2.2, 5.2,
 * 5.2.1).
 *
 * No database is reached: the catalog service is replaced by mocks, so these tests cover only
 * what the handler and its frame decide (path validation, the envelope, the error mapping). The
 * visibility rule behind the 404 is covered by the integration tests under
 * tests/integration/catalog.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductDetailDto } from "@/modules/catalog";
import { getProduct } from "@/modules/catalog/service";
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
const getProductMock = vi.mocked(getProduct);

const ORIGIN = "http://localhost";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANARY = "Zq7SECRETcanary";

const PRODUCT: ProductDetailDto = {
  id: "prod_1",
  slug: "t-shirt-a1b2c3d4",
  title: "เสื้อยืด",
  description: "ผ้าฝ้าย",
  priceSatang: 25_900,
  stock: 12,
  soldOut: false,
  images: [{ key: "uploads/a.webp", url: "/api/files/uploads%2Fa.webp" }],
  category: { name: "เสื้อผ้า", slug: "clothes" },
  store: { name: "ร้านตัวอย่าง", slug: "sample-store", isSample: true },
  reviewSummary: { averageRating: 4.7, count: 3 },
  isSample: true,
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
  getProductMock.mockReset();
  getProductMock.mockResolvedValue(PRODUCT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** `params` as the framework hands it over: a promise of the already-decoded segment. */
function get(params: unknown, query = "", headers: HeadersInit = {}): Promise<Response> {
  const context = { params: Promise.resolve(params) } as RouteContext<"/api/v1/products/[slug]">;
  return GET(new Request(`${ORIGIN}/api/v1/products/x${query}`, { headers }), context);
}

async function expectValidationError(response: Response): Promise<FieldError[]> {
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as ErrorEnvelope;
  expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message", "requestId"]);
  expect(body.error.code).toBe("VALIDATION_ERROR");
  expect(body.error.message).toBe("The request is invalid.");
  expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  expect(getProductMock).not.toHaveBeenCalled();
  return body.error.details.fields ?? [];
}

describe("GET /api/v1/products/{slug}: the route module", () => {
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

describe("GET /api/v1/products/{slug}: success", () => {
  it("calls the service with the slug alone and answers { data }", async () => {
    const response = await get({ slug: "t-shirt-a1b2c3d4" });

    expect(getProductMock).toHaveBeenCalledTimes(1);
    expect(getProductMock).toHaveBeenCalledWith("t-shirt-a1b2c3d4");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    expect(await response.json()).toEqual({ data: PRODUCT });
    expect(lines).toEqual([]);
  });

  it("ignores the query string and a session cookie", async () => {
    await get({ slug: "abc" }, "?storeId=s1&role=ADMIN&page=0", {
      cookie: "better-auth.session_token=abc",
    });
    expect(getProductMock).toHaveBeenCalledWith("abc");
    expect(getProductMock.mock.calls[0]).toHaveLength(1);
  });

  it("decodes a slug the framework left percent-encoded and normalises it to NFC", async () => {
    await get({ slug: "%E0%B8%AA" });
    expect(getProductMock).toHaveBeenLastCalledWith("ส");

    await get({ slug: "café" });
    expect(getProductMock).toHaveBeenLastCalledWith("café");
  });

  it("accepts a slug of 200 characters", async () => {
    const response = await get({ slug: "a".repeat(200) });
    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/products/{slug}: path validation (400)", () => {
  it.each([
    ["a broken escape", { slug: "%E0%B8" }, "custom"],
    ["an empty slug", { slug: "" }, "too_small"],
    ["a slug over 200 characters", { slug: "a".repeat(201) }, "too_big"],
    ["U+0000", { slug: "a\u0000b" }, "custom"],
    ["a lone surrogate", { slug: "a\uD800" }, "custom"],
    ["a list (catch-all shape)", { slug: ["a", "b"] }, "invalid_type"],
  ])("refuses %s on the path slug", async (_label, params, code) => {
    const fields = await expectValidationError(await get(params));
    expect(fields).toEqual([expect.objectContaining({ path: "slug", code })]);
  });

  it("does not echo the rejected slug", async () => {
    const response = await get({ slug: `${CANARY}\u0000` });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(CANARY);
  });
});

describe("GET /api/v1/products/{slug}: service errors and the frame", () => {
  it("maps the service's 404 (unknown or hidden product) to the envelope with empty details", async () => {
    getProductMock.mockRejectedValue(notFound());

    const response = await get({ slug: "hidden" });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
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
    getProductMock.mockRejectedValue(new Error(`column "sku" ${CANARY}`));

    const response = await get({ slug: "abc" });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain("sku");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "INTERNAL_ERROR", details: {} } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(CANARY);
  });

  it("awaits connection() before the service runs, and stops when the build interrupts it", async () => {
    await get({ slug: "abc" });
    expect(connectionMock.mock.invocationCallOrder[0]).toBeLessThan(
      getProductMock.mock.invocationCallOrder[0] ?? 0,
    );

    getProductMock.mockClear();
    const interruption = new Error("needs to bail out of prerendering");
    connectionMock.mockRejectedValue(interruption);
    await expect(get({ slug: "abc" })).rejects.toBe(interruption);
    expect(getProductMock).not.toHaveBeenCalled();
  });
});
