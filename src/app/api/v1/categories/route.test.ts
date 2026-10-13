/**
 * Route-level tests of `GET /api/v1/categories` (docs/API_CONTRACTS.md sections 2.2, 5.2, 5.2.1).
 *
 * No database is reached: the catalog service is replaced by mocks, so these tests cover only
 * what the handler and its frame decide (query validation, the envelope, the error mapping, the
 * request id, the order of `connection()` and the service). The rows a service returns are
 * covered by the integration tests under tests/integration/catalog.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { CategoryDto, Page } from "@/modules/catalog";
import { listCategories } from "@/modules/catalog/service";
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
const listCategoriesMock = vi.mocked(listCategories);

const ORIGIN = "http://localhost";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANARY = "Zq7SECRETcanary";

const CATEGORY: CategoryDto = {
  id: "cat_1",
  name: "เสื้อผ้า",
  slug: "clothes",
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
  listCategoriesMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function get(query = "", headers: HeadersInit = {}): Promise<Response> {
  return GET(new Request(`${ORIGIN}/api/v1/categories${query}`, { headers }));
}

function page(items: CategoryDto[], meta: Omit<Page<CategoryDto>, "items">): Page<CategoryDto> {
  return { items, ...meta };
}

async function expectValidationError(response: Response): Promise<FieldError[]> {
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as ErrorEnvelope;
  expect(Object.keys(body)).toEqual(["error"]);
  expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message", "requestId"]);
  expect(body.error.code).toBe("VALIDATION_ERROR");
  expect(body.error.message).toBe("The request is invalid.");
  expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  const fields = body.error.details.fields ?? [];
  expect(fields.length).toBeGreaterThan(0);
  for (const field of fields) {
    expect(Object.keys(field).sort()).toEqual(["code", "message", "path"]);
  }
  expect(listCategoriesMock).not.toHaveBeenCalled();
  return fields;
}

describe("GET /api/v1/categories: the route module", () => {
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
    // A public endpoint: no guard and no rate limit (section 5.2.1).
    expect(source).not.toMatch(/requireActor|rate-?limit|cookies\s*\(/i);
  });
});

describe("GET /api/v1/categories: success", () => {
  it("calls the service once with the defaults and answers the list envelope", async () => {
    listCategoriesMock.mockResolvedValue(page([CATEGORY], { page: 1, pageSize: 20, total: 41 }));

    const response = await get();

    expect(listCategoriesMock).toHaveBeenCalledTimes(1);
    expect(listCategoriesMock).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    expect(await response.json()).toEqual({
      data: [CATEGORY],
      meta: { page: 1, pageSize: 20, total: 41, totalPages: 3 },
    });
    expect(lines).toEqual([]);
  });

  it("passes the parsed page and pageSize as numbers", async () => {
    listCategoriesMock.mockResolvedValue(page([], { page: 3, pageSize: 50, total: 0 }));

    const response = await get("?page=3&pageSize=50");

    expect(listCategoriesMock).toHaveBeenCalledWith({ page: 3, pageSize: 50 });
    expect(await response.json()).toEqual({
      data: [],
      meta: { page: 3, pageSize: 50, total: 0, totalPages: 0 },
    });
  });

  it("accepts the largest page (14 digits, CR-84)", async () => {
    listCategoriesMock.mockResolvedValue(
      page([], { page: 99_999_999_999_999, pageSize: 20, total: 0 }),
    );
    const response = await get("?page=99999999999999");
    expect(response.status).toBe(200);
    expect(listCategoriesMock).toHaveBeenCalledWith({ page: 99_999_999_999_999, pageSize: 20 });
  });

  it("drops unknown parameters, storeId, userId, and role included, and ignores a session cookie", async () => {
    listCategoriesMock.mockResolvedValue(page([], { page: 1, pageSize: 20, total: 0 }));

    const response = await get("?storeId=s1&userId=u1&role=ADMIN&storeId=s2", {
      cookie: "better-auth.session_token=abc",
    });

    expect(response.status).toBe(200);
    expect(listCategoriesMock).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    const [query] = listCategoriesMock.mock.calls[0] ?? [];
    expect(Object.keys(query ?? {}).sort()).toEqual(["page", "pageSize"]);
  });

  it("does not reuse a client request id when no proxy is trusted (SR-03)", async () => {
    listCategoriesMock.mockResolvedValue(page([], { page: 1, pageSize: 20, total: 0 }));
    const response = await get("", { "x-request-id": "client-chosen-id-1" });
    expect(response.headers.get("x-request-id")).not.toBe("client-chosen-id-1");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });
});

describe("GET /api/v1/categories: query validation (400)", () => {
  it.each([
    ["pageSize above 50", "?pageSize=51", "pageSize", "too_big"],
    ["page 0", "?page=0", "page", "too_small"],
    ["pageSize 0", "?pageSize=0", "pageSize", "too_small"],
    ["a page that is not digits", "?page=abc", "page", "invalid_format"],
    ["a negative page", "?page=-1", "page", "invalid_format"],
    ["a fraction", "?page=1.5", "page", "invalid_format"],
    ["an exponent", "?pageSize=1e1", "pageSize", "invalid_format"],
    ["an empty page", "?page=", "page", "invalid_format"],
    ["a page of 15 digits", "?page=100000000000000", "page", "invalid_format"],
    ["a page given twice", "?page=1&page=2", "page", "invalid_type"],
  ])("refuses %s", async (_label, query, path, code) => {
    const fields = await expectValidationError(await get(query));
    expect(fields).toEqual([expect.objectContaining({ path, code })]);
  });

  it("does not echo the rejected value", async () => {
    const response = await get(`?page=${CANARY}`);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(CANARY);
  });

  it("logs nothing for a client error", async () => {
    await get("?pageSize=999");
    expect(lines).toEqual([]);
  });
});

describe("GET /api/v1/categories: service errors", () => {
  it("maps an AppError from the service to its envelope", async () => {
    listCategoriesMock.mockRejectedValue(notFound());

    const response = await get();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as ErrorEnvelope;
    expect(body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "The resource was not found.",
        details: {},
        requestId: response.headers.get("x-request-id"),
      },
    });
  });

  it("turns an unknown error into a 500 that discloses nothing and is logged once", async () => {
    listCategoriesMock.mockRejectedValue(new Error(`SELECT * FROM "Category" ${CANARY}`));

    const response = await get();

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain("SELECT");
    const body = JSON.parse(text) as ErrorEnvelope;
    expect(body.error).toMatchObject({ code: "INTERNAL_ERROR", details: {} });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(CANARY);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      level: "error",
      requestId: body.error.requestId,
      err: { errorClass: "Error" },
    });
  });

  it("treats a ZodError thrown by the service as a server fault (500), not as a 400", async () => {
    const parsed = z.object({ a: z.string() }).safeParse({ a: 1 });
    listCategoriesMock.mockRejectedValue(parsed.error);

    const response = await get();

    expect(response.status).toBe(500);
    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.details).toEqual({});
  });
});

describe("GET /api/v1/categories: the frame", () => {
  it("awaits connection() before the service runs", async () => {
    listCategoriesMock.mockResolvedValue(page([], { page: 1, pageSize: 20, total: 0 }));
    await get();
    expect(connectionMock).toHaveBeenCalledTimes(1);
    expect(connectionMock.mock.invocationCallOrder[0]).toBeLessThan(
      listCategoriesMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("lets the build's prerender interruption through without calling the service", async () => {
    const interruption = new Error("needs to bail out of prerendering");
    connectionMock.mockRejectedValue(interruption);
    await expect(get()).rejects.toBe(interruption);
    expect(listCategoriesMock).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});
