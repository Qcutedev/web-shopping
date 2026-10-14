/**
 * `GET /categories/{slug}` against a real database (docs/API_CONTRACTS.md section 5.2;
 * code-review finding CR-T021-05): success shape, an inactive or unknown category is the same
 * 404, path validation, and that the read writes nothing (D-029 point 1).
 *
 * The endpoint is `public`, so there is no unauthenticated, wrong-role, or wrong-owner refusal
 * to test. What stands in for them: a session cookie, or a `storeId`, `role`, or `isActive` in
 * the query, gets the same answer as a plain request.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/server/db";

import { createCategory } from "../../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../../helpers/snapshot";
import { callCategory, callCategoryRawSlug, type ErrorBody } from "./call";

// The handlers await `connection()` first (src/server/public-get.ts), which throws outside a
// Next.js request scope. Here it resolves, as it does at request time.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

const THAI_SLUG = "เสื้อผ้า-q8w2e4rt";

let active: { id: string; name: string; slug: string };
let inactive: { id: string; name: string; slug: string };

beforeAll(async () => {
  active = await createCategory({ name: "Kitchen", slug: "kitchen-get-case" });
  inactive = await createCategory({
    name: "Retired",
    slug: "retired-get-case",
    isActive: false,
  });
  await createCategory({ name: "เสื้อผ้า", slug: THAI_SLUG });
});

describe("GET /categories/{slug}: success", () => {
  it("returns { data: { name, slug } } and nothing else", async () => {
    const result = await callCategory<{ data: Record<string, unknown> }>(active.slug);
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("X-Request-Id")).toBeTruthy();
    expect(result.body).toEqual({ data: { name: "Kitchen", slug: "kitchen-get-case" } });
  });

  it("finds a Thai slug whether the framework hands it over decoded or still percent-encoded", async () => {
    const expected = { data: { name: "เสื้อผ้า", slug: THAI_SLUG } };
    expect((await callCategory(THAI_SLUG)).body).toEqual(expected);
    expect((await callCategoryRawSlug(encodeURIComponent(THAI_SLUG))).body).toEqual(expected);
    expect((await callCategoryRawSlug(THAI_SLUG)).body).toEqual(expected);
  });

  it("ignores storeId, role, and isActive in the query, and a session cookie", async () => {
    const plain = await callCategory(active.slug);
    const tampered = await callCategory(active.slug, "storeId=s1&role=ADMIN&isActive=false", {
      Cookie: "better-auth.session_token=forged",
      "X-Request-Id": "client-chosen-0001",
    });
    expect(tampered.status).toBe(200);
    expect(tampered.body).toEqual(plain.body);
    expect(tampered.headers.get("X-Request-Id")).not.toBe("client-chosen-0001");

    // isActive=false in the query does not reveal an inactive category either.
    const hidden = await callCategory(inactive.slug, "isActive=false");
    expect(hidden.status).toBe(404);
  });
});

describe("GET /categories/{slug}: 404 discloses nothing", () => {
  it("answers an inactive and an unknown category with the same 404 body", async () => {
    const hidden = await callCategory<ErrorBody>(inactive.slug);
    const unknown = await callCategory<ErrorBody>("does-not-exist");
    for (const result of [hidden, unknown]) {
      expect(result.status).toBe(404);
      expect(result.headers.get("Cache-Control")).toBe("no-store");
      expect(result.body.error).toEqual({
        code: "NOT_FOUND",
        message: "The resource was not found.",
        details: {},
        requestId: result.headers.get("X-Request-Id"),
      });
    }
    expect(JSON.stringify(hidden.body)).not.toContain("Retired");
    expect(JSON.stringify(hidden.body)).not.toContain(inactive.id);
  });

  it("follows the category when it is deactivated and reactivated", async () => {
    try {
      await db.category.update({ where: { id: active.id }, data: { isActive: false } });
      expect((await callCategory(active.slug)).status).toBe(404);
    } finally {
      await db.category.update({ where: { id: active.id }, data: { isActive: true } });
    }
    expect((await callCategory(active.slug)).status).toBe(200);
  });
});

describe("GET /categories/{slug}: path validation (400)", () => {
  it("refuses a broken escape and an over-long slug, echoing nothing", async () => {
    const broken = await callCategoryRawSlug<ErrorBody>("%E0%B8");
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe("VALIDATION_ERROR");
    expect(broken.body.error.details["fields"]).toEqual([
      expect.objectContaining({ path: "slug", code: "custom" }),
    ]);

    const canary = `Zq7canary${"x".repeat(200)}`;
    const long = await callCategory<ErrorBody>(canary);
    expect(long.status).toBe(400);
    expect(long.body.error.details["fields"]).toEqual([
      expect.objectContaining({ path: "slug", code: "too_big" }),
    ]);
    expect(JSON.stringify(long.body)).not.toContain("Zq7canary");
  });
});

describe("GET /categories/{slug} never writes (D-029 point 1)", () => {
  it("leaves every table and sequence unchanged on 200, 404, and 400", async () => {
    const before = await snapshotDatabase();
    await callCategory(active.slug);
    await callCategory(inactive.slug);
    await callCategory("does-not-exist");
    await callCategoryRawSlug("%E0%B8");
    expect(diffSnapshots(before, await snapshotDatabase())).toEqual([]);
  });
});
