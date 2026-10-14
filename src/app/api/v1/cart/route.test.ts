/**
 * Route-level tests of `GET /api/v1/cart` (docs/API_CONTRACTS.md sections 1.8, 5.4).
 *
 * No database is reached: the session guard and the cart service are mocks. What the cart holds
 * and how it is priced is the service's and is tested in src/modules/cart and, against a real
 * database, in tests/integration/cart.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartDto } from "@/modules/cart";
import { getCart } from "@/modules/cart/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { unauthenticated } from "@/server/errors";

import * as routeModule from "./route";

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

const { GET } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const getCartMock = vi.mocked(getCart);

const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});
const EMPTY: CartDto = {
  stores: [],
  itemsSubtotalSatang: 0,
  shippingTotalSatang: 0,
  grandTotalSatang: 0,
  canCheckout: false,
};

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  requireActorMock.mockReset();
  requireActorMock.mockResolvedValue(ACTOR);
  getCartMock.mockReset();
  getCartMock.mockResolvedValue(EMPTY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/v1/cart: the route module", () => {
  it("exports GET only", () => {
    expect(Object.keys(routeModule)).toEqual(["GET"]);
  });

  it("is thin: no database import", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.sort()).toEqual([
      "@/modules/cart",
      "@/server/auth/session",
      "@/server/http",
      "@/server/request-frame",
    ]);
  });
});

describe("GET /api/v1/cart", () => {
  it("returns the session actor's cart, no-store", async () => {
    const response = await GET(new Request("http://localhost:3000/api/v1/cart"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: EMPTY });
    expect(getCartMock).toHaveBeenCalledWith(ACTOR);
  });

  it("ignores userId and storeId in the query: the actor comes from the session only", async () => {
    await GET(new Request("http://localhost:3000/api/v1/cart?userId=user_victim&storeId=s"));
    expect(getCartMock).toHaveBeenCalledWith(ACTOR);
  });

  it("is 401 without a session and reads no cart", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    const response = await GET(new Request("http://localhost:3000/api/v1/cart"));
    expect(response.status).toBe(401);
    expect(getCartMock).not.toHaveBeenCalled();
  });
});
