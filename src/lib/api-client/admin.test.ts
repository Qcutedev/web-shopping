import { describe, expect, it, vi } from "vitest";
import {
  approveApplication,
  approveProduct,
  changeSellerOrderStatus,
  createCategory,
  deactivateUser,
  deleteCategory,
  hideReview,
  unhideReview,
  reactivateUser,
  rejectApplication,
  rejectProduct,
  reinstateStore,
  suspendStore,
  takedownProduct,
  updateCategory,
  updateSettings,
} from "./admin";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function okFetch() {
  return vi.fn().mockResolvedValue(jsonResponse({ data: { id: "x" } }));
}

function call(fetchImpl: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

describe("admin API client, review moderation", () => {
  it("posts hide and unhide with a JSON body to the encoded path", async () => {
    const hide = okFetch();
    await hideReview("r/1", { reason: "ไม่เหมาะสม" }, hide);
    expect(call(hide).url).toBe("/api/v1/admin/reviews/r%2F1/hide");
    expect(call(hide).init.method).toBe("POST");
    expect(JSON.parse(call(hide).init.body as string)).toEqual({ reason: "ไม่เหมาะสม" });

    const unhide = okFetch();
    await unhideReview("r1", {}, unhide);
    expect(call(unhide).url).toBe("/api/v1/admin/reviews/r1/unhide");
    expect(JSON.parse(call(unhide).init.body as string)).toEqual({});
  });
});

describe("admin API client", () => {
  it("posts a user decision without a body to the encoded path", async () => {
    const fetchImpl = okFetch();
    await deactivateUser("u/1 2", fetchImpl);
    const { url, init } = call(fetchImpl);
    expect(url).toBe("/api/v1/admin/users/u%2F1%202/deactivate");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.credentials).toBe("same-origin");
  });

  it("reactivates a user", async () => {
    const fetchImpl = okFetch();
    await reactivateUser("u1", fetchImpl);
    expect(call(fetchImpl).url).toBe("/api/v1/admin/users/u1/reactivate");
  });

  it("approves an application without a body and rejects with a reason", async () => {
    const approve = okFetch();
    await approveApplication("a1", approve);
    expect(call(approve).url).toBe("/api/v1/admin/applications/a1/approve");
    expect(call(approve).init.body).toBeUndefined();

    const reject = okFetch();
    await rejectApplication("a1", { reason: "ไม่ครบ" }, reject);
    expect(call(reject).url).toBe("/api/v1/admin/applications/a1/reject");
    expect(JSON.parse(call(reject).init.body as string)).toEqual({ reason: "ไม่ครบ" });
  });

  it("suspends and reinstates a store with a reason", async () => {
    const suspend = okFetch();
    await suspendStore("s1", { reason: "r" }, suspend);
    expect(call(suspend).url).toBe("/api/v1/admin/stores/s1/suspend");
    const reinstate = okFetch();
    await reinstateStore("s1", { reason: "r" }, reinstate);
    expect(call(reinstate).url).toBe("/api/v1/admin/stores/s1/reinstate");
  });

  it("sends the revision the admin saw with every product decision", async () => {
    const approve = okFetch();
    await approveProduct("p1", { contentRevision: 4 }, approve);
    expect(JSON.parse(call(approve).init.body as string)).toEqual({ contentRevision: 4 });
    const reject = okFetch();
    await rejectProduct("p1", { contentRevision: 4, reason: "r" }, reject);
    expect(call(reject).url).toBe("/api/v1/admin/products/p1/reject");
    const takedown = okFetch();
    await takedownProduct("p1", { contentRevision: 4, reason: "r" }, takedown);
    expect(call(takedown).url).toBe("/api/v1/admin/products/p1/takedown");
  });

  it("creates, updates, and deletes a category", async () => {
    const create = okFetch();
    await createCategory({ name: "เสื้อผ้า" }, create);
    expect(call(create).url).toBe("/api/v1/admin/categories");
    expect(call(create).init.method).toBe("POST");
    const update = okFetch();
    await updateCategory("c1", { isActive: false }, update);
    expect(call(update).init.method).toBe("PATCH");
    expect(JSON.parse(call(update).init.body as string)).toEqual({ isActive: false });
    const remove = okFetch();
    await deleteCategory("c1", remove);
    expect(call(remove).init.method).toBe("DELETE");
    expect(call(remove).init.body).toBeUndefined();
  });

  it("changes a seller order status through the admin path", async () => {
    const fetchImpl = okFetch();
    await changeSellerOrderStatus("so1", { to: "CANCELLED" }, fetchImpl);
    expect(call(fetchImpl).url).toBe("/api/v1/admin/seller-orders/so1/status");
    expect(JSON.parse(call(fetchImpl).init.body as string)).toEqual({ to: "CANCELLED" });
  });

  it("patches the settings", async () => {
    const fetchImpl = okFetch();
    await updateSettings({ commissionRateBps: 700 }, fetchImpl);
    expect(call(fetchImpl).url).toBe("/api/v1/admin/settings");
    expect(call(fetchImpl).init.method).toBe("PATCH");
  });

  it("returns the conflict reason of a refusal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "CONFLICT",
            message: "x",
            details: { reason: "LAST_ADMIN" },
            requestId: "r",
          },
        },
        409,
      ),
    );
    const result = await deactivateUser("u1", fetchImpl);
    expect(result).toMatchObject({ ok: false, code: "CONFLICT", reason: "LAST_ADMIN" });
  });
});
