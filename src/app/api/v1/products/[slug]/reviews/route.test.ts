/**
 * Route-level tests of `GET /api/v1/products/{slug}/reviews` (docs/API_CONTRACTS.md sections 2.2,
 * 5.2, 5.2.1).
 *
 * No database is reached: the catalog service is replaced by mocks, so these tests cover only
 * what the handler and its frame decide (path and query validation and their order, the
 * envelope, the error mapping).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewDto } from "@/modules/catalog";
import { listProductReviews } from "@/modules/catalog/service";
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
const listReviewsMock = vi.mocked(listProductReviews);

const ORIGIN = "http://localhost";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANARY = "Zq7SECRETcanary";

const REVIEW: ReviewDto = {
  id: "rev_1",
  rating: 5,
  comment: "<b>ดีมาก</b>",
  createdAt: "2026-10-11T03:20:00.000Z",
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
  listReviewsMock.mockReset();
  listReviewsMock.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function get(params: unknown, query = "", headers: HeadersInit = {}): Promise<Response> {
  const context = {
    params: Promise.resolve(params),
  } as RouteContext<"/api/v1/products/[slug]/reviews">;
  return GET(new Request(`${ORIGIN}/api/v1/products/x/reviews${query}`, { headers }), context);
}

async function expectValidationError(response: Response): Promise<FieldError[]> {
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as ErrorEnvelope;
  expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message", "requestId"]);
  expect(body.error.code).toBe("VALIDATION_ERROR");
  expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  expect(listReviewsMock).not.toHaveBeenCalled();
  return body.error.details.fields ?? [];
}

describe("GET /api/v1/products/{slug}/reviews: the route module", () => {
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

describe("GET /api/v1/products/{slug}/reviews: success", () => {
  it("calls the service with the slug and the default page, and answers the list envelope", async () => {
    listReviewsMock.mockResolvedValue({ items: [REVIEW], page: 1, pageSize: 20, total: 1 });

    const response = await get({ slug: "t-shirt-a1b2c3d4" });

    expect(listReviewsMock).toHaveBeenCalledTimes(1);
    expect(listReviewsMock).toHaveBeenCalledWith("t-shirt-a1b2c3d4", { page: 1, pageSize: 20 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    // The comment is returned exactly as stored (REQ-C-14: the frontend escapes it).
    expect(await response.json()).toEqual({
      data: [REVIEW],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
  });

  it("passes the parsed page, decodes the slug, and drops unknown parameters", async () => {
    await get({ slug: "%E0%B8%AA" }, "?page=4&pageSize=5&userId=u1&sort=price_asc", {
      cookie: "better-auth.session_token=abc",
    });
    expect(listReviewsMock).toHaveBeenCalledWith("ส", { page: 4, pageSize: 5 });
  });
});

describe("GET /api/v1/products/{slug}/reviews: validation (400)", () => {
  it.each([
    ["pageSize above 50", "?pageSize=51", "pageSize", "too_big"],
    ["page 0", "?page=0", "page", "too_small"],
    ["a page given twice", "?page=1&page=1", "page", "invalid_type"],
    ["a fractional pageSize", "?pageSize=2.0", "pageSize", "invalid_format"],
  ])("refuses %s in the query", async (_label, query, path, code) => {
    const fields = await expectValidationError(await get({ slug: "abc" }, query));
    expect(fields).toEqual([expect.objectContaining({ path, code })]);
  });

  it("refuses a broken slug escape on the path slug", async () => {
    const fields = await expectValidationError(await get({ slug: "%E0%B8" }));
    expect(fields).toEqual([expect.objectContaining({ path: "slug", code: "custom" })]);
  });

  it("validates the path before the query: with both invalid only the slug is reported", async () => {
    const fields = await expectValidationError(await get({ slug: "" }, "?pageSize=999"));
    expect(fields.map((field) => field.path)).toEqual(["slug"]);
  });

  it("does not echo the rejected value", async () => {
    const response = await get({ slug: "abc" }, `?page=${CANARY}`);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(CANARY);
  });
});

describe("GET /api/v1/products/{slug}/reviews: service errors and the frame", () => {
  it("maps the service's 404 (product not visible) to the envelope with empty details", async () => {
    listReviewsMock.mockRejectedValue(notFound());

    const response = await get({ slug: "hidden" });

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
    listReviewsMock.mockRejectedValue(new Error(`reviewer email ${CANARY}`));

    const response = await get({ slug: "abc" });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(CANARY);
    expect(JSON.parse(text)).toMatchObject({ error: { code: "INTERNAL_ERROR", details: {} } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(CANARY);
  });

  it("awaits connection() before the service runs, and stops when the build interrupts it", async () => {
    await get({ slug: "abc" });
    expect(connectionMock.mock.invocationCallOrder[0]).toBeLessThan(
      listReviewsMock.mock.invocationCallOrder[0] ?? 0,
    );

    listReviewsMock.mockClear();
    const interruption = new Error("needs to bail out of prerendering");
    connectionMock.mockRejectedValue(interruption);
    await expect(get({ slug: "abc" })).rejects.toBe(interruption);
    expect(listReviewsMock).not.toHaveBeenCalled();
  });
});
