/**
 * T-041: `POST /api/v1/seller/uploads` and `GET /api/files/{key}` against the worker's real test
 * database and a real temporary storage directory (docs/API_CONTRACTS.md section 5.8; REQ-S-05,
 * BR-14; SECURITY.md TM-17, TM-18; docs/TEST_STRATEGY.md "Uploads").
 *
 * The route modules are called in process with a real `Request` and a real session cookie. Every
 * fixture file is generated here. For every refusal the test checks that nothing was stored:
 * no `Upload` row and no file in the storage directory.
 */
import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getFileRoute } from "@/app/api/files/[key]/route";
import { PATCH as patchStoreRoute } from "@/app/api/v1/seller/store/route";
import { POST as postUploadRoute } from "@/app/api/v1/seller/uploads/route";
import {
  cleanUpExpiredOrphans,
  createUpload,
  LocalDiskStorage,
  MAX_UNATTACHED_UPLOADS_PER_STORE,
  MAX_UPLOAD_FILE_BYTES,
} from "@/modules/uploads";
import {
  ascii,
  fileBody,
  jpegBytes,
  multipartBody,
  multipartContentType,
  pngBytes,
  webpBytes,
} from "@/modules/uploads/test-fixtures";
import { db } from "@/server/db";

import {
  createOrderItemRow,
  createProduct,
  createProductImage,
  createSellerOrderRow,
  createUpload as createUploadRow,
} from "../../helpers/factories";
import { APP_ORIGIN, APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { errorCode, json, request as jsonRequest, signedIn } from "../sellers/support";

let uploadDir: string;
let outsideDir: string;

beforeAll(async () => {
  stubAuthEnvironment();
  outsideDir = await mkdtemp(join(tmpdir(), "t041-outside-"));
  uploadDir = join(outsideDir, "uploads");
  process.env["UPLOAD_DIR"] = uploadDir;
});

afterAll(async () => {
  delete process.env["UPLOAD_DIR"];
  await rm(outsideDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetProcessRateLimiter();
});

/** Every file under `dir`, as paths relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
      .sort();
  } catch {
    return [];
  }
}

interface UploadOptions {
  cookie?: string;
  origin?: string | null;
  contentType?: string | null;
  headers?: Record<string, string>;
}

function uploadRequest(body: BodyInit, options: UploadOptions = {}): Request {
  const headers = new Headers(options.headers);
  const origin = options.origin === undefined ? APP_ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType =
    options.contentType === undefined ? multipartContentType() : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  return new Request(`${APP_URL}/api/v1/seller/uploads`, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
}

/** A body stream that records whether anything pulled from it. */
function watchedBody(bytes: Uint8Array<ArrayBuffer>): {
  stream: ReadableStream<Uint8Array>;
  pulled: () => boolean;
} {
  let pulled = false;
  // High-water mark 0: the stream asks for nothing until a reader reads, so `pulled` means the
  // handler (not the stream's own pre-fill) read the body.
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled = true;
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulled: () => pulled };
}

function fileRequest(key: string): Request {
  return new Request(`${APP_URL}/api/files/${encodeURIComponent(key)}`, { method: "GET" });
}

function fileContext(key: string): RouteContext<"/api/files/[key]"> {
  return { params: Promise.resolve({ key }) } as RouteContext<"/api/files/[key]">;
}

async function storedNothing(before: { rows: number; files: string[] }): Promise<void> {
  expect(await db.upload.count()).toBe(before.rows);
  expect(await filesUnder(uploadDir)).toEqual(before.files);
  expect(
    await filesUnder(outsideDir).then((all) => all.filter((p) => !p.startsWith("uploads"))),
  ).toEqual([]);
}

async function state(): Promise<{ rows: number; files: string[] }> {
  return { rows: await db.upload.count(), files: await filesUnder(uploadDir) };
}

// ---------------------------------------------------------------------------------------------
// POST /seller/uploads: success
// ---------------------------------------------------------------------------------------------

describe("POST /api/v1/seller/uploads: accepted images", () => {
  it.each([
    ["JPEG", jpegBytes(500), "photo.jpg", "image/jpeg"],
    ["PNG", pngBytes(500), "รูป.PNG", "image/png"],
    ["WebP", webpBytes(500), "a.webp", "image/webp"],
  ] as const)(
    "stores a %s under a generated key, owned by the caller's store",
    async (_n, bytes, filename, type) => {
      const seller = await signedIn("SELLER");
      const response = await postUploadRoute(
        uploadRequest(fileBody(bytes, filename, type), { cookie: seller.cookie }),
      );
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const { data } = await json<{
        data: { key: string; url: string; contentType: string; sizeBytes: number };
      }>(response);
      expect(Object.keys(data).sort()).toEqual(["contentType", "key", "sizeBytes", "url"]);
      expect(data.key).toMatch(/^[0-9a-f]{32}$/);
      expect(data.url).toBe(`/api/files/${data.key}`);
      expect(data).toMatchObject({ contentType: type, sizeBytes: 500 });

      const row = await db.upload.findUniqueOrThrow({ where: { storageKey: data.key } });
      expect(row).toMatchObject({ storeId: seller.storeId, contentType: type, sizeBytes: 500 });
      const files = await filesUnder(uploadDir);
      expect(files).toContain(join(data.key.slice(0, 2), data.key));
      expect(files.some((path) => path.includes(filename))).toBe(false);
    },
  );

  it("accepts a file of exactly 5 MB", async () => {
    const seller = await signedIn("SELLER");
    const response = await postUploadRoute(
      uploadRequest(fileBody(jpegBytes(MAX_UPLOAD_FILE_BYTES)), { cookie: seller.cookie }),
    );
    expect(response.status).toBe(201);
    expect((await json<{ data: { sizeBytes: number } }>(response)).data.sizeBytes).toBe(
      MAX_UPLOAD_FILE_BYTES,
    );
  });

  it("five uploads of one store at the same time all succeed (no deadlock on the store lock)", async () => {
    const seller = await signedIn("SELLER");
    const responses = await Promise.all(
      [0, 1, 2, 3, 4].map(() =>
        postUploadRoute(uploadRequest(fileBody(jpegBytes(200)), { cookie: seller.cookie })),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(await db.upload.count({ where: { storeId: seller.storeId ?? "" } })).toBe(5);
  });

  it("a fresh upload can be the store logo of its own store (attached through logoKey)", async () => {
    const seller = await signedIn("SELLER");
    const uploaded = await postUploadRoute(
      uploadRequest(fileBody(pngBytes(), "logo.png", "image/png"), { cookie: seller.cookie }),
    );
    const { data } = await json<{ data: { key: string } }>(uploaded);
    const patched = await patchStoreRoute(
      jsonRequest("PATCH", "/api/v1/seller/store", {
        cookie: seller.cookie,
        body: { logoKey: data.key },
      }),
    );
    expect(patched.status).toBe(200);
    expect((await json<{ data: { logo: unknown } }>(patched)).data.logo).toEqual({
      key: data.key,
      url: `/api/files/${data.key}`,
    });
    // Another store cannot attach it: 404 upload, the same as an unknown key.
    const other = await signedIn("SELLER");
    const refused = await patchStoreRoute(
      jsonRequest("PATCH", "/api/v1/seller/store", {
        cookie: other.cookie,
        body: { logoKey: data.key },
      }),
    );
    expect(refused.status).toBe(404);
    expect(await json(refused)).toMatchObject({ error: { details: { resource: "upload" } } });
  });
});

// ---------------------------------------------------------------------------------------------
// POST /seller/uploads: refusals of the file
// ---------------------------------------------------------------------------------------------

describe("POST /api/v1/seller/uploads: refused files store nothing", () => {
  it.each([
    ["GIF", ascii("GIF89a\u0001\u0000\u0001\u0000;"), "a.gif", "image/gif"],
    [
      "SVG",
      ascii("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"),
      "a.svg",
      "image/svg+xml",
    ],
    ["PDF", ascii("%PDF-1.7\n1 0 obj"), "a.pdf", "application/pdf"],
    ["HTML", ascii("<!doctype html><script>alert(1)</script>"), "a.html", "text/html"],
    [
      "HTML named .jpg with an image type",
      ascii("<html><script>alert(1)</script>"),
      "a.jpg",
      "image/jpeg",
    ],
    ["PNG bytes declared as JPEG", pngBytes(), "a.jpg", "image/jpeg"],
  ] as const)("refuses %s with 415", async (_n, bytes, filename, type) => {
    const seller = await signedIn("SELLER");
    const before = await state();
    const response = await postUploadRoute(
      uploadRequest(fileBody(bytes, filename, type), { cookie: seller.cookie }),
    );
    expect(response.status).toBe(415);
    expect(await errorCode(response)).toBe("UNSUPPORTED_MEDIA_TYPE");
    await storedNothing(before);
  });

  it("refuses a request that is not multipart/form-data with 415", async () => {
    const seller = await signedIn("SELLER");
    const before = await state();
    for (const contentType of [
      "application/json",
      "image/jpeg",
      "application/x-www-form-urlencoded",
      null,
    ]) {
      const response = await postUploadRoute(
        uploadRequest(jpegBytes(), { cookie: seller.cookie, contentType }),
      );
      expect(response.status).toBe(415);
    }
    await storedNothing(before);
  });

  it("refuses one byte over 5 MB with 413, and a declared length over the body limit unread", async () => {
    const seller = await signedIn("SELLER");
    const before = await state();
    const over = await postUploadRoute(
      uploadRequest(fileBody(jpegBytes(MAX_UPLOAD_FILE_BYTES + 1)), { cookie: seller.cookie }),
    );
    expect(over.status).toBe(413);
    expect(await errorCode(over)).toBe("PAYLOAD_TOO_LARGE");

    const watched = watchedBody(fileBody(jpegBytes()));
    const declared = await postUploadRoute(
      uploadRequest(watched.stream, {
        cookie: seller.cookie,
        headers: { "content-length": "999999999" },
      }),
    );
    expect(declared.status).toBe(413);
    expect(watched.pulled()).toBe(false);
    await storedNothing(before);
  });

  it.each([
    "../../x.jpg",
    "/etc/x.jpg",
    "C:\\Windows\\x.jpg",
    "..\\..\\x.jpg",
    "x\u0000.jpg",
    `${"a".repeat(300)}.jpg`,
  ])("refuses the file name %j with 400 and writes nothing anywhere", async (filename) => {
    const seller = await signedIn("SELLER");
    const before = await state();
    const response = await postUploadRoute(
      uploadRequest(fileBody(jpegBytes(), filename), { cookie: seller.cookie }),
    );
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { fields: [{ path: "file", code: "invalid_format" }] },
      },
    });
    await storedNothing(before);
  });

  it("refuses an extra storeId field naming another store with 400; the other store gains nothing", async () => {
    const seller = await signedIn("SELLER");
    const victim = await signedIn("SELLER");
    const before = await state();
    const body = multipartBody([
      { name: "file", filename: "a.jpg", contentType: "image/jpeg", bytes: jpegBytes() },
      { name: "storeId", bytes: ascii(victim.storeId ?? "") },
    ]);
    const response = await postUploadRoute(uploadRequest(body, { cookie: seller.cookie }));
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: { details: { fields: [{ path: "", code: "unrecognized_keys" }] } },
    });
    expect(await db.upload.count({ where: { storeId: victim.storeId ?? "" } })).toBe(0);
    await storedNothing(before);
  });

  it("refuses a malformed body (no boundary, two files, no file) with 400", async () => {
    const seller = await signedIn("SELLER");
    const before = await state();
    const one = { name: "file", filename: "a.jpg", contentType: "image/jpeg", bytes: jpegBytes() };
    for (const [body, contentType] of [
      [fileBody(jpegBytes()), "multipart/form-data"],
      [multipartBody([one, one]), multipartContentType()],
      [multipartBody([]), multipartContentType()],
    ] as const) {
      const response = await postUploadRoute(
        uploadRequest(body, { cookie: seller.cookie, contentType }),
      );
      expect(response.status).toBe(400);
    }
    await storedNothing(before);
  });
});

// ---------------------------------------------------------------------------------------------
// POST /seller/uploads: who may upload (steps 1 to 5 read no body)
// ---------------------------------------------------------------------------------------------

describe("POST /api/v1/seller/uploads: access", () => {
  it("(control) the body probe does see the read of an accepted upload", async () => {
    const seller = await signedIn("SELLER");
    const watched = watchedBody(fileBody(jpegBytes()));
    const request = uploadRequest(watched.stream, { cookie: seller.cookie });
    const response = await postUploadRoute(request);
    expect(response.status).toBe(201);
    expect(watched.pulled()).toBe(true);
    expect(request.bodyUsed).toBe(true);
  });

  it("is 401 without a session, 403 FORBIDDEN for a customer and an admin, body unread", async () => {
    const customer = await signedIn("CUSTOMER");
    const admin = await signedIn("ADMIN");
    const before = await state();
    for (const [cookie, status, code] of [
      [undefined, 401, "UNAUTHENTICATED"],
      [customer.cookie, 403, "FORBIDDEN"],
      [admin.cookie, 403, "FORBIDDEN"],
    ] as const) {
      const watched = watchedBody(fileBody(jpegBytes()));
      const response = await postUploadRoute(
        uploadRequest(watched.stream, cookie === undefined ? {} : { cookie }),
      );
      expect(response.status).toBe(status);
      expect(await errorCode(response)).toBe(code);
      expect(watched.pulled()).toBe(false);
    }
    await storedNothing(before);
  });

  it("is 403 SELLER_NOT_APPROVED for a suspended store, before the body is read, and uses no allowance", async () => {
    const seller = await signedIn("SELLER", "SUSPENDED");
    const before = await state();
    for (let i = 0; i < 35; i += 1) {
      const watched = watchedBody(fileBody(jpegBytes()));
      const response = await postUploadRoute(
        uploadRequest(watched.stream, { cookie: seller.cookie }),
      );
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("SELLER_NOT_APPROVED");
      expect(watched.pulled()).toBe(false);
    }
    await storedNothing(before);
  });

  it("is 403 for a foreign or missing Origin, before the session or the body", async () => {
    const seller = await signedIn("SELLER");
    const before = await state();
    for (const origin of ["https://evil.example", "null", null]) {
      const watched = watchedBody(fileBody(jpegBytes()));
      const response = await postUploadRoute(
        uploadRequest(watched.stream, { cookie: seller.cookie, origin }),
      );
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("FORBIDDEN");
      expect(watched.pulled()).toBe(false);
    }
    await storedNothing(before);
  });

  it("allows 30 requests an hour per user; the 31st is 429 with Retry-After and is not read", async () => {
    const seller = await signedIn("SELLER");
    for (let i = 0; i < 30; i += 1) {
      // Refused requests count as well (section 6): every second one is a wrong type.
      const body =
        i % 2 === 0 ? fileBody(jpegBytes()) : fileBody(ascii("<svg/>"), "a.svg", "image/svg+xml");
      const response = await postUploadRoute(uploadRequest(body, { cookie: seller.cookie }));
      expect([201, 415]).toContain(response.status);
    }
    const watched = watchedBody(fileBody(jpegBytes()));
    const limited = await postUploadRoute(uploadRequest(watched.stream, { cookie: seller.cookie }));
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(watched.pulled()).toBe(false);
    expect(await db.upload.count({ where: { storeId: seller.storeId ?? "" } })).toBe(15);
    // The allowance is per user: another seller is not affected.
    const other = await signedIn("SELLER");
    resetProcessRateLimiter();
    expect(
      (await postUploadRoute(uploadRequest(fileBody(jpegBytes()), { cookie: other.cookie })))
        .status,
    ).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------
// The service under the store lock (step 8)
// ---------------------------------------------------------------------------------------------

describe("createUpload: the store status is judged again in the transaction", () => {
  it("refuses a store suspended after the session was read: 403, no row, no file", async () => {
    const seller = await signedIn("SELLER");
    await db.store.update({ where: { id: seller.storeId ?? "" }, data: { status: "SUSPENDED" } });
    const before = await state();
    const actor = {
      userId: seller.userId,
      role: "SELLER" as const,
      storeId: seller.storeId,
      storeStatus: "APPROVED" as const, // what step 4 saw before the suspension committed
    };
    await expect(
      createUpload(
        actor,
        { contentType: "image/jpeg", bytes: jpegBytes() },
        { storage: new LocalDiskStorage(uploadDir) },
      ),
    ).rejects.toMatchObject({ code: "SELLER_NOT_APPROVED", status: 403 });
    await storedNothing(before);
  });

  it("refuses a session whose store id is another user's store (scoped by owner): 403, nothing stored", async () => {
    const seller = await signedIn("SELLER");
    const victim = await signedIn("SELLER");
    const before = await state();
    const forged = {
      userId: seller.userId,
      role: "SELLER" as const,
      storeId: victim.storeId,
      storeStatus: "APPROVED" as const,
    };
    await expect(
      createUpload(
        forged,
        { contentType: "image/jpeg", bytes: jpegBytes() },
        { storage: new LocalDiskStorage(uploadDir) },
      ),
    ).rejects.toMatchObject({ code: "SELLER_NOT_APPROVED" });
    await storedNothing(before);
  });

  it("a suspension that starts during an upload waits for it and does not deadlock", async () => {
    const seller = await signedIn("SELLER");
    const [upload, suspension] = await Promise.allSettled([
      postUploadRoute(uploadRequest(fileBody(jpegBytes(200_000)), { cookie: seller.cookie })),
      db.store.update({ where: { id: seller.storeId ?? "" }, data: { status: "SUSPENDED" } }),
    ]);
    expect(suspension.status).toBe("fulfilled");
    expect(upload.status).toBe("fulfilled");
    const status = upload.status === "fulfilled" ? upload.value.status : 0;
    expect([201, 403]).toContain(status);
    const rows = await db.upload.count({ where: { storeId: seller.storeId ?? "" } });
    expect(rows).toBe(status === 201 ? 1 : 0);
  });
});

// ---------------------------------------------------------------------------------------------
// GET /api/files/{key}
// ---------------------------------------------------------------------------------------------

describe("GET /api/files/{key}", () => {
  it("serves the stored bytes to anyone with the recorded type and nosniff", async () => {
    const seller = await signedIn("SELLER");
    const bytes = webpBytes(321);
    const uploaded = await postUploadRoute(
      uploadRequest(fileBody(bytes, "a.webp", "image/webp"), { cookie: seller.cookie }),
    );
    const { data } = await json<{ data: { key: string } }>(uploaded);
    const response = await getFileRoute(fileRequest(data.key), fileContext(data.key));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe("321");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it("is 404, identically, for an unknown key, traversal keys, and a key outside the pattern", async () => {
    const legacy = await createUploadRow(); // a row whose key does not match the pattern
    const answers: string[] = [];
    for (const key of [
      "0123456789abcdef0123456789abcdef",
      "../../../etc/passwd",
      "..\\..\\windows\\win.ini",
      "%2e%2e%2fetc%2fpasswd",
      `../${"0".repeat(32)}`,
      legacy.storageKey,
      "",
    ]) {
      const response = await getFileRoute(fileRequest(key), fileContext(key));
      expect(response.status).toBe(404);
      const body = await json<{ error: { code: string; message: string; details: unknown } }>(
        response,
      );
      answers.push(JSON.stringify([body.error.code, body.error.message, body.error.details]));
    }
    expect(new Set(answers).size).toBe(1);
  });

  it("is 404 for a registered upload whose bytes are gone", async () => {
    const seller = await signedIn("SELLER");
    const uploaded = await postUploadRoute(
      uploadRequest(fileBody(jpegBytes()), { cookie: seller.cookie }),
    );
    const { data } = await json<{ data: { key: string } }>(uploaded);
    await unlink(join(uploadDir, data.key.slice(0, 2), data.key));
    const response = await getFileRoute(fileRequest(data.key), fileContext(data.key));
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-065: the cap on unattached uploads, orphans not served, the cleanup
// ---------------------------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

async function uploadedKey(cookie: string): Promise<string> {
  const response = await postUploadRoute(uploadRequest(fileBody(jpegBytes()), { cookie }));
  expect(response.status).toBe(201);
  return (await json<{ data: { key: string } }>(response)).data.key;
}

async function setAge(storageKey: string, hours: number): Promise<{ id: string }> {
  return db.upload.update({
    where: { storageKey },
    data: { createdAt: new Date(Date.now() - hours * HOUR_MS) },
    select: { id: true },
  });
}

/** `count` unattached `Upload` rows of the store, written directly (no bytes). */
async function fillStore(storeId: string, count: number, hoursOld = 0): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const row = await createUploadRow({
      storeId,
      createdAt: new Date(Date.now() - hoursOld * HOUR_MS),
    });
    ids.push(row.id);
  }
  return ids;
}

function fileOf(key: string): string {
  return join(key.slice(0, 2), key);
}

describe("SEC-065: a store's cap on uploads nothing references", () => {
  it("a store at the cap is refused 409 UPLOAD_LIMIT before the body is read, and nothing is stored", async () => {
    const seller = await signedIn("SELLER");
    await fillStore(seller.storeId ?? "", MAX_UNATTACHED_UPLOADS_PER_STORE);
    const before = await state();
    const body = watchedBody(fileBody(jpegBytes()));
    const response = await postUploadRoute(uploadRequest(body.stream, { cookie: seller.cookie }));
    expect(response.status).toBe(409);
    const { error } = await json<{ error: { code: string; details: unknown } }>(response);
    expect(error).toMatchObject({ code: "CONFLICT", details: { reason: "UPLOAD_LIMIT" } });
    expect(body.pulled()).toBe(false);
    await storedNothing(before);
  });

  it("the service refuses at the cap too, inside the transaction (the early check passed over)", async () => {
    const seller = await signedIn("SELLER");
    await fillStore(seller.storeId ?? "", MAX_UNATTACHED_UPLOADS_PER_STORE);
    const before = await state();
    const actor = {
      userId: seller.userId,
      role: "SELLER" as const,
      storeId: seller.storeId,
      storeStatus: "APPROVED" as const,
    };
    await expect(
      createUpload(
        actor,
        { contentType: "image/jpeg", bytes: jpegBytes() },
        { storage: new LocalDiskStorage(uploadDir) },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409, details: { reason: "UPLOAD_LIMIT" } });
    await storedNothing(before);
  });

  it("product pictures, the logo, and order pictures do not count; each attach frees one place", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const [forPicture, forLogo, forOrder] = await fillStore(
      storeId,
      MAX_UNATTACHED_UPLOADS_PER_STORE,
    );
    await createProductImage({
      productId: (await createProduct({ storeId })).id,
      uploadId: forPicture ?? "",
    });
    await db.store.update({ where: { id: storeId }, data: { logoUploadId: forLogo ?? "" } });
    await createOrderItemRow({
      sellerOrderId: (await createSellerOrderRow({ storeId })).id,
      productImageUploadId: forOrder ?? "",
    });
    for (let i = 0; i < 3; i += 1) await uploadedKey(seller.cookie);
    const refused = await postUploadRoute(
      uploadRequest(fileBody(jpegBytes()), { cookie: seller.cookie }),
    );
    expect(refused.status).toBe(409);
  });

  it("another store's uploads never count against the caller's store", async () => {
    const full = await signedIn("SELLER");
    const other = await signedIn("SELLER");
    await fillStore(full.storeId ?? "", MAX_UNATTACHED_UPLOADS_PER_STORE);
    expect(
      (await postUploadRoute(uploadRequest(fileBody(jpegBytes()), { cookie: full.cookie }))).status,
    ).toBe(409);
    await uploadedKey(other.cookie);
  });

  it("orphans past the grace period count until the cleanup deletes them", async () => {
    const seller = await signedIn("SELLER");
    await fillStore(seller.storeId ?? "", MAX_UNATTACHED_UPLOADS_PER_STORE, 25);
    expect(
      (await postUploadRoute(uploadRequest(fileBody(jpegBytes()), { cookie: seller.cookie })))
        .status,
    ).toBe(409);
    await cleanUpExpiredOrphans({ storage: new LocalDiskStorage(uploadDir), maxBatches: 1_000 });
    expect(await db.upload.count({ where: { storeId: seller.storeId ?? "" } })).toBe(0);
    await uploadedKey(seller.cookie);
  });

  it("parallel uploads of one store cannot pass the cap: one place left, three tries, one stored", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    await fillStore(storeId, MAX_UNATTACHED_UPLOADS_PER_STORE - 1);
    const filesBefore = await filesUnder(uploadDir);
    const actor = {
      userId: seller.userId,
      role: "SELLER" as const,
      storeId,
      storeStatus: "APPROVED" as const,
    };
    const results = await Promise.allSettled(
      [0, 1, 2].map(() =>
        createUpload(
          actor,
          { contentType: "image/jpeg", bytes: jpegBytes(50_000) },
          { storage: new LocalDiskStorage(uploadDir) },
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        code: "CONFLICT",
        details: { reason: "UPLOAD_LIMIT" },
      });
    }
    expect(await db.upload.count({ where: { storeId } })).toBe(MAX_UNATTACHED_UPLOADS_PER_STORE);
    expect((await filesUnder(uploadDir)).length).toBe(filesBefore.length + 1);
  });
});

describe("SEC-065: GET /api/files/{key} for uploads nothing references", () => {
  async function status(key: string): Promise<number> {
    return (await getFileRoute(fileRequest(key), fileContext(key))).status;
  }

  it("is served inside the grace period, and 404 after it, the same 404 as an unknown key", async () => {
    const seller = await signedIn("SELLER");
    const key = await uploadedKey(seller.cookie);
    await setAge(key, 23);
    expect(await status(key)).toBe(200);
    await setAge(key, 25);
    const response = await getFileRoute(fileRequest(key), fileContext(key));
    expect(response.status).toBe(404);
    const unknown = "f".repeat(32);
    const unknownResponse = await getFileRoute(fileRequest(unknown), fileContext(unknown));
    const shape = async (r: Response) => {
      const { error } = await json<{ error: { code: string; message: string; details: unknown } }>(
        r,
      );
      return [error.code, error.message, error.details];
    };
    expect(await shape(response)).toEqual(await shape(unknownResponse));
  });

  it("past the grace period, an upload that a product picture, a logo, or only an order item references is served", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const picture = await uploadedKey(seller.cookie);
    const logo = await uploadedKey(seller.cookie);
    const ordered = await uploadedKey(seller.cookie);
    const pictureRow = await setAge(picture, 25);
    const logoRow = await setAge(logo, 25);
    const orderedRow = await setAge(ordered, 25);
    await createProductImage({
      productId: (await createProduct({ storeId })).id,
      uploadId: pictureRow.id,
    });
    await db.store.update({ where: { id: storeId }, data: { logoUploadId: logoRow.id } });
    await createOrderItemRow({
      sellerOrderId: (await createSellerOrderRow({ storeId })).id,
      productImageUploadId: orderedRow.id,
    });
    for (const key of [picture, logo, ordered]) expect(await status(key)).toBe(200);
  });
});

describe("SEC-065: the orphan cleanup", () => {
  it("deletes expired orphans, row and bytes, and keeps everything else", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const [expired, fresh, picture, logo, ordered] = [
      await uploadedKey(seller.cookie),
      await uploadedKey(seller.cookie),
      await uploadedKey(seller.cookie),
      await uploadedKey(seller.cookie),
      await uploadedKey(seller.cookie),
    ];
    await setAge(expired, 25);
    await setAge(fresh, 23);
    const pictureRow = await setAge(picture, 25);
    const logoRow = await setAge(logo, 25);
    const orderedRow = await setAge(ordered, 25);
    await createProductImage({
      productId: (await createProduct({ storeId })).id,
      uploadId: pictureRow.id,
    });
    await db.store.update({ where: { id: storeId }, data: { logoUploadId: logoRow.id } });
    await createOrderItemRow({
      sellerOrderId: (await createSellerOrderRow({ storeId })).id,
      productImageUploadId: orderedRow.id,
    });

    const result = await cleanUpExpiredOrphans({
      storage: new LocalDiskStorage(uploadDir),
      maxBatches: 1_000,
    });
    expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);

    expect(await db.upload.findUnique({ where: { storageKey: expired } })).toBeNull();
    const files = await filesUnder(uploadDir);
    expect(files).not.toContain(fileOf(expired));
    for (const key of [fresh, picture, logo, ordered]) {
      expect(await db.upload.findUnique({ where: { storageKey: key } })).not.toBeNull();
      expect(files).toContain(fileOf(key));
    }
  });

  it("skips an upload that a transaction is attaching at that moment, which keeps its row and bytes", async () => {
    const seller = await signedIn("SELLER");
    const storeId = seller.storeId ?? "";
    const key = await uploadedKey(seller.cookie);
    const row = await setAge(key, 25);
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
        await tx.productImage.create({
          data: { productId: product.id, uploadId: row.id, sortOrder: 0 },
        });
        attached();
        await gate;
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
    await attachedSignal;
    try {
      await cleanUpExpiredOrphans({ storage: new LocalDiskStorage(uploadDir), maxBatches: 1_000 });
    } finally {
      release();
    }
    await attach;
    expect(await db.upload.findUnique({ where: { storageKey: key } })).not.toBeNull();
    expect(await filesUnder(uploadDir)).toContain(fileOf(key));
    expect((await getFileRoute(fileRequest(key), fileContext(key))).status).toBe(200);
  });

  it("a file whose deletion fails stays without a row, is never served, and the run goes on", async () => {
    const seller = await signedIn("SELLER");
    const key = await uploadedKey(seller.cookie);
    await setAge(key, 25);
    const storage = new LocalDiskStorage(uploadDir);
    const warn: unknown[][] = [];
    const failing = {
      put: storage.put.bind(storage),
      get: storage.get.bind(storage),
      delete: async (k: string) => {
        if (k === key) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
        await storage.delete(k);
      },
    };
    const result = await cleanUpExpiredOrphans({
      storage: failing,
      log: { warn: (...args: unknown[]) => warn.push(args) },
      maxBatches: 1_000,
    });
    expect(result.filesFailed).toBeGreaterThanOrEqual(1);
    expect(warn).toContainEqual([expect.any(String), { storageKey: key }]);
    expect(await db.upload.findUnique({ where: { storageKey: key } })).toBeNull();
    expect(await filesUnder(uploadDir)).toContain(fileOf(key));
    expect((await getFileRoute(fileRequest(key), fileContext(key))).status).toBe(404);
  });
});
