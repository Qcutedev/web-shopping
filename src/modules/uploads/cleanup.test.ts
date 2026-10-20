/**
 * Unit tests of the orphan cleanup (SEC-065): rows before bytes, batching, a failed file deletion,
 * the log lines, and the schedule. The row deletion is replaced; tests/integration/uploads runs it
 * against PostgreSQL.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "@/server/logger";

vi.mock("@/server/db", () => ({ db: {} }));
// The repository's serving lookup imports the visibility rule, which reads the client's enums.
vi.mock("@/modules/catalog/visibility", () => ({
  PUBLIC_STORE_WHERE: {},
  VISIBLE_PRODUCT_SQL: {},
}));

const {
  cleanUpExpiredOrphans,
  ORPHAN_CLEANUP_BATCH_SIZE,
  ORPHAN_CLEANUP_MAX_BATCHES,
  runUploadCleanup,
  startUploadCleanupSchedule,
  stopUploadCleanupSchedule,
} = await import("./cleanup");
const { ORPHAN_GRACE_PERIOD_SECONDS } = await import("./schema");

const KEY_A = "a".repeat(32);
const KEY_B = "b".repeat(32);

function fakeStorage() {
  return {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn<(key: string) => Promise<void>>(async () => undefined),
  };
}

function fakeLogger() {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  return log as typeof log & Logger;
}

afterEach(() => {
  stopUploadCleanupSchedule();
  vi.useRealTimers();
});

describe("cleanUpExpiredOrphans", () => {
  it("deletes the rows first, then the bytes of exactly the rows deleted", async () => {
    const order: string[] = [];
    const storage = fakeStorage();
    storage.delete.mockImplementation(async (key: string) => {
      order.push(`file ${key}`);
    });
    const deleteRows = vi.fn(async () => {
      order.push("rows");
      return [KEY_A, KEY_B];
    });
    const result = await cleanUpExpiredOrphans({ storage, deleteRows });
    expect(deleteRows).toHaveBeenCalledWith(ORPHAN_GRACE_PERIOD_SECONDS, ORPHAN_CLEANUP_BATCH_SIZE);
    expect(order).toEqual(["rows", `file ${KEY_A}`, `file ${KEY_B}`]);
    expect(result).toEqual({ rowsDeleted: 2, filesDeleted: 2, filesFailed: 0 });
  });

  it("goes on while a batch is full, and stops at the batch limit", async () => {
    const full = vi.fn(async (_grace: number, limit: number) =>
      Array.from({ length: limit }, () => KEY_A),
    );
    const result = await cleanUpExpiredOrphans({ storage: fakeStorage(), deleteRows: full });
    expect(full).toHaveBeenCalledTimes(ORPHAN_CLEANUP_MAX_BATCHES);
    expect(result.rowsDeleted).toBe(ORPHAN_CLEANUP_BATCH_SIZE * ORPHAN_CLEANUP_MAX_BATCHES);

    const twice = vi.fn().mockResolvedValueOnce([KEY_A, KEY_B]).mockResolvedValueOnce([KEY_A]);
    await cleanUpExpiredOrphans({ storage: fakeStorage(), deleteRows: twice, batchSize: 2 });
    expect(twice).toHaveBeenCalledTimes(2);
  });

  it("deletes no file when no row was deleted", async () => {
    const storage = fakeStorage();
    const result = await cleanUpExpiredOrphans({ storage, deleteRows: async () => [] });
    expect(storage.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ rowsDeleted: 0, filesDeleted: 0, filesFailed: 0 });
  });

  it("a failed file deletion is counted, logged with the key only, and does not stop the run", async () => {
    const storage = fakeStorage();
    storage.delete.mockRejectedValueOnce(
      Object.assign(new Error("EPERM /srv/x"), { code: "EPERM" }),
    );
    const warn = vi.fn();
    const result = await cleanUpExpiredOrphans({
      storage,
      log: { warn },
      deleteRows: async () => [KEY_A, KEY_B],
    });
    expect(result).toEqual({ rowsDeleted: 2, filesDeleted: 1, filesFailed: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toEqual({ storageKey: KEY_A });
    expect(storage.delete).toHaveBeenCalledWith(KEY_B);
  });

  it("passes a failed row batch on, and deletes no file for it", async () => {
    const storage = fakeStorage();
    await expect(
      cleanUpExpiredOrphans({
        storage,
        deleteRows: async () => {
          throw new Error("database down");
        },
      }),
    ).rejects.toThrow("database down");
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe("runUploadCleanup", () => {
  it("writes one info line with the counts", async () => {
    const log = fakeLogger();
    const result = { rowsDeleted: 3, filesDeleted: 2, filesFailed: 1 };
    await expect(runUploadCleanup(log, async () => result)).resolves.toEqual(result);
    expect(log.info).toHaveBeenCalledWith("Upload orphan cleanup ran", {
      component: "upload-cleanup",
      ...result,
    });
  });

  it("never throws: one error line with the class and code, nothing of the message", async () => {
    const log = fakeLogger();
    const failure = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432 secret"), {
      code: "ECONNREFUSED",
    });
    await expect(
      runUploadCleanup(log, async () => {
        throw failure;
      }),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(1);
    const fields = log.error.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(fields).toEqual({
      component: "upload-cleanup",
      errorClass: "Error",
      errorCode: "ECONNREFUSED",
    });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("secret");
  });
});

describe("startUploadCleanupSchedule", () => {
  it("runs at once, then every interval, one schedule per process, never overlapping", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<{ rowsDeleted: number; filesDeleted: number; filesFailed: number }>(
          (resolve) => {
            release = () => resolve({ rowsDeleted: 0, filesDeleted: 0, filesFailed: 0 });
          },
        ),
    );
    const logger = fakeLogger();
    expect(startUploadCleanupSchedule({ run, logger, intervalMs: 1_000 })).toBe(true);
    expect(startUploadCleanupSchedule({ run, logger, intervalMs: 1_000 })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    // Still running: the next tick starts nothing.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    stopUploadCleanupSchedule();
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
