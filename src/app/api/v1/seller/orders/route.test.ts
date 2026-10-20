/**
 * Route-level tests of `/api/v1/seller/orders/**` and `/api/v1/seller/summary`
 * (docs/API_CONTRACTS.md sections 1.8, 5.7.3, and 5.7.4): the order of refusals of every handler,
 * that a refused request's body is never read, that a suspended seller passes (access
 * `seller (any store status)`, BR-14), and that each handler passes the session's actor and the
 * parsed input to its service.
 *
 * No database is reached: the session guard and the seller order service are mocks. The real
 * guard helpers of src/server/auth/actor.ts are used. The service against a real database is in
 * tests/integration/seller-orders.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SellerOrderViewDto, SellerSummaryDto } from "@/modules/orders";
import * as service from "@/modules/orders/seller-service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { invalidStateTransition, notFound, unauthenticated } from "@/server/errors";

import * as summaryModule from "../summary/route";
import * as itemModule from "./[id]/route";
import * as statusModule from "./[id]/status/route";
import * as listModule from "./route";

const APP_ORIGIN = "http://localhost:3000";
const HERE = dirname(fileURLToPath(import.meta.url));

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, appOrigin: "http://localhost:3000" }),
}));
vi.mock("@/server/auth/session", () => ({ requireActor: vi.fn() }));
vi.mock("@/modules/orders/seller-service", () => ({
  changeSellerOrderStatus: vi.fn(),
  getOwnSellerOrder: vi.fn(),
  getSellerSummary: vi.fn(),
  listOwnSellerOrders: vi.fn(),
}));

const requireActorMock = vi.mocked(requireActor);

function actor(role: Actor["role"], storeStatus: Actor["storeStatus"] = null): Actor {
  return Object.freeze({
    userId: "user_me",
    role,
    storeId: storeStatus === null ? null : "store_me",
    storeStatus,
  });
}

const SELLER = actor("SELLER", "APPROVED");
const SUSPENDED = actor("SELLER", "SUSPENDED");

const VIEW: SellerOrderViewDto = {
  id: "so1",
  orderNumber: "OD1",
  createdAt: "2026-10-20T00:00:00.000Z",
  paidAt: "2026-10-20T00:00:01.000Z",
  paymentStatus: "PAID",
  fulfilmentStatus: "PENDING",
  cancellationKind: null,
  storeName: "S",
  itemsSubtotalSatang: 100,
  shippingFeeSatang: 4_000,
  shippingFeeIsSimulated: true,
  commissionRateBps: 500,
  shippingAddress: {
    recipientName: "r",
    phone: "0812345678",
    line1: "l",
    subdistrict: "s",
    district: "d",
    province: "p",
    postalCode: "10110",
  },
  shipment: null,
  items: [],
};
const SUMMARY: SellerSummaryDto = {
  productsByStatus: { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 },
  lowStockCount: 0,
  soldOutCount: 0,
  ordersByStatus: { PENDING: 0, PROCESSING: 0, SHIPPED: 0, DELIVERED: 0, CANCELLED: 0 },
  paidSalesTotalSatang: 0,
};

function ctx<T>(id = "so1"): T {
  return { params: Promise.resolve({ id }) } as T;
}

function statusRequest(
  options: {
    body?: unknown;
    rawBody?: string;
    origin?: string | null;
    contentType?: string | null;
  } = {},
): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const body =
    options.rawBody ??
    JSON.stringify(options.body === undefined ? { to: "PROCESSING" } : options.body);
  return new Request(`${APP_ORIGIN}/api/v1/seller/orders/so1/status`, {
    method: "POST",
    headers,
    body,
  });
}

async function codeOf(response: Response): Promise<string> {
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActorMock.mockResolvedValue(SELLER);
  vi.mocked(service.listOwnSellerOrders).mockResolvedValue({
    items: [VIEW],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.mocked(service.getOwnSellerOrder).mockResolvedValue(VIEW);
  vi.mocked(service.changeSellerOrderStatus).mockResolvedValue(VIEW);
  vi.mocked(service.getSellerSummary).mockResolvedValue(SUMMARY);
});

describe("the route modules", () => {
  it.each([
    ["route.ts", listModule, ["GET"]],
    ["[id]/route.ts", itemModule, ["GET"]],
    ["[id]/status/route.ts", statusModule, ["POST"]],
    ["../summary/route.ts", summaryModule, ["GET"]],
  ] as const)("%s exports only its methods and is thin", (file, module, methods) => {
    expect(Object.keys(module).sort()).toEqual([...methods]);
    const source = readFileSync(join(HERE, file), "utf8");
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
    expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated|\$transaction/);
    // Access `seller (any store status)`: no handler judges the store status (BR-14).
    expect(source).not.toMatch(/requireApprovedSeller/);
  });
});

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

const READS: [string, () => Promise<Response>][] = [
  [
    "GET /seller/orders",
    () => listModule.GET(new Request(`${APP_ORIGIN}/api/v1/seller/orders?storeId=other`)),
  ],
  ["GET /seller/orders/{id}", () => itemModule.GET(new Request(`${APP_ORIGIN}/x`), ctx())],
  [
    "GET /seller/summary",
    () => summaryModule.GET(new Request(`${APP_ORIGIN}/api/v1/seller/summary?storeId=other`)),
  ],
];

describe.each(READS)("%s", (_name, send) => {
  it("answers an approved and a suspended seller with no-store", async () => {
    for (const who of [SELLER, SUSPENDED]) {
      requireActorMock.mockResolvedValue(who);
      const response = await send();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("3: no session is 401", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    expect(await codeOf(await send())).toBe("UNAUTHENTICATED");
  });

  it("4: a customer and an admin are 403 FORBIDDEN and no service is called", async () => {
    for (const who of [actor("CUSTOMER"), actor("ADMIN")]) {
      requireActorMock.mockResolvedValue(who);
      expect(await codeOf(await send())).toBe("FORBIDDEN");
    }
    expect(service.listOwnSellerOrders).not.toHaveBeenCalled();
    expect(service.getOwnSellerOrder).not.toHaveBeenCalled();
    expect(service.getSellerSummary).not.toHaveBeenCalled();
  });
});

describe("GET /seller/orders", () => {
  it("passes the session's actor and the parsed query; a storeId is not passed on", async () => {
    requireActorMock.mockResolvedValue(SUSPENDED);
    const response = await listModule.GET(
      new Request(`${APP_ORIGIN}/x?storeId=other&fulfilmentStatus=SHIPPED&page=2`),
    );
    expect(await response.json()).toEqual({
      data: [VIEW],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(service.listOwnSellerOrders).toHaveBeenCalledWith(SUSPENDED, {
      page: 2,
      pageSize: 20,
      fulfilmentStatus: "SHIPPED",
    });
  });

  it("7: a bad query is 400 after the role", async () => {
    for (const query of ["pageSize=51", "fulfilmentStatus=LOST", "page=0"]) {
      expect((await listModule.GET(new Request(`${APP_ORIGIN}/x?${query}`))).status).toBe(400);
    }
    requireActorMock.mockResolvedValue(actor("CUSTOMER"));
    expect((await listModule.GET(new Request(`${APP_ORIGIN}/x?pageSize=51`))).status).toBe(403);
    expect(service.listOwnSellerOrders).not.toHaveBeenCalled();
  });
});

describe("GET /seller/orders/{id}", () => {
  it("passes the path id; a bad id is 400; a 404 from the service is passed on", async () => {
    await itemModule.GET(new Request(`${APP_ORIGIN}/x`), ctx("so9"));
    expect(service.getOwnSellerOrder).toHaveBeenCalledWith(SELLER, "so9");
    expect((await itemModule.GET(new Request(`${APP_ORIGIN}/x`), ctx(""))).status).toBe(400);
    vi.mocked(service.getOwnSellerOrder).mockRejectedValue(notFound());
    expect(await codeOf(await itemModule.GET(new Request(`${APP_ORIGIN}/x`), ctx()))).toBe(
      "NOT_FOUND",
    );
  });
});

describe("GET /seller/summary", () => {
  it("passes only the session's actor", async () => {
    const response = await summaryModule.GET(new Request(`${APP_ORIGIN}/x?storeId=other`));
    expect(await response.json()).toEqual({ data: SUMMARY });
    expect(service.getSellerSummary).toHaveBeenCalledWith(SELLER);
  });
});

// ---------------------------------------------------------------------------------------------
// POST /seller/orders/{id}/status
// ---------------------------------------------------------------------------------------------

describe("POST /seller/orders/{id}/status", () => {
  const send = (options: Parameters<typeof statusRequest>[0] = {}, id = "so1") =>
    statusModule.POST(statusRequest(options), ctx(id));

  it("an approved and a suspended seller pass, with the session's actor, the id, and the body", async () => {
    for (const who of [SELLER, SUSPENDED]) {
      requireActorMock.mockResolvedValue(who);
      const response = await send({
        body: { to: "SHIPPED", carrierName: " Kerry ", trackingNumber: "T1" },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: VIEW });
      expect(service.changeSellerOrderStatus).toHaveBeenLastCalledWith(who, "so1", {
        to: "SHIPPED",
        carrierName: "Kerry",
        trackingNumber: "T1",
      });
    }
  });

  it("1, 2: a foreign or missing Origin is 403, a missing or other Content-Type 415, before the session", async () => {
    expect((await send({ origin: "https://evil.example" })).status).toBe(403);
    expect((await send({ origin: null })).status).toBe(403);
    expect((await send({ contentType: null })).status).toBe(415);
    expect((await send({ contentType: "text/plain" })).status).toBe(415);
    expect((await send({ contentType: "application/x-www-form-urlencoded" })).status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
  });

  it("3: no session is 401 before the body is read", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    expect(await codeOf(await send({ rawBody: "{bad" }))).toBe("UNAUTHENTICATED");
  });

  it("4: a customer and an admin are 403 FORBIDDEN before the body is read, even an invalid one", async () => {
    for (const who of [actor("CUSTOMER"), actor("ADMIN")]) {
      requireActorMock.mockResolvedValue(who);
      expect(await codeOf(await send({ rawBody: "{bad" }))).toBe("FORBIDDEN");
    }
    expect(service.changeSellerOrderStatus).not.toHaveBeenCalled();
  });

  it("7: invalid JSON, an unknown key, a storeId, a PENDING target, and a carrier without SHIPPED are 400", async () => {
    for (const options of [
      { rawBody: "{bad" },
      { body: { to: "PROCESSING", storeId: "store_other" } },
      { body: { to: "CANCELLED", itemsSubtotalSatang: 0 } },
      { body: { to: "PENDING" } },
      { body: { to: "DELIVERED", trackingNumber: "T1" } },
      { body: {} },
    ]) {
      const response = await send(options);
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    }
    expect((await send({}, "")).status).toBe(400);
    expect(service.changeSellerOrderStatus).not.toHaveBeenCalled();
  });

  it("passes on 404 and 409 from the service", async () => {
    vi.mocked(service.changeSellerOrderStatus).mockRejectedValueOnce(notFound());
    expect(await codeOf(await send())).toBe("NOT_FOUND");
    vi.mocked(service.changeSellerOrderStatus).mockRejectedValueOnce(invalidStateTransition());
    expect(await codeOf(await send())).toBe("INVALID_STATE_TRANSITION");
  });

  it("413: a body over the limit is refused before validation", async () => {
    const response = await send({ rawBody: JSON.stringify({ to: "x".repeat(200_000) }) });
    expect(response.status).toBe(413);
    expect(service.changeSellerOrderStatus).not.toHaveBeenCalled();
  });
});
