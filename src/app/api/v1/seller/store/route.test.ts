/**
 * Route-level tests of `GET` and `PATCH /api/v1/seller/store` (docs/API_CONTRACTS.md sections
 * 1.8 and 5.7.1; REQ-S-02, REQ-S-09, BR-14).
 *
 * No database is reached: the session guard and the seller service are mocks. The real guard
 * helpers of src/server/auth/actor.ts are used, so the role and store-status refusals are the
 * real ones. The service against a real database is in tests/integration/sellers.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SellerStoreDto } from "@/modules/sellers";
import { getOwnStore, updateOwnStore } from "@/modules/sellers/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { unauthenticated } from "@/server/errors";

import * as routeModule from "./route";

const APP_ORIGIN = "http://localhost:3000";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/env", () => ({
  getEnv: () => ({ trustedProxy: { trustedProxyHops: 0 }, appOrigin: "http://localhost:3000" }),
}));
vi.mock("@/server/auth/session", () => ({ requireActor: vi.fn() }));
vi.mock("@/modules/sellers/service", () => ({
  approveApplication: vi.fn(),
  getOwnApplication: vi.fn(),
  getOwnStore: vi.fn(),
  rejectApplication: vi.fn(),
  requireApprovedStoreForWrite: vi.fn(),
  submitApplication: vi.fn(),
  updateOwnStore: vi.fn(),
}));

const { GET, PATCH } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const getMock = vi.mocked(getOwnStore);
const updateMock = vi.mocked(updateOwnStore);

function actor(role: Actor["role"], storeStatus: Actor["storeStatus"] = null): Actor {
  return Object.freeze({
    userId: "user_me",
    role,
    storeId: storeStatus === null ? null : "store_me",
    storeStatus,
  });
}

const SELLER = actor("SELLER", "APPROVED");
const STORE: SellerStoreDto = {
  id: "store_me",
  name: "ร้านดี",
  slug: "s-00000000",
  description: null,
  logo: null,
  contactPhone: "0812345678",
  status: "APPROVED",
  statusReason: null,
  isSample: false,
};

function patch(
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
  return new Request(`${APP_ORIGIN}/api/v1/seller/store`, {
    method: "PATCH",
    headers,
    body: options.rawBody ?? JSON.stringify(options.body ?? { name: "ใหม่" }),
  });
}

async function codeOf(response: Response): Promise<string> {
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
  requireActorMock.mockReset();
  requireActorMock.mockResolvedValue(SELLER);
  getMock.mockReset();
  getMock.mockResolvedValue(STORE);
  updateMock.mockReset();
  updateMock.mockResolvedValue(STORE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/v1/seller/store: the route module", () => {
  it("exports GET and PATCH only, and is thin", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "PATCH"]);
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
    expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated|\$transaction/);
  });
});

describe("GET /api/v1/seller/store", () => {
  it("answers the session's store for an approved and for a suspended seller", async () => {
    for (const who of [SELLER, actor("SELLER", "SUSPENDED")]) {
      requireActorMock.mockResolvedValue(who);
      const response = await GET(new Request(`${APP_ORIGIN}/api/v1/seller/store?storeId=other`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: STORE });
      expect(getMock).toHaveBeenLastCalledWith(who);
    }
  });

  it("is 403 FORBIDDEN for a customer (a pending or rejected applicant) and an admin", async () => {
    for (const who of [actor("CUSTOMER"), actor("ADMIN")]) {
      requireActorMock.mockResolvedValue(who);
      const response = await GET(new Request(`${APP_ORIGIN}/api/v1/seller/store`));
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("FORBIDDEN");
    }
    expect(getMock).not.toHaveBeenCalled();
  });

  it("is 401 without a session", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    expect((await GET(new Request(`${APP_ORIGIN}/api/v1/seller/store`))).status).toBe(401);
  });
});

describe("PATCH /api/v1/seller/store", () => {
  it("passes the parsed body and the session's actor", async () => {
    const response = await PATCH(patch({ body: { contactPhone: "02-123-4567", logoKey: null } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: STORE });
    expect(updateMock).toHaveBeenCalledWith(SELLER, { contactPhone: "021234567", logoKey: null });
  });

  it("1, 2: origin and content type come before the session", async () => {
    expect((await PATCH(patch({ origin: null }))).status).toBe(403);
    expect((await PATCH(patch({ contentType: null }))).status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
  });

  it("3: no session is 401", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    expect((await PATCH(patch())).status).toBe(401);
  });

  it.each([
    ["a customer (pending or rejected applicant)", actor("CUSTOMER"), "FORBIDDEN"],
    ["an admin", actor("ADMIN"), "FORBIDDEN"],
    ["a suspended seller", actor("SELLER", "SUSPENDED"), "SELLER_NOT_APPROVED"],
  ])("4: %s is refused before the body is read, even an invalid one", async (_l, who, code) => {
    requireActorMock.mockResolvedValue(who);
    const request = patch({ rawBody: "{bad" });
    const response = await PATCH(request);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe(code);
    expect(request.bodyUsed).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty object", {}],
    ["storeId", { name: "a", storeId: "store_other" }],
    ["slug", { slug: "x" }],
    ["status", { status: "APPROVED" }],
    ["a null name", { name: null }],
  ])("7: %s is 400", async (_l, body) => {
    const response = await PATCH(patch({ body }));
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("VALIDATION_ERROR");
    expect(updateMock).not.toHaveBeenCalled();
  });
});
