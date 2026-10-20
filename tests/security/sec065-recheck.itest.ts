/**
 * Re-check of the SEC-065 fix, commit 1f38501 (2026-10-20). Owner: security. Review:
 * docs/reviews/SEC-065-recheck.md. The fix's own cases are in tests/integration/uploads and in
 * t041-uploads.itest.ts; this file adds the cases the re-check found missing.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * The real route modules and the real module functions are called in process with the worker's
 * PostgreSQL database and a temporary storage directory. The database is emptied only before the
 * first test of the file, so every assertion names its own keys and stores.
 *
 *   it(...)        behaviour checked on 2026-10-20 that holds. A failure is a regression.
 *   it.fails(...)  an OPEN finding (SEC-066, SEC-067). The body asserts the secure behaviour, so it is
 *                  reported as an expected failure while the flaw exists. The owner of the fix
 *                  changes `it.fails` to `it` (and may call the new entry point first), and the
 *                  security agent re-checks the change.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getFileRoute } from "@/app/api/files/[key]/route";
import { PATCH as patchStoreRoute } from "@/app/api/v1/seller/store/route";
import { POST as postUploadRoute } from "@/app/api/v1/seller/uploads/route";
import {
  cleanUpExpiredOrphans,
  generateStorageKey,
  LocalDiskStorage,
  MAX_UNATTACHED_UPLOADS_PER_STORE,
  ORPHAN_GRACE_PERIOD_SECONDS,
} from "@/modules/uploads";
import { deleteExpiredOrphans } from "@/modules/uploads/repository";
import { fileBody, jpegBytes, multipartContentType } from "@/modules/uploads/test-fixtures";
import { db } from "@/server/db";

import {
  createOrderItemRow,
  createProduct,
  createSellerOrderRow,
  createUpload as createUploadRow,
} from "../helpers/factories";
import {
  APP_ORIGIN,
  APP_URL,
  resetProcessRateLimiter,
  stubAuthEnvironment,
} from "../integration/auth/support";
import { json, request as jsonRequest, signedIn } from "../integration/sellers/support";

let base: string;
let uploadDir: string;

beforeAll(async () => {
  stubAuthEnvironment();
  base = await mkdtemp(join(tmpdir(), "sec065-recheck-"));
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

function uploadRequest(cookie: string): Request {
  return new Request(`${APP_URL}/api/v1/seller/uploads`, {
    method: "POST",
    headers: { origin: APP_ORIGIN, "content-type": multipartContentType(), cookie },
    body: fileBody(jpegBytes(2_000)),
  });
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function pathOfKey(key: string): string {
  return join(uploadDir, key.slice(0, 2), key);
}

/** Unattached rows of the store with no bytes (the cap counts rows). */
async function fillStore(storeId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await createUploadRow({ storeId });
}

/** A registered upload with real bytes, `ageSeconds` old by the database clock. */
async function storedUpload(
  storeId: string,
  ageSeconds: number,
): Promise<{ id: string; key: string }> {
  const key = generateStorageKey();
  await new LocalDiskStorage(uploadDir).put(key, jpegBytes(500));
  const row = await createUploadRow({ storeId, storageKey: key, sizeBytes: 500 });
  await setAgeSeconds(row.id, ageSeconds);
  return { id: row.id, key };
}

/** Sets `createdAt` by the database clock, so no clock of this process enters the comparison. */
async function setAgeSeconds(id: string, seconds: number): Promise<void> {
  await db.$executeRaw`UPDATE "Upload" SET "createdAt" = now() - make_interval(secs => ${seconds}::int) WHERE "id" = ${id}`;
}

const PAST_GRACE = ORPHAN_GRACE_PERIOD_SECONDS + 3_600;

async function cleanAll(): Promise<Awaited<ReturnType<typeof cleanUpExpiredOrphans>>> {
  return cleanUpExpiredOrphans({ storage: new LocalDiskStorage(uploadDir), maxBatches: 1_000 });
}

// ---------------------------------------------------------------------------------------------
// The cap under concurrency, through the route (early check and transaction together)
// ---------------------------------------------------------------------------------------------

describe("SEC-065 re-check: the cap holds under parallel requests through the route", () => {
  it("three places left, twelve parallel POSTs: exactly three 201, nine 409 UPLOAD_LIMIT, cap exact on rows and disk", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    await fillStore(storeId, MAX_UNATTACHED_UPLOADS_PER_STORE - 3);
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => postUploadRoute(uploadRequest(seller.cookie))),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    for (const r of responses.filter((x) => x.status === 409)) {
      expect(await json(r)).toMatchObject({
        error: { code: "CONFLICT", details: { reason: "UPLOAD_LIMIT" } },
      });
    }
    const keys = await Promise.all(
      responses
        .filter((r) => r.status === 201)
        .map(async (r) => (await json<{ data: { key: string } }>(r)).data.key),
    );
    expect(await db.upload.count({ where: { storeId } })).toBe(MAX_UNATTACHED_UPLOADS_PER_STORE);
    for (const key of keys) expect(await exists(pathOfKey(key))).toBe(true);
    // Every stored file has a row: a refused request left no bytes behind.
    const rowKeys = new Set(
      (await db.upload.findMany({ where: { storeId }, select: { storageKey: true } })).map(
        (r) => r.storageKey,
      ),
    );
    for (const key of keys) expect(rowKeys.has(key)).toBe(true);
  });

  it("two stores, each one place left, racing at the same time: each gets exactly one, neither uses the other's place", async () => {
    const a = await signedIn("SELLER");
    const b = await signedIn("SELLER");
    await fillStore(a.storeId ?? "", MAX_UNATTACHED_UPLOADS_PER_STORE - 1);
    await fillStore(b.storeId ?? "", MAX_UNATTACHED_UPLOADS_PER_STORE - 1);
    const responses = await Promise.all([
      ...Array.from({ length: 4 }, () => postUploadRoute(uploadRequest(a.cookie))),
      ...Array.from({ length: 4 }, () => postUploadRoute(uploadRequest(b.cookie))),
    ]);
    expect(responses.slice(0, 4).filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.slice(4).filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.upload.count({ where: { storeId: a.storeId ?? "" } })).toBe(
      MAX_UNATTACHED_UPLOADS_PER_STORE,
    );
    expect(await db.upload.count({ where: { storeId: b.storeId ?? "" } })).toBe(
      MAX_UNATTACHED_UPLOADS_PER_STORE,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Orphans are 404 to every caller, the owner included
// ---------------------------------------------------------------------------------------------

describe("SEC-065 re-check: an expired orphan is 404 whoever asks", () => {
  it("anonymous, a customer, an admin, another seller, and the owning seller all get the same 404", async () => {
    const owner = await signedIn("SELLER");
    const other = await signedIn("SELLER");
    const customer = await signedIn("CUSTOMER");
    const admin = await signedIn("ADMIN");
    const { key } = await storedUpload(owner.storeId ?? "", PAST_GRACE);
    const bodies: unknown[] = [];
    for (const cookie of [undefined, customer.cookie, admin.cookie, other.cookie, owner.cookie]) {
      const response = await getFile(key, cookie);
      expect(response.status).toBe(404);
      const { error } = await json<{ error: { code: string; message: string; details: unknown } }>(
        response,
      );
      bodies.push([error.code, error.message, error.details]);
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it("the grace boundary is the database clock: 60 s inside is served, 60 s past is 404", async () => {
    const seller = await signedIn("SELLER");
    const inside = await storedUpload(seller.storeId ?? "", ORPHAN_GRACE_PERIOD_SECONDS - 60);
    const past = await storedUpload(seller.storeId ?? "", ORPHAN_GRACE_PERIOD_SECONDS + 60);
    expect((await getFile(inside.key)).status).toBe(200);
    expect((await getFile(past.key)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// Cross-store: an orphan cannot be revived or kept alive by another store
// ---------------------------------------------------------------------------------------------

describe("SEC-065 re-check: cross-store isolation of orphans", () => {
  it("another store cannot attach an expired orphan as its logo; the orphan stays 404 and is cleaned up", async () => {
    const owner = await signedIn("SELLER");
    const other = await signedIn("SELLER");
    const orphan = await storedUpload(owner.storeId ?? "", PAST_GRACE);
    const refused = await patchStoreRoute(
      jsonRequest("PATCH", "/api/v1/seller/store", {
        cookie: other.cookie,
        body: { logoKey: orphan.key },
      }),
    );
    expect(refused.status).toBe(404);
    expect(
      (await db.store.findUniqueOrThrow({ where: { id: other.storeId ?? "" } })).logoUploadId,
    ).toBeNull();
    expect((await getFile(orphan.key)).status).toBe(404);
    await cleanAll();
    expect(await db.upload.findUnique({ where: { storageKey: orphan.key } })).toBeNull();
    expect(await exists(pathOfKey(orphan.key))).toBe(false);
  });

  it("the owner attaching an expired orphan as its logo makes it served again and keeps it from the cleanup (section 5.8)", async () => {
    const owner = await signedIn("SELLER");
    const orphan = await storedUpload(owner.storeId ?? "", PAST_GRACE);
    const patched = await patchStoreRoute(
      jsonRequest("PATCH", "/api/v1/seller/store", {
        cookie: owner.cookie,
        body: { logoKey: orphan.key },
      }),
    );
    expect(patched.status).toBe(200);
    expect((await getFile(orphan.key)).status).toBe(200);
    await cleanAll();
    expect(await db.upload.findUnique({ where: { storageKey: orphan.key } })).not.toBeNull();
    expect(await exists(pathOfKey(orphan.key))).toBe(true);
  });

  it("one store's uploads at the cap do not refuse another store's upload at the same moment", async () => {
    const full = await signedIn("SELLER");
    const free = await signedIn("SELLER");
    await fillStore(full.storeId ?? "", MAX_UNATTACHED_UPLOADS_PER_STORE);
    const [refused, accepted] = await Promise.all([
      postUploadRoute(uploadRequest(full.cookie)),
      postUploadRoute(uploadRequest(free.cookie)),
    ]);
    expect(refused.status).toBe(409);
    expect(accepted.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------
// Cleanup: what it may never delete
// ---------------------------------------------------------------------------------------------

describe("SEC-065 re-check: the cleanup never deletes a referenced or recent upload", () => {
  it("keeps an upload whose logo attach is in flight (Store row update not yet committed)", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const target = await storedUpload(storeId, PAST_GRACE);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attached: () => void = () => undefined;
    const attachedSignal = new Promise<void>((resolve) => {
      attached = resolve;
    });
    const attach = db.$transaction(
      async (tx) => {
        await tx.store.update({ where: { id: storeId }, data: { logoUploadId: target.id } });
        attached();
        await gate;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
    await attachedSignal;
    try {
      await cleanAll();
    } finally {
      release();
    }
    await attach;
    expect(await db.upload.findUnique({ where: { storageKey: target.key } })).not.toBeNull();
    expect(await exists(pathOfKey(target.key))).toBe(true);
    expect((await getFile(target.key)).status).toBe(200);
  });

  it("keeps an upload whose order item insert is in flight (checkout not yet committed)", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const target = await storedUpload(storeId, PAST_GRACE);
    const sellerOrder = await createSellerOrderRow({ storeId });
    const product = await createProduct({ storeId });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let attached: () => void = () => undefined;
    const attachedSignal = new Promise<void>((resolve) => {
      attached = resolve;
    });
    const attach = db.$transaction(
      async (tx) => {
        await tx.orderItem.create({
          data: {
            sellerOrderId: sellerOrder.id,
            productId: product.id,
            productTitle: "In-flight order",
            productSku: "SEC065-INFLIGHT",
            unitPriceSatang: 10_000,
            quantity: 1,
            lineTotalSatang: 10_000,
            productImageUploadId: target.id,
          },
        });
        attached();
        await gate;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
    await attachedSignal;
    try {
      await cleanAll();
    } finally {
      release();
    }
    await attach;
    expect(await db.upload.findUnique({ where: { storageKey: target.key } })).not.toBeNull();
    expect(await exists(pathOfKey(target.key))).toBe(true);
  });

  it("keeps an upload 60 s inside the grace period and deletes one 60 s past it (database clock)", async () => {
    const seller = await signedIn("SELLER");
    const inside = await storedUpload(seller.storeId ?? "", ORPHAN_GRACE_PERIOD_SECONDS - 60);
    const past = await storedUpload(seller.storeId ?? "", ORPHAN_GRACE_PERIOD_SECONDS + 60);
    await cleanAll();
    expect(await db.upload.findUnique({ where: { storageKey: inside.key } })).not.toBeNull();
    expect(await exists(pathOfKey(inside.key))).toBe(true);
    expect(await db.upload.findUnique({ where: { storageKey: past.key } })).toBeNull();
    expect(await exists(pathOfKey(past.key))).toBe(false);
  });

  it("an order picture is kept even when the order item is the only reference, years past the grace period", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const target = await storedUpload(storeId, 3 * 365 * 86_400);
    await createOrderItemRow({
      sellerOrderId: (await createSellerOrderRow({ storeId })).id,
      productImageUploadId: target.id,
    });
    await cleanAll();
    expect(await exists(pathOfKey(target.key))).toBe(true);
    expect((await getFile(target.key)).status).toBe(200);
  });

  it("two cleanup runs at the same time: no error, every expired orphan deleted exactly once, nothing else", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const orphans = await Promise.all(
      Array.from({ length: 30 }, () => storedUpload(storeId, PAST_GRACE)),
    );
    const fresh = await storedUpload(storeId, 60);
    const seen: string[] = [];
    const recording = async (grace: number, limit: number): Promise<string[]> => {
      const keys = await deleteExpiredOrphans(grace, limit);
      seen.push(...keys);
      return keys;
    };
    const storage = new LocalDiskStorage(uploadDir);
    const runs = await Promise.all([
      cleanUpExpiredOrphans({ storage, batchSize: 7, maxBatches: 1_000, deleteRows: recording }),
      cleanUpExpiredOrphans({ storage, batchSize: 7, maxBatches: 1_000, deleteRows: recording }),
    ]);
    expect(new Set(seen).size).toBe(seen.length);
    for (const { key } of orphans) {
      expect(seen).toContain(key);
      expect(await exists(pathOfKey(key))).toBe(false);
    }
    expect(seen).not.toContain(fresh.key);
    expect(runs.reduce((n, r) => n + r.rowsDeleted, 0)).toBe(seen.length);
  });
});

// ---------------------------------------------------------------------------------------------
// Cleanup: hostile keys in the database, and disk and database out of step
// ---------------------------------------------------------------------------------------------

describe("SEC-065 re-check: the cleanup and paths outside the storage root", () => {
  it("rows whose storageKey is a traversal or absolute path: rows deleted, nothing outside the root touched, each counted failed", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    // Canaries a naive join of the key would reach.
    const canaryParent = join(base, "escape-canary");
    const canaryAbsolute = join(base, "absolute-canary");
    await writeFile(canaryParent, "keep");
    await writeFile(canaryAbsolute, "keep");
    const hostile = [
      "../escape-canary",
      "../../escape-canary",
      "..\\escape-canary",
      canaryAbsolute,
      `${"a".repeat(31)}/`,
      "A".repeat(32),
      `${"a".repeat(32)}.jpg`,
      "",
    ];
    const ids: string[] = [];
    for (const storageKey of hostile) {
      const row = await createUploadRow({ storeId, storageKey });
      await setAgeSeconds(row.id, PAST_GRACE);
      ids.push(row.id);
    }
    const warn: unknown[][] = [];
    const result = await cleanUpExpiredOrphans({
      storage: new LocalDiskStorage(uploadDir),
      log: { warn: (...args: unknown[]) => warn.push(args) },
      maxBatches: 1_000,
    });
    expect(result.filesFailed).toBeGreaterThanOrEqual(hostile.length);
    expect(await db.upload.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await readFile(canaryParent, "utf8")).toBe("keep");
    expect(await readFile(canaryAbsolute, "utf8")).toBe("keep");
    for (const key of hostile)
      expect(warn).toContainEqual([expect.any(String), { storageKey: key }]);
  });

  it("a pattern-valid key whose path is a directory: row deleted, the directory and its content kept, counted failed", async () => {
    const seller = await signedIn("SELLER");
    const key = generateStorageKey();
    const directory = pathOfKey(key);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "inner"), "keep");
    const row = await createUploadRow({ storeId: seller.storeId ?? "", storageKey: key });
    await setAgeSeconds(row.id, PAST_GRACE);
    const result = await cleanAll();
    expect(result.filesFailed).toBeGreaterThanOrEqual(1);
    expect(await db.upload.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await readFile(join(directory, "inner"), "utf8")).toBe("keep");
  });

  it("a row whose bytes are already gone is deleted without error and counted as a deleted file", async () => {
    const seller = await signedIn("SELLER");
    const key = generateStorageKey();
    const row = await createUploadRow({ storeId: seller.storeId ?? "", storageKey: key });
    await setAgeSeconds(row.id, PAST_GRACE);
    const seen: string[] = [];
    const result = await cleanUpExpiredOrphans({
      storage: new LocalDiskStorage(uploadDir),
      maxBatches: 1_000,
      deleteRows: async (grace, limit) => {
        const keys = await deleteExpiredOrphans(grace, limit);
        seen.push(...keys);
        return keys;
      },
    });
    expect(seen).toContain(key);
    expect(result.filesDeleted).toBeGreaterThanOrEqual(1);
    expect(await db.upload.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("(documented) a stored file with no row is never served, and the cleanup leaves it on disk", async () => {
    const key = generateStorageKey();
    await new LocalDiskStorage(uploadDir).put(key, jpegBytes(500));
    expect((await getFile(key)).status).toBe(404);
    await cleanAll();
    expect(await exists(pathOfKey(key))).toBe(true);
  });

  it.fails(
    "SEC-066: a stored file with no row, older than the grace period, is removed by the cleanup",
    async () => {
      const key = generateStorageKey();
      await new LocalDiskStorage(uploadDir).put(key, jpegBytes(500));
      const old = new Date(Date.now() - (ORPHAN_GRACE_PERIOD_SECONDS + 3_600) * 1_000);
      const { utimes } = await import("node:fs/promises");
      await utimes(pathOfKey(key), old, old);
      await cleanAll();
      expect(await exists(pathOfKey(key))).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// SEC-067: the "nothing references it" test has no index on OrderItem.productImageUploadId
// ---------------------------------------------------------------------------------------------

/** The plan of `sql` with sequential scans disabled: an index, if one exists, is then chosen. */
async function planWithoutSeqScan(
  run: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown[]>,
): Promise<string> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
    const rows = (await run(tx)) as { "QUERY PLAN": string }[];
    return rows.map((row) => row["QUERY PLAN"]).join("\n");
  });
}

describe("SEC-067 the reference lookup on order items is a full table scan", () => {
  // The statement of findUploadByKey (src/modules/uploads/repository.ts), run on every
  // GET /api/files/{key} past the grace period, without a session or a rate limit.
  const servePlan = (key: string) =>
    planWithoutSeqScan(
      (tx) => tx.$queryRaw`
        EXPLAIN SELECT u."contentType", u."sizeBytes",
          (u."createdAt" < now() - make_interval(secs => ${ORPHAN_GRACE_PERIOD_SECONDS}::int)
            AND NOT EXISTS (SELECT 1 FROM "ProductImage" p WHERE p."uploadId" = u."id")
            AND NOT EXISTS (SELECT 1 FROM "Store" s WHERE s."logoUploadId" = u."id")
            AND NOT EXISTS (SELECT 1 FROM "OrderItem" o WHERE o."productImageUploadId" = u."id")
          ) AS "expiredOrphan"
        FROM "Upload" u
        WHERE u."storageKey" = ${key}`,
    );

  it("(documented) serving a file plans a sequential scan of OrderItem even with sequential scans disabled", async () => {
    const plan = await servePlan(generateStorageKey());
    expect(plan).toMatch(/Seq Scan on "OrderItem"/);
  });

  it.fails("serving a file looks up order item references through an index", async () => {
    const plan = await servePlan(generateStorageKey());
    expect(plan).not.toMatch(/Seq Scan on "OrderItem"/);
  });
});
