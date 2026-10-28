/**
 * Route-level tests of `POST /api/v1/orders/{id}/items/{itemId}/review` (docs/API_CONTRACTS.md
 * sections 1.8, 5.6, 6).
 *
 * No database is reached: the session guard, the rate limiter, and the reviews service are mocks,
 * so these tests cover what the handler decides (the order of refusals, validation, the envelope).
 * The service against a real database is in tests/integration/reviews.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consumeUserRateLimit } from "@/modules/rate-limit";
import { createReview } from "@/modules/reviews/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { conflict, notFound, unauthenticated } from "@/server/errors";
import { rateLimiter } from "@/server/rate-limit";

import * as routeModule from "./route";

const APP_ORIGIN = "http://localhost:3000";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, appOrigin: "http://localhost:3000" }),
}));
vi.mock("@/server/auth/session", () => ({ requireActor: vi.fn() }));
vi.mock("@/server/auth/security-events", () => ({ recordSecurityEvent: vi.fn() }));
vi.mock("@/modules/reviews/service", () => ({ createReview: vi.fn() }));
vi.mock("@/modules/rate-limit", () => ({ consumeUserRateLimit: vi.fn() }));

const { POST } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const createMock = vi.mocked(createReview);
const userLimitMock = vi.mocked(consumeUserRateLimit);

function actor(role: Actor["role"]): Actor {
  return Object.freeze({
    userId: "user_me",
    role,
    storeId: role === "SELLER" ? "store_me" : null,
    storeStatus: role === "SELLER" ? "APPROVED" : null,
  });
}

const REVIEW = { id: "rev1", rating: 5, comment: "ดี", createdAt: "2026-10-26T01:00:00.000Z" };

function post(
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
  return new Request(`${APP_ORIGIN}/api/v1/orders/order1/items/item1/review`, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(options.body ?? { rating: 5, comment: "ดี" }),
  });
}

function context(id = "order1", itemId = "item1"): never {
  return { params: Promise.resolve({ id, itemId }) } as never;
}

async function codeOf(response: Response): Promise<string> {
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { error: { code: string } }).error.code;
}

let consumeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  requireActorMock.mockReset();
  requireActorMock.mockResolvedValue(actor("CUSTOMER"));
  createMock.mockReset();
  createMock.mockResolvedValue(REVIEW);
  consumeSpy = vi.spyOn(rateLimiter, "consume");
  consumeSpy.mockResolvedValue({
    allowed: true,
    limit: 60,
    remaining: 59,
    resetAt: 0,
    retryAfterSeconds: 1,
    saturated: false,
  });
  userLimitMock.mockReset();
  userLimitMock.mockResolvedValue({
    allowed: true,
    limit: 10,
    remaining: 9,
    resetAt: 0,
    retryAfterSeconds: 1,
    saturated: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/v1/orders/{id}/items/{itemId}/review: the route module", () => {
  it("exports POST only", () => {
    expect(Object.keys(routeModule)).toEqual(["POST"]);
  });

  it("is thin: no database, no raw body read", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
    expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated|\$transaction/);
  });
});

describe("POST /api/v1/orders/{id}/items/{itemId}/review", () => {
  it("answers 201 with the review, for any role, from the session's actor and the path", async () => {
    for (const role of ["CUSTOMER", "SELLER", "ADMIN"] as const) {
      const who = actor(role);
      requireActorMock.mockResolvedValue(who);
      const response = await POST(post(), context());
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ data: REVIEW });
      expect(createMock).toHaveBeenLastCalledWith(
        who,
        { id: "order1", itemId: "item1" },
        { rating: 5, comment: "ดี" },
      );
    }
  });

  it("consumes signed-in-address on the client address, then the review-create rule on the session's user id (SEC-052)", async () => {
    await POST(post(), context());
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    // No trusted proxy here, so SR-01 gives the shared subject `unknown`.
    expect(consumeSpy.mock.calls[0]?.[0]).toBe("unknown");
    expect(consumeSpy.mock.calls[0]?.[1]).toMatchObject({ name: "signed-in-address", limit: 60 });
    // The per-user rule is counted in the database (option (b)) on the session's actor.
    expect(userLimitMock.mock.calls).toEqual([
      [actor("CUSTOMER"), { name: "review-create", limit: 10, windowMs: 3_600_000 }],
    ]);
    expect(consumeSpy.mock.invocationCallOrder[0]).toBeLessThan(
      userLimitMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(userLimitMock.mock.invocationCallOrder[0]).toBeLessThan(
      createMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("fails closed when the per-user store fails: 500, body unread, service not called", async () => {
    userLimitMock.mockRejectedValueOnce(new Error("connection refused"));
    const sent = post({ rawBody: "{not json" });
    const response = await POST(sent, context());
    expect(response.status).toBe(500);
    expect(await codeOf(response)).toBe("INTERNAL_ERROR");
    expect(sent.bodyUsed).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("is 429 when signed-in-address refuses, without consuming review-create or reading the body (SEC-052)", async () => {
    consumeSpy.mockResolvedValueOnce({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: 0,
      retryAfterSeconds: 30,
      saturated: false,
    });
    const sent = post({ rawBody: "{not json" });
    const response = await POST(sent, context());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await codeOf(response)).toBe("RATE_LIMITED");
    expect(sent.bodyUsed).toBe(false);
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    expect(consumeSpy.mock.calls[0]?.[1]).toMatchObject({ name: "signed-in-address" });
    expect(userLimitMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("is 403 for a foreign Origin before anything else", async () => {
    const response = await POST(post({ origin: "https://evil.example" }), context());
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN");
    expect(requireActorMock).not.toHaveBeenCalled();
    expect(consumeSpy).not.toHaveBeenCalled();
  });

  it("is 415 without a JSON content type, before the session", async () => {
    const response = await POST(post({ contentType: "text/plain" }), context());
    expect(response.status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
  });

  it("is 401 for a guest, before the rate limit and the body", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    const response = await POST(post({ rawBody: "{not json" }), context());
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("UNAUTHENTICATED");
    expect(consumeSpy).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("is 429 with Retry-After over the limit, before the body is read", async () => {
    userLimitMock.mockResolvedValue({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 0,
      retryAfterSeconds: 120,
      saturated: false,
    });
    const response = await POST(post({ rawBody: "{not json" }), context());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(await codeOf(response)).toBe("RATE_LIMITED");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("is 400 for invalid JSON, a bad rating, an unknown key, and a bad path id", async () => {
    const cases: [Request, never][] = [
      [post({ rawBody: "{not json" }), context()],
      [post({ body: { rating: 0 } }), context()],
      [post({ body: { rating: 6 } }), context()],
      [post({ body: { rating: 4.5 } }), context()],
      [post({ body: { rating: "5" } }), context()],
      [post({ body: { comment: "x" } }), context()],
      [post({ body: { rating: 5, productId: "p" } }), context()],
      [post({ body: { rating: 5, userId: "u" } }), context()],
      [post(), context("", "item1")],
      [post(), context("order1", "a".repeat(201))],
    ];
    for (const [request, routeContext] of cases) {
      const response = await POST(request, routeContext);
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it("maps the service's 404 and 409 refusals to the envelope", async () => {
    createMock.mockRejectedValueOnce(notFound());
    let response = await POST(post(), context());
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { details: unknown } }).error.details).toEqual({});

    for (const reason of ["NOT_DELIVERED", "DUPLICATE_REVIEW"]) {
      createMock.mockRejectedValueOnce(conflict(reason));
      response = await POST(post(), context());
      expect(response.status).toBe(409);
      const { error } = (await response.json()) as { error: { code: string; details: unknown } };
      expect(error).toMatchObject({ code: "CONFLICT", details: { reason } });
    }
  });
});
