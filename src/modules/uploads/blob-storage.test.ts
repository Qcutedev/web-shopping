/**
 * VercelBlobStorage (D-051) against an in-memory stand-in for @vercel/blob. No network, no real
 * token: the library module is replaced as a whole, so a request can never leave the process.
 */
import { inspect } from "node:util";

import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => {
  class BlobNotFoundError extends Error {
    constructor() {
      super("Vercel Blob: The requested blob does not exist");
    }
  }
  const objects = new Map<string, Uint8Array>();
  const toBytes = (body: unknown): Uint8Array => {
    if (typeof body === "string") return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return Uint8Array.from(body);
    throw new TypeError("fake put: unexpected body type");
  };
  return {
    BlobNotFoundError,
    objects,
    head: vi.fn<
      (
        pathname: string,
        options?: Record<string, unknown>,
      ) => Promise<{ pathname: string; size: number }>
    >(async (pathname) => {
      const object = objects.get(pathname);
      if (object === undefined) throw new BlobNotFoundError();
      return { pathname, size: object.byteLength };
    }),
    put: vi.fn(async (pathname: string, body: unknown, options: Record<string, unknown>) => {
      if (options.allowOverwrite !== true && objects.has(pathname)) {
        throw new Error("Vercel Blob: This blob already exists");
      }
      objects.set(pathname, toBytes(body));
      return { pathname };
    }),
    get: vi.fn<
      (
        pathname: string,
        options: Record<string, unknown>,
      ) => Promise<{
        statusCode: 200;
        stream: ReadableStream<Uint8Array>;
        blob: { size: number };
      } | null>
    >(async (pathname) => {
      const object = objects.get(pathname);
      if (object === undefined) return null;
      return {
        statusCode: 200 as const,
        stream: new Response(Uint8Array.from(object)).body!,
        blob: { size: object.byteLength },
      };
    }),
    del: vi.fn<(pathname: string, options?: Record<string, unknown>) => Promise<void>>(
      async (pathname) => {
        objects.delete(pathname);
      },
    ),
  };
});

vi.mock("@vercel/blob", () => ({
  BlobNotFoundError: blob.BlobNotFoundError,
  head: blob.head,
  put: blob.put,
  get: blob.get,
  del: blob.del,
}));

const { BLOB_MARKER_PATHNAME, BLOB_PATH_PREFIX, VercelBlobStorage } =
  await import("./blob-storage");
const { generateStorageKey, LocalDiskStorage, UploadStorageNotReadyError } =
  await import("./storage");
const { getUploadStorage, readBlobToken, UploadStorageNotConfiguredError } =
  await import("./config");
const { cleanUpExpiredOrphans } = await import("./cleanup");

// Made up, and assembled at run time so no token-shaped literal is in the repository.
const SECRET_PART = "Zq7canaryFakeSecret0123";
const TOKEN = ["vercel", "blob", "rw", "TestStore01", SECRET_PART].join("_");

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  return Array.from(new Uint8Array(await new Response(stream).arrayBuffer()));
}

function sdkCallCount(): number {
  return (
    blob.head.mock.calls.length +
    blob.put.mock.calls.length +
    blob.get.mock.calls.length +
    blob.del.mock.calls.length
  );
}

beforeEach(() => {
  blob.objects.clear();
  vi.clearAllMocks();
});

describe("VercelBlobStorage", () => {
  it("stores a private object under uploads/<key>, reads it back, and deletes it", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    const key = generateStorageKey();
    await storage.put(key, Uint8Array.from([1, 2, 3]));

    const objectPut = blob.put.mock.calls.find(([pathname]) => pathname === `uploads/${key}`);
    expect(objectPut?.[2]).toMatchObject({
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/octet-stream",
      token: TOKEN,
    });
    expect(objectPut?.[2].abortSignal).toBeInstanceOf(AbortSignal);
    expect(Array.from(blob.objects.get(`${BLOB_PATH_PREFIX}${key}`)!)).toEqual([1, 2, 3]);

    const object = await storage.get(key);
    expect(object?.sizeBytes).toBe(3);
    expect(await readAll(object!.body)).toEqual([1, 2, 3]);
    expect(blob.get.mock.calls[0]?.[1]).toMatchObject({
      access: "private",
      token: TOKEN,
      headers: { "accept-encoding": "identity" },
    });

    expect(await storage.delete(key)).toBe(true);
    expect(blob.del).toHaveBeenCalledWith(
      `uploads/${key}`,
      expect.objectContaining({ token: TOKEN }),
    );
    expect(await storage.get(key)).toBeNull();
  });

  it("passes the token explicitly to every library call", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    const key = generateStorageKey();
    await storage.put(key, Uint8Array.from([1]));
    await storage.get(key);
    await storage.delete(key);
    await storage.assertReady();
    for (const call of [
      ...blob.head.mock.calls.map((args) => args[1]),
      ...blob.put.mock.calls.map((args) => args[2]),
      ...blob.get.mock.calls.map((args) => args[1]),
      ...blob.del.mock.calls.map((args) => args[1]),
    ]) {
      expect(call).toMatchObject({ token: TOKEN });
    }
  });

  it("stores only the bytes of the view it is given", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    const key = generateStorageKey();
    const backing = Uint8Array.from([9, 9, 4, 5, 6, 9]);
    await storage.put(key, backing.subarray(2, 5));
    expect(Array.from(blob.objects.get(`uploads/${key}`)!)).toEqual([4, 5, 6]);
  });

  it("never overwrites an existing object and deletes nothing when the write is refused", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    const key = generateStorageKey();
    await storage.put(key, Uint8Array.from([1]));
    await expect(storage.put(key, Uint8Array.from([2]))).rejects.toThrow("already exists");
    expect(blob.del).not.toHaveBeenCalled();
    expect(await readAll((await storage.get(key))!.body)).toEqual([1]);
  });

  it("returns null for a key with no object, and delete of it resolves false without a delete request", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    const key = generateStorageKey();
    expect(await storage.get(key)).toBeNull();
    expect(await storage.delete(key)).toBe(false);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it.each([
    "../../etc/passwd",
    "..",
    "a/b",
    "ABCDEF0123456789ABCDEF0123456789",
    `${"0".repeat(31)}/`,
    "0".repeat(33),
    "",
  ])("refuses the key %j in every operation without a library call", async (key) => {
    const storage = new VercelBlobStorage(TOKEN);
    await expect(storage.put(key, Uint8Array.from([1]))).rejects.toBeInstanceOf(TypeError);
    await expect(storage.get(key)).rejects.toBeInstanceOf(TypeError);
    await expect(storage.delete(key)).rejects.toBeInstanceOf(TypeError);
    expect(sdkCallCount()).toBe(0);
  });

  it("refuses a token of the wrong form; the error holds no part of it", () => {
    for (const value of [
      "",
      SECRET_PART,
      `vercel_blob_rw__${SECRET_PART}`,
      `vercel_blob_rw_Store.evil.example_${SECRET_PART}`,
      `vercel_blob_rw_Store01_${SECRET_PART} x`,
      `vercel_blob_ro_Store01_${SECRET_PART}`,
    ]) {
      let error: unknown;
      try {
        new VercelBlobStorage(value);
      } catch (caught) {
        error = caught;
      }
      expect(error, value).toBeInstanceOf(TypeError);
      expect(String((error as Error).message)).not.toContain("Zq7canary");
    }
  });

  it("keeps the token out of JSON and out of an inspected object", () => {
    const storage = new VercelBlobStorage(TOKEN);
    expect(JSON.stringify(storage)).not.toContain(SECRET_PART);
    expect(inspect(storage, { depth: 5, showHidden: true })).not.toContain(SECRET_PART);
  });

  it("passes on a library error from a read and from a delete", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    const key = generateStorageKey();
    blob.get.mockRejectedValueOnce(new Error("Vercel Blob: Failed to fetch blob: 500"));
    await expect(storage.get(key)).rejects.toThrow("Failed to fetch blob");

    await storage.put(key, Uint8Array.from([1]));
    blob.del.mockRejectedValueOnce(new Error("Vercel Blob: service unavailable"));
    await expect(storage.delete(key)).rejects.toThrow("service unavailable");
  });

  it("treats a read answered without a body as an error, not as a missing object", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    blob.get.mockResolvedValueOnce({
      statusCode: 304,
      stream: null,
      blob: { size: null },
    } as never);
    await expect(storage.get(generateStorageKey())).rejects.toThrow("without a body");
  });
});

describe("VercelBlobStorage: SEC-073 marker", () => {
  it("the first put writes the marker; assertReady passes only with it", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    await expect(storage.assertReady()).rejects.toBeInstanceOf(UploadStorageNotReadyError);
    await storage.put(generateStorageKey(), Uint8Array.from([1]));
    expect(blob.objects.has(BLOB_MARKER_PATHNAME)).toBe(true);
    expect(BLOB_MARKER_PATHNAME).toBe("uploads/.marketplace-uploads");
    const markerPut = blob.put.mock.calls.find(([pathname]) => pathname === BLOB_MARKER_PATHNAME);
    expect(markerPut?.[2]).toMatchObject({ access: "private", allowOverwrite: false });
    await expect(storage.assertReady()).resolves.toBeUndefined();
  });

  it("keeps an existing marker and checks it once per adapter", async () => {
    blob.objects.set(BLOB_MARKER_PATHNAME, Uint8Array.from([7]));
    const storage = new VercelBlobStorage(TOKEN);
    await storage.put(generateStorageKey(), Uint8Array.from([1]));
    await storage.put(generateStorageKey(), Uint8Array.from([2]));
    expect(Array.from(blob.objects.get(BLOB_MARKER_PATHNAME)!)).toEqual([7]);
    expect(blob.put.mock.calls.filter(([p]) => p === BLOB_MARKER_PATHNAME)).toHaveLength(0);
    expect(blob.head.mock.calls.filter(([p]) => p === BLOB_MARKER_PATHNAME)).toHaveLength(1);
  });

  it("accepts a marker written by another instance between the look-up and the write", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    blob.put.mockImplementationOnce(async (pathname: string) => {
      blob.objects.set(pathname, Uint8Array.from([1]));
      throw new Error("Vercel Blob: This blob already exists");
    });
    const key = generateStorageKey();
    await storage.put(key, Uint8Array.from([5]));
    expect(Array.from(blob.objects.get(`uploads/${key}`)!)).toEqual([5]);
  });

  it("stores no object when the marker cannot be written", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    blob.put.mockRejectedValueOnce(new Error("Vercel Blob: Access denied"));
    const key = generateStorageKey();
    await expect(storage.put(key, Uint8Array.from([5]))).rejects.toThrow("Access denied");
    expect(blob.objects.size).toBe(0);
  });

  it("assertReady refuses when the store cannot be reached; the error names nothing of it", async () => {
    blob.objects.set(BLOB_MARKER_PATHNAME, Uint8Array.from([1]));
    const storage = new VercelBlobStorage(TOKEN);
    blob.head.mockRejectedValueOnce(new Error(`network down ${TOKEN}`));
    const error = await storage.assertReady().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UploadStorageNotReadyError);
    expect(JSON.stringify([String(error), (error as Error).stack])).not.toContain(SECRET_PART);
  });

  it("the orphan cleanup deletes no row on a store without the marker", async () => {
    const deleteRows = vi.fn(async () => [generateStorageKey()]);
    await expect(
      cleanUpExpiredOrphans({ storage: new VercelBlobStorage(TOKEN), deleteRows }),
    ).rejects.toBeInstanceOf(UploadStorageNotReadyError);
    expect(deleteRows).not.toHaveBeenCalled();
  });

  it("the orphan cleanup counts a missing object as filesMissing and a present one as deleted", async () => {
    const storage = new VercelBlobStorage(TOKEN);
    const present = generateStorageKey();
    await storage.put(present, Uint8Array.from([1]));
    const missing = generateStorageKey();
    const deleteRows = vi.fn(async () => [present, missing]);
    const result = await cleanUpExpiredOrphans({ storage, deleteRows, batchSize: 100 });
    expect(result).toEqual({ rowsDeleted: 2, filesDeleted: 1, filesMissing: 1, filesFailed: 0 });
    expect(blob.objects.has(`uploads/${present}`)).toBe(false);
  });
});

describe("getUploadStorage: storage selection (D-051)", () => {
  const uploadDir = process.platform === "win32" ? "C:\\srv\\uploads" : "/srv/uploads";

  it("uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set", () => {
    expect(getUploadStorage({ BLOB_READ_WRITE_TOKEN: TOKEN })).toBeInstanceOf(VercelBlobStorage);
  });

  it("uses the local disk when the token is not set or empty", () => {
    for (const token of [undefined, ""]) {
      const storage = getUploadStorage({ BLOB_READ_WRITE_TOKEN: token, UPLOAD_DIR: uploadDir });
      expect(storage).toBeInstanceOf(LocalDiskStorage);
    }
  });

  it("keeps one Blob adapter per token", () => {
    const first = getUploadStorage({ BLOB_READ_WRITE_TOKEN: TOKEN });
    expect(getUploadStorage({ BLOB_READ_WRITE_TOKEN: TOKEN })).toBe(first);
    const other = ["vercel", "blob", "rw", "OtherStore", SECRET_PART].join("_");
    expect(getUploadStorage({ BLOB_READ_WRITE_TOKEN: other })).not.toBe(first);
  });

  it("refuses both storages at once, and a malformed token; no value in the error", () => {
    const cases: [Record<string, string>, string][] = [
      [{ BLOB_READ_WRITE_TOKEN: TOKEN, UPLOAD_DIR: uploadDir }, "both"],
      [{ BLOB_READ_WRITE_TOKEN: `x${SECRET_PART}` }, "blob-token"],
      [{ BLOB_READ_WRITE_TOKEN: `x${SECRET_PART}`, UPLOAD_DIR: uploadDir }, "blob-token"],
      [{}, "upload-dir"],
    ];
    for (const [source, problem] of cases) {
      let error: unknown;
      try {
        getUploadStorage(source);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(UploadStorageNotConfiguredError);
      expect((error as InstanceType<typeof UploadStorageNotConfiguredError>).problem).toBe(problem);
      expect(String((error as Error).message)).not.toContain("Zq7canary");
    }
    expect(sdkCallCount()).toBe(0);
  });

  it("readBlobToken counts an empty value as not set", () => {
    expect(readBlobToken({ BLOB_READ_WRITE_TOKEN: "" })).toBeUndefined();
    expect(readBlobToken({})).toBeUndefined();
    expect(readBlobToken({ BLOB_READ_WRITE_TOKEN: TOKEN })).toBe(TOKEN);
  });
});
