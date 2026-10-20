/**
 * Security review of T-042 (seller product and inventory), commits 9c0ff06 and 7aef770,
 * 2026-10-20. Owner: security. Review: docs/reviews/T-042-security.md. The author's own cases are
 * in tests/integration/inventory; this file adds what the review found missing.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * The real route modules are called in process with real session cookies, the worker's
 * PostgreSQL database, and a temporary storage directory. The database is emptied only before the
 * first test of the file, so every assertion names its own stores and products.
 *
 *   it(...)        behaviour checked on 2026-10-20. For a "documented" case of an OPEN finding the
 *                  case shows the flaw as it is today; a failure there means the behaviour changed
 *                  and the finding needs a re-check.
 *   it.fails(...)  an OPEN finding (SEC-068). The body asserts the secure behaviour, so it is
 *                  reported as an expected failure while the flaw exists. The owner of the fix
 *                  changes `it.fails` to `it`, and the security agent re-checks the change.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getFileRoute } from "@/app/api/files/[key]/route";
import { POST as postUploadRoute } from "@/app/api/v1/seller/uploads/route";
import {
  generateStorageKey,
  LocalDiskStorage,
  MAX_UNATTACHED_UPLOADS_PER_STORE,
} from "@/modules/uploads";
import { countUnreferencedUploads } from "@/modules/uploads/repository";
import { fileBody, jpegBytes, multipartContentType } from "@/modules/uploads/test-fixtures";
import { db } from "@/server/db";

import {
  createCategory,
  createProduct as createProductRow,
  createUpload as createUploadRow,
} from "../helpers/factories";
import { diffSnapshots, snapshotDatabase } from "../helpers/snapshot";
import {
  APP_ORIGIN,
  APP_URL,
  resetProcessRateLimiter,
  stubAuthEnvironment,
} from "../integration/auth/support";
import { call, json, type SignedIn, signedIn } from "../integration/inventory/support";

// A switch for the slug generator, so one case can force a collision on every attempt. Off, the
// real generator runs.
const slugSwitch = vi.hoisted(() => ({ fixed: null as string | null }));

vi.mock("@/modules/sellers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/sellers")>();
  return {
    ...actual,
    generateSlug: (text: string) => slugSwitch.fixed ?? actual.generateSlug(text),
  };
});

let base: string;
let uploadDir: string;

beforeAll(async () => {
  stubAuthEnvironment();
  base = await mkdtemp(join(tmpdir(), "t042-security-"));
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
  slugSwitch.fixed = null;
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type Seller = SignedIn & { storeId: string };

async function seller(): Promise<Seller> {
  const who = await signedIn("SELLER");
  if (who.storeId === null) throw new Error("a seller without a store");
  return { ...who, storeId: who.storeId };
}

/** A registered upload of `storeId` with real bytes on disk. */
async function storedUpload(storeId: string): Promise<{ id: string; key: string }> {
  const key = generateStorageKey();
  await new LocalDiskStorage(uploadDir).put(key, jpegBytes(500));
  const row = await createUploadRow({ storeId, storageKey: key, sizeBytes: 500 });
  return { id: row.id, key };
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

function uploadRequest(cookie: string): Request {
  return new Request(`${APP_URL}/api/v1/seller/uploads`, {
    method: "POST",
    headers: { origin: APP_ORIGIN, "content-type": multipartContentType(), cookie },
    body: fileBody(jpegBytes(2_000)),
  });
}

async function createBody(overrides: Record<string, unknown> = {}) {
  const category = await createCategory();
  return {
    title: "Plain shirt",
    description: "Cotton",
    sku: `SKU-${Math.random().toString(36).slice(2, 10)}`,
    categoryId: category.id,
    priceSatang: 25_900,
    stock: 10,
    ...overrides,
  };
}

async function createVia(who: Seller, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await call.create({ cookie: who.cookie, body: await createBody(overrides) });
  expect(response.status).toBe(201);
  return (await json<{ data: { id: string } }>(response)).data.id;
}

async function errorOf(response: Response): Promise<unknown> {
  const { error } = await json<{ error: Record<string, unknown> }>(response);
  const rest = { ...error };
  delete rest.requestId;
  return rest;
}

function snapshot() {
  return snapshotDatabase({ excludeTables: ["Session"] });
}

// ---------------------------------------------------------------------------------------------
// Tenant isolation: every id endpoint, one foreign product, one unknown id
// ---------------------------------------------------------------------------------------------

describe("T-042 review: another store's product is an unknown product on every endpoint", () => {
  it("seven endpoints: the foreign id and an unknown id get the same 404 body, and nothing in the database changes", async () => {
    const owner = await seller();
    const picture = await storedUpload(owner.storeId);
    const productId = await createVia(owner, { imageKeys: [picture.key] });
    await call.publish(productId, { cookie: owner.cookie });

    const attacker = await seller();
    const attackerPicture = await storedUpload(attacker.storeId);
    const category = await createCategory();
    const unknownId = "00000000-0000-4000-8000-000000000000";

    const attempts: [string, (id: string) => Promise<Response>][] = [
      ["GET", (id) => call.get(id, attacker.cookie)],
      [
        "PATCH",
        (id) =>
          call.patch(id, {
            cookie: attacker.cookie,
            body: {
              title: "Taken over",
              priceSatang: 100,
              categoryId: category.id,
              imageKeys: [attackerPicture.key],
            },
          }),
      ],
      ["PATCH stock", (id) => call.stock(id, { cookie: attacker.cookie, body: { set: 0 } })],
      ["POST publish", (id) => call.publish(id, { cookie: attacker.cookie })],
      ["POST unpublish", (id) => call.unpublish(id, { cookie: attacker.cookie })],
      ["POST archive", (id) => call.archive(id, { cookie: attacker.cookie })],
      ["DELETE", (id) => call.remove(id, { cookie: attacker.cookie })],
    ];

    const before = await snapshot();
    for (const [name, attempt] of attempts) {
      const foreign = await attempt(productId);
      const unknown = await attempt(unknownId);
      expect(foreign.status, name).toBe(404);
      expect(unknown.status, name).toBe(404);
      const foreignBody = await errorOf(foreign);
      expect(foreignBody, name).toEqual(await errorOf(unknown));
      expect(foreignBody, name).toEqual({
        code: "NOT_FOUND",
        message: expect.any(String) as string,
        details: {},
      });
    }
    expect(diffSnapshots(before, await snapshot())).toEqual([]);

    const list = await call.list(attacker.cookie, `?storeId=${owner.storeId}&pageSize=50`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await json(list))).not.toContain(productId);
  });

  it("another store's upload, and another store's logo, cannot become a picture (404 upload, same body)", async () => {
    const victim = await seller();
    const victimPicture = await storedUpload(victim.storeId);
    const victimLogo = await storedUpload(victim.storeId);
    await db.store.update({ where: { id: victim.storeId }, data: { logoUploadId: victimLogo.id } });

    const attacker = await seller();
    const ownId = await createVia(attacker);
    const bodies: unknown[] = [];
    for (const key of [victimPicture.key, victimLogo.key, generateStorageKey()]) {
      const created = await call.create({
        cookie: attacker.cookie,
        body: await createBody({ imageKeys: [key] }),
      });
      expect(created.status).toBe(404);
      bodies.push(await errorOf(created));
      const edited = await call.patch(ownId, {
        cookie: attacker.cookie,
        body: { imageKeys: [key] },
      });
      expect(edited.status).toBe(404);
      bodies.push(await errorOf(edited));
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(bodies[0]).toMatchObject({ code: "NOT_FOUND", details: { resource: "upload" } });
    expect(
      await db.productImage.count({
        where: { uploadId: { in: [victimPicture.id, victimLogo.id] } },
      }),
    ).toBe(0);
  });

  it("a seller whose role is taken away after sign-in is refused at once, reads and writes alike", async () => {
    const who = await seller();
    const productId = await createVia(who);
    await db.user.update({ where: { id: who.userId }, data: { role: "CUSTOMER" } });
    expect((await call.list(who.cookie)).status).toBe(403);
    expect((await call.get(productId, who.cookie)).status).toBe(403);
    const before = await snapshot();
    expect((await call.stock(productId, { cookie: who.cookie, body: { set: 0 } })).status).toBe(
      403,
    );
    expect((await call.remove(productId, { cookie: who.cookie })).status).toBe(403);
    expect(diffSnapshots(before, await snapshot())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------------------------

describe("T-042 review: stock and picture races", () => {
  it("twenty parallel adjust -1 on stock 10: exactly ten succeed, ten are NEGATIVE_STOCK, stock ends at 0", async () => {
    const who = await seller();
    const productId = await createVia(who, { stock: 10 });
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        call.stock(productId, { cookie: who.cookie, body: { adjust: -1 } }),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses.filter((status) => status === 200)).toHaveLength(10);
    expect(statuses.filter((status) => status === 409)).toHaveLength(10);
    const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(row.stock).toBe(0);
  });

  it("parallel increases never pass 1,000,000", async () => {
    const who = await seller();
    const productId = await createVia(who, { stock: 999_990 });
    await Promise.all(
      Array.from({ length: 8 }, () =>
        call.stock(productId, { cookie: who.cookie, body: { adjust: 5 } }),
      ),
    );
    const row = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(row.stock).toBe(1_000_000);
  });

  it("one upload attached to two products at the same time: one wins, the other is 409 UPLOAD_IN_USE", async () => {
    const who = await seller();
    const picture = await storedUpload(who.storeId);
    const first = await createVia(who);
    const second = await createVia(who);
    const responses = await Promise.all([
      call.patch(first, { cookie: who.cookie, body: { imageKeys: [picture.key] } }),
      call.patch(second, { cookie: who.cookie, body: { imageKeys: [picture.key] } }),
      call.create({ cookie: who.cookie, body: await createBody({ imageKeys: [picture.key] }) }),
    ]);
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200 || status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(2);
    for (const response of responses) {
      if (response.status === 409) {
        expect(await errorOf(response)).toMatchObject({ details: { reason: "UPLOAD_IN_USE" } });
      }
    }
    expect(await db.productImage.count({ where: { uploadId: picture.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Error answers carry nothing of the database error
// ---------------------------------------------------------------------------------------------

describe("T-042 review: a slug collision on every attempt", () => {
  it("is 409 SLUG_TAKEN, names no slug, logs nothing of it, and creates nothing", async () => {
    const who = await seller();
    const existing = await createProductRow({ slug: "collide-canary-zq7" });
    expect(existing.slug).toBe("collide-canary-zq7");
    slugSwitch.fixed = "collide-canary-zq7";
    const lines: string[] = [];
    const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      const before = await db.product.count({ where: { storeId: who.storeId } });
      const response = await call.create({ cookie: who.cookie, body: await createBody() });
      const text = await response.text();
      expect(response.status).toBe(409);
      expect(JSON.parse(text)).toMatchObject({
        error: { code: "CONFLICT", details: { reason: "SLUG_TAKEN" } },
      });
      expect(text).not.toContain("collide-canary");
      expect(text).not.toContain("Product_slug_key");
      expect(lines.join("")).not.toContain("collide-canary");
      expect(await db.product.count({ where: { storeId: who.storeId } })).toBe(before);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-068: pictures of products no admin approved are public, and attaching them lifts the cap
// ---------------------------------------------------------------------------------------------

describe("SEC-068: pictures of unapproved products are served to anyone and do not count against the upload cap", () => {
  // Changed by backend-api with the SEC-068 fix (2026-10-20), for the security re-check: this case
  // documented the flaw and asserted status 200 for an anonymous request. The setup is unchanged;
  // the anonymous status is now the fixed behaviour (404), and the owner's session gets 200, as
  // SECURITY.md SEC-068 "Remediation" allows for the chosen serving rule.
  it("documented: a DRAFT product's picture (never published, never in the queue) and a TAKEN_DOWN product's picture are served to the owner's session only", async () => {
    const who = await seller();
    const draftPicture = await storedUpload(who.storeId);
    const draftId = await createVia(who, { imageKeys: [draftPicture.key] });
    const draft = await db.product.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.moderationStatus).toBe("PENDING");
    expect((await getFile(draftPicture.key)).status).toBe(404);
    expect((await getFile(draftPicture.key, who.cookie)).status).toBe(200);

    const downPicture = await storedUpload(who.storeId);
    const downId = await createVia(who, { imageKeys: [downPicture.key] });
    await db.product.update({
      where: { id: downId },
      data: { status: "PUBLISHED", moderationStatus: "TAKEN_DOWN", moderationNote: "illegal" },
    });
    expect((await getFile(downPicture.key)).status).toBe(404);
    expect((await getFile(downPicture.key, who.cookie)).status).toBe(200);
  });

  it("documented: a store at the cap of unattached uploads attaches them to throw-away drafts and uploads again, with no limit on drafts", async () => {
    const who = await seller();
    const keys: string[] = [];
    for (let i = 0; i < MAX_UNATTACHED_UPLOADS_PER_STORE; i += 1) {
      keys.push((await storedUpload(who.storeId)).key);
    }
    expect(await countUnreferencedUploads(who.storeId)).toBe(MAX_UNATTACHED_UPLOADS_PER_STORE);
    const refused = await postUploadRoute(uploadRequest(who.cookie));
    expect(refused.status).toBe(409);

    for (let i = 0; i < keys.length; i += 8) {
      await createVia(who, { imageKeys: keys.slice(i, i + 8) });
    }
    expect(await countUnreferencedUploads(who.storeId)).toBe(0);
    resetProcessRateLimiter();
    const accepted = await postUploadRoute(uploadRequest(who.cookie));
    expect(accepted.status).toBe(201);
    // 50 stored pictures, none seen by an admin, all public, plus a fresh place for 50 more.
    expect(await db.upload.count({ where: { storeId: who.storeId } })).toBe(
      MAX_UNATTACHED_UPLOADS_PER_STORE + 1,
    );
  });

  // Flipped from it.fails by backend-api with the SEC-068 fix (2026-10-20), for the security
  // re-check. Assertions unchanged; the owner's 200 is added as SEC-068 "Remediation" allows.
  it("secure: a picture whose only reference is a product no admin approved is not served to an anonymous request", async () => {
    const who = await seller();
    const picture = await storedUpload(who.storeId);
    await createVia(who, { imageKeys: [picture.key] });
    expect((await getFile(picture.key)).status).toBe(404);
    expect((await getFile(picture.key, who.cookie)).status).toBe(200);
  });

  it("secure: a picture of a TAKEN_DOWN product is not served to an anonymous request", async () => {
    const who = await seller();
    const picture = await storedUpload(who.storeId);
    const productId = await createVia(who, { imageKeys: [picture.key] });
    await db.product.update({
      where: { id: productId },
      data: { status: "PUBLISHED", moderationStatus: "TAKEN_DOWN" },
    });
    expect((await getFile(picture.key)).status).toBe(404);
    expect((await getFile(picture.key, who.cookie)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-069: no limit on products or product writes
// ---------------------------------------------------------------------------------------------

describe("SEC-069: one seller can fill the approval queue", () => {
  it("documented: 60 creates and 60 publishes in a row are all accepted; every product enters the queue", async () => {
    const who = await seller();
    const category = await createCategory();
    let refused = 0;
    for (let i = 0; i < 60; i += 1) {
      const created = await call.create({
        cookie: who.cookie,
        body: {
          title: `Flood ${i}`,
          description: "x",
          sku: `FLOOD-${i}`,
          categoryId: category.id,
          priceSatang: 100,
          stock: 0,
        },
      });
      if (created.status !== 201) {
        refused += 1;
        continue;
      }
      const { id } = (await json<{ data: { id: string } }>(created)).data;
      if ((await call.publish(id, { cookie: who.cookie })).status !== 200) refused += 1;
    }
    expect(refused).toBe(0);
    expect(
      await db.product.count({
        where: { storeId: who.storeId, status: "PUBLISHED", moderationStatus: "PENDING" },
      }),
    ).toBe(60);
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-070: the public slug keeps the words of the first title
// ---------------------------------------------------------------------------------------------

describe("SEC-070: the slug is made from the first title and never changes", () => {
  it("documented: a title never shown to an admin stays readable in the product's public URL", async () => {
    const who = await seller();
    const created = await call.create({
      cookie: who.cookie,
      body: await createBody({ title: "Pay LINE scamid123 direct" }),
    });
    expect(created.status).toBe(201);
    const { id, slug } = (await json<{ data: { id: string; slug: string } }>(created)).data;
    expect(slug.startsWith("pay-line-scamid123-direct-")).toBe(true);

    const edited = await call.patch(id, { cookie: who.cookie, body: { title: "Plain shirt" } });
    expect(edited.status).toBe(200);
    const after = (await json<{ data: { title: string; slug: string } }>(edited)).data;
    expect(after.title).toBe("Plain shirt");
    expect(after.slug).toBe(slug);
  });
});
