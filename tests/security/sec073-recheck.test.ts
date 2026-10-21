/**
 * Independent re-check of SEC-073, commit 8a57d53 (2026-10-21): the orphan cleanup checks the
 * storage root and its marker `.marketplace-uploads` before it deletes any row, and counts a file
 * that is already missing as `filesMissing`. Owner: security. Written from SECURITY.md SEC-073
 * "Remediation" and API_CONTRACTS.md section 5.8.1 "Storage check first", not from the fix's own
 * cases (src/modules/uploads/cleanup.test.ts, storage.test.ts,
 * tests/security/sec065-cleanup-schedule.test.ts).
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)  behaviour checked on 2026-10-21 that holds. A failure is a regression. A case named
 *            "(documented)" shows a residual the owner decides on (SECURITY.md, residual risks):
 *            a failure there means the behaviour changed and the residual needs a re-read.
 */
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "@/server/logger";

vi.mock("@/server/db", () => ({ db: {} }));
// The repository's serving lookup imports the visibility rule, which reads the client's enums.
vi.mock("@/modules/catalog/visibility", () => ({
  PUBLIC_STORE_WHERE: {},
  VISIBLE_PRODUCT_SQL: {},
}));

const { cleanUpExpiredOrphans, runUploadCleanup } = await import("@/modules/uploads/cleanup");
const { generateStorageKey, LocalDiskStorage, UPLOAD_ROOT_MARKER } =
  await import("@/modules/uploads/storage");

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "sec073-recheck-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function fakeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger & {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

describe("SEC-073 re-check: a root that is not the upload store", () => {
  for (const [name, prepare] of [
    ["missing", async (root: string) => root],
    [
      "an empty directory (an unmounted mount point)",
      async (root: string) => {
        await mkdir(root, { recursive: true });
        return root;
      },
    ],
    [
      "a directory with files but no marker",
      async (root: string) => {
        await mkdir(join(root, "ab"), { recursive: true });
        return root;
      },
    ],
  ] as const) {
    it(`${name}: one error line with the class only, no info line, no row deleted, no path logged`, async () => {
      const root = await prepare(join(base, "uploads"));
      const deleteRows = vi.fn(async () => [generateStorageKey()]);
      const log = fakeLogger();
      const result = await runUploadCleanup(log, () =>
        cleanUpExpiredOrphans({ storage: new LocalDiskStorage(root), log, deleteRows }),
      );
      expect(result).toBeUndefined();
      expect(deleteRows).not.toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalled();
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error.mock.calls[0]?.[1]).toEqual({
        component: "upload-cleanup",
        errorClass: "UploadStorageNotReadyError",
      });
      const everything = JSON.stringify([log.error.mock.calls, log.warn.mock.calls]);
      expect(everything).not.toContain(base);
      expect(everything).not.toContain(base.replaceAll("\\", "\\\\"));
    });
  }

  it("a storage adapter without assertReady is refused before any row (no silent pass)", async () => {
    const deleteRows = vi.fn(async () => [generateStorageKey()]);
    const storage = { put: vi.fn(), get: vi.fn(), delete: vi.fn(async () => true) };
    await expect(cleanUpExpiredOrphans({ storage, deleteRows })).rejects.toThrow();
    expect(deleteRows).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("an assertReady that throws its own error class still deletes no row", async () => {
    const deleteRows = vi.fn(async () => [generateStorageKey()]);
    const storage = {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(async () => true),
      assertReady: vi.fn(async () => {
        throw new Error("bucket unreachable");
      }),
    };
    await expect(cleanUpExpiredOrphans({ storage, deleteRows })).rejects.toThrow();
    expect(deleteRows).not.toHaveBeenCalled();
  });
});

describe("SEC-073 re-check: a marked root whose files are gone", () => {
  it("rows are deleted, every file is counted missing, one warn line with the count and no key", async () => {
    const root = join(base, "marked");
    await new LocalDiskStorage(root).prepareRoot();
    const keys = [generateStorageKey(), generateStorageKey(), generateStorageKey()];
    const log = fakeLogger();
    const result = await runUploadCleanup(log, () =>
      cleanUpExpiredOrphans({
        storage: new LocalDiskStorage(root),
        log,
        deleteRows: vi.fn(async () => keys.splice(0, keys.length)),
      }),
    );
    expect(result).toEqual({ rowsDeleted: 3, filesDeleted: 0, filesMissing: 3, filesFailed: 0 });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[1]).toEqual({ filesMissing: 3 });
    expect(log.info.mock.calls[0]?.[1]).toMatchObject({ filesMissing: 3 });
  });
});

describe("SEC-073 residual (owner decision): an upload into an empty mount point marks it", () => {
  it("(documented) the first put into an unmounted, empty mount point writes the marker, and the cleanup then runs there", async () => {
    const mountPoint = join(base, "mnt-uploads");
    await mkdir(mountPoint, { recursive: true });
    const storage = new LocalDiskStorage(mountPoint);
    await expect(storage.assertReady()).rejects.toThrow();
    await storage.put(generateStorageKey(), Uint8Array.from([1]));
    expect(await readdir(mountPoint)).toContain(UPLOAD_ROOT_MARKER);
    await expect(storage.assertReady()).resolves.toBeUndefined();
    const deleteRows = vi.fn(async (): Promise<string[]> => []);
    await cleanUpExpiredOrphans({ storage, deleteRows });
    expect(deleteRows).toHaveBeenCalled();
  });
});
