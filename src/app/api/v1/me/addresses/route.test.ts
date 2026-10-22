/**
 * Route-level tests of `GET` and `POST /api/v1/me/addresses` (docs/API_CONTRACTS.md sections 1.7,
 * 1.8, 2.2, 5.3).
 *
 * No database is reached: the session guard and the profile service are mocks. The service
 * against a real database is in tests/integration/profile.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADDRESS_LIMIT_REASON, type AddressDto } from "@/modules/profile";
import { createAddress, listAddresses } from "@/modules/profile/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { conflict, unauthenticated } from "@/server/errors";

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

const { GET, POST } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const listMock = vi.mocked(listAddresses);
const createMock = vi.mocked(createAddress);

const CANARY = "Zq7SECRETcanary";
const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "SELLER",
  storeId: "store_1",
  storeStatus: "SUSPENDED",
});
const INPUT = {
  recipientName: "สมชาย ใจดี",
  phone: "0812345678",
  line1: "99/1 ถนนสุขุมวิท",
  subdistrict: "คลองเตย",
  district: "คลองเตย",
  province: "กรุงเทพมหานคร",
  postalCode: "10110",
};
const ADDRESS: AddressDto = { id: "addr_1", ...INPUT, isDefault: false };

interface ErrorEnvelope {
  error: {
    code: string;
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
  listMock.mockReset();
  listMock.mockResolvedValue({ items: [ADDRESS], page: 1, pageSize: 20, total: 1 });
  createMock.mockReset();
  createMock.mockResolvedValue(ADDRESS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function list(query = ""): Promise<Response> {
  return GET(new Request(`${APP_ORIGIN}/api/v1/me/addresses${query}`));
}

function post(
  body: unknown,
  options: { origin?: string | null; contentType?: string | null; raw?: string } = {},
): Request {
  const headers = new Headers();
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  return new Request(`${APP_ORIGIN}/api/v1/me/addresses`, {
    method: "POST",
    headers,
    body: options.raw ?? JSON.stringify(body),
  });
}

describe("/api/v1/me/addresses: the route module", () => {
  it("exports GET and POST only", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "POST"]);
  });

  it("is thin: no database import, no raw body read", () => {
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
  });
});

describe("GET /api/v1/me/addresses", () => {
  it("answers the list envelope with the defaults and the session's actor", async () => {
    const response = await list();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [ADDRESS],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(listMock).toHaveBeenCalledWith(ACTOR, { page: 1, pageSize: 20 });
  });

  it("ignores userId and storeId in the query", async () => {
    await list("?userId=user_victim&storeId=s2&page=2&pageSize=5");
    expect(listMock).toHaveBeenCalledWith(ACTOR, { page: 2, pageSize: 5 });
  });

  it("refuses pageSize above 50 (never clamped) and page 0", async () => {
    expect((await list("?pageSize=51")).status).toBe(400);
    expect((await list("?page=0")).status).toBe(400);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("is 401 without a session, before the query is validated", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    expect((await list("?pageSize=999")).status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/me/addresses", () => {
  it("creates with the parsed body and answers 201", async () => {
    const response = await POST(post({ ...INPUT, phone: "081-234-5678", isDefault: true }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: ADDRESS });
    expect(createMock).toHaveBeenCalledWith(ACTOR, { ...INPUT, isDefault: true });
  });

  it("maps the address cap to 409 CONFLICT with details.reason ADDRESS_LIMIT (D-044 point 4)", async () => {
    createMock.mockRejectedValue(conflict(ADDRESS_LIMIT_REASON));
    const response = await POST(post(INPUT));
    expect(response.status).toBe(409);
    const body = (await response.json()) as ErrorEnvelope & {
      error: { message: string; details: { reason?: string } };
    };
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.details).toEqual({ reason: "ADDRESS_LIMIT" });
    expect(typeof body.error.requestId).toBe("string");
  });

  it("defaults isDefault to false", async () => {
    await POST(post(INPUT));
    expect(createMock).toHaveBeenCalledWith(ACTOR, { ...INPUT, isDefault: false });
  });

  it("refuses a foreign origin (403), then a wrong content type (415), before the session", async () => {
    expect((await POST(post(INPUT, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post(INPUT, { contentType: "text/plain" }))).status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
  });

  it("is 401 without a session and does not read the body", async () => {
    requireActorMock.mockRejectedValue(unauthenticated());
    const request = post(INPUT);
    expect((await POST(request)).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each([
    ["userId", { userId: "user_victim" }],
    ["id", { id: "addr_x" }],
  ])("refuses the unknown key %s", async (_key, extra) => {
    const response = await POST(post({ ...INPUT, ...extra }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error.details.fields).toEqual([
      expect.objectContaining({ path: "", code: "unrecognized_keys" }),
    ]);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("refuses a postal code that is not exactly five digits (REQ-C-04)", async () => {
    for (const postalCode of ["1011", "101100", "1011a"]) {
      const response = await POST(post({ ...INPUT, postalCode }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorEnvelope;
      expect(body.error.details.fields).toEqual([expect.objectContaining({ path: "postalCode" })]);
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  it("refuses a missing field and invalid JSON, without echoing input or logging", async () => {
    const { province: _omitted, ...withoutProvince } = { ...INPUT, line1: CANARY };
    expect(_omitted).toBeDefined();
    const response = await POST(post(withoutProvince));
    expect(response.status).toBe(400);
    expect((await POST(post(null, { raw: `{"line1":"${CANARY}"` }))).status).toBe(400);
    expect(await response.text()).not.toContain(CANARY);
    expect(lines).toEqual([]);
  });
});
