/**
 * Security review of T-051 (admin pages), 2026-10-23. Owner: security. Review:
 * docs/reviews/T-051-security.md. Real PostgreSQL (`pnpm test:integration`).
 *
 * SEC-090: the admin product review page (src/components/admin/product-section.tsx) shows the
 * pictures of a product awaiting approval as `<img src="/api/files/{key}">`, but the file endpoint
 * served a picture of a product that is not visible only to the owning seller (SEC-068 item 1,
 * API_CONTRACTS 5.8). So the admin approved a product without being able to see its pictures.
 * FIXED by BR-41 (commit 027edfa); re-checked 2026-10-23 by security, see
 * docs/reviews/T-051-security.md "SEC-090 re-check" and tests/security/sec090-recheck.itest.ts.
 * The first case below documented the defect (admin 404); since the fix it asserts the BR-41
 * behaviour (admin 200, no session 404). Changed by backend-api, accepted by security.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)        behaviour checked on 2026-10-23 that holds (or documents the current state).
 *   it.fails(...)  an open finding: the body asserts the secure behaviour and fails today. When
 *                  the finding is fixed this turns red; flip it to `it` then.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getFileRoute } from "@/app/api/files/[key]/route";
import { getProduct } from "@/modules/admin";
import { generateStorageKey, LocalDiskStorage } from "@/modules/uploads";
import { jpegBytes } from "@/modules/uploads/test-fixtures";
import { loadActor } from "@/server/auth/session";

import {
  createCategory,
  createProduct,
  createProductImage,
  createUpload as createUploadRow,
} from "../helpers/factories";
import { APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { signedIn } from "../integration/sellers/support";

let base: string;
let uploadDir: string;

beforeAll(async () => {
  stubAuthEnvironment();
  base = await mkdtemp(join(tmpdir(), "t051-admin-ui-"));
  uploadDir = join(base, "uploads");
  await mkdir(uploadDir, { recursive: true });
  process.env["UPLOAD_DIR"] = uploadDir;
});

afterAll(async () => {
  delete process.env["UPLOAD_DIR"];
  await rm(base, { recursive: true, force: true });
});

beforeEach(() => {
  resetProcessRateLimiter();
});

function getFile(url: string, cookie?: string): Promise<Response> {
  const key = url.replace(/^\/api\/files\//, "");
  return getFileRoute(
    new Request(`${APP_URL}${url}`, {
      method: "GET",
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    }),
    { params: Promise.resolve({ key }) } as RouteContext<"/api/files/[key]">,
  );
}

/** A published product awaiting approval, with one picture on disk; the admin and the seller. */
async function queuedProductWithPicture() {
  const owner = await signedIn("SELLER", "APPROVED");
  if (owner.storeId === null) throw new Error("a seller without a store");
  const admin = await signedIn("ADMIN");
  const category = await createCategory({ isActive: true });
  const product = await createProduct({
    storeId: owner.storeId,
    categoryId: category.id,
    status: "PUBLISHED",
    moderationStatus: "PENDING",
  });
  const key = generateStorageKey();
  await new LocalDiskStorage(uploadDir).put(key, jpegBytes(500));
  const upload = await createUploadRow({ storeId: owner.storeId, storageKey: key, sizeBytes: 500 });
  await createProductImage({ productId: product.id, uploadId: upload.id });
  const adminActor = await loadActor(admin.userId);
  if (adminActor === null) throw new Error("no admin actor");
  const dto = await getProduct(adminActor, product.id);
  return { owner, admin, dto, key };
}

describe("SEC-090 (fixed by BR-41): the admin sees the pictures of a product awaiting approval", () => {
  // Changed with the BR-41 fix (2026-10-23, backend-api; re-checked and accepted by security the
  // same day): the admin now reads the queued picture, so the admin assertion is 200, not 404.
  it("the review page links the picture; the owner and the admin read it; a request without a session gets 404", async () => {
    const { owner, admin, dto, key } = await queuedProductWithPicture();
    expect(dto.moderationStatus).toBe("PENDING");
    expect(dto.images.map((image) => image.url)).toEqual([`/api/files/${key}`]);
    expect((await getFile(`/api/files/${key}`, owner.cookie)).status).toBe(200);
    expect((await getFile(`/api/files/${key}`, admin.cookie)).status).toBe(200);
    expect((await getFile(`/api/files/${key}`)).status).toBe(404);
  });

  it("the admin's session can read every picture the review page shows for a queued product", async () => {
    const { admin, dto } = await queuedProductWithPicture();
    expect(dto.images.length).toBeGreaterThan(0);
    for (const image of dto.images) {
      const response = await getFile(image.url, admin.cookie);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("whatever the fix, a request without a session still gets 404 for the queued picture (control)", async () => {
    const { dto } = await queuedProductWithPicture();
    for (const image of dto.images) expect((await getFile(image.url)).status).toBe(404);
  });
});
