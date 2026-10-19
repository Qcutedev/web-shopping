/**
 * Route-level tests of `GET` and `POST /api/v1/seller/application` (docs/API_CONTRACTS.md
 * sections 1.8, 5.7.1, 6).
 *
 * No database is reached: the session guard, the rate limiter, and the seller service are mocks,
 * so these tests cover what the handler decides (the order of refusals, validation, the
 * envelope). The service against a real database is in tests/integration/sellers.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SellerApplicationDto } from "@/modules/sellers";
import { getOwnApplication, submitApplication } from "@/modules/sellers/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { notFound, unauthenticated } from "@/server/errors";
import { rateLimiter } from "@/server/rate-limit";

import * as routeModule from "./route";

const APP_ORIGIN = "http://localhost:3000";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, appOrigin: "http://localhost:3000" }),
}));
vi.mock("@/server/auth/session", () => ({ requireActor: vi.fn() }));
vi.mock("@/server/auth/security-events", () => ({ recordSecurityEvent: vi.fn() }));
vi.mock("@/modules/sellers/service", () => ({
  approveApplication: vi.fn(),
  getOwnApplication: vi.fn(),
  getOwnStore: vi.fn(),
  rejectApplication: vi.fn(),
  requireApprovedStoreForStoreRowWrite: vi.fn(),
  requireApprovedStoreForWrite: vi.fn(),
  submitApplication: vi.fn(),
  updateOwnStore: vi.fn(),
}));

const { GET, POST } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const getMock = vi.mocked(getOwnApplication);
const submitMock = vi.mocked(submitApplication);

function actor(role: Actor["role"], storeStatus: Actor["storeStatus"] = null): Actor {
  return Object.freeze({
    userId: "user_me",
    role,
    storeId: storeStatus === null ? null : "store_me",
    storeStatus,
  });
}

const APPLICATION: SellerApplicationDto = {
  id: "app_1",
  storeName: "ร้านดี",
  description: "ขายของ",
  contactPhone: "0812345678",
  status: "PENDING",
  reviewNote: null,
  reviewedAt: null,
  createdAt: "2026-10-14T01:00:00.000Z",
};
const BODY = { storeName: "ร้านดี", description: "ขายของ", contactPhone: "081-234-5678" };

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
  return new Request(`${APP_ORIGIN}/api/v1/seller/application`, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(options.body ?? BODY),
  });
}

async function codeOf(response: Response): Promise<string> {
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { error: { code: string } }).error.code;
}

let consumeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  requireActorMock.mockReset();
  requireActorMock.mockResolvedValue(actor("CUSTOMER"));
  getMock.mockReset();
  getMock.mockResolvedValue(APPLICATION);
  submitMock.mockReset();
  submitMock.mockResolvedValue(APPLICATION);
  consumeSpy = vi.spyOn(rateLimiter, "consume");
  consumeSpy.mockResolvedValue({
    allowed: true,
    limit: 3,
    remaining: 2,
    resetAt: 0,
    retryAfterSeconds: 1,
    saturated: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/v1/seller/application: the route module", () => {
  it("exports GET and POST only", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "POST"]);
  });

  it("is thin: no database, no raw body read", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
    expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated|\$transaction/);
  });
});

describe("GET /api/v1/seller/application", () => {
  it("answers the caller's latest application, for any role", async () => {
    for (const who of [actor("CUSTOMER"), actor("SELLER", "SUSPENDED"), actor("ADMIN")]) {
      requireActorMock.mockResolvedValue(who);
      const response = await GET(new Request(`${APP_ORIGIN}/api/v1/seller/application?userId=x`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: APPLICATION });
      expect(getMock).toHaveBeenLastCalledWith(who);
    }
  });

  it("is 401 without a session and 404 when the service finds none", async () => {
    requireActorMock.mockRejectedValueOnce(unauthenticated());
    expect((await GET(new Request(`${APP_ORIGIN}/api/v1/seller/application`))).status).toBe(401);
    getMock.mockRejectedValueOnce(notFound());
    expect((await GET(new Request(`${APP_ORIGIN}/api/v1/seller/application`))).status).toBe(404);
  });
});

describe("POST /api/v1/seller/application", () => {
  it("creates with 201 and the session's actor, the body normalised", async () => {
    const response = await POST(post());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: APPLICATION });
    expect(submitMock).toHaveBeenCalledWith(actor("CUSTOMER"), {
      storeName: "ร้านดี",
      description: "ขายของ",
      contactPhone: "0812345678",
    });
    expect(consumeSpy).toHaveBeenCalledWith(
      "user_me",
      expect.objectContaining({ name: "seller-application" }),
    );
  });

  it("1, 2: origin and content type come before the session", async () => {
    expect((await POST(post({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post({ contentType: "text/plain" }))).status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
  });

  it("3: no session is 401 and the body is never read", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    const request = post({ rawBody: "{bad" });
    expect((await POST(request)).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  it.each([
    ["a seller", actor("SELLER", "APPROVED")],
    ["a suspended seller", actor("SELLER", "SUSPENDED")],
    ["an admin", actor("ADMIN")],
  ])("4: %s is 403 FORBIDDEN, uses no allowance, and the body is never read", async (_l, who) => {
    requireActorMock.mockResolvedValue(who);
    const request = post({ rawBody: "{bad" });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN");
    expect(request.bodyUsed).toBe(false);
    expect(consumeSpy).not.toHaveBeenCalled();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("5: over the limit is 429 with Retry-After, before the body is read", async () => {
    consumeSpy.mockResolvedValue({
      allowed: false,
      limit: 3,
      remaining: 0,
      resetAt: 0,
      retryAfterSeconds: 3600,
      saturated: false,
    });
    const request = post({ rawBody: "{bad" });
    const response = await POST(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(request.bodyUsed).toBe(false);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown key", { ...BODY, userId: "user_victim" }],
    ["a role", { ...BODY, role: "SELLER" }],
    ["a missing field", { storeName: "a", description: "b" }],
    ["a bad phone", { ...BODY, contactPhone: "123" }],
  ])("7: %s is 400 and the service is not called", async (_l, body) => {
    const response = await POST(post({ body }));
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("6: a body over 100 KiB is 413", async () => {
    const response = await POST(post({ body: { ...BODY, description: "a".repeat(102_400) } }));
    expect(response.status).toBe(413);
  });
});
