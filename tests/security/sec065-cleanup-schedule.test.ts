/**
 * Security review of the scheduled upload orphan cleanup (SEC-065 item 1, wiring commit 37d07c8 and
 * fixes 5b03eac), 2026-10-20. Owner: security. Review: docs/reviews/SEC-065-cleanup-security.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * No database: the row deletion is replaced by a stub, and the real local disk adapter works on a
 * temporary directory. The database side (locks, grace period, references, two runs at once) is
 * in sec065-recheck.itest.ts.
 *
 *   it(...)        behaviour checked on 2026-10-20 that holds, or a documented behaviour. A failure
 *                  is a regression or a changed behaviour to re-read.
 *   it.fails(...)  an OPEN finding (SEC-073). The body asserts the secure behaviour, so it is
 *                  reported as an expected failure while the flaw exists. The owner of the fix
 *                  changes `it.fails` to `it`, and the security agent re-checks the change.
 */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));
// The repository's serving lookup imports the visibility rule, which reads the client's enums.
vi.mock("@/modules/catalog/visibility", () => ({
  PUBLIC_STORE_WHERE: {},
  VISIBLE_PRODUCT_SQL: {},
}));

const { cleanUpExpiredOrphans } = await import("@/modules/uploads/cleanup");
const { generateStorageKey, LocalDiskStorage } = await import("@/modules/uploads/storage");

let base: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "sec073-"));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

function rowStub(keys: string[]) {
  return vi.fn(async (): Promise<string[]> => keys.splice(0, keys.length));
}

describe("SEC-073 a storage root that is missing or wrong is reported as a successful cleanup", () => {
  it("(documented) root does not exist: the rows are deleted, every file counts as deleted, no warn line", async () => {
    const missingRoot = join(base, "not-mounted");
    const keys = [generateStorageKey(), generateStorageKey()];
    const deleteRows = rowStub([...keys]);
    const warn = vi.fn();
    const result = await cleanUpExpiredOrphans({
      storage: new LocalDiskStorage(missingRoot),
      log: { warn },
      deleteRows,
    });
    expect(deleteRows).toHaveBeenCalled();
    expect(result).toEqual({ rowsDeleted: 2, filesDeleted: 2, filesFailed: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it.fails(
    "SEC-073: when the storage root does not exist, no row is deleted (the run stops or throws first)",
    async () => {
      const missingRoot = join(base, "not-mounted-2");
      const deleteRows = rowStub([generateStorageKey()]);
      await cleanUpExpiredOrphans({
        storage: new LocalDiskStorage(missingRoot),
        log: { warn: vi.fn() },
        deleteRows,
      }).catch(() => undefined);
      expect(deleteRows).not.toHaveBeenCalled();
    },
  );

  it("(documented) root is the file system root: every delete is refused, rows are still deleted, one warn line per key", async () => {
    const fsRoot = parse(base).root;
    const keys = [generateStorageKey(), generateStorageKey()];
    const warn = vi.fn();
    const result = await cleanUpExpiredOrphans({
      storage: new LocalDiskStorage(fsRoot),
      log: { warn },
      deleteRows: rowStub([...keys]),
    });
    expect(result).toEqual({ rowsDeleted: 2, filesDeleted: 0, filesFailed: 2 });
    expect(warn).toHaveBeenCalledTimes(2);
    for (const call of warn.mock.calls)
      expect(Object.keys(call[1] as object)).toEqual(["storageKey"]);
  });
});

describe("SEC-065 cleanup: blast radius of the storage root", () => {
  it("deletes only <root>/<two digits>/<key> for keys the rows returned; a sibling file and a file of another name in the same directory are kept", async () => {
    const root = join(base, "radius");
    const storage = new LocalDiskStorage(root);
    const key = generateStorageKey();
    await storage.put(key, new Uint8Array([1, 2, 3]));
    const directory = join(root, key.slice(0, 2));
    await writeFile(join(directory, `${key}.bak`), "keep");
    await writeFile(join(root, key), "keep");
    const result = await cleanUpExpiredOrphans({ storage, deleteRows: rowStub([key]) });
    expect(result).toEqual({ rowsDeleted: 1, filesDeleted: 1, filesFailed: 0 });
    expect(await storage.get(key)).toBeNull();
    expect(await readFile(join(directory, `${key}.bak`), "utf8")).toBe("keep");
    expect(await readFile(join(root, key), "utf8")).toBe("keep");
  });

  it("a link at the key's own path is removed, its target is kept (unlink does not follow the last component)", async (context) => {
    const root = join(base, "link-file");
    const key = generateStorageKey();
    const directory = join(root, key.slice(0, 2));
    await mkdir(directory, { recursive: true });
    const target = join(base, "link-file-target");
    await writeFile(target, "keep");
    try {
      await symlink(target, join(directory, key), "file");
    } catch {
      // Windows without the symlink privilege: the case cannot be set up here.
      context.skip();
    }
    await cleanUpExpiredOrphans({
      storage: new LocalDiskStorage(root),
      deleteRows: rowStub([key]),
    });
    expect(await readFile(target, "utf8")).toBe("keep");
  });

  it("(documented) a two-digit directory that is a link or junction is followed: a file named by the key outside the root is deleted", async (context) => {
    const root = join(base, "link-dir");
    await mkdir(root, { recursive: true });
    const key = generateStorageKey();
    const outside = join(base, "outside-dir");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, key), "outside");
    try {
      await symlink(outside, join(root, key.slice(0, 2)), "junction");
    } catch {
      context.skip();
    }
    const result = await cleanUpExpiredOrphans({
      storage: new LocalDiskStorage(root),
      deleteRows: rowStub([key]),
    });
    expect(result.filesDeleted).toBe(1);
    await expect(readFile(join(outside, key), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("SEC-065 cleanup: bounded work per run", () => {
  it("never asks for more than maxBatches * batchSize rows and never lists a directory", async () => {
    const asked: number[] = [];
    const storage = {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(async () => undefined),
    };
    const result = await cleanUpExpiredOrphans({
      storage,
      batchSize: 3,
      maxBatches: 4,
      deleteRows: async (_grace, limit) => {
        asked.push(limit);
        return Array.from({ length: limit }, () => generateStorageKey());
      },
    });
    expect(asked).toEqual([3, 3, 3, 3]);
    expect(result.rowsDeleted).toBe(12);
    expect(storage.delete).toHaveBeenCalledTimes(12);
    expect(storage.get).not.toHaveBeenCalled();
    const source = await readFile(join(process.cwd(), "src/modules/uploads/cleanup.ts"), "utf8");
    // The job reaches the disk only through `storage.delete(key)`: no file system import, no listing.
    expect(source).not.toMatch(/readdir|opendir|from "(node:)?fs(\/promises)?"/);
  });
});
