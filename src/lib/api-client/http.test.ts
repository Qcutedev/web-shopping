import { describe, expect, it, vi } from "vitest";
import { apiErrorMessage } from "./error-copy";
import { apiRequest } from "./http";
import { createAddress, deleteAddress, updateAddress, updateProfile } from "./me";
import { th } from "@/i18n/th";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiRequest", () => {
  it("returns data of a success envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "a" } }, 201));
    const result = await apiRequest<{ id: string }>("/api/v1/x", { method: "POST", fetchImpl });
    expect(result).toEqual({ ok: true, status: 201, data: { id: "a" } });
  });

  it("sends a JSON content type on a mutation without a body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { deleted: true } }));
    await apiRequest("/api/v1/x", { method: "DELETE", fetchImpl });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe("same-origin");
  });

  it("reads the error code, field errors, and request id of an error envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The request is invalid.",
            details: { fields: [{ path: "postalCode", code: "invalid_format", message: "x" }] },
            requestId: "r-1",
          },
        },
        400,
      ),
    );
    const result = await apiRequest("/api/v1/x", { method: "POST", body: {}, fetchImpl });
    expect(result).toEqual({
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      fields: [{ path: "postalCode", code: "invalid_format" }],
      requestId: "r-1",
    });
  });

  it("does not throw on a network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("failed"));
    const result = await apiRequest("/api/v1/x", { method: "GET", fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 0, code: "NETWORK_ERROR" });
  });

  it("does not throw on an answer that is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }));
    const result = await apiRequest("/api/v1/x", { method: "GET", fetchImpl });
    expect(result).toMatchObject({ ok: false, status: 502, code: "UNKNOWN" });
  });
});

describe("apiErrorMessage", () => {
  it("maps codes to Thai copy and never to the English message", () => {
    expect(apiErrorMessage({ status: 401, code: "UNAUTHENTICATED" })).toBe(
      th.errors.unauthenticated,
    );
    expect(apiErrorMessage({ status: 404, code: "NOT_FOUND" })).toBe(th.errors.notFound);
    expect(apiErrorMessage({ status: 0, code: "NETWORK_ERROR" })).toBe(th.errors.network);
    expect(apiErrorMessage({ status: 500, code: "INTERNAL_ERROR" })).toBe(th.errors.unknown);
  });
});

describe("me client", () => {
  const address = {
    recipientName: "ก",
    phone: "0812345678",
    line1: "1",
    subdistrict: "ก",
    district: "ก",
    province: "ก",
    postalCode: "10110",
    isDefault: false,
  };

  it("calls the documented endpoints with the documented methods", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ data: {} })));
    await updateProfile({ name: "n" }, fetchImpl);
    await createAddress(address, fetchImpl);
    await updateAddress("a/b", { isDefault: true }, fetchImpl);
    await deleteAddress("a b", fetchImpl);
    const calls = fetchImpl.mock.calls.map(([url, init]) => [url, (init as RequestInit).method]);
    expect(calls).toEqual([
      ["/api/v1/me", "PATCH"],
      ["/api/v1/me/addresses", "POST"],
      ["/api/v1/me/addresses/a%2Fb", "PATCH"],
      ["/api/v1/me/addresses/a%20b", "DELETE"],
    ]);
  });
});
