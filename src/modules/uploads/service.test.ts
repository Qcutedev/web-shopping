/**
 * Unit tests of the upload service: the permission checks, the order of work inside the
 * transaction, and the clean-up of stored bytes when the row is refused. The database, the store
 * lock, and the repository are replaced; tests/integration/uploads runs the same paths against
 * PostgreSQL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/server/auth/actor";
import { sellerNotApproved } from "@/server/errors";

const calls: string[] = [];

vi.mock("@/server/db", () => ({
  db: {
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
      calls.push("begin");
      try {
        const result = await run({ tx: true });
        calls.push("commit");
        return result;
      } catch (error) {
        calls.push("rollback");
        throw error;
      }
    }),
  },
}));

const lockMock = vi.fn(async (_tx: unknown, actor: Actor) => {
  calls.push("lock");
  return { storeId: actor.storeId ?? "none" };
});
vi.mock("@/modules/sellers", () => ({
  requireApprovedStoreForWrite: (tx: unknown, actor: Actor) => lockMock(tx, actor),
}));

const insertMock = vi.fn(async () => {
  calls.push("insert");
  return true;
});
type FoundRow = { contentType: string; sizeBytes: number; expiredOrphan: boolean } | null;
const findMock = vi.fn<(...args: unknown[]) => Promise<FoundRow>>(async () => null);
const quotaLockMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {
  calls.push("quota-lock");
});
const countMock = vi.fn<(...args: unknown[]) => Promise<number>>(async () => {
  calls.push("count");
  return 0;
});
vi.mock("./repository", () => ({
  insertUploadIfStoreApproved: (...args: unknown[]) => insertMock(...(args as [])),
  findUploadByKey: (...args: unknown[]) => findMock(...args),
  lockStoreUploads: (...args: unknown[]) => quotaLockMock(...args),
  countUnreferencedUploads: (...args: unknown[]) => countMock(...args),
}));

const { assertUploadAllowance, createUpload, openFile } = await import("./service");
const { MAX_UNATTACHED_UPLOADS_PER_STORE, ORPHAN_GRACE_PERIOD_SECONDS } = await import("./schema");
const { jpegBytes } = await import("./test-fixtures");

const KEY = "0123456789abcdef0123456789abcdef";

function seller(storeStatus: "APPROVED" | "SUSPENDED" | null = "APPROVED"): Actor {
  return {
    userId: "user-1",
    role: "SELLER",
    storeId: storeStatus === null ? null : "store-1",
    storeStatus,
  };
}

function fakeStorage(bytes: Uint8Array<ArrayBuffer> | null = null) {
  return {
    put: vi.fn(async () => {
      calls.push("put");
    }),
    get: vi.fn(async () =>
      bytes === null
        ? null
        : { body: new Response(bytes).body as ReadableStream<Uint8Array>, sizeBytes: bytes.length },
    ),
    delete: vi.fn(async () => {
      calls.push("delete");
    }),
  };
}

beforeEach(() => {
  calls.length = 0;
  lockMock.mockClear();
  insertMock.mockClear();
  quotaLockMock.mockClear();
  countMock.mockClear();
  findMock.mockReset();
  findMock.mockResolvedValue(null);
});

const servable = { expiredOrphan: false };

const IMAGE = { contentType: "image/jpeg" as const, bytes: jpegBytes(100) };

describe("createUpload: permission checks", () => {
  it.each([
    [
      "a customer",
      { userId: "u", role: "CUSTOMER", storeId: null, storeStatus: null },
      "FORBIDDEN",
    ],
    ["an admin", { userId: "u", role: "ADMIN", storeId: null, storeStatus: null }, "FORBIDDEN"],
    ["a seller of a suspended store", seller("SUSPENDED"), "SELLER_NOT_APPROVED"],
    ["a seller without a store", seller(null), "SELLER_NOT_APPROVED"],
  ] as const)("refuses %s before any database or storage work", async (_name, actor, code) => {
    const storage = fakeStorage();
    await expect(createUpload(actor as Actor, IMAGE, { storage })).rejects.toMatchObject({
      code,
      status: 403,
    });
    expect(calls).toEqual([]);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("scopes the row by the session's store and user, never anything else", async () => {
    const storage = fakeStorage();
    const result = await createUpload(seller(), IMAGE, { storage, newKey: () => KEY });
    expect(insertMock).toHaveBeenCalledWith(
      { tx: true },
      {
        storageKey: KEY,
        storeId: "store-1",
        userId: "user-1",
        contentType: "image/jpeg",
        sizeBytes: 100,
      },
    );
    expect(result).toEqual({
      key: KEY,
      url: `/api/files/${KEY}`,
      contentType: "image/jpeg",
      sizeBytes: 100,
    });
  });

  it("locks the store first, then the store's uploads, counts, stores the bytes, then inserts the row, in one transaction", async () => {
    await createUpload(seller(), IMAGE, { storage: fakeStorage(), newKey: () => KEY });
    expect(calls).toEqual(["begin", "lock", "quota-lock", "count", "put", "insert", "commit"]);
    // The lock and the count are of the store the store lock returned, inside the transaction.
    expect(quotaLockMock).toHaveBeenCalledWith({ tx: true }, "store-1");
    expect(countMock).toHaveBeenCalledWith("store-1", { tx: true });
  });
});

describe("SEC-065: the cap on uploads nothing references", () => {
  it("refuses at the cap inside the transaction: 409 UPLOAD_LIMIT, nothing stored, rolled back", async () => {
    countMock.mockImplementationOnce(async () => {
      calls.push("count");
      return MAX_UNATTACHED_UPLOADS_PER_STORE;
    });
    const storage = fakeStorage();
    await expect(createUpload(seller(), IMAGE, { storage })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: { reason: "UPLOAD_LIMIT" },
    });
    expect(calls).toEqual(["begin", "lock", "quota-lock", "count", "rollback"]);
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("accepts one below the cap", async () => {
    countMock.mockResolvedValueOnce(MAX_UNATTACHED_UPLOADS_PER_STORE - 1);
    await expect(createUpload(seller(), IMAGE, { storage: fakeStorage() })).resolves.toMatchObject({
      contentType: "image/jpeg",
    });
  });

  it("the early check counts the session's store and refuses at the cap", async () => {
    countMock.mockResolvedValueOnce(MAX_UNATTACHED_UPLOADS_PER_STORE);
    await expect(assertUploadAllowance(seller())).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "UPLOAD_LIMIT" },
    });
    expect(countMock).toHaveBeenLastCalledWith("store-1");
    countMock.mockResolvedValueOnce(MAX_UNATTACHED_UPLOADS_PER_STORE - 1);
    await expect(assertUploadAllowance(seller())).resolves.toBeUndefined();
  });

  it.each([
    [
      "a customer",
      { userId: "u", role: "CUSTOMER", storeId: null, storeStatus: null },
      "FORBIDDEN",
    ],
    ["an admin", { userId: "u", role: "ADMIN", storeId: null, storeStatus: null }, "FORBIDDEN"],
    ["a seller of a suspended store", seller("SUSPENDED"), "SELLER_NOT_APPROVED"],
  ] as const)("the early check refuses %s without counting", async (_name, actor, code) => {
    await expect(assertUploadAllowance(actor as Actor)).rejects.toMatchObject({ code });
    expect(countMock).not.toHaveBeenCalled();
  });
});

describe("createUpload: refusals inside the transaction", () => {
  it("stores nothing when the store lock refuses (suspended since the session was read)", async () => {
    lockMock.mockImplementationOnce(async () => {
      calls.push("lock");
      throw sellerNotApproved();
    });
    const storage = fakeStorage();
    await expect(createUpload(seller(), IMAGE, { storage })).rejects.toMatchObject({
      code: "SELLER_NOT_APPROVED",
    });
    expect(calls).toEqual(["begin", "lock", "rollback"]);
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("deletes the stored bytes when the guarded insert writes no row (403)", async () => {
    insertMock.mockImplementationOnce(async () => {
      calls.push("insert");
      return false;
    });
    const storage = fakeStorage();
    await expect(
      createUpload(seller(), IMAGE, { storage, newKey: () => KEY }),
    ).rejects.toMatchObject({ code: "SELLER_NOT_APPROVED", status: 403 });
    expect(calls).toEqual([
      "begin",
      "lock",
      "quota-lock",
      "count",
      "put",
      "insert",
      "rollback",
      "delete",
    ]);
    expect(storage.delete).toHaveBeenCalledWith(KEY);
  });

  it("deletes the stored bytes when the insert fails, and passes the error on", async () => {
    insertMock.mockImplementationOnce(async () => {
      throw new Error("database down");
    });
    const storage = fakeStorage();
    await expect(createUpload(seller(), IMAGE, { storage, newKey: () => KEY })).rejects.toThrow(
      "database down",
    );
    expect(storage.delete).toHaveBeenCalledWith(KEY);
  });

  it("does not delete when storing itself failed, and logs a failed deletion by key only", async () => {
    const storage = fakeStorage();
    storage.put.mockRejectedValueOnce(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
    await expect(createUpload(seller(), IMAGE, { storage })).rejects.toThrow("disk full");
    expect(storage.delete).not.toHaveBeenCalled();

    insertMock.mockImplementationOnce(async () => false);
    const warn = vi.fn();
    const failing = fakeStorage();
    failing.delete.mockRejectedValueOnce(new Error("EPERM"));
    await expect(
      createUpload(seller(), IMAGE, { storage: failing, log: { warn }, newKey: () => KEY }),
    ).rejects.toMatchObject({ code: "SELLER_NOT_APPROVED" });
    expect(warn).toHaveBeenCalledWith(expect.any(String), { storageKey: KEY });
  });

  it("refuses an image the reader did not check, as a programming error", async () => {
    for (const image of [
      { contentType: "image/gif", bytes: jpegBytes() },
      { contentType: "image/jpeg", bytes: new Uint8Array(0) },
      { contentType: "image/jpeg", bytes: new Uint8Array(5_242_881) },
    ]) {
      await expect(
        createUpload(seller(), image as never, { storage: fakeStorage() }),
      ).rejects.toBeInstanceOf(TypeError);
    }
    expect(calls).toEqual([]);
  });
});

describe("openFile", () => {
  it.each([
    "../../etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    "test-upload-1",
    KEY.toUpperCase(),
    `${KEY}.jpg`,
    `${KEY}/`,
    "",
  ])("is 404 for %j without a lookup or a read", async (key) => {
    const storage = fakeStorage(jpegBytes());
    await expect(openFile(key, { storage })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(findMock).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("is 404 for a key with no upload row, without reading storage", async () => {
    const storage = fakeStorage(jpegBytes());
    await expect(openFile(KEY, { storage })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("serves the bytes with the recorded type and size", async () => {
    findMock.mockResolvedValueOnce({ contentType: "image/png", sizeBytes: 64, ...servable });
    const file = await openFile(KEY, { storage: fakeStorage(jpegBytes(64)) });
    expect(file.contentType).toBe("image/png");
    expect(file.sizeBytes).toBe(64);
    expect(new Uint8Array(await new Response(file.body).arrayBuffer())).toHaveLength(64);
    expect(findMock).toHaveBeenCalledWith(KEY, ORPHAN_GRACE_PERIOD_SECONDS);
  });

  it("SEC-065: is 404 for an expired orphan, without reading storage or logging", async () => {
    const warn = vi.fn();
    const storage = fakeStorage(jpegBytes(64));
    findMock.mockResolvedValueOnce({
      contentType: "image/jpeg",
      sizeBytes: 64,
      expiredOrphan: true,
    });
    await expect(openFile(KEY, { storage, log: { warn } })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(storage.get).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("is 404 with a warn line when the bytes are missing or have another length", async () => {
    const warn = vi.fn();
    findMock.mockResolvedValueOnce({ contentType: "image/jpeg", sizeBytes: 64, ...servable });
    await expect(
      openFile(KEY, { storage: fakeStorage(null), log: { warn } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    findMock.mockResolvedValueOnce({ contentType: "image/jpeg", sizeBytes: 10, ...servable });
    await expect(
      openFile(KEY, { storage: fakeStorage(jpegBytes(64)), log: { warn } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    findMock.mockResolvedValueOnce({ contentType: "text/html", sizeBytes: 64, ...servable });
    await expect(
      openFile(KEY, { storage: fakeStorage(jpegBytes(64)), log: { warn } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(warn).toHaveBeenCalledTimes(3);
    for (const call of warn.mock.calls) expect(call[1]).toEqual({ storageKey: KEY });
  });
});
