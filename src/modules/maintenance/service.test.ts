import { describe, expect, it, vi } from "vitest";

import { maintenanceReportSchema } from "./schema";
import { type MaintenanceJobs, runMaintenance, runMaintenanceOnce } from "./service";

const SWEEP = { found: 3, failed: 2, errored: 1 };
const CLEANUP = { rowsDeleted: 4, filesDeleted: 3, filesMissing: 1, filesFailed: 0 };
const PURGE = { sessions: 5, verifications: 6 };

function jobs(overrides: Partial<MaintenanceJobs> = {}): MaintenanceJobs {
  return {
    paymentTimeoutSweep: vi.fn(() => Promise.resolve(SWEEP)),
    uploadCleanup: vi.fn(() => Promise.resolve(CLEANUP)),
    sessionPurge: vi.fn(() => Promise.resolve(PURGE)),
    ...overrides,
  };
}

function logs() {
  return { info: vi.fn(), error: vi.fn() };
}

describe("runMaintenance", () => {
  it("runs the three jobs in order and reports their counts", async () => {
    const order: string[] = [];
    const log = logs();
    const report = await runMaintenance(
      {
        paymentTimeoutSweep: () => (order.push("sweep"), Promise.resolve(SWEEP)),
        uploadCleanup: () => (order.push("cleanup"), Promise.resolve(CLEANUP)),
        sessionPurge: () => (order.push("purge"), Promise.resolve(PURGE)),
      },
      log,
    );
    expect(order).toEqual(["sweep", "cleanup", "purge"]);
    expect(report).toEqual({
      ok: true,
      jobs: {
        paymentTimeoutSweep: { ok: true, found: 3, failed: 2, errored: 1 },
        uploadCleanup: {
          ok: true,
          rowsDeleted: 4,
          filesDeleted: 3,
          filesMissing: 1,
          filesFailed: 0,
        },
        sessionPurge: { ok: true, removedSessions: 5, removedVerifications: 6 },
      },
    });
    expect(maintenanceReportSchema.parse(report)).toEqual(report);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("does not start a job before the previous one finished", async () => {
    let sweepDone = false;
    const sawSweepDone: boolean[] = [];
    await runMaintenance(
      jobs({
        paymentTimeoutSweep: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          sweepDone = true;
          return SWEEP;
        },
        uploadCleanup: () => {
          sawSweepDone.push(sweepDone);
          return Promise.resolve(CLEANUP);
        },
      }),
      logs(),
    );
    expect(sawSweepDone).toEqual([true]);
  });

  it.each(["paymentTimeoutSweep", "uploadCleanup", "sessionPurge"] as const)(
    "isolates a failed %s: it is { ok: false }, the others still run and report",
    async (name) => {
      for (const failure of [
        () => Promise.resolve(undefined),
        () => Promise.reject(new Error("Zq7canary db://secret@host")),
        () => {
          throw new Error("Zq7canary sync");
        },
      ]) {
        const all = jobs({ [name]: failure });
        const log = logs();
        const report = await runMaintenance(all, log);
        expect(report.ok).toBe(false);
        expect(report.jobs[name]).toEqual({ ok: false });
        for (const other of ["paymentTimeoutSweep", "uploadCleanup", "sessionPurge"] as const) {
          if (other === name) continue;
          expect(all[other]).toHaveBeenCalledTimes(1);
          expect(report.jobs[other].ok).toBe(true);
        }
        expect(maintenanceReportSchema.parse(report)).toEqual(report);
        expect(JSON.stringify(report)).not.toContain("Zq7canary");
        expect(log.error).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(log.error.mock.calls)).not.toContain("Zq7canary");
      }
    },
  );

  it("copies named counts only, never other fields of a job's result", async () => {
    const report = await runMaintenance(
      jobs({
        paymentTimeoutSweep: () =>
          Promise.resolve({ ...SWEEP, orderIds: ["Zq7canary"] } as typeof SWEEP),
        uploadCleanup: () => Promise.resolve({ rowsDeleted: 1, filesDeleted: 1, filesFailed: 0 }),
      }),
      logs(),
    );
    expect(JSON.stringify(report)).not.toContain("Zq7canary");
    // A cleanup result without `filesMissing` (a stub written before SEC-073) reports 0.
    expect(report.jobs.uploadCleanup).toEqual({
      ok: true,
      rowsDeleted: 1,
      filesDeleted: 1,
      filesMissing: 0,
      filesFailed: 0,
    });
  });

  it("writes one summary line with outcomes only, no key containing 'session'", async () => {
    const log = logs();
    await runMaintenance(jobs({ sessionPurge: () => Promise.resolve(undefined) }), log);
    const fields = log.error.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(fields).toMatchObject({
      component: "maintenance",
      paymentSweepOk: true,
      uploadCleanupOk: true,
      authPurgeOk: false,
    });
    expect(Object.keys(fields).some((key) => key.toLowerCase().includes("session"))).toBe(false);
  });
});

describe("runMaintenanceOnce", () => {
  it("shares one run between calls that overlap in one process, then starts a new one", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sweep = vi.fn(async () => {
      await gate;
      return SWEEP;
    });
    const first = runMaintenanceOnce(jobs({ paymentTimeoutSweep: sweep }), logs());
    const second = runMaintenanceOnce(jobs({ paymentTimeoutSweep: sweep }), logs());
    expect(second).toBe(first);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(sweep).toHaveBeenCalledTimes(1);

    const third = runMaintenanceOnce(jobs({ paymentTimeoutSweep: sweep }), logs());
    expect(third).not.toBe(first);
    await third;
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("frees the slot after a run with a failed job", async () => {
    const failed = await runMaintenanceOnce(
      jobs({ uploadCleanup: () => Promise.reject(new Error("x")) }),
      logs(),
    );
    expect(failed.ok).toBe(false);
    const next = await runMaintenanceOnce(jobs(), logs());
    expect(next.ok).toBe(true);
  });
});
