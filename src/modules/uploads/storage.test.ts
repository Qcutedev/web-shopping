import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getUploadStorage, readUploadDir, UploadStorageNotConfiguredError } from "./config";
import { STORAGE_KEY_PATTERN } from "./schema";
import { generateStorageKey, LocalDiskStorage } from "./storage";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "uploads-unit-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("generateStorageKey", () => {
  it("makes 32 lower-case hexadecimal digits, different every time", () => {
    const keys = new Set(Array.from({ length: 1_000 }, () => generateStorageKey()));
    expect(keys.size).toBe(1_000);
    for (const key of keys) expect(key).toMatch(STORAGE_KEY_PATTERN);
  });
});

describe("LocalDiskStorage", () => {
  it("stores, reads back, and deletes a file under <root>/<two digits>/<key>", async () => {
    const storage = new LocalDiskStorage(root);
    const key = generateStorageKey();
    await storage.put(key, Uint8Array.from([1, 2, 3]));
    expect(await readFile(join(root, key.slice(0, 2), key))).toEqual(Buffer.from([1, 2, 3]));
    const object = await storage.get(key);
    expect(object?.sizeBytes).toBe(3);
    expect(Array.from(await readAll(object!.body))).toEqual([1, 2, 3]);
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    await storage.delete(key); // no object is not an error
  });

  it("never overwrites an existing object", async () => {
    const storage = new LocalDiskStorage(root);
    const key = generateStorageKey();
    await storage.put(key, Uint8Array.from([1]));
    await expect(storage.put(key, Uint8Array.from([2]))).rejects.toMatchObject({ code: "EEXIST" });
    expect(Array.from(await readAll((await storage.get(key))!.body))).toEqual([1]);
  });

  it("returns null for a key with no object", async () => {
    expect(await new LocalDiskStorage(root).get(generateStorageKey())).toBeNull();
  });

  it.each([
    "../../etc/passwd",
    "..",
    "a/b",
    "ABCDEF0123456789ABCDEF0123456789",
    `${"0".repeat(31)}/`,
    "0".repeat(33),
    "",
  ])("refuses the key %j in every operation without touching the disk", async (key) => {
    const storage = new LocalDiskStorage(root);
    await expect(storage.put(key, Uint8Array.from([1]))).rejects.toBeInstanceOf(TypeError);
    await expect(storage.get(key)).rejects.toBeInstanceOf(TypeError);
    await expect(storage.delete(key)).rejects.toBeInstanceOf(TypeError);
    expect(await readdir(root)).toEqual([]);
  });

  it("does not serve a directory in place of a file", async () => {
    const storage = new LocalDiskStorage(root);
    const key = generateStorageKey();
    await storage.put(key, Uint8Array.from([1]));
    await storage.delete(key);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, key.slice(0, 2), key));
    expect(await storage.get(key)).toBeNull();
  });

  it("refuses a relative root", () => {
    expect(() => new LocalDiskStorage("relative/dir")).toThrow(TypeError);
    expect(() => new LocalDiskStorage("")).toThrow(TypeError);
  });

  it("leaves a file written outside it alone (the root is the only place it touches)", async () => {
    const outside = join(root, "outside.txt");
    await writeFile(outside, "keep");
    const storage = new LocalDiskStorage(join(root, "store"));
    const key = generateStorageKey();
    await storage.put(key, Uint8Array.from([9]));
    expect(await readFile(outside, "utf8")).toBe("keep");
    expect((await readdir(root)).sort()).toEqual(["outside.txt", "store"]);
  });
});

describe("UPLOAD_DIR", () => {
  it("must be an absolute path; the error names the variable, never the value", () => {
    for (const value of [undefined, "", "   ", "relative/secret-dir"]) {
      let error: unknown;
      try {
        readUploadDir({ UPLOAD_DIR: value });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(UploadStorageNotConfiguredError);
      expect(String((error as Error).message)).toContain("UPLOAD_DIR");
      expect(String((error as Error).message)).not.toContain("secret-dir");
    }
  });

  it("builds the local disk storage on the configured directory", () => {
    const storage = getUploadStorage({ UPLOAD_DIR: root });
    expect(storage).toBeInstanceOf(LocalDiskStorage);
    expect((storage as LocalDiskStorage).root).toBe(root);
  });
});
