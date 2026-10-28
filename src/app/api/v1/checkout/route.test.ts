/**
 * Route-level tests of `POST /api/v1/checkout` (docs/API_CONTRACTS.md sections 1.1, 1.3, 1.8,
 * 5.5, 6).
 *
 * No database is reached: the session guard, the rate limiter, and the checkout service are
 * mocks. The rules of checkout (stock, refusal, payment) are the service's, tested in
 * src/modules/checkout; here only the order of refusals, the validation of the header and the
 * body, the rate limit, and the mapping of the outcome are checked.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkout } from "@/modules/checkout/service";
import type { OrderDto } from "@/modules/orders";
import type { Actor } from "@/server/auth/actor";
import { recordSecurityEvent } from "@/server/auth/security-events";
import { requireActor } from "@/server/auth/session";
import {
  AppError,
  cartEmpty,
  notFound,
  orderLimitExceeded,
  unauthenticated,
} from "@/server/errors";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";

import * as routeModule from "./route";

const APP_ORIGIN = "http://localhost:3000";
const KEY = "0F8FAD5B-D9CB-469F-A165-70867728950E";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, appOrigin: "http://localhost:3000" }),
}));
vi.mock("@/server/auth/session", () => ({ requireActor: vi.fn() }));
vi.mock("@/server/auth/security-events", () => ({ recordSecurityEvent: vi.fn() }));
vi.mock("@/server/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/rate-limit")>();
  return { ...original, rateLimiter: { consume: vi.fn() } };
});
vi.mock("@/modules/checkout/service", () => ({ checkout: vi.fn(), CHECKOUT_ATTEMPTS: 3 }));

const { POST } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const checkoutMock = vi.mocked(checkout);
const consumeMock = vi.mocked(rateLimiter.consume);
const eventMock = vi.mocked(recordSecurityEvent);

const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});
const ORDER = { id: "order_1", paymentStatus: "PAID" } as unknown as OrderDto;
const BODY = { addressId: "addr_1", paymentMethod: "MOCK" };

interface ErrorEnvelope {
  error: {
    code: string;
    details: { fields?: { path: string; code: string }[]; items?: unknown[]; resource?: string };
  };
}

function allowed(allowedNow = true) {
  return {
    allowed: allowedNow,
    limit: 10,
    remaining: allowedNow ? 9 : 0,
    resetAt: 0,
    retryAfterSeconds: 42,
    saturated: false,
  };
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  requireActorMock.mockReset();
  requireActorMock.mockResolvedValue(ACTOR);
  checkoutMock.mockReset();
  checkoutMock.mockResolvedValue({ order: ORDER, created: true });
  consumeMock.mockReset();
  consumeMock.mockResolvedValue(allowed());
  eventMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function request(
  body?: unknown,
  options: {
    origin?: string | null;
    contentType?: string | null;
    key?: string | null;
    raw?: string;
  } = {},
) {
  const headers = new Headers();
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const key = options.key === undefined ? KEY : options.key;
  if (key !== null) headers.set("idempotency-key", key);
  const text = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Request(`${APP_ORIGIN}/api/v1/checkout`, {
    method: "POST",
    headers,
    ...(text === undefined ? {} : { body: text }),
  });
}

describe("/api/v1/checkout: the route module", () => {
  it("exports POST only", () => {
    expect(Object.keys(routeModule)).toEqual(["POST"]);
  });

  it("is thin: no database import, no raw body read", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.sort()).toEqual([
      "@/modules/checkout",
      "@/server/auth/security-events",
      "@/server/auth/session",
      "@/server/client-address",
      "@/server/env",
      "@/server/errors",
      "@/server/http",
      "@/server/logger",
      "@/server/rate-limit",
      "@/server/request-frame",
    ]);
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
  });
});

describe("POST /api/v1/checkout", () => {
  it("answers 201 with the order, passing the session actor, the normalised key, and the body", async () => {
    const response = await POST(request(BODY));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: ORDER });
    expect(checkoutMock).toHaveBeenCalledWith(
      ACTOR,
      "0f8fad5b-d9cb-469f-a165-70867728950e",
      { addressId: "addr_1", paymentMethod: "MOCK", mockOutcome: "SUCCESS" },
      expect.objectContaining({ log: expect.anything() }),
    );
    // SEC-052: the client address first (SR-01 subject; no trusted proxy here), then the user.
    expect(consumeMock.mock.calls).toEqual([
      ["unknown", RATE_LIMITS.SIGNED_IN_ADDRESS],
      ["user_me", RATE_LIMITS.CHECKOUT],
    ]);
  });

  it("answers 200 when the key matched an existing order", async () => {
    checkoutMock.mockResolvedValue({ order: ORDER, created: false });
    expect((await POST(request(BODY))).status).toBe(200);
  });

  it("refuses any amount, quantity, storeId, or userId in the body (400), never calling the service", async () => {
    for (const extra of [
      { grandTotalSatang: 1 },
      { unitPriceSatang: 1 },
      { shippingFeeSatang: 0 },
      { quantity: 1 },
      { storeId: "store_x" },
      { userId: "user_victim" },
    ]) {
      const response = await POST(request({ ...BODY, ...extra }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorEnvelope;
      expect(body.error.details.fields?.[0]).toMatchObject({ path: "", code: "unrecognized_keys" });
    }
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("a missing or malformed Idempotency-Key is 400 invalid_header", async () => {
    for (const key of [null, "", "not-a-uuid", `{${KEY}}`]) {
      const response = await POST(request(BODY, { key }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorEnvelope;
      expect(body.error.details.fields).toEqual([
        expect.objectContaining({ path: "Idempotency-Key", code: "invalid_header" }),
      ]);
    }
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("refuses another payment method and invalid JSON (400)", async () => {
    expect((await POST(request({ ...BODY, paymentMethod: "CARD" }))).status).toBe(400);
    expect((await POST(request(undefined, { raw: "{broken" }))).status).toBe(400);
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("order: 403 origin, 415 content type, 401 session; no allowance used, no body read", async () => {
    const foreign = request(BODY, { origin: "https://evil.example" });
    expect((await POST(foreign)).status).toBe(403);
    const wrongType = request(BODY, { contentType: "text/plain" });
    expect((await POST(wrongType)).status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
    requireActorMock.mockRejectedValue(unauthenticated());
    const anonymous = request(undefined, { raw: "{broken", key: null });
    expect((await POST(anonymous)).status).toBe(401);
    for (const sent of [foreign, wrongType, anonymous]) expect(sent.bodyUsed).toBe(false);
    expect(consumeMock).not.toHaveBeenCalled();
    expect(checkoutMock).not.toHaveBeenCalled();
  });

  it("429 with Retry-After before the body is read when the user's checkout rule refuses, logged as a security event", async () => {
    consumeMock.mockResolvedValueOnce(allowed()).mockResolvedValueOnce(allowed(false));
    const sent = request(undefined, { raw: "{broken", key: null });
    const response = await POST(sent);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(sent.bodyUsed).toBe(false);
    expect(checkoutMock).not.toHaveBeenCalled();
    expect(eventMock).toHaveBeenCalledWith(
      expect.anything(),
      "rate-limited",
      expect.objectContaining({ outcome: "refused", route: "checkout", rule: "checkout" }),
    );
  });

  it("SEC-052: 429 when signed-in-address refuses; the user's checkout rule is not consumed and no body is read", async () => {
    consumeMock.mockResolvedValueOnce({ ...allowed(false), saturated: true });
    const sent = request(undefined, { raw: "{broken", key: null });
    const response = await POST(sent);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(sent.bodyUsed).toBe(false);
    expect(consumeMock.mock.calls).toEqual([["unknown", RATE_LIMITS.SIGNED_IN_ADDRESS]]);
    expect(checkoutMock).not.toHaveBeenCalled();
    expect(eventMock).toHaveBeenCalledWith(
      expect.anything(),
      "rate-limited",
      expect.objectContaining({
        outcome: "refused",
        route: "checkout",
        rule: "signed-in-address",
        clientIp: "unknown",
        saturated: true,
      }),
    );
  });

  it("a request that reaches the limit uses an allowance of both rules even when it is then refused", async () => {
    await POST(request({ ...BODY, priceSatang: 1 }));
    expect(consumeMock).toHaveBeenCalledTimes(2);
  });

  it("maps the service's outcomes: 404 address, 409 CART_EMPTY, 409 with items, 422", async () => {
    checkoutMock.mockRejectedValue(notFound({ details: { resource: "address" } }));
    let response = await POST(request(BODY));
    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorEnvelope).error.details).toEqual({
      resource: "address",
    });

    checkoutMock.mockRejectedValue(cartEmpty());
    response = await POST(request(BODY));
    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorEnvelope).error.code).toBe("CART_EMPTY");

    const details = {
      items: [
        {
          cartItemId: "line_1",
          productId: "p1",
          reason: "INSUFFICIENT_STOCK",
          requestedQuantity: 5,
          availableStock: 3,
        },
      ],
      totals: { itemsSubtotalSatang: 3_000, shippingTotalSatang: 4_000, grandTotalSatang: 7_000 },
    };
    checkoutMock.mockRejectedValue(new AppError("INSUFFICIENT_STOCK", { details }));
    response = await POST(request(BODY));
    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorEnvelope).error).toMatchObject({
      code: "INSUFFICIENT_STOCK",
      details,
    });

    checkoutMock.mockRejectedValue(orderLimitExceeded());
    expect((await POST(request(BODY))).status).toBe(422);
  });
});
