/**
 * Route-level tests of `PATCH` and `DELETE /api/v1/me/addresses/{id}` (docs/API_CONTRACTS.md
 * sections 1.2, 1.8, 2.2, 5.3).
 *
 * No database is reached: the session guard and the profile service are mocks. Ownership itself
 * (a foreign id is 404 and changes nothing) is the service's and is tested against a real database
 * in tests/integration/profile; here only the mapping of its refusal is checked.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AddressDto } from "@/modules/profile";
import { deleteAddress, updateAddress } from "@/modules/profile/service";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { notFound, unauthenticated } from "@/server/errors";

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

const { PATCH, DELETE } = routeModule;
const requireActorMock = vi.mocked(requireActor);
const updateMock = vi.mocked(updateAddress);
const deleteMock = vi.mocked(deleteAddress);

const ACTOR: Actor = Object.freeze({
  userId: "user_me",
  role: "ADMIN",
  storeId: null,
  storeStatus: null,
});
const ADDRESS: AddressDto = {
  id: "addr_1",
  recipientName: "สมชาย ใจดี",
  phone: "0812345678",
  line1: "99/1 ถนนสุขุมวิท",
  subdistrict: "คลองเตย",
  district: "คลองเตย",
  province: "กรุงเทพมหานคร",
  postalCode: "10110",
  isDefault: true,
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
  updateMock.mockReset();
  updateMock.mockResolvedValue(ADDRESS);
  deleteMock.mockReset();
  deleteMock.mockResolvedValue({ deleted: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

interface MutationOptions {
  origin?: string | null;
  contentType?: string | null;
  raw?: string;
}

function request(method: "PATCH" | "DELETE", body?: unknown, options: MutationOptions = {}) {
  const headers = new Headers();
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const text = options.raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Request(`${APP_ORIGIN}/api/v1/me/addresses/addr_1`, {
    method,
    headers,
    ...(text === undefined ? {} : { body: text }),
  });
}

describe("/api/v1/me/addresses/{id}: the route module", () => {
  it("exports PATCH and DELETE only", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["DELETE", "PATCH"]);
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

describe("PATCH /api/v1/me/addresses/{id}", () => {
  it("passes the session's actor, the path id, and the parsed body to the service", async () => {
    const response = await PATCH(request("PATCH", { isDefault: true }), params("addr_1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: ADDRESS });
    expect(updateMock).toHaveBeenCalledWith(ACTOR, "addr_1", { isDefault: true });
  });

  it("maps the service's 404 for a foreign or unknown id to the plain 404 envelope", async () => {
    updateMock.mockRejectedValue(notFound());
    const response = await PATCH(request("PATCH", { isDefault: true }), params("addr_foreign"));
    expect(response.status).toBe(404);
    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error).toEqual({
      code: "NOT_FOUND",
      message: "The resource was not found.",
      details: {},
      requestId: response.headers.get("x-request-id"),
    });
  });

  it("refuses userId in the body: an address cannot be moved to another user", async () => {
    const response = await PATCH(
      request("PATCH", { isDefault: true, userId: "user_victim" }),
      params("addr_1"),
    );
    expect(response.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses an empty body object and a bad postal code", async () => {
    expect((await PATCH(request("PATCH", {}), params("addr_1"))).status).toBe(400);
    expect((await PATCH(request("PATCH", { postalCode: "123" }), params("addr_1"))).status).toBe(
      400,
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("refuses an id that is too long, after the body was read", async () => {
    const response = await PATCH(request("PATCH", { isDefault: true }), params("x".repeat(201)));
    expect(response.status).toBe(400);
    const body = (await response.json()) as ErrorEnvelope;
    expect(body.error.details.fields).toEqual([expect.objectContaining({ path: "id" })]);
  });

  it("order: 403 origin, 415 content type, 401 session; the body is not read for any of them", async () => {
    const foreign = request("PATCH", { isDefault: true }, { origin: "https://evil.example" });
    expect((await PATCH(foreign, params("addr_1"))).status).toBe(403);
    const wrongType = request("PATCH", { isDefault: true }, { contentType: "text/plain" });
    expect((await PATCH(wrongType, params("addr_1"))).status).toBe(415);
    expect(requireActorMock).not.toHaveBeenCalled();
    requireActorMock.mockRejectedValue(unauthenticated());
    const anonymous = request("PATCH", undefined, { raw: "{broken" });
    expect((await PATCH(anonymous, params("addr_1"))).status).toBe(401);
    for (const sent of [foreign, wrongType, anonymous]) expect(sent.bodyUsed).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/me/addresses/{id}", () => {
  it("deletes through the service with the actor and the path id, and reads no body", async () => {
    const sent = request("DELETE", { anything: "ignored" });
    const response = await DELETE(sent, params("addr_1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { deleted: true } });
    expect(deleteMock).toHaveBeenCalledWith(ACTOR, "addr_1");
    expect(sent.bodyUsed).toBe(false);
  });

  it("maps the service's 404 for a foreign or unknown id", async () => {
    deleteMock.mockRejectedValue(notFound());
    expect((await DELETE(request("DELETE"), params("addr_foreign"))).status).toBe(404);
  });

  it("requires the JSON content type even without a body (section 1.2)", async () => {
    const response = await DELETE(request("DELETE", undefined, { contentType: null }), params("a"));
    expect(response.status).toBe(415);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("refuses a foreign origin (403) and an anonymous caller (401)", async () => {
    expect(
      (await DELETE(request("DELETE", undefined, { origin: "https://evil.example" }), params("a")))
        .status,
    ).toBe(403);
    requireActorMock.mockRejectedValue(unauthenticated());
    expect((await DELETE(request("DELETE"), params("a"))).status).toBe(401);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("refuses an empty id", async () => {
    expect((await DELETE(request("DELETE"), params(""))).status).toBe(400);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
