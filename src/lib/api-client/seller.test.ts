import { describe, expect, it, vi } from "vitest";
import { apiRequest } from "./http";
import {
  changeOrderStatus,
  changeStock,
  deleteProduct,
  runProductAction,
  updateProduct,
  uploadImage,
} from "./seller";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiRequest reason", () => {
  it("exposes details.reason of a conflict", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "CONFLICT",
            message: "x",
            details: { reason: "DUPLICATE_SKU" },
            requestId: "r",
          },
        },
        409,
      ),
    );
    const result = await apiRequest("/api/v1/x", { method: "POST", fetchImpl });
    expect(result).toMatchObject({ ok: false, code: "CONFLICT", reason: "DUPLICATE_SKU" });
  });

  it("leaves reason out when the envelope has none", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "NOT_FOUND", message: "x", details: {}, requestId: "r" } },
          404,
        ),
      );
    const result = await apiRequest("/api/v1/x", { method: "GET", fetchImpl });
    expect("reason" in result).toBe(false);
  });
});

describe("seller client", () => {
  it("uploads one file as multipart without setting a content type", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { data: { key: "k", url: "/api/files/k", contentType: "image/png", sizeBytes: 3 } },
          201,
        ),
      );
    const file = new File(["abc"], "pic.png", { type: "image/png" });
    const result = await uploadImage(file, fetchImpl);
    expect(result).toMatchObject({ ok: true, data: { key: "k" } });
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/v1/seller/uploads");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("builds product and order paths with encoded ids and the documented methods", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ data: {} })));
    await updateProduct("a/b", { title: "x" }, fetchImpl);
    await changeStock("a b", { set: 3 }, fetchImpl);
    await runProductAction("p1", "publish", fetchImpl);
    await runProductAction("p1", "archive", fetchImpl);
    await deleteProduct("p1", fetchImpl);
    await changeOrderStatus("o/1", { to: "SHIPPED", carrierName: "x" }, fetchImpl);
    const calls = fetchImpl.mock.calls.map(([url, init]) => [url, (init as RequestInit).method]);
    expect(calls).toEqual([
      ["/api/v1/seller/products/a%2Fb", "PATCH"],
      ["/api/v1/seller/products/a%20b/stock", "PATCH"],
      ["/api/v1/seller/products/p1/publish", "POST"],
      ["/api/v1/seller/products/p1/archive", "POST"],
      ["/api/v1/seller/products/p1", "DELETE"],
      ["/api/v1/seller/orders/o%2F1/status", "POST"],
    ]);
  });
});
