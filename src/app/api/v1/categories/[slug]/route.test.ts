/**
 * Route-level tests of `GET /api/v1/categories/{slug}` (docs/API_CONTRACTS.md sections 2.2, 5.2,
 * 5.2.1).
 *
 * No database is reached: the catalog service is replaced by mocks, so these tests cover only
 * what the handler and its frame decide (path validation, the envelope, the error mapping). Which
 * categories are found is covered by the integration tests under tests/integration/catalog.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { connection } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CategorySummaryDto } from "@/modules/catalog";
import { getCategory } from "@/modules/catalog/service";
import { notFound } from "@/server/errors";

import * as routeModule from "./route";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 } }),
}));
vi.mock("@/modules/catalog/service", () => ({
  getCategory: vi.fn(),
  getProduct: vi.fn(),
  getStore: vi.fn(),
  listCategories: vi.fn(),
  listProductReviews: vi.fn(),
  listProducts: vi.fn(),
  listStoreProducts: vi.fn(),
}));

const { GET } = routeModule;
const connectionMock = vi.mocked(connection);
const getCategoryMock = vi.mocked(getCategory);

const ORIGIN = "http://localhost";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANARY = "Zq7SECRETcanary";

const CATEGORY: CategorySummaryDto = { name: "เสื้อผ้า", slug: "เสื้อผ้า-k3m9x2qa" };

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
  getCategoryMock.mockReset();
  getCategoryMock.mockResolvedValue(CATEGORY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function get(params: unknown, query = "", headers: HeadersInit = {}): Promise<Response> {
  const context = { params: Promise.resolve(params) } as RouteContext<"/api/v1/categories/[slug]">;
  return GET(new Request(`${ORIGIN}/api/v1/categories/x${query}`, { headers }), context);
}

async function expectValidationError(response: Response): Promise<FieldError[]> {
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as ErrorEnvelope;
  expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message", "requestId"]);
  expect(body.error.code).toBe("VALIDATION_ERROR");
  expect(body.error.message).toBe("The request is invalid.");
  expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  expect(getCategoryMock).not.toHaveBeenCalled();
  return body.error.details.fields ?? [];
}

describe("GET /api/v1/categories/{slug}: the route module", () => {
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

describe("GET /api/v1/categories/{slug}: success", () => {
  it("calls the service with the slug alone and answers { data } with name and slug", async () => {
    const response = await get({ slug: CATEGORY.slug });

    expect(getCategoryMock).toHaveBeenCalledTimes(1);
    expect(getCategoryMock).toHaveBeenCalledWith(CATEGORY.slug);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(UUID);
    expect(await response.json()).toEqual({ data: CATEGORY });
    expect(lines).toEqual([]);
  });

  it("ignores the query string and a session cookie", async () => {
    await get({ slug: "abc" }, "?storeId=s1&userId=u1&role=ADMIN&isActive=false", {
      cookie: "better-auth.session_token=abc",
    });
    expect(getCategoryMock).toHaveBeenCalledWith("abc");
    expect(getCategoryMock.mock.calls[0]).toHaveLength(1);
  });

  it("decodes a slug the framework left percent-encoded and normalises it to NFC", async () => {
    await get({ slug: "%E0%B9%80%E0%B8%AA%E0%B8%B7%E0%B9%89%E0%B8%AD" });
    expect(getCategoryMock).toHaveBeenLastCalledWith("เสื้อ");

    await get({ slug: "cafe\u0301" });
    expect(getCategoryMock).toHaveBeenLastCalledWith("caf\u00e9");
  });
});

describe("GET /api/v1/categories/{slug}: path validation (400)", () => {
  it.each([
    ["a broken escape", { slug: "%E0%B8" }, "custom"],
    ["an empty slug", { slug: "" }, "too_small"],
    ["a slug over 200 characters", { slug: "a".repeat(201) }, "too_big"],
    ["U+0000", { slug: "a\u0000b" }, "custom"],
    ["a lone surrogate", { slug: "\uDC00a" }, "custom"],
    ["a missing slug", {}, "invalid_type"],
  ])("refuses %s on the path slug", async (_label, params, code) => {
    const fields = await expectValidationError(await get(params));
    expect(fields).toEqual([expect.objectContaining({ path: "slug", code })]);
  });

  it("does not echo the rejected slug", async () => {
    const response = await get({ slug: `${CANARY}${"x".repeat(200)}` });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(CANARY);
  });
});

describe("GET /api/v1/categories/{slug}: service errors and the frame", () => {
  it("maps the service's 404 (unknown or inactive) to the envelope with empty details", async () => {
    getCategoryMock.mockRejectedValue(notFound());

    const response = await get({ slug: "inactive" });

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
    getCategoryMock.mockRejectedValue(new Error(`isActive sortOrder ${CANARY}`));

    const response = await get({ slug: "abc" });

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain("sortOrder");
    expect(JSON.parse(text)).toMatchObject({ error: { code: "INTERNAL_ERROR", details: {} } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(CANARY);
  });

  it("awaits connection() before the service runs, and stops when the build interrupts it", async () => {
    await get({ slug: "abc" });
    expect(connectionMock.mock.invocationCallOrder[0]).toBeLessThan(
      getCategoryMock.mock.invocationCallOrder[0] ?? 0,
    );

    getCategoryMock.mockClear();
    const interruption = new Error("needs to bail out of prerendering");
    connectionMock.mockRejectedValue(interruption);
    await expect(get({ slug: "abc" })).rejects.toBe(interruption);
    expect(getCategoryMock).not.toHaveBeenCalled();
  });
});
