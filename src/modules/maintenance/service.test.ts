import { describe, expect, it, vi } from "vitest";

import { maintenanceReportSchema } from "./schema";
import {
  assessMaintenanceStatus,
  MAINTENANCE_STALE_AFTER_MINUTES,
  type MaintenanceJobs,
  runMaintenance,
  runMaintenanceOnce,
} from "./service";

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

describe("runMaintenance: recording the run (SEC-100)", () => {
  it("records once, after the three jobs, with ok true when all succeeded", async () => {
    const order: string[] = [];
    const recordRun = vi.fn((ok: boolean) => (order.push(`record:${ok}`), Promise.resolve(1)));
    const report = await runMaintenance(
      {
        paymentTimeoutSweep: () => (order.push("sweep"), Promise.resolve(SWEEP)),
        uploadCleanup: () => (order.push("cleanup"), Promise.resolve(CLEANUP)),
        sessionPurge: () => (order.push("purge"), Promise.resolve(PURGE)),
        recordRun,
      },
      logs(),
    );
    expect(report.ok).toBe(true);
    expect(order).toEqual(["sweep", "cleanup", "purge", "record:true"]);
    expect(recordRun).toHaveBeenCalledTimes(1);
  });

  it.each(["paymentTimeoutSweep", "uploadCleanup", "sessionPurge"] as const)(
    "records ok false when %s failed",
    async (name) => {
      const recordRun = vi.fn(() => Promise.resolve(1));
      await runMaintenance(jobs({ [name]: () => Promise.resolve(undefined), recordRun }), logs());
      expect(recordRun.mock.calls).toEqual([[false]]);
    },
  );

  it("a failed write is logged with the error class only and changes nothing in the report", async () => {
    const log = logs();
    const expected = await runMaintenance(jobs(), logs());
    const error = Object.assign(new Error("Zq7canary postgresql://u:p@h/db"), { code: "P2010" });
    for (const recordRun of [
      () => Promise.reject(error),
      () => {
        throw error;
      },
    ]) {
      log.error.mockClear();
      const report = await runMaintenance(jobs({ recordRun }), log);
      expect(report).toEqual(expected);
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error.mock.calls[0]).toEqual([
        "Maintenance run not recorded: the status write failed",
        { component: "maintenance", errorName: "Error", errorCode: "P2010" },
      ]);
      expect(JSON.stringify(log.error.mock.calls)).not.toContain("Zq7canary");
    }
  });

  it("a missing row (no row updated) is logged and changes nothing in the report", async () => {
    const log = logs();
    const report = await runMaintenance(jobs({ recordRun: () => Promise.resolve(0) }), log);
    expect(report.ok).toBe(true);
    expect(log.error.mock.calls).toEqual([
      [
        "Maintenance run not recorded: the status row is missing",
        { component: "maintenance", rowsUpdated: 0 },
      ],
    ]);
  });

  it("a log that throws while reporting a failed write does not make the run throw", async () => {
    const log = {
      info: vi.fn(),
      error: vi.fn(() => {
        throw new Error("the log is broken");
      }),
    };
    const report = await runMaintenance(
      jobs({ recordRun: () => Promise.reject(new Error("x")) }),
      log,
    );
    expect(report.ok).toBe(true);
  });
});

describe("assessMaintenanceStatus", () => {
  const MIN = 60;
  it.each([
    ["missing row", null, "missing"],
    [
      "never ran",
      { lastRunAgeSeconds: null, lastRunOk: null, lastSuccessAgeSeconds: null },
      "never-ran",
    ],
    [
      "fresh success",
      { lastRunAgeSeconds: 10 * MIN, lastRunOk: true, lastSuccessAgeSeconds: 10 * MIN },
      "fresh",
    ],
    [
      "exactly 45 minutes",
      { lastRunAgeSeconds: 45 * MIN, lastRunOk: true, lastSuccessAgeSeconds: 45 * MIN },
      "fresh",
    ],
    [
      "45 minutes and 1 second",
      { lastRunAgeSeconds: 45 * MIN + 1, lastRunOk: true, lastSuccessAgeSeconds: 45 * MIN + 1 },
      "stale",
    ],
    [
      "recent failed run after an old success",
      { lastRunAgeSeconds: MIN, lastRunOk: false, lastSuccessAgeSeconds: 120 * MIN },
      "stale",
    ],
    [
      "recent failed run after a recent success",
      { lastRunAgeSeconds: MIN, lastRunOk: false, lastSuccessAgeSeconds: 11 * MIN },
      "fresh",
    ],
    [
      "runs recorded, none succeeded",
      { lastRunAgeSeconds: MIN, lastRunOk: false, lastSuccessAgeSeconds: null },
      "stale",
    ],
  ] as const)("%s", (_label, reading, expected) => {
    expect(assessMaintenanceStatus(reading)).toBe(expected);
  });

  it("has the owner's threshold of 45 minutes, and the threshold can be set", () => {
    expect(MAINTENANCE_STALE_AFTER_MINUTES).toBe(45);
    const reading = {
      lastRunAgeSeconds: 11 * MIN,
      lastRunOk: true,
      lastSuccessAgeSeconds: 11 * MIN,
    };
    expect(assessMaintenanceStatus(reading, 10)).toBe("stale");
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
