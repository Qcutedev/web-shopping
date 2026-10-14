/**
 * Route-level tests of `GET /api/v1/orders` and `GET /api/v1/orders/{id}` (docs/API_CONTRACTS.md
 * sections 1.7, 1.8, 5.5). The session guard and the orders service are mocks; ownership is the
 * service's (src/modules/orders) and is checked against a real database in tests/integration.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderDto } from "@/modules/orders";
import { getOrder, listOrders } from "@/modules/orders/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { notFound, unauthenticated } from "@/server/errors";

import * as detailRoute from "./[id]/route";
import * as listRoute from "./route";

const APP_ORIGIN = "http://localhost:3000";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, appOrigin: "http://localhost:3000" }),
}));
vi.mock("@/server/auth/session", () => ({ requireActor: vi.fn() }));
vi.mock("@/modules/orders/service", () => ({
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  readOrderOfUser: vi.fn(),
  completeOrderPayment: vi.fn(),
  failOrderPayment: vi.fn(),
  failOverdueOrders: vi.fn(),
  PAYMENT_SWEEP_BATCH_SIZE: 100,
}));

const requireActorMock = vi.mocked(requireActor);
const listMock = vi.mocked(listOrders);
const getMock = vi.mocked(getOrder);

const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "SELLER",
  storeId: "store_own",
  storeStatus: "SUSPENDED",
});
const ORDER = { id: "order_1" } as unknown as OrderDto;

function context(id: string) {
  return { params: Promise.resolve({ id }) } as Parameters<typeof detailRoute.GET>[1];
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  requireActorMock.mockReset();
  requireActorMock.mockResolvedValue(ACTOR);
  listMock.mockReset();
  listMock.mockResolvedValue({ items: [ORDER], page: 2, pageSize: 5, total: 6 });
  getMock.mockReset();
  getMock.mockResolvedValue(ORDER);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the route modules", () => {
  it("export GET only, and are thin", () => {
    expect(Object.keys(listRoute)).toEqual(["GET"]);
    expect(Object.keys(detailRoute)).toEqual(["GET"]);
    const here = dirname(fileURLToPath(import.meta.url));
    for (const file of [join(here, "route.ts"), join(here, "[id]", "route.ts")]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated/);
      expect(source).toMatch(/requireActor\(request\)/);
    }
  });
});

describe("GET /api/v1/orders", () => {
  it("lists the session user's orders with the page envelope", async () => {
    const response = await listRoute.GET(
      new Request(`${APP_ORIGIN}/api/v1/orders?page=2&pageSize=5`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [ORDER],
      meta: { page: 2, pageSize: 5, total: 6, totalPages: 2 },
    });
    expect(listMock).toHaveBeenCalledWith(ACTOR, { page: 2, pageSize: 5 });
  });

  it("a page size above 50 is 400, not clamped; a userId in the query widens nothing", async () => {
    expect(
      (await listRoute.GET(new Request(`${APP_ORIGIN}/api/v1/orders?pageSize=51`))).status,
    ).toBe(400);
    await listRoute.GET(new Request(`${APP_ORIGIN}/api/v1/orders?userId=user_victim`));
    expect(listMock).toHaveBeenLastCalledWith(ACTOR, { page: 1, pageSize: 20 });
  });

  it("a guest is 401 before the query is looked at", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    expect(
      (await listRoute.GET(new Request(`${APP_ORIGIN}/api/v1/orders?pageSize=x`))).status,
    ).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/orders/{id}", () => {
  it("answers the order of the session user", async () => {
    const response = await detailRoute.GET(
      new Request(`${APP_ORIGIN}/api/v1/orders/order_1`),
      context("order_1"),
    );
    expect(response.status).toBe(200);
    expect(getMock).toHaveBeenCalledWith(ACTOR, "order_1");
  });

  it("another user's order is the service's 404, with empty details", async () => {
    getMock.mockRejectedValue(notFound());
    const response = await detailRoute.GET(
      new Request(`${APP_ORIGIN}/api/v1/orders/x`),
      context("x"),
    );
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { details: unknown } }).error.details).toEqual({});
  });

  it("a guest is 401; an over-long id is 400", async () => {
    expect(
      (
        await detailRoute.GET(
          new Request(`${APP_ORIGIN}/api/v1/orders/x`),
          context("x".repeat(201)),
        )
      ).status,
    ).toBe(400);
    requireActorMock.mockRejectedValue(unauthenticated());
    expect(
      (await detailRoute.GET(new Request(`${APP_ORIGIN}/api/v1/orders/x`), context("x"))).status,
    ).toBe(401);
    expect(getMock).toHaveBeenCalledTimes(0);
  });
});
