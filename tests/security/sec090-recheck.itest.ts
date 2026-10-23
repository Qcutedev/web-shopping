/**
 * Independent re-check of SEC-090 (BR-41), commit 027edfa (2026-10-23): GET /api/files/{key}
 * serves a file that is not public to an active ADMIN session only when a ProductImage row
 * attaches it to a product. Owner: security. Written from BR-41 and REQ-A-05 acceptance in
 * docs/REQUIREMENTS.md, not from the fix's own cases (tests/integration/uploads/endpoints.test.ts,
 * src/modules/uploads/service.test.ts). This file probes what those cases do not: a demoted
 * admin, a signed-out admin, a picture detached by deleting its row or its product, key variants
 * of a readable picture, and whether the admin's 200 and 404 differ from the owner's 200 and the
 * unknown-key 404 in any header.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * The real route module is called in process with real session cookies, the worker's PostgreSQL
 * database, and a temporary storage directory. Every assertion names its own stores and keys.
 *
 *   it(...)  behaviour checked on 2026-10-23 that holds. A failure is a regression.
 *   A case named "documented" records behaviour that is allowed by BR-41 but worth knowing.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getFileRoute } from "@/app/api/files/[key]/route";
import { generateStorageKey, LocalDiskStorage } from "@/modules/uploads";
import { jpegBytes } from "@/modules/uploads/test-fixtures";
import { db } from "@/server/db";

import {
  createCategory,
  createProduct,
  createProductImage,
  createUpload as createUploadRow,
} from "../helpers/factories";
import { APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { json, type SignedIn, signedIn } from "../integration/sellers/support";

let base: string;
let uploadDir: string;

beforeAll(async () => {
  stubAuthEnvironment();
  base = await mkdtemp(join(tmpdir(), "sec090-recheck-"));
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

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type Seller = SignedIn & { storeId: string };

async function seller(storeStatus: "APPROVED" | "SUSPENDED" = "APPROVED"): Promise<Seller> {
  const who = await signedIn("SELLER", storeStatus);
  if (who.storeId === null) throw new Error("a seller without a store");
  return { ...who, storeId: who.storeId };
}

async function storedUpload(storeId: string): Promise<{ id: string; key: string }> {
  const key = generateStorageKey();
  await new LocalDiskStorage(uploadDir).put(key, jpegBytes(500));
  const row = await createUploadRow({ storeId, storageKey: key, sizeBytes: 500 });
  return { id: row.id, key };
}

/** A PENDING published product of `storeId` with one picture (not public). */
async function queuedPicture(
  storeId: string,
): Promise<{ key: string; uploadId: string; productId: string }> {
  const category = await createCategory({ isActive: true });
  const row = await createProduct({
    storeId,
    categoryId: category.id,
    status: "PUBLISHED",
    moderationStatus: "PENDING",
  });
  const upload = await storedUpload(storeId);
  await createProductImage({ productId: row.id, uploadId: upload.id });
  return { key: upload.key, uploadId: upload.id, productId: row.id };
}

function getFile(key: string, cookie?: string): Promise<Response> {
  return getFileRoute(
    new Request(`${APP_URL}/api/files/${key}`, {
      method: "GET",
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    }),
    { params: Promise.resolve({ key }) } as RouteContext<"/api/files/[key]">,
  );
}

/** Status, every header but the request id, and the body (envelope without request id, or bytes). */
async function shape(response: Response): Promise<unknown> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== "x-request-id") headers[name] = value;
  });
  if (response.status === 200) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: 200, headers, bytes: Array.from(bytes) };
  }
  const { error } = await json<{ error: Record<string, unknown> }>(response);
  const rest = { ...error };
  delete rest.requestId;
  return { status: response.status, headers, body: rest };
}

async function unknownKeyShape(cookie?: string): Promise<unknown> {
  return shape(await getFile(generateStorageKey(), cookie));
}

// ---------------------------------------------------------------------------------------------
// Who is an admin: judged from the database on every request
// ---------------------------------------------------------------------------------------------

describe("SEC-090 re-check: the admin rule follows the user row, not the session", () => {
  it("an admin demoted to CUSTOMER keeps a session row but gets the unknown-key 404", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const { key } = await queuedPicture(owner.storeId);
    expect((await getFile(key, admin.cookie)).status).toBe(200);
    await db.user.update({ where: { id: admin.userId }, data: { role: "CUSTOMER" } });
    expect(await db.session.count({ where: { userId: admin.userId } })).toBeGreaterThan(0);
    expect(await shape(await getFile(key, admin.cookie))).toEqual(
      await unknownKeyShape(admin.cookie),
    );
  });

  it("an admin whose sessions are deleted (signed out) gets the unknown-key 404", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const { key } = await queuedPicture(owner.storeId);
    expect((await getFile(key, admin.cookie)).status).toBe(200);
    await db.session.deleteMany({ where: { userId: admin.userId } });
    expect(await shape(await getFile(key))).toEqual(await unknownKeyShape());
    expect(await shape(await getFile(key, admin.cookie))).toEqual(await unknownKeyShape());
  });

  it("an admin session cookie with a tampered value is anonymous", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const { key } = await queuedPicture(owner.storeId);
    const forged = admin.cookie.replace(/=[^;]*/, "=forged-session-token.forged-signature");
    expect(await shape(await getFile(key, forged))).toEqual(await unknownKeyShape());
  });
});

// ---------------------------------------------------------------------------------------------
// What counts as attached: the ProductImage row, at the moment of the request
// ---------------------------------------------------------------------------------------------

describe("SEC-090 re-check: a picture stops being readable by the admin the moment it is detached", () => {
  it("deleting the ProductImage row: admin 404 identical to an unknown key; owner still 200", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const { key, uploadId } = await queuedPicture(owner.storeId);
    expect((await getFile(key, admin.cookie)).status).toBe(200);
    await db.productImage.deleteMany({ where: { uploadId } });
    expect(await shape(await getFile(key, admin.cookie))).toEqual(
      await unknownKeyShape(admin.cookie),
    );
    expect((await getFile(key, owner.cookie)).status).toBe(200);
  });

  it("deleting the product (ProductImage cascades): admin 404 identical to an unknown key", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const { key, productId } = await queuedPicture(owner.storeId);
    expect((await getFile(key, admin.cookie)).status).toBe(200);
    await db.product.delete({ where: { id: productId } });
    expect(await shape(await getFile(key, admin.cookie))).toEqual(
      await unknownKeyShape(admin.cookie),
    );
  });

  it("documented: an upload that is both a suspended store's logo and a picture of its product is readable by the admin (BR-41 (1) wins: it is attached to a product)", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const { key, uploadId } = await queuedPicture(owner.storeId);
    await db.store.update({
      where: { id: owner.storeId },
      data: { logoUploadId: uploadId, status: "SUSPENDED" },
    });
    expect((await getFile(key)).status).toBe(404);
    expect((await getFile(key, admin.cookie)).status).toBe(200);
    // Detach it from the product: now only a logo of a store that is not public.
    await db.productImage.deleteMany({ where: { uploadId } });
    expect(await shape(await getFile(key, admin.cookie))).toEqual(
      await unknownKeyShape(admin.cookie),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Response differences and key probing
// ---------------------------------------------------------------------------------------------

describe("SEC-090 re-check: the admin's answers carry nothing the owner's or an unknown key's do not", () => {
  it("the admin's 200 has the same headers and bytes as the owner's 200 (no-store, nosniff, sandbox)", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const { key } = await queuedPicture(owner.storeId);
    const asAdmin = await shape(await getFile(key, admin.cookie));
    const asOwner = await shape(await getFile(key, owner.cookie));
    expect(asAdmin).toEqual(asOwner);
    expect(asAdmin).toMatchObject({
      status: 200,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": "image/jpeg",
      },
    });
    expect((asAdmin as { headers: Record<string, string> }).headers).not.toHaveProperty(
      "set-cookie",
    );
    expect((asAdmin as { headers: Record<string, string> }).headers).not.toHaveProperty(
      "access-control-allow-origin",
    );
  });

  it("the admin's refusal of an unattached upload equals the unknown-key 404 in status, every header, and body", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const unattached = await storedUpload(owner.storeId);
    expect(await shape(await getFile(unattached.key, admin.cookie))).toEqual(
      await unknownKeyShape(admin.cookie),
    );
  });

  it("variants of a key the admin may read are not served (case, suffix, prefix, encoded dot)", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const { key } = await queuedPicture(owner.storeId);
    expect((await getFile(key, admin.cookie)).status).toBe(200);
    const expected = await unknownKeyShape(admin.cookie);
    for (const variant of [
      key.toUpperCase(),
      `${key}.jpg`,
      `${key} `,
      `./${key}`,
      `${key}%2e`,
      key.slice(0, -1),
      `${key}0`,
    ]) {
      expect({ variant, got: await shape(await getFile(variant, admin.cookie)) }).toEqual({
        variant,
        got: expected,
      });
    }
  });

  it("serving a hidden picture to the admin writes no audit row and touches no session row", async () => {
    const owner = await seller();
    const admin = await signedIn("ADMIN");
    const { key } = await queuedPicture(owner.storeId);
    const audit = await db.auditLog.count();
    const sessions = await db.session.findMany({
      where: { userId: admin.userId },
      orderBy: { id: "asc" },
    });
    for (let i = 0; i < 3; i += 1) expect((await getFile(key, admin.cookie)).status).toBe(200);
    expect(await db.auditLog.count()).toBe(audit);
    expect(
      await db.session.findMany({ where: { userId: admin.userId }, orderBy: { id: "asc" } }),
    ).toEqual(sessions);
  });
});
