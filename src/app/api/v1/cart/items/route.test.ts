/**
 * Route-level tests of `POST /api/v1/cart/items` (docs/API_CONTRACTS.md sections 1.1, 1.8, 5.4).
 *
 * No database is reached: the session guard and the cart service are mocks. The rules of the add
 * (visibility, own store, 99, stock) are the service's, tested in src/modules/cart and against a
 * real database in tests/integration/cart; here only the order of refusals, the validation, and
 * the mapping of the outcome are checked.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartWriteLineDto } from "@/modules/cart";
import { addCartItem } from "@/modules/cart/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { insufficientStock, notFound, unauthenticated } from "@/server/errors";

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

const { POST } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const addMock = vi.mocked(addCartItem);

const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "SELLER",
  storeId: "store_own",
  storeStatus: "SUSPENDED",
});
const LINE: CartWriteLineDto = {
  id: "line_1",
  productId: "product_1",
  slug: "product-1",
  title: "สินค้า",
  image: null,
  unitPriceSatang: 25_900,
  quantity: 3,
  lineTotalSatang: 77_700,
  stock: 3,
  buyable: true,
  unbuyableReason: null,
  requestedQuantity: 5,
  quantityLowered: true,
};

interface ErrorEnvelope {
  error: {
    code: string;
    details: { fields?: { path: string; code: string }[]; items?: unknown[] };
  };
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  requireActorMock.mockReset();
  requireActorMock.mockResolvedValue(ACTOR);
  addMock.mockReset();
  addMock.mockResolvedValue({ line: LINE, created: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function request(
  body?: unknown,
  options: { origin?: string | null; contentType?: string | null; raw?: string } = {},
) {
  const headers = new Headers();
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const text = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Request(`${APP_ORIGIN}/api/v1/cart/items`, {
    method: "POST",
    headers,
    ...(text === undefined ? {} : { body: text }),
  });
}

describe("/api/v1/cart/items: the route module", () => {
  it("exports POST only", () => {
    expect(Object.keys(routeModule)).toEqual(["POST"]);
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

describe("POST /api/v1/cart/items", () => {
  it("answers 201 with the line when the service created it, passing the session actor", async () => {
    const response = await POST(request({ productId: "product_1", quantity: 5 }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: LINE });
    expect(addMock).toHaveBeenCalledWith(ACTOR, { productId: "product_1", quantity: 5 });
  });

  it("answers 200 when the service added to an existing line", async () => {
    addMock.mockResolvedValue({ line: LINE, created: false });
    const response = await POST(request({ productId: "product_1", quantity: 1 }));
    expect(response.status).toBe(200);
  });

  it("refuses a price, a total, a userId, or a storeId in the body (400), never calling the service", async () => {
    for (const extra of [
      { priceSatang: 1 },
      { unitPriceSatang: 1 },
      { lineTotalSatang: 1 },
      { userId: "user_victim" },
      { storeId: "store_x" },
    ]) {
      const response = await POST(request({ productId: "product_1", quantity: 1, ...extra }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorEnvelope;
      expect(body.error.details.fields?.[0]).toMatchObject({ path: "", code: "unrecognized_keys" });
    }
    expect(addMock).not.toHaveBeenCalled();
  });

  it("refuses a quantity of 0, 100, or 1.5, and invalid JSON (400)", async () => {
    for (const quantity of [0, 100, 1.5]) {
      const response = await POST(request({ productId: "product_1", quantity }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorEnvelope;
      expect(body.error.details.fields?.[0]?.path).toBe("quantity");
    }
    expect((await POST(request(undefined, { raw: "{broken" }))).status).toBe(400);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("maps the service's refusals: 404 with resource, 409 with items", async () => {
    addMock.mockRejectedValue(notFound({ details: { resource: "product" } }));
    let response = await POST(request({ productId: "nope", quantity: 1 }));
    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorEnvelope).error.details).toEqual({
      resource: "product",
    });

    const item = {
      cartItemId: null,
      productId: "product_1",
      reason: "INSUFFICIENT_STOCK",
      requestedQuantity: 1,
      availableStock: 0,
    };
    addMock.mockRejectedValue(insufficientStock([item]));
    response = await POST(request({ productId: "product_1", quantity: 1 }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error).toMatchObject({ code: "INSUFFICIENT_STOCK", details: { items: [item] } });
  });

  it("order: 403 origin, 415 content type, 401 session; the body is read for none of them", async () => {
    const foreign = request({ productId: "p", quantity: 1 }, { origin: "https://evil.example" });
    expect((await POST(foreign)).status).toBe(403);
    const missingOrigin = request({ productId: "p", quantity: 1 }, { origin: null });
    expect((await POST(missingOrigin)).status).toBe(403);
    const wrongType = request({ productId: "p", quantity: 1 }, { contentType: "text/plain" });
    expect((await POST(wrongType)).status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
    requireActorMock.mockRejectedValue(unauthenticated());
    const anonymous = request(undefined, { raw: "{broken" });
    expect((await POST(anonymous)).status).toBe(401);
    for (const sent of [foreign, missingOrigin, wrongType, anonymous]) {
      expect(sent.bodyUsed).toBe(false);
    }
    expect(addMock).not.toHaveBeenCalled();
  });
});
