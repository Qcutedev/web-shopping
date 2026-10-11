import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkHealth,
  createHealthCheck,
  HEALTH_DATABASE_TIMEOUT_MS,
  HEALTH_PROBE_ABANDON_MS,
} from "./health";
import { createLogger } from "./logger";

// No database here: the probe is injected. The check against the real test database is an
// integration case (tests/integration, owner qa) and a real run recorded in docs/DEPLOYMENT.md.

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { lines, logger };
}

/** A promise that the test settles by hand. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const UP = { status: "ok", database: "up" };
const DOWN = { status: "unavailable", database: "down" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("createHealthCheck", () => {
  it("reports up when the probe resolves, and logs nothing", async () => {
    const { lines, logger } = capture();
    const check = createHealthCheck({ probe: async () => [{ "?column?": 1 }], logger });
    expect(await check()).toEqual(UP);
    expect(lines).toEqual([]);
  });

  it("reports down when the probe rejects, and logs the cause on the server only", async () => {
    const { lines, logger } = capture();
    const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5999"), {
      code: "ECONNREFUSED",
      meta: { query: "SELECT secret_column" },
    });
    const check = createHealthCheck({ probe: () => Promise.reject(error), logger });
    const report = await check({ requestId: "req-12345678" });
    // The result is the whole public answer: two fixed words and nothing about the cause.
    expect(report).toEqual(DOWN);
    expect(JSON.stringify(report)).not.toContain("ECONNREFUSED");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "Health check failed: the database query failed.",
      component: "health",
      reason: "error",
      errorName: "Error",
      errorCode: "ECONNREFUSED",
      errorMessage: "connect ECONNREFUSED 127.0.0.1:5999",
      requestId: "req-12345678",
    });
    // Only name, code, and message are taken from the error: no stack, no other property.
    expect(JSON.stringify(lines)).not.toContain("secret_column");
    expect(JSON.stringify(lines)).not.toContain("stack");
  });

  it("reports down when the probe throws synchronously", async () => {
    const { lines, logger } = capture();
    const check = createHealthCheck({
      probe: () => {
        throw new TypeError("boom");
      },
      logger,
    });
    expect(await check()).toEqual(DOWN);
    expect(lines[0]).toMatchObject({ reason: "error", errorName: "TypeError" });
  });

  it("reports down for a rejection that is not an Error", async () => {
    const { lines, logger } = capture();
    const check = createHealthCheck({ probe: () => Promise.reject("a string"), logger });
    expect(await check()).toEqual(DOWN);
    expect(lines[0]).toMatchObject({ reason: "error", errorName: "string" });
    expect(JSON.stringify(lines)).not.toContain("a string");
  });

  it("masks credentials in a logged error message and clips a long one", async () => {
    const { lines, logger } = capture();
    const message = `cannot reach postgresql://shop_app:Zq7canaryPw@db.example.test:5432/shop ${"x".repeat(1_000)}`;
    const check = createHealthCheck({ probe: () => Promise.reject(new Error(message)), logger });
    expect(await check()).toEqual(DOWN);
    const logged = String(lines[0]?.errorMessage);
    expect(logged).not.toContain("Zq7canaryPw");
    expect(logged.length).toBeLessThanOrEqual(320);
  });

  it("stops waiting after the timeout when the probe never settles", async () => {
    vi.useFakeTimers();
    const { lines, logger } = capture();
    const check = createHealthCheck({ probe: () => new Promise(() => {}), logger });
    let report: unknown;
    void check().then((value) => {
      report = value;
    });
    await vi.advanceTimersByTimeAsync(HEALTH_DATABASE_TIMEOUT_MS - 1);
    expect(report).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(report).toEqual(DOWN);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "Health check failed: the database did not answer in time.",
      reason: "timeout",
      timeoutMs: HEALTH_DATABASE_TIMEOUT_MS,
    });
  });

  it("has a bounded default wait", () => {
    expect(HEALTH_DATABASE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HEALTH_DATABASE_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
    expect(HEALTH_PROBE_ABANDON_MS).toBeGreaterThan(HEALTH_DATABASE_TIMEOUT_MS);
  });

  it("leaves no timer behind after an answer", async () => {
    vi.useFakeTimers();
    const check = createHealthCheck({ probe: async () => undefined, logger: capture().logger });
    expect(await check()).toEqual(UP);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one running probe between callers that arrive together", async () => {
    const gate = deferred();
    const probe = vi.fn(() => gate.promise);
    const check = createHealthCheck({ probe, logger: capture().logger });
    const reports = [check(), check(), check()];
    await Promise.resolve();
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(1);
    gate.resolve();
    expect(await Promise.all(reports)).toEqual([UP, UP, UP]);
    // The next check after the probe settled starts a new one.
    expect(await check()).toEqual(UP);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("starts no second query while one is stuck, and each caller still gets an answer in time", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(() => new Promise<void>(() => {}));
    const check = createHealthCheck({ probe, logger: capture().logger, timeoutMs: 100 });
    const first = check();
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toEqual(DOWN);
    const second = check();
    await vi.advanceTimersByTimeAsync(100);
    expect(await second).toEqual(DOWN);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("gives a stuck probe up after the abandon time and recovers with a new one", async () => {
    let clock = 0;
    vi.useFakeTimers();
    const stuck = new Promise<void>(() => {});
    const probe = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(stuck)
      .mockResolvedValue(undefined);
    const check = createHealthCheck({
      probe,
      logger: capture().logger,
      timeoutMs: 100,
      abandonAfterMs: 1_000,
      now: () => clock,
    });
    const first = check();
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toEqual(DOWN);

    clock = 999;
    const second = check();
    await vi.advanceTimersByTimeAsync(100);
    expect(await second).toEqual(DOWN);
    expect(probe).toHaveBeenCalledTimes(1);

    clock = 1_000;
    expect(await check()).toEqual(UP);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("a late answer of a timed-out probe changes nothing and is not an unhandled rejection", async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const { lines, logger } = capture();
    const check = createHealthCheck({ probe: () => gate.promise, logger, timeoutMs: 100 });
    const report = check();
    await vi.advanceTimersByTimeAsync(100);
    expect(await report).toEqual(DOWN);
    gate.reject(new Error("late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(lines).toHaveLength(1);
  });

  it("returns only the two documented shapes", async () => {
    const quiet = capture().logger;
    const up = await createHealthCheck({ probe: async () => 1, logger: quiet })();
    const down = await createHealthCheck({ probe: () => Promise.reject(1), logger: quiet })();
    expect(Object.keys(up).sort()).toEqual(["database", "status"]);
    expect(Object.keys(down).sort()).toEqual(["database", "status"]);
    expect(Object.isFrozen(up)).toBe(true);
    expect(Object.isFrozen(down)).toBe(true);
  });
});

describe("checkHealth with the real database layer and no DATABASE_URL", () => {
  it("reports down instead of throwing, and the log names the variable without a value", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    const lines: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    let report: unknown;
    try {
      report = await checkHealth();
    } finally {
      write.mockRestore();
    }
    expect(report).toEqual(DOWN);
    const logged = lines.join("");
    expect(logged).toContain("Health check failed: the database query failed.");
    expect(logged).toContain("DATABASE_URL is not set");
  });
});
