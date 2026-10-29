import { beforeEach, describe, expect, it, vi } from "vitest";

import { runPaymentTimeoutSweep } from "@/modules/orders";
import { runUploadCleanup } from "@/modules/uploads";

import { runSessionPurge } from "./auth/session-purge";
import { createMaintenanceJobs } from "./maintenance-jobs";
import { UPLOAD_VOLUME_ALERT_MESSAGE } from "./upload-volume-alert";

vi.mock("@/modules/orders", () => ({ runPaymentTimeoutSweep: vi.fn() }));
vi.mock("@/modules/uploads", () => ({ runUploadCleanup: vi.fn() }));
vi.mock("./auth/session-purge", () => ({ runSessionPurge: vi.fn() }));

const sweep = vi.mocked(runPaymentTimeoutSweep);
const cleanup = vi.mocked(runUploadCleanup);
const purge = vi.mocked(runSessionPurge);

beforeEach(() => {
  sweep.mockReset().mockResolvedValue({ found: 0, failed: 0, errored: 0 });
  cleanup
    .mockReset()
    .mockResolvedValue({ rowsDeleted: 0, filesDeleted: 0, filesMissing: 0, filesFailed: 0 });
  purge.mockReset().mockResolvedValue({ sessions: 0, verifications: 0 });
});

describe("createMaintenanceJobs", () => {
  it("runs the sweep with the validated timeout, as the timer does", async () => {
    await createMaintenanceJobs({ paymentTimeoutMinutes: 7 }).paymentTimeoutSweep();
    expect(sweep.mock.calls).toEqual([[7]]);
  });

  it("runs the cleanup's default run (with its SEC-073 storage check) and the volume-alert logger", async () => {
    await createMaintenanceJobs({ paymentTimeoutMinutes: 15 }).uploadCleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);
    const args = cleanup.mock.calls[0] ?? [];
    // One argument, the logger: no `run` is injected, so `cleanUpExpiredOrphans` with
    // `storage.assertReady` is what runs.
    expect(args).toHaveLength(1);
    const logger = args[0] as { info: (message: string, fields?: object) => void };
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      logger.info("Upload orphan cleanup ran", { component: "upload-cleanup", filesMissing: 2 });
      expect(write.mock.calls.map(([line]) => String(line)).join("")).toContain(
        UPLOAD_VOLUME_ALERT_MESSAGE,
      );
    } finally {
      write.mockRestore();
    }
  });

  it("keeps one volume-alert logger per process across requests", async () => {
    await createMaintenanceJobs({ paymentTimeoutMinutes: 15 }).uploadCleanup();
    await createMaintenanceJobs({ paymentTimeoutMinutes: 15 }).uploadCleanup();
    expect(cleanup.mock.calls[0]?.[0]).toBe(cleanup.mock.calls[1]?.[0]);
  });

  it("runs the session purge with its defaults", async () => {
    await createMaintenanceJobs({ paymentTimeoutMinutes: 15 }).sessionPurge();
    expect(purge.mock.calls).toEqual([[]]);
  });
});
