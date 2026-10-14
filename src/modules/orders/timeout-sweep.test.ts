import { afterEach, describe, expect, it, vi } from "vitest";

import type { StructuredLogger } from "@/server/logger";

import * as service from "./service";

import {
  runPaymentTimeoutSweep,
  startPaymentTimeoutSweepSchedule,
  stopPaymentTimeoutSweepSchedule,
} from "./timeout-sweep";

vi.mock("./service", () => ({ failOverdueOrders: vi.fn() }));

function fakeLogger() {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    security: vi.fn(),
    child: vi.fn(),
  };
  return log as typeof log & StructuredLogger;
}

afterEach(() => {
  stopPaymentTimeoutSweepSchedule();
  vi.useRealTimers();
});

describe("runPaymentTimeoutSweep", () => {
  it("writes one counts-only line through security() for a run that worked", async () => {
    const log = fakeLogger();
    const sweep = vi.fn().mockResolvedValue({ found: 2, failed: 1, errored: 1 });
    await expect(runPaymentTimeoutSweep(15, log, sweep)).resolves.toEqual({
      found: 2,
      failed: 1,
      errored: 1,
    });
    expect(sweep).toHaveBeenCalledWith(15);
    expect(log.security).toHaveBeenCalledWith("info", "Payment timeout sweep ran", {
      component: "payment-timeout-sweep",
      overdueFound: 2,
      overdueFailed: 1,
      overdueErrored: 1,
    });
  });

  it("by default sweeps through failOverdueOrders with the same logger", async () => {
    const log = fakeLogger();
    const failOverdueOrders = vi.mocked(service.failOverdueOrders);
    failOverdueOrders.mockResolvedValue({ found: 1, failed: 0, errored: 1 });
    await expect(runPaymentTimeoutSweep(15, log)).resolves.toEqual({
      found: 1,
      failed: 0,
      errored: 1,
    });
    expect(failOverdueOrders).toHaveBeenCalledWith(15, undefined, log);
  });

  it("never throws; a failed run writes one error line with labels only", async () => {
    const log = fakeLogger();
    const failure = Object.assign(new Error("secret row 0812345678"), { code: "P2028" });
    const sweep = vi.fn().mockRejectedValue(failure);
    await expect(runPaymentTimeoutSweep(15, log, sweep)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("0812345678");
    expect(log.error.mock.calls[0]?.[1]).toMatchObject({ errorName: "Error", errorCode: "P2028" });
  });
});

describe("startPaymentTimeoutSweepSchedule (D-033 point 12)", () => {
  it("runs once at start, then every interval, and only one schedule per process", async () => {
    vi.useFakeTimers();
    const sweep = vi.fn().mockResolvedValue({ found: 0, failed: 0, errored: 0 });
    const log = fakeLogger();
    expect(
      startPaymentTimeoutSweepSchedule({
        timeoutMinutes: 15,
        intervalMs: 60_000,
        logger: log,
        sweep,
      }),
    ).toBe(true);
    expect(startPaymentTimeoutSweepSchedule({ timeoutMinutes: 15, logger: log, sweep })).toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(sweep).toHaveBeenLastCalledWith(15);
  });

  it("a run never overlaps the previous one", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const sweep = vi.fn(
      () =>
        new Promise<{ found: number; failed: number; errored: number }>((resolve) => {
          release = () => resolve({ found: 0, failed: 0, errored: 0 });
        }),
    );
    startPaymentTimeoutSweepSchedule({
      timeoutMinutes: 15,
      intervalMs: 1_000,
      logger: fakeLogger(),
      sweep,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
