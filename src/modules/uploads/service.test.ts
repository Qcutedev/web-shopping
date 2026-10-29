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
type FoundRow = {
  id?: string;
  storeId?: string;
  contentType: string;
  sizeBytes: number;
  expiredOrphan: boolean;
  publicPicture?: boolean;
  productPicture?: boolean;
  isLogo?: boolean;
} | null;
const findMock = vi.fn<(...args: unknown[]) => Promise<FoundRow>>(async () => null);
const publicLogoMock = vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => false);
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
  isLogoOfPublicStore: (...args: unknown[]) => publicLogoMock(...args),
  lockStoreUploads: (...args: unknown[]) => quotaLockMock(...args),
  countUnreferencedUploads: (...args: unknown[]) => countMock(...args),
}));

const { assertUploadAllowance, createUpload, mayServe, openFile } = await import("./service");
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
  publicLogoMock.mockReset();
  publicLogoMock.mockResolvedValue(false);
});

/** A registered upload of store-1 that anyone may read (a picture of a visible product). */
const servable = {
  id: "upload-1",
  storeId: "store-1",
  expiredOrphan: false,
  publicPicture: true,
  productPicture: true,
  isLogo: false,
};

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
      { contentType: "image/jpeg", bytes: new Uint8Array(4_194_305) },
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

describe("SEC-068: who may read a file (mayServe)", () => {
  const owner = seller();
  const suspendedOwner = seller("SUSPENDED");
  const otherSeller: Actor = { ...seller(), userId: "user-2", storeId: "store-2" };
  const customer: Actor = { userId: "user-3", role: "CUSTOMER", storeId: null, storeStatus: null };
  const admin: Actor = { userId: "user-4", role: "ADMIN", storeId: null, storeStatus: null };
  // Against the data model, but the role is what is judged: a non-seller with the store id.
  const customerWithStore: Actor = { ...customer, storeId: "store-1" };

  // Against the data model, but the role is what is judged: an admin with the store id.
  const adminWithStore: Actor = { ...admin, storeId: "store-1" };

  it("a public file is served to everyone, anonymous included", () => {
    for (const isProductPicture of [true, false]) {
      const file = { storeId: "store-1", isPublic: true, isProductPicture };
      for (const who of [null, owner, otherSeller, customer, admin]) {
        expect(mayServe(file, who)).toBe(true);
      }
    }
  });

  it("a file that is not public and attached to no product: only a SELLER of the owning store, suspended or not", () => {
    const file = { storeId: "store-1", isPublic: false, isProductPicture: false };
    expect(mayServe(file, owner)).toBe(true);
    expect(mayServe(file, suspendedOwner)).toBe(true);
    for (const who of [null, otherSeller, customer, admin, adminWithStore, customerWithStore]) {
      expect(mayServe(file, who)).toBe(false);
    }
  });

  it("BR-41: a product picture that is not public: the owning SELLER and any ADMIN, nobody else", () => {
    const file = { storeId: "store-1", isPublic: false, isProductPicture: true };
    expect(mayServe(file, owner)).toBe(true);
    expect(mayServe(file, suspendedOwner)).toBe(true);
    expect(mayServe(file, admin)).toBe(true);
    for (const who of [null, otherSeller, customer, customerWithStore]) {
      expect(mayServe(file, who)).toBe(false);
    }
  });
});

describe("SEC-068: openFile serves a file that is not public only to its owner", () => {
  // Not public and attached to no product (an unattached upload, or a logo).
  const notPublic = { ...servable, publicPicture: false, productPicture: false };
  // BR-41: not public, attached to a product that is not visible.
  const hiddenPicture = { ...servable, publicPicture: false, productPicture: true };
  const admin: Actor = { userId: "user-4", role: "ADMIN", storeId: null, storeStatus: null };
  const resolver = (who: Actor | null) => vi.fn(async () => who);

  it("a public picture is served without asking for the session", async () => {
    findMock.mockResolvedValueOnce({ contentType: "image/jpeg", sizeBytes: 64, ...servable });
    const resolve = resolver(null);
    await openFile(KEY, { storage: fakeStorage(jpegBytes(64)) }, resolve);
    expect(resolve).not.toHaveBeenCalled();
    expect(publicLogoMock).not.toHaveBeenCalled();
  });

  it("not public: anonymous (the default too), another seller, a customer, an admin are 404 without reading storage or logging", async () => {
    const warn = vi.fn();
    const others: (Actor | null)[] = [
      null,
      { ...seller(), userId: "user-2", storeId: "store-2" },
      { userId: "user-3", role: "CUSTOMER", storeId: null, storeStatus: null },
      { userId: "user-4", role: "ADMIN", storeId: null, storeStatus: null },
    ];
    for (const who of others) {
      const storage = fakeStorage(jpegBytes(64));
      findMock.mockResolvedValueOnce({ contentType: "image/jpeg", sizeBytes: 64, ...notPublic });
      await expect(openFile(KEY, { storage, log: { warn } }, resolver(who))).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
        details: {},
      });
      expect(storage.get).not.toHaveBeenCalled();
    }
    const storage = fakeStorage(jpegBytes(64));
    findMock.mockResolvedValueOnce({ contentType: "image/jpeg", sizeBytes: 64, ...notPublic });
    await expect(openFile(KEY, { storage })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.get).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("not public: the owning seller's session is served", async () => {
    findMock.mockResolvedValueOnce({ contentType: "image/jpeg", sizeBytes: 64, ...notPublic });
    const resolve = resolver(seller("SUSPENDED"));
    const file = await openFile(KEY, { storage: fakeStorage(jpegBytes(64)) }, resolve);
    expect(file.sizeBytes).toBe(64);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("BR-41: a hidden product picture is served to an admin, with the recorded type and size", async () => {
    findMock.mockResolvedValueOnce({ contentType: "image/webp", sizeBytes: 64, ...hiddenPicture });
    const resolve = resolver(admin);
    const file = await openFile(KEY, { storage: fakeStorage(jpegBytes(64)) }, resolve);
    expect(file.contentType).toBe("image/webp");
    expect(file.sizeBytes).toBe(64);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("BR-41: a hidden product picture is still 404 for anonymous, another seller, and a customer", async () => {
    const warn = vi.fn();
    for (const who of [
      null,
      { ...seller(), userId: "user-2", storeId: "store-2" },
      { userId: "user-3", role: "CUSTOMER", storeId: null, storeStatus: null },
    ] satisfies (Actor | null)[]) {
      const storage = fakeStorage(jpegBytes(64));
      findMock.mockResolvedValueOnce({
        contentType: "image/jpeg",
        sizeBytes: 64,
        ...hiddenPicture,
      });
      await expect(openFile(KEY, { storage, log: { warn } }, resolver(who))).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
        details: {},
      });
      expect(storage.get).not.toHaveBeenCalled();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("BR-41: an admin gets 404 for an unattached upload, a logo of a store that is not public, and an expired orphan", async () => {
    for (const row of [
      notPublic,
      { ...notPublic, isLogo: true },
      { ...notPublic, expiredOrphan: true },
    ]) {
      const storage = fakeStorage(jpegBytes(64));
      findMock.mockResolvedValueOnce({ contentType: "image/jpeg", sizeBytes: 64, ...row });
      await expect(openFile(KEY, { storage }, resolver(admin))).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
      expect(storage.get).not.toHaveBeenCalled();
    }
  });

  it("a logo is public only when its store is public; asked for that upload id only", async () => {
    const logo = { ...notPublic, isLogo: true };
    publicLogoMock.mockResolvedValueOnce(true);
    findMock.mockResolvedValueOnce({ contentType: "image/jpeg", sizeBytes: 64, ...logo });
    const resolve = resolver(null);
    await openFile(KEY, { storage: fakeStorage(jpegBytes(64)) }, resolve);
    expect(publicLogoMock).toHaveBeenCalledWith("upload-1");
    expect(resolve).not.toHaveBeenCalled();

    publicLogoMock.mockResolvedValueOnce(false);
    findMock.mockResolvedValueOnce({ contentType: "image/jpeg", sizeBytes: 64, ...logo });
    await expect(
      openFile(KEY, { storage: fakeStorage(jpegBytes(64)) }, resolver(null)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an expired orphan is 404 even for its owner, and the session is not asked", async () => {
    findMock.mockResolvedValueOnce({
      contentType: "image/jpeg",
      sizeBytes: 64,
      ...notPublic,
      expiredOrphan: true,
    });
    const resolve = resolver(seller());
    await expect(
      openFile(KEY, { storage: fakeStorage(jpegBytes(64)) }, resolve),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("an invalid key never asks for the session", async () => {
    const resolve = resolver(seller());
    await expect(
      openFile("../x", { storage: fakeStorage(jpegBytes(64)) }, resolve),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(resolve).not.toHaveBeenCalled();
  });
});
