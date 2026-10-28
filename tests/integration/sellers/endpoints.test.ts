/**
 * T-040: `/api/v1/seller/application` and `/api/v1/seller/store` against the worker's real test
 * database (docs/API_CONTRACTS.md section 5.7.1; REQ-S-01, REQ-S-02, REQ-S-09, BR-06, BR-14).
 *
 * The route modules are called in process with a real `Request` and a real session cookie from
 * the sign-in route. Each case makes its own users, because the database is emptied once per
 * file, not per case. For every endpoint: success, validation failure, unauthenticated, wrong
 * role, and wrong owner (the store and the application have no id in the path, so "wrong owner"
 * is a foreign id in the body, or a `storeId` or `userId` in the query, which never changes what
 * is read or written).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  GET as getApplicationRoute,
  POST as postApplicationRoute,
} from "@/app/api/v1/seller/application/route";
import { GET as getStoreRoute, PATCH as patchStoreRoute } from "@/app/api/v1/seller/store/route";
import { db } from "@/server/db";

import { createSellerApplication, createUpload } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { resetUserRateLimits, USER_RATE_LIMIT_TABLE, windowCount } from "../rate-limit/support";
import { errorCode, json, request, signedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

const APPLY = {
  storeName: "  ร้านดีดี  ",
  description: "ขายของดี\r\nราคาถูก  ",
  contactPhone: "081-234-5678",
};

// ---------------------------------------------------------------------------------------------
// POST /seller/application
// ---------------------------------------------------------------------------------------------

describe("POST /api/v1/seller/application", () => {
  it("creates a PENDING application of the caller, normalised, and nothing else", async () => {
    const user = await signedIn();
    const response = await postApplicationRoute(
      request("POST", "/api/v1/seller/application", { cookie: user.cookie, body: APPLY }),
    );
    expect(response.status).toBe(201);
    const { data } = await json<{ data: Record<string, unknown> }>(response);
    expect(data).toMatchObject({
      storeName: "ร้านดีดี",
      description: "ขายของดี\nราคาถูก",
      contactPhone: "0812345678",
      status: "PENDING",
      reviewNote: null,
      reviewedAt: null,
    });
    const stored = await db.sellerApplication.findUniqueOrThrow({ where: { id: String(data.id) } });
    expect(stored.userId).toBe(user.userId);
    const role = await db.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(role.role).toBe("CUSTOMER");
    expect(await db.store.count({ where: { ownerId: user.userId } })).toBe(0);
  });

  it("refuses a second application while one is PENDING with 409 OPEN_APPLICATION", async () => {
    const user = await signedIn();
    await createSellerApplication({ userId: user.userId });
    // The per-user window is counted by contract whatever the outcome (section 6, SEC-052 (b)),
    // so it is left out of the snapshot and asserted on its own.
    const excludeTables = ["Session", USER_RATE_LIMIT_TABLE];
    const before = await snapshotDatabase({ excludeTables });
    const response = await postApplicationRoute(
      request("POST", "/api/v1/seller/application", { cookie: user.cookie, body: APPLY }),
    );
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      error: { code: "CONFLICT", details: { reason: "OPEN_APPLICATION" } },
    });
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables }))).toEqual([]);
    expect(await windowCount(user.userId, "seller-application")).toBe(1);
  });

  it("lets a rejected applicant apply again", async () => {
    const user = await signedIn();
    await createSellerApplication({ userId: user.userId, status: "REJECTED", reviewNote: "no" });
    const response = await postApplicationRoute(
      request("POST", "/api/v1/seller/application", { cookie: user.cookie, body: APPLY }),
    );
    expect(response.status).toBe(201);
    expect(await db.sellerApplication.count({ where: { userId: user.userId } })).toBe(2);
  });

  it("two submissions at the same time create exactly one application", async () => {
    const user = await signedIn();
    const responses = await Promise.all(
      [0, 1].map(() =>
        postApplicationRoute(
          request("POST", "/api/v1/seller/application", { cookie: user.cookie, body: APPLY }),
        ),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.sellerApplication.count({ where: { userId: user.userId } })).toBe(1);
  });

  it("is 400 for an invalid body or an unknown key (userId, role, status), and writes nothing", async () => {
    const user = await signedIn();
    const victim = await signedIn();
    for (const body of [
      { ...APPLY, userId: victim.userId },
      { ...APPLY, role: "SELLER" },
      { ...APPLY, status: "APPROVED" },
      { ...APPLY, contactPhone: "123" },
      { storeName: "a", description: "b" },
    ]) {
      // Each refused request still uses an allowance of 3 per day (section 6); start afresh.
      resetProcessRateLimiter();
      await resetUserRateLimits(user.userId);
      const response = await postApplicationRoute(
        request("POST", "/api/v1/seller/application", { cookie: user.cookie, body }),
      );
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VALIDATION_ERROR");
      expect(await windowCount(user.userId, "seller-application")).toBe(1);
    }
    expect(
      await db.sellerApplication.count({ where: { userId: { in: [user.userId, victim.userId] } } }),
    ).toBe(0);
  });

  it("is 401 without a session", async () => {
    const response = await postApplicationRoute(
      request("POST", "/api/v1/seller/application", { body: APPLY }),
    );
    expect(response.status).toBe(401);
  });

  it("is 403 FORBIDDEN for a seller (already owns a store, BR-06) and an admin; nothing is created", async () => {
    for (const who of [
      await signedIn("SELLER"),
      await signedIn("SELLER", "SUSPENDED"),
      await signedIn("ADMIN"),
    ]) {
      const response = await postApplicationRoute(
        request("POST", "/api/v1/seller/application", { cookie: who.cookie, body: APPLY }),
      );
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
      expect(await db.sellerApplication.count({ where: { userId: who.userId } })).toBe(0);
    }
  });

  it("allows 3 per day per user, then 429 with Retry-After before the body is read", async () => {
    const user = await signedIn();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await postApplicationRoute(
        request("POST", "/api/v1/seller/application", { cookie: user.cookie, body: APPLY }),
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([201, 409, 409]);
    const fourth = request("POST", "/api/v1/seller/application", {
      cookie: user.cookie,
      rawBody: "{not json",
    });
    const refused = await postApplicationRoute(fourth);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(fourth.bodyUsed).toBe(false);
    // Another user's allowance is untouched.
    const other = await signedIn();
    const response = await postApplicationRoute(
      request("POST", "/api/v1/seller/application", { cookie: other.cookie, body: APPLY }),
    );
    expect(response.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------
// GET /seller/application
// ---------------------------------------------------------------------------------------------

describe("GET /api/v1/seller/application", () => {
  it("returns the caller's latest application with the rejection reason", async () => {
    const user = await signedIn();
    await createSellerApplication({
      userId: user.userId,
      status: "REJECTED",
      reviewNote: "เอกสารไม่ครบ",
      reviewedAt: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date("2026-09-01T00:00:00Z"),
    });
    const response = await getApplicationRoute(
      request("GET", "/api/v1/seller/application", { cookie: user.cookie }),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      data: {
        status: "REJECTED",
        reviewNote: "เอกสารไม่ครบ",
        reviewedAt: "2026-10-01T00:00:00.000Z",
      },
    });
  });

  it("never shows another user's application, whatever the query says; none of one's own is 404", async () => {
    const owner = await signedIn();
    const application = await createSellerApplication({ userId: owner.userId });
    const other = await signedIn();
    const response = await getApplicationRoute(
      request("GET", `/api/v1/seller/application?userId=${owner.userId}&id=${application.id}`, {
        cookie: other.cookie,
      }),
    );
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ error: { code: "NOT_FOUND", details: {} } });
  });

  it("is 401 without a session", async () => {
    expect((await getApplicationRoute(request("GET", "/api/v1/seller/application"))).status).toBe(
      401,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// GET /seller/store
// ---------------------------------------------------------------------------------------------

describe("GET /api/v1/seller/store", () => {
  it("returns the session's own store, approved or suspended", async () => {
    for (const status of ["APPROVED", "SUSPENDED"] as const) {
      const seller = await signedIn("SELLER", status);
      await db.store.update({
        where: { id: seller.storeId ?? "" },
        data: { statusReason: status === "SUSPENDED" ? "ผิดเงื่อนไข" : null },
      });
      const response = await getStoreRoute(
        request("GET", "/api/v1/seller/store", { cookie: seller.cookie }),
      );
      expect(response.status).toBe(200);
      const { data } = await json<{ data: Record<string, unknown> }>(response);
      expect(data).toMatchObject({ id: seller.storeId, status, logo: null, isSample: false });
      expect(data.statusReason).toBe(status === "SUSPENDED" ? "ผิดเงื่อนไข" : null);
      expect(data).not.toHaveProperty("ownerId");
    }
  });

  it("ignores a storeId in the query (wrong owner): the caller's own store is answered", async () => {
    const seller = await signedIn("SELLER");
    const other = await signedIn("SELLER");
    const response = await getStoreRoute(
      request("GET", `/api/v1/seller/store?storeId=${other.storeId ?? ""}`, {
        cookie: seller.cookie,
      }),
    );
    expect((await json<{ data: { id: string } }>(response)).data.id).toBe(seller.storeId);
  });

  it("is 403 FORBIDDEN for a customer with a pending or rejected application, and an admin", async () => {
    const pending = await signedIn();
    await createSellerApplication({ userId: pending.userId });
    const rejected = await signedIn();
    await createSellerApplication({ userId: rejected.userId, status: "REJECTED" });
    for (const who of [pending, rejected, await signedIn("ADMIN")]) {
      const response = await getStoreRoute(
        request("GET", "/api/v1/seller/store", { cookie: who.cookie }),
      );
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }
  });

  it("is 401 without a session", async () => {
    expect((await getStoreRoute(request("GET", "/api/v1/seller/store"))).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------
// PATCH /seller/store
// ---------------------------------------------------------------------------------------------

describe("PATCH /api/v1/seller/store", () => {
  it("changes name, description, phone, and logo at once; the slug never changes", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const before = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    const upload = await createUpload({ storeId });
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: seller.cookie,
        body: {
          name: " ชื่อใหม่ ",
          description: "บรรทัดหนึ่ง\nบรรทัดสอง",
          contactPhone: "02-123-4567",
          logoKey: upload.storageKey,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      data: {
        id: storeId,
        name: "ชื่อใหม่",
        slug: before.slug,
        description: "บรรทัดหนึ่ง\nบรรทัดสอง",
        contactPhone: "021234567",
        logo: {
          key: upload.storageKey,
          url: `/api/files/${encodeURIComponent(upload.storageKey)}`,
        },
      },
    });
    const after = await db.store.findUniqueOrThrow({ where: { id: storeId } });
    expect(after).toMatchObject({ slug: before.slug, logoUploadId: upload.id, status: "APPROVED" });
  });

  it("removes the logo and clears the description with null; the upload stays", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const upload = await createUpload({ storeId });
    await db.store.update({
      where: { id: storeId },
      data: { logoUploadId: upload.id, description: "x" },
    });
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: seller.cookie,
        body: { logoKey: null, description: null },
      }),
    );
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ data: { logo: null, description: null } });
    expect(await db.upload.count({ where: { id: upload.id } })).toBe(1);
  });

  it("refuses another store's upload, and an unknown key, alike with 404 `upload` (wrong owner)", async () => {
    const seller = await signedIn("SELLER");
    const other = await signedIn("SELLER");
    const foreign = await createUpload({ storeId: other.storeId ?? "" });
    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    const answers: unknown[] = [];
    for (const logoKey of [foreign.storageKey, "no-such-key"]) {
      const response = await patchStoreRoute(
        request("PATCH", "/api/v1/seller/store", {
          cookie: seller.cookie,
          body: { name: "ใหม่", logoKey },
        }),
      );
      expect(response.status).toBe(404);
      const { error } = await json<{ error: { requestId?: string } }>(response);
      delete error.requestId;
      answers.push(error);
    }
    expect(answers[0]).toEqual({
      code: "NOT_FOUND",
      message: expect.any(String) as unknown,
      details: { resource: "upload" },
    });
    expect(answers[0]).toEqual(answers[1]);
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );
  });

  it("a storeId in the body is 400 and changes no store (wrong owner)", async () => {
    const seller = await signedIn("SELLER");
    const other = await signedIn("SELLER");
    const otherBefore = await db.store.findUniqueOrThrow({ where: { id: other.storeId ?? "" } });
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", {
        cookie: seller.cookie,
        body: { name: "ยึดร้าน", storeId: other.storeId },
      }),
    );
    expect(response.status).toBe(400);
    expect(await db.store.findUniqueOrThrow({ where: { id: other.storeId ?? "" } })).toEqual(
      otherBefore,
    );
  });

  it("is 400 for an empty body, a slug, a status, or a bad phone", async () => {
    const seller = await signedIn("SELLER");
    for (const body of [{}, { slug: "x" }, { status: "APPROVED" }, { contactPhone: "1" }]) {
      const response = await patchStoreRoute(
        request("PATCH", "/api/v1/seller/store", { cookie: seller.cookie, body }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("is 401 without a session", async () => {
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", { body: { name: "x" } }),
    );
    expect(response.status).toBe(401);
  });

  it("is 403 FORBIDDEN for a pending applicant, a rejected applicant, and an admin (REQ-S-09)", async () => {
    const pending = await signedIn();
    await createSellerApplication({ userId: pending.userId });
    const rejected = await signedIn();
    await createSellerApplication({ userId: rejected.userId, status: "REJECTED" });
    for (const who of [pending, rejected, await signedIn("ADMIN")]) {
      const response = await patchStoreRoute(
        request("PATCH", "/api/v1/seller/store", { cookie: who.cookie, body: { name: "x" } }),
      );
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
    }
  });

  it("a suspended store is 403 SELLER_NOT_APPROVED, also with an invalid body, and nothing changes (BR-14)", async () => {
    const seller = await signedIn("SELLER", "SUSPENDED");
    const before = await snapshotDatabase({ excludeTables: ["Session"] });
    for (const req of [
      request("PATCH", "/api/v1/seller/store", {
        cookie: seller.cookie,
        body: { contactPhone: "021234567" },
      }),
      request("PATCH", "/api/v1/seller/store", { cookie: seller.cookie, rawBody: "{bad" }),
    ]) {
      const response = await patchStoreRoute(req);
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("SELLER_NOT_APPROVED");
      expect(req.bodyUsed).toBe(false);
    }
    expect(diffSnapshots(before, await snapshotDatabase({ excludeTables: ["Session"] }))).toEqual(
      [],
    );
  });

  it("after reinstatement the same change succeeds again (REQ-S-09)", async () => {
    const seller = await signedIn("SELLER", "SUSPENDED");
    const body = { name: "ร้านกลับมา" };
    const refused = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", { cookie: seller.cookie, body }),
    );
    expect(refused.status).toBe(403);
    await db.store.update({ where: { id: seller.storeId ?? "" }, data: { status: "APPROVED" } });
    const response = await patchStoreRoute(
      request("PATCH", "/api/v1/seller/store", { cookie: seller.cookie, body }),
    );
    expect(response.status).toBe(200);
  });
});
