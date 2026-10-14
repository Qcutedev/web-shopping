/**
 * Route-level tests of `PATCH` and `DELETE /api/v1/cart/items/{itemId}` (docs/API_CONTRACTS.md
 * sections 1.2, 1.8, 5.4).
 *
 * No database is reached: the session guard and the cart service are mocks. Ownership itself (a
 * foreign line is 404 and changes nothing) is the service's and is tested against a real database
 * in tests/integration/cart; here only the mapping of its refusal is checked.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartWriteLineDto } from "@/modules/cart";
import { deleteCartItem, updateCartItem } from "@/modules/cart/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { notFound, productUnavailable, unauthenticated } from "@/server/errors";

import * as routeModule from "./route";

const APP_ORIGIN = "http://localhost:3000";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, appOrigin: "http://localhost:3000" }),
}));
vi.mock("@/server/auth/session", () => ({ requireActor: vi.fn() }));
vi.mock("@/modules/cart/service", () => ({
  addCartItem: vi.fn(),
  deleteCartItem: vi.fn(),
  getCart: vi.fn(),
  updateCartItem: vi.fn(),
}));

const { PATCH, DELETE } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const updateMock = vi.mocked(updateCartItem);
const deleteMock = vi.mocked(deleteCartItem);

const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "ADMIN",
  storeId: null,
  storeStatus: null,
});
const LINE: CartWriteLineDto = {
  id: "line_1",
  productId: "product_1",
  slug: "product-1",
  title: "สินค้า",
  image: null,
  unitPriceSatang: 1_000,
  quantity: 2,
  lineTotalSatang: 2_000,
  stock: 10,
  buyable: true,
  unbuyableReason: null,
  requestedQuantity: 2,
  quantityLowered: false,
};

interface ErrorEnvelope {
  error: { code: string; details: { fields?: { path: string }[]; items?: unknown[] } };
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  requireActorMock.mockReset();
  requireActorMock.mockResolvedValue(ACTOR);
  updateMock.mockReset();
  updateMock.mockResolvedValue(LINE);
  deleteMock.mockReset();
  deleteMock.mockResolvedValue({ deleted: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function params(itemId: string) {
  return { params: Promise.resolve({ itemId }) };
}

function request(
  method: "PATCH" | "DELETE",
  body?: unknown,
  options: { origin?: string | null; contentType?: string | null; raw?: string } = {},
) {
  const headers = new Headers();
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const text = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Request(`${APP_ORIGIN}/api/v1/cart/items/line_1`, {
    method,
    headers,
    ...(text === undefined ? {} : { body: text }),
  });
}

describe("/api/v1/cart/items/{itemId}: the route module", () => {
  it("exports PATCH and DELETE only", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["DELETE", "PATCH"]);
  });

  it("is thin: no database import, no raw body read", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.sort()).toEqual([
      "@/modules/cart",
      "@/server/auth/session",
      "@/server/env",
      "@/server/http",
      "@/server/request-frame",
    ]);
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
  });
});

describe("PATCH /api/v1/cart/items/{itemId}", () => {
  it("passes the session actor, the path id, and the parsed body to the service", async () => {
    const response = await PATCH(request("PATCH", { quantity: 2 }), params("line_1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: LINE });
    expect(updateMock).toHaveBeenCalledWith(ACTOR, "line_1", { quantity: 2 });
  });

  it("maps the service's 404 for a foreign or unknown line to the plain 404 envelope", async () => {
    updateMock.mockRejectedValue(notFound());
    const response = await PATCH(request("PATCH", { quantity: 2 }), params("line_foreign"));
    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorEnvelope).error.details).toEqual({});
  });

  it("maps the 409 of a hidden line with its items", async () => {
    const item = {
      cartItemId: "line_1",
      productId: "product_1",
      reason: "NOT_AVAILABLE",
      requestedQuantity: 2,
      availableStock: null,
    };
    updateMock.mockRejectedValue(productUnavailable({ details: { items: [item] } }));
    const response = await PATCH(request("PATCH", { quantity: 2 }), params("line_1"));
    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorEnvelope).error).toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
      details: { items: [item] },
    });
  });

  it("refuses a quantity outside 1 to 99, an unknown key, and an over-long id (400)", async () => {
    for (const body of [{ quantity: 0 }, { quantity: 100 }, {}, { quantity: 1, priceSatang: 1 }]) {
      expect((await PATCH(request("PATCH", body), params("line_1"))).status).toBe(400);
    }
    const response = await PATCH(request("PATCH", { quantity: 1 }), params("x".repeat(201)));
    expect(response.status).toBe(400);
    expect(((await response.json()) as ErrorEnvelope).error.details.fields?.[0]?.path).toBe(
      "itemId",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("order: 403 origin, 415 content type, 401 session; the body is read for none of them", async () => {
    const foreign = request("PATCH", { quantity: 1 }, { origin: "https://evil.example" });
    expect((await PATCH(foreign, params("line_1"))).status).toBe(403);
    const wrongType = request("PATCH", { quantity: 1 }, { contentType: "text/plain" });
    expect((await PATCH(wrongType, params("line_1"))).status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
    requireActorMock.mockRejectedValue(unauthenticated());
    const anonymous = request("PATCH", undefined, { raw: "{broken" });
    expect((await PATCH(anonymous, params("line_1"))).status).toBe(401);
    for (const sent of [foreign, wrongType, anonymous]) expect(sent.bodyUsed).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/cart/items/{itemId}", () => {
  it("deletes through the service with the actor and the path id, and reads no body", async () => {
    const sent = request("DELETE", { anything: "ignored" });
    const response = await DELETE(sent, params("line_1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { deleted: true } });
    expect(deleteMock).toHaveBeenCalledWith(ACTOR, "line_1");
    expect(sent.bodyUsed).toBe(false);
  });

  it("maps the service's 404 for a foreign or unknown line", async () => {
    deleteMock.mockRejectedValue(notFound());
    expect((await DELETE(request("DELETE"), params("line_foreign"))).status).toBe(404);
  });

  it("requires the JSON content type even without a body (section 1.2)", async () => {
    const response = await DELETE(request("DELETE", undefined, { contentType: null }), params("a"));
    expect(response.status).toBe(415);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("refuses a foreign origin (403), an anonymous caller (401), and an empty id (400)", async () => {
    expect(
      (await DELETE(request("DELETE", undefined, { origin: "https://evil.example" }), params("a")))
        .status,
    ).toBe(403);
    expect((await DELETE(request("DELETE"), params(""))).status).toBe(400);
    requireActorMock.mockRejectedValue(unauthenticated());
    expect((await DELETE(request("DELETE"), params("a"))).status).toBe(401);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
