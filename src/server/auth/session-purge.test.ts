import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, setLogLevel, DEFAULT_LOG_LEVEL } from "../logger";
import { SESSION_PURGE_INTERVAL_MS } from "./config";
import {
  type PurgeResult,
  runSessionPurge,
  startSessionPurgeSchedule,
  stopSessionPurgeSchedule,
} from "./session-purge";

function capture(level: "info" | "error" = "info") {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    level,
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { log, lines };
}

afterEach(() => {
  stopSessionPurgeSchedule();
  vi.useRealTimers();
  setLogLevel(DEFAULT_LOG_LEVEL);
});

describe("runSessionPurge", () => {
  it("writes one line with the counts, also when LOG_LEVEL is error", async () => {
    const { log, lines } = capture("error");
    const result = await runSessionPurge(log, async () => ({ sessions: 3, verifications: 1 }));
    expect(result).toEqual({ sessions: 3, verifications: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      message: "Expired sessions removed",
      component: "auth-purge",
      removedCount: 3,
      removedVerifications: 1,
    });
  });

  it("logs a failure at error with the class name and code only, and never throws", async () => {
    const { log, lines } = capture();
    const failure = Object.assign(new Error("connect ECONNREFUSED postgres://u:Zq7canary@h/db"), {
      code: "ECONNREFUSED",
    });
    expect(await runSessionPurge(log, () => Promise.reject(failure))).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "Expired session removal failed",
      errorName: "Error",
      errorCode: "ECONNREFUSED",
    });
    expect(JSON.stringify(lines)).not.toContain("Zq7canary");
  });
});

describe("startSessionPurgeSchedule", () => {
  it("runs at once, then every interval, and only one schedule per process", async () => {
    vi.useFakeTimers();
    const { log } = capture();
    const purge = vi.fn(async (): Promise<PurgeResult> => ({ sessions: 0, verifications: 0 }));
    expect(startSessionPurgeSchedule({ logger: log, purge })).toBe(true);
    expect(startSessionPurgeSchedule({ logger: log, purge })).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(purge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SESSION_PURGE_INTERVAL_MS);
    expect(purge).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SESSION_PURGE_INTERVAL_MS * 11);
    // Twelve hours: at least the twelve runs SR-07 item 5 asks for (one every 12 hours at most).
    expect(purge).toHaveBeenCalledTimes(13);
  });

  it("never overlaps a run that is still going", async () => {
    vi.useFakeTimers();
    const { log } = capture();
    let release: (() => void) | undefined;
    const purge = vi.fn(
      () =>
        new Promise<PurgeResult>((resolve) => {
          release = () => resolve({ sessions: 0, verifications: 0 });
        }),
    );
    startSessionPurgeSchedule({ logger: log, purge, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(purge).toHaveBeenCalledTimes(1);
    release?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(purge).toHaveBeenCalledTimes(2);
  });

  it("does not keep the process alive: the timer is unref'd", () => {
    const { log } = capture();
    const spy = vi.spyOn(globalThis, "setInterval");
    startSessionPurgeSchedule({
      logger: log,
      purge: async () => ({ sessions: 0, verifications: 0 }),
    });
    const timer = spy.mock.results[0]?.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    spy.mockRestore();
  });
});
