/**
 * Independent re-check of SEC-068 item 1, commit 1413db6 (2026-10-20): GET /api/files/{key}
 * serves a file that is not public only to the owning seller. Owner: security. The fix's own
 * cases are in tests/integration/uploads/endpoints.test.ts and src/modules/uploads/service.test.ts;
 * this file is written from the rule in SECURITY.md SEC-068 "Remediation" (1) and API_CONTRACTS.md
 * section 5.8 "Who may read", not from those cases.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * The real route module is called in process with real session cookies, the worker's PostgreSQL
 * database, and a temporary storage directory. The database is emptied only before the first test
 * of the file, so every assertion names its own stores and keys.
 *
 *   it(...)  behaviour checked on 2026-10-20 that holds. A failure is a regression. A case named
 *            "documented" shows behaviour of an OPEN finding as it is today (SEC-071); a failure
 *            there means the behaviour changed and the finding needs a re-check.
 *   it.fails(...)  an OPEN finding (SEC-071). The body asserts the secure behaviour, so it is
 *            reported as an expected failure while the flaw exists.
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
  createOrderItemRow,
  createProduct,
  createProductImage,
  createSellerOrderRow,
  createUpload as createUploadRow,
} from "../helpers/factories";
import { APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../integration/auth/support";
import { json, type SignedIn, signedIn } from "../integration/sellers/support";

let base: string;
let uploadDir: string;

beforeAll(async () => {
  stubAuthEnvironment();
  base = await mkdtemp(join(tmpdir(), "sec068-recheck-"));
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

/** A registered upload of `storeId` with real bytes on disk, created now (inside the grace). */
async function storedUpload(storeId: string): Promise<{ id: string; key: string }> {
  const key = generateStorageKey();
  await new LocalDiskStorage(uploadDir).put(key, jpegBytes(500));
  const row = await createUploadRow({ storeId, storageKey: key, sizeBytes: 500 });
  return { id: row.id, key };
}

/** A product of `storeId` in the given state, with one picture; returns the picture's key. */
async function pictureOf(
  storeId: string,
  product: {
    status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    moderationStatus?: "PENDING" | "APPROVED" | "REJECTED" | "TAKEN_DOWN";
    categoryActive?: boolean;
  } = {},
): Promise<{ key: string; uploadId: string; productId: string }> {
  const category = await createCategory({ isActive: product.categoryActive ?? true });
  const row = await createProduct({
    storeId,
    categoryId: category.id,
    status: product.status ?? "PUBLISHED",
    moderationStatus: product.moderationStatus ?? "APPROVED",
  });
  const upload = await storedUpload(storeId);
  await createProductImage({ productId: row.id, uploadId: upload.id });
  return { key: upload.key, uploadId: upload.id, productId: row.id };
}

/** Sets the store's logo to a fresh upload of the store; returns its key. */
async function logoOf(storeId: string): Promise<string> {
  const upload = await storedUpload(storeId);
  await db.store.update({ where: { id: storeId }, data: { logoUploadId: upload.id } });
  return upload.key;
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

/** The error envelope without its request id, for comparing refusals. */
async function refusal(response: Response): Promise<unknown> {
  expect(response.status).toBe(404);
  const { error } = await json<{ error: Record<string, unknown> }>(response);
  const rest = { ...error };
  delete rest.requestId;
  return rest;
}

/** The refusal of a key that matches the pattern and has no upload row. */
async function unknownKeyRefusal(): Promise<unknown> {
  return refusal(await getFile(generateStorageKey()));
}

interface Callers {
  owner: Seller;
  otherSeller: Seller;
  customer: SignedIn;
  admin: SignedIn;
}

async function callers(owner?: Seller): Promise<Callers> {
  return {
    owner: owner ?? (await seller()),
    otherSeller: await seller(),
    customer: await signedIn("CUSTOMER"),
    admin: await signedIn("ADMIN"),
  };
}

/** Every caller who is not the owner, by name, with its cookie (undefined = no session). */
function nonOwners(c: Callers): [string, string | undefined][] {
  return [
    ["anonymous", undefined],
    ["customer", c.customer.cookie],
    ["admin", c.admin.cookie],
    ["other seller", c.otherSeller.cookie],
    // The owner's cookie name with a value no session has: must be treated as anonymous.
    ["forged cookie", c.owner.cookie.replace(/=[^;]*/, "=forged-session-token.forged-signature")],
  ];
}

/** Asserts: the owner gets 200 with the protective headers; every other caller the unknown-key 404. */
async function expectOwnerOnly(key: string, c: Callers, expectedRefusal: unknown): Promise<void> {
  for (const [name, cookie] of nonOwners(c)) {
    const body = await refusal(await getFile(key, cookie));
    expect({ name, body }).toEqual({ name, body: expectedRefusal });
  }
  const response = await getFile(key, c.owner.cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  // A response that depends on the session must never be kept by a shared cache.
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBe(500);
}

/** Asserts: every caller, the owner and a request without a session included, gets 200. */
async function expectPublic(key: string, c: Callers): Promise<void> {
  for (const [name, cookie] of [...nonOwners(c), ["owner", c.owner.cookie] as const]) {
    const response = await getFile(key, cookie);
    expect({ name, status: response.status }).toEqual({ name, status: 200 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  }
}

// ---------------------------------------------------------------------------------------------
// Files that are not public: the owning seller only
// ---------------------------------------------------------------------------------------------

describe("SEC-068 re-check: a file that is not public is served to the owning seller only", () => {
  it("an unattached upload inside the grace period", async () => {
    const c = await callers();
    const { key } = await storedUpload(c.owner.storeId);
    await expectOwnerOnly(key, c, await unknownKeyRefusal());
  });

  for (const [label, state] of [
    ["a DRAFT product", { status: "DRAFT", moderationStatus: "PENDING" }],
    ["a PUBLISHED product awaiting approval", { moderationStatus: "PENDING" }],
    ["a REJECTED product", { moderationStatus: "REJECTED" }],
    ["a TAKEN_DOWN product", { moderationStatus: "TAKEN_DOWN" }],
    ["an ARCHIVED product (moderation APPROVED)", { status: "ARCHIVED" }],
    ["an approved product in a switched-off category", { categoryActive: false }],
  ] as const) {
    it(`a picture of ${label}`, async () => {
      const c = await callers();
      const { key } = await pictureOf(c.owner.storeId, state);
      await expectOwnerOnly(key, c, await unknownKeyRefusal());
    });
  }

  it("a suspended store's approved product picture and its logo: the suspended owner still reads them (BR-14), nobody else", async () => {
    const owner = await seller("SUSPENDED");
    const c = await callers(owner);
    const { key } = await pictureOf(owner.storeId);
    const logo = await logoOf(owner.storeId);
    const expected = await unknownKeyRefusal();
    await expectOwnerOnly(key, c, expected);
    await expectOwnerOnly(logo, c, expected);
  });

  it("a deactivated owner: the product picture and logo are not public, and the owner's remaining session no longer reads them", async () => {
    const c = await callers();
    const { key } = await pictureOf(c.owner.storeId);
    const logo = await logoOf(c.owner.storeId);
    await expectPublic(key, c);
    await expectPublic(logo, c);
    await db.user.update({ where: { id: c.owner.userId }, data: { isActive: false } });
    const expected = await unknownKeyRefusal();
    for (const k of [key, logo]) {
      for (const [, cookie] of [...nonOwners(c), ["owner", c.owner.cookie] as const]) {
        expect(await refusal(await getFile(k, cookie))).toEqual(expected);
      }
    }
  });

  it("another seller's session never reads it, whatever the request names (query, headers)", async () => {
    const c = await callers();
    const { key } = await storedUpload(c.owner.storeId);
    const response = await getFileRoute(
      new Request(`${APP_URL}/api/files/${key}?storeId=${c.owner.storeId}`, {
        method: "GET",
        headers: {
          cookie: c.otherSeller.cookie,
          "x-store-id": c.owner.storeId,
          "x-user-id": c.owner.userId,
        },
      }),
      { params: Promise.resolve({ key }) } as RouteContext<"/api/files/[key]">,
    );
    expect(await refusal(response)).toEqual(await unknownKeyRefusal());
  });

  it("a seller whose role is changed to CUSTOMER no longer reads its store's non-public files", async () => {
    const c = await callers();
    const { key } = await pictureOf(c.owner.storeId, {
      status: "DRAFT",
      moderationStatus: "PENDING",
    });
    expect((await getFile(key, c.owner.cookie)).status).toBe(200);
    await db.user.update({ where: { id: c.owner.userId }, data: { role: "CUSTOMER" } });
    expect(await refusal(await getFile(key, c.owner.cookie))).toEqual(await unknownKeyRefusal());
  });
});

// ---------------------------------------------------------------------------------------------
// Public files: anyone, with or without a session
// ---------------------------------------------------------------------------------------------

describe("SEC-068 re-check: a public file is served to anyone", () => {
  it("a picture of a visible product", async () => {
    const c = await callers();
    const { key } = await pictureOf(c.owner.storeId);
    await expectPublic(key, c);
  });

  it("the logo of a public store", async () => {
    const c = await callers();
    await expectPublic(await logoOf(c.owner.storeId), c);
  });

  it("an order item's picture, even with the store suspended", async () => {
    const c = await callers();
    const { id, key } = await storedUpload(c.owner.storeId);
    await createOrderItemRow({
      sellerOrderId: (await createSellerOrderRow({ storeId: c.owner.storeId })).id,
      productImageUploadId: id,
    });
    await expectPublic(key, c);
    await db.store.update({ where: { id: c.owner.storeId }, data: { status: "SUSPENDED" } });
    await expectPublic(key, c);
  });
});

// ---------------------------------------------------------------------------------------------
// Transitions take effect at once, without any write to the upload
// ---------------------------------------------------------------------------------------------

describe("SEC-068 re-check: takedown, suspension, and category switch-off stop public serving at once", () => {
  it("visible -> TAKEN_DOWN -> APPROVED: 200, then owner only, then 200 again; the Upload row is never written", async () => {
    const c = await callers();
    const { key, uploadId, productId } = await pictureOf(c.owner.storeId);
    const before = await db.upload.findUniqueOrThrow({ where: { id: uploadId } });
    await expectPublic(key, c);
    await db.product.update({
      where: { id: productId },
      data: { moderationStatus: "TAKEN_DOWN", moderationNote: "takedown" },
    });
    await expectOwnerOnly(key, c, await unknownKeyRefusal());
    await db.product.update({ where: { id: productId }, data: { moderationStatus: "APPROVED" } });
    await expectPublic(key, c);
    expect(await db.upload.findUniqueOrThrow({ where: { id: uploadId } })).toEqual(before);
  });

  it("store suspended then reinstated: its product picture and logo follow", async () => {
    const c = await callers();
    const { key } = await pictureOf(c.owner.storeId);
    const logo = await logoOf(c.owner.storeId);
    await db.store.update({ where: { id: c.owner.storeId }, data: { status: "SUSPENDED" } });
    const expected = await unknownKeyRefusal();
    await expectOwnerOnly(key, c, expected);
    await expectOwnerOnly(logo, c, expected);
    await db.store.update({ where: { id: c.owner.storeId }, data: { status: "APPROVED" } });
    await expectPublic(key, c);
    await expectPublic(logo, c);
  });

  it("category switched off then on: the picture follows", async () => {
    const c = await callers();
    const { key, productId } = await pictureOf(c.owner.storeId);
    const { categoryId } = await db.product.findUniqueOrThrow({ where: { id: productId } });
    await db.category.update({ where: { id: categoryId }, data: { isActive: false } });
    await expectOwnerOnly(key, c, await unknownKeyRefusal());
    await db.category.update({ where: { id: categoryId }, data: { isActive: true } });
    await expectPublic(key, c);
  });

  it("a taken-down picture cannot be made public again by linking its upload to a second, visible product", async () => {
    // ProductImage.uploadId is unique (one upload belongs to one product), so "a picture of a
    // visible product" cannot be gamed by linking the same upload to another product.
    const c = await callers();
    const taken = await pictureOf(c.owner.storeId, { moderationStatus: "TAKEN_DOWN" });
    const visible = await createProduct({ storeId: c.owner.storeId });
    await expect(
      createProductImage({ productId: visible.id, uploadId: taken.uploadId }),
    ).rejects.toThrow();
    await expectOwnerOnly(taken.key, c, await unknownKeyRefusal());
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-071 (OPEN): an order item's picture stays public after its product is taken down
// ---------------------------------------------------------------------------------------------

describe("SEC-071 an ordered picture stays public after the product is taken down", () => {
  it("documented: a visible product's picture, once in an order item, is still served to anyone after an admin takedown", async () => {
    const c = await callers();
    const { key, uploadId, productId } = await pictureOf(c.owner.storeId);
    await createOrderItemRow({
      sellerOrderId: (await createSellerOrderRow({ storeId: c.owner.storeId })).id,
      productId,
      productImageUploadId: uploadId,
    });
    await db.product.update({
      where: { id: productId },
      data: { moderationStatus: "TAKEN_DOWN", moderationNote: "illegal picture" },
    });
    await expectPublic(key, c);
  });

  // The secure behaviour asserted here is the minimum any ruling must give: a request without a
  // session no longer gets a taken-down product's picture. Who else keeps it (the buyer of that
  // order, the seller, an admin) is for the owner to rule; the owner of the fix may add those
  // callers, then changes `it.fails` to `it`, and the security agent re-checks the change.
  it.fails(
    "secure: an ordered picture of a TAKEN_DOWN product is not served to a request without a session",
    async () => {
      const c = await callers();
      const { key, uploadId, productId } = await pictureOf(c.owner.storeId);
      await createOrderItemRow({
        sellerOrderId: (await createSellerOrderRow({ storeId: c.owner.storeId })).id,
        productId,
        productImageUploadId: uploadId,
      });
      await db.product.update({
        where: { id: productId },
        data: { moderationStatus: "TAKEN_DOWN", moderationNote: "illegal picture" },
      });
      expect((await getFile(key)).status).toBe(404);
    },
  );
});
