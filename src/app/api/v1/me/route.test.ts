/**
 * Route-level tests of `GET` and `PATCH /api/v1/me` (docs/API_CONTRACTS.md sections 1.8, 2.2,
 * 5.3).
 *
 * No database is reached: the session guard and the profile service are mocks, so these tests
 * cover what the handler and its frame decide (the order of refusals, validation, the envelope,
 * the error mapping). The service against a real database is in tests/integration/profile.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileDto } from "@/modules/profile";
import { getProfile, updateProfile } from "@/modules/profile/service";
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
vi.mock("@/modules/profile/service", () => ({
  createAddress: vi.fn(),
  deleteAddress: vi.fn(),
  getProfile: vi.fn(),
  listAddresses: vi.fn(),
  updateAddress: vi.fn(),
  updateProfile: vi.fn(),
}));

const { GET, PATCH } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const getProfileMock = vi.mocked(getProfile);
const updateProfileMock = vi.mocked(updateProfile);

const CANARY = "Zq7SECRETcanary";
const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "CUSTOMER",
  storeId: null,
  storeStatus: null,
});
const PROFILE: ProfileDto = {
  id: "user_me",
  name: "สมชาย",
  email: "somchai@example.com",
  phone: null,
  role: "CUSTOMER",
  store: null,
  sellerApplication: null,
};

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: { fields?: { path: string; code: string }[] };
    requestId: string;
  };
}

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  requireActorMock.mockReset();
  requireActorMock.mockResolvedValue(ACTOR);
  getProfileMock.mockReset();
  getProfileMock.mockResolvedValue(PROFILE);
  updateProfileMock.mockReset();
  updateProfileMock.mockResolvedValue(PROFILE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface PatchOptions {
  body?: unknown;
  rawBody?: string;
  origin?: string | null;
  contentType?: string | null;
}

function patch(options: PatchOptions = {}): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const body = options.rawBody ?? JSON.stringify(options.body ?? { name: "ใหม่" });
  return new Request(`${APP_ORIGIN}/api/v1/me`, { method: "PATCH", headers, body });
}

async function errorOf(response: Response): Promise<ErrorEnvelope["error"]> {
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as ErrorEnvelope;
  expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  return body.error;
}

describe("/api/v1/me: the route module", () => {
  it("exports GET and PATCH only", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "PATCH"]);
  });

  it("is thin: the profile surface, the guard, and the shared frame; no database, no raw body read", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");
    const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.sort()).toEqual([
      "@/modules/profile",
      "@/server/auth/session",
      "@/server/env",
      "@/server/http",
      "@/server/request-frame",
    ]);
    expect(source).not.toMatch(/request\.(json|text|formData|arrayBuffer|blob)\s*\(/);
    expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated/);
  });
});

describe("GET /api/v1/me", () => {
  it("answers the caller's profile from the service, with the actor of the session", async () => {
    const response = await GET(new Request(`${APP_ORIGIN}/api/v1/me?userId=user_victim`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: PROFILE });
    expect(getProfileMock).toHaveBeenCalledWith(ACTOR);
  });

  it("is 401 without a session, and the service is not called", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    const response = await GET(new Request(`${APP_ORIGIN}/api/v1/me`));
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe("UNAUTHENTICATED");
    expect(getProfileMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/me: success", () => {
  it("passes the parsed body and the session's actor to the service", async () => {
    const response = await PATCH(patch({ body: { name: "  ใหม่ ", phone: "081-234-5678" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: PROFILE });
    expect(updateProfileMock).toHaveBeenCalledWith(ACTOR, { name: "ใหม่", phone: "0812345678" });
  });

  it("accepts phone null to clear it", async () => {
    await PATCH(patch({ body: { phone: null } }));
    expect(updateProfileMock).toHaveBeenCalledWith(ACTOR, { phone: null });
  });
});

describe("PATCH /api/v1/me: order of refusals (section 1.8)", () => {
  it("1: a foreign Origin is 403 before anything else, with no session read", async () => {
    const response = await PATCH(patch({ origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("FORBIDDEN");
    expect(requireActorMock).not.toHaveBeenCalled();
  });

  it("1: a missing Origin is 403", async () => {
    expect((await PATCH(patch({ origin: null }))).status).toBe(403);
  });

  it("2: a wrong or missing content type is 415, before the session", async () => {
    for (const contentType of ["text/plain", null]) {
      const response = await PATCH(patch({ contentType }));
      expect(response.status).toBe(415);
    }
    expect(requireActorMock).not.toHaveBeenCalled();
  });

  it("3: no session is 401 and the body is never read, even when it is invalid", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    const request = patch({ rawBody: "{not json" });
    const response = await PATCH(request);
    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("6: a body over 100 KiB is 413", async () => {
    const response = await PATCH(patch({ body: { name: "a".repeat(102_400) } }));
    expect(response.status).toBe(413);
    expect(updateProfileMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/me: validation (400)", () => {
  it.each([
    ["email", { email: "other@example.com" }],
    ["role", { role: "ADMIN" }],
    ["isActive", { isActive: false }],
    ["userId", { userId: "user_victim" }],
  ])("refuses the unknown key %s and does not call the service (REQ-C-03)", async (_k, extra) => {
    const response = await PATCH(patch({ body: { name: "A", ...extra } }));
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.fields).toEqual([expect.objectContaining({ code: "unrecognized_keys" })]);
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("refuses an empty body object, invalid JSON, and a bad phone", async () => {
    for (const request of [
      patch({ body: {} }),
      patch({ rawBody: "{" }),
      patch({ body: { phone: "12345" } }),
      patch({ body: { name: "" } }),
    ]) {
      expect((await PATCH(request)).status).toBe(400);
    }
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it("does not echo the rejected value and logs nothing for a client error", async () => {
    const response = await PATCH(patch({ body: { phone: CANARY } }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(CANARY);
    expect(lines).toEqual([]);
  });
});

describe("/api/v1/me: service errors", () => {
  it("turns an unknown error into a 500 that discloses nothing", async () => {
    updateProfileMock.mockRejectedValue(new Error(`UPDATE "User" ${CANARY}`));
    const response = await PATCH(patch());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(CANARY);
    expect(lines.join("")).not.toContain(CANARY);
  });
});
