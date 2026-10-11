import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkHealth,
  createHealthCheck,
  HEALTH_DATABASE_TIMEOUT_MS,
  HEALTH_FAILURE_LOG_INTERVAL_MS,
  HEALTH_PROBE_ABANDON_MS,
} from "./health";
import { createLogger, type Logger } from "./logger";

// No database here: the probe is injected. Against a real database the check has been exercised
// only by the runs recorded in docs/DEPLOYMENT.md, "Health endpoint". An integration case under
// tests/integration is planned (owner qa) and does not exist yet. The route handler has its own
// test in src/app/api/health/route.test.ts.

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

// SEC-026: the endpoint is public and not rate limited, so the number of log lines must follow
// the outage and the clock, never the number of requests.
describe("createHealthCheck: what an outage writes to the log (SEC-026)", () => {
  const refused = () =>
    Promise.reject(Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }));

  function levels(lines: Record<string, unknown>[]): unknown[] {
    return lines.map((line) => line.level);
  }

  it("writes one line for all the callers that shared a failed probe, with their number and the first caller's request id", async () => {
    const { lines, logger } = capture();
    const probe = vi.fn(refused);
    const check = createHealthCheck({ probe, logger, now: () => 0 });
    const reports = await Promise.all(
      Array.from({ length: 50 }, (_, index) => check({ requestId: `req-caller-${index}` })),
    );
    expect(probe).toHaveBeenCalledTimes(1);
    // Every caller still gets its own answer.
    expect(reports).toHaveLength(50);
    for (const report of reports) expect(report).toEqual(DOWN);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "Health check failed: the database query failed.",
      component: "health",
      reason: "error",
      errorCode: "ECONNREFUSED",
      failedChecks: 50,
      requestId: "req-caller-0",
    });
  });

  it("uses the first request id there is when the first caller has none", async () => {
    const { lines, logger } = capture();
    const check = createHealthCheck({ probe: refused, logger, now: () => 0 });
    await Promise.all([check(), check({ requestId: "req-second-1" }), check({ requestId: "x" })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ failedChecks: 3, requestId: "req-second-1" });
  });

  it("writes no second failure line within the interval, and the next one carries the count", async () => {
    let clock = 5_000;
    const { lines, logger } = capture();
    const probe = vi.fn(refused);
    const check = createHealthCheck({ probe, logger, now: () => clock });

    expect(await check({ requestId: "req-first-01" })).toEqual(DOWN);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ failedChecks: 1, requestId: "req-first-01" });

    // One probe per check (each fails at once), 300 failed checks, and still one line.
    for (let request = 0; request < 300; request += 1) {
      clock = 5_000 + Math.min(request * 100, HEALTH_FAILURE_LOG_INTERVAL_MS - 1);
      expect(await check({ requestId: `req-quiet-${request}` })).toEqual(DOWN);
    }
    expect(probe).toHaveBeenCalledTimes(301);
    expect(lines).toHaveLength(1);

    // The interval is over: the next failed check writes the line for all of them.
    clock = 5_000 + HEALTH_FAILURE_LOG_INTERVAL_MS;
    expect(await check({ requestId: "req-later-01" })).toEqual(DOWN);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      level: "error",
      reason: "error",
      failedChecks: 301,
      // The first of the checks this line reports.
      requestId: "req-quiet-0",
    });

    // And the interval starts again from that line.
    clock += HEALTH_FAILURE_LOG_INTERVAL_MS - 1;
    expect(await check()).toEqual(DOWN);
    expect(lines).toHaveLength(2);
    clock += 1;
    expect(await check()).toEqual(DOWN);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatchObject({ failedChecks: 2 });
    expect(lines[2]).not.toHaveProperty("requestId");
  });

  it("has a default interval of 30 seconds, and the interval can be set", async () => {
    expect(HEALTH_FAILURE_LOG_INTERVAL_MS).toBe(30_000);
    let clock = 0;
    const { lines, logger } = capture();
    const check = createHealthCheck({
      probe: refused,
      logger,
      now: () => clock,
      failureLogIntervalMs: 10,
    });
    await check();
    clock = 9;
    await check();
    expect(lines).toHaveLength(1);
    clock = 10;
    await check();
    expect(lines).toHaveLength(2);
  });

  it("limits timeouts in the same way: one line for the callers of a stuck probe", async () => {
    vi.useFakeTimers();
    const { lines, logger } = capture();
    const probe = vi.fn(() => new Promise<void>(() => {}));
    const check = createHealthCheck({ probe, logger, timeoutMs: 100, now: () => 0 });
    const reports = Array.from({ length: 20 }, (_, index) =>
      check({ requestId: `req-stuck-${index}` }),
    );
    await vi.advanceTimersByTimeAsync(100);
    for (const report of await Promise.all(reports)) expect(report).toEqual(DOWN);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "Health check failed: the database did not answer in time.",
      reason: "timeout",
      timeoutMs: 100,
      failedChecks: 1,
      requestId: "req-stuck-0",
    });
  });

  it("counts a timeout and an error under one limit, and no check twice", async () => {
    vi.useFakeTimers();
    let clock = 0;
    const gate = deferred();
    const { lines, logger } = capture();
    const check = createHealthCheck({
      probe: () => gate.promise,
      logger,
      timeoutMs: 100,
      now: () => clock,
    });
    // Three callers time out on the probe; two more join it later and get its error.
    const early = [check(), check(), check()];
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(early);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ reason: "timeout", failedChecks: 1 });

    const late = [check(), check()];
    gate.reject(new Error("refused in the end"));
    expect(await Promise.all(late)).toEqual([DOWN, DOWN]);
    expect(lines).toHaveLength(1);

    clock = HEALTH_FAILURE_LOG_INTERVAL_MS;
    await check();
    expect(lines).toHaveLength(2);
    // 2 timeouts that wrote no line, the 2 that got the error, and this check.
    expect(lines[1]).toMatchObject({ reason: "error", failedChecks: 5 });
  });

  it("writes one info line when the database answers again, and nothing while it stays up", async () => {
    let up = false;
    const { lines, logger } = capture();
    const check = createHealthCheck({
      probe: () => (up ? Promise.resolve() : refused()),
      logger,
      now: () => 0,
    });
    for (let request = 0; request < 4; request += 1) await check();
    expect(levels(lines)).toEqual(["error"]);

    up = true;
    expect(await check({ requestId: "req-back-001" })).toEqual(UP);
    expect(levels(lines)).toEqual(["error", "info"]);
    expect(lines[1]).toMatchObject({
      level: "info",
      message: "Health check recovered: the database answers again.",
      component: "health",
      // The three failed checks that the failure line had not counted.
      failedChecks: 3,
      requestId: "req-back-001",
    });

    for (let request = 0; request < 10; request += 1) expect(await check()).toEqual(UP);
    await Promise.all(Array.from({ length: 10 }, () => check()));
    expect(lines).toHaveLength(2);
  });

  it("writes no recovery line when nothing had failed", async () => {
    const { lines, logger } = capture();
    const check = createHealthCheck({ probe: async () => undefined, logger });
    await Promise.all(Array.from({ length: 5 }, () => check()));
    expect(await check()).toEqual(UP);
    expect(lines).toEqual([]);
  });

  it("a database that goes up and down writes at most one error and one info line per interval", async () => {
    let clock = 0;
    let up = false;
    const { lines, logger } = capture();
    const check = createHealthCheck({
      probe: () => (up ? Promise.resolve() : refused()),
      logger,
      now: () => clock,
    });
    for (let request = 0; request < 100; request += 1) {
      up = request % 2 === 1;
      expect(await check()).toEqual(up ? UP : DOWN);
    }
    expect(levels(lines)).toEqual(["error", "info"]);

    // The 49 failures that wrote no line are not lost: the next failure line counts them.
    clock = HEALTH_FAILURE_LOG_INTERVAL_MS;
    up = false;
    await check();
    expect(levels(lines)).toEqual(["error", "info", "error"]);
    expect(lines[2]).toMatchObject({ failedChecks: 50 });
  });

  it("logs a new outage at once when the last failure line is older than the interval", async () => {
    let clock = 0;
    let up = false;
    const { lines, logger } = capture();
    const check = createHealthCheck({
      probe: () => (up ? Promise.resolve() : refused()),
      logger,
      now: () => clock,
    });
    await check();
    up = true;
    await check();
    clock = HEALTH_FAILURE_LOG_INTERVAL_MS + 1;
    up = false;
    await check({ requestId: "req-again-01" });
    expect(levels(lines)).toEqual(["error", "info", "error"]);
    expect(lines[2]).toMatchObject({ failedChecks: 1, requestId: "req-again-01" });
  });

  it("gives every caller the same answer at the same time as before, whatever is logged", async () => {
    vi.useFakeTimers();
    const quiet = createLogger({ level: "error", write: () => {} });
    const check = createHealthCheck({
      probe: () => new Promise<void>(() => {}),
      logger: quiet,
      timeoutMs: 100,
    });
    const settled: number[] = [];
    for (let caller = 0; caller < 5; caller += 1) {
      void check().then(() => settled.push(caller));
      await vi.advanceTimersByTimeAsync(10);
    }
    // The first caller started 50 ms ago: nobody has an answer yet.
    expect(settled).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toEqual([0]);
    await vi.advanceTimersByTimeAsync(40);
    expect(settled).toEqual([0, 1, 2, 3, 4]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a logger that throws does not change the answer", async () => {
    const broken = createLogger({ level: "debug", write: () => {} });
    const throwing: Logger = {
      ...broken,
      error: () => {
        throw new Error("the log is broken");
      },
      info: () => {
        throw new Error("the log is broken");
      },
      child: () => throwing,
    };
    let up = false;
    const check = createHealthCheck({
      probe: () => (up ? Promise.resolve() : refused()),
      logger: throwing,
      now: () => 0,
    });
    expect(await Promise.all([check(), check({ requestId: "req-12345678" })])).toEqual([
      DOWN,
      DOWN,
    ]);
    up = true;
    expect(await check()).toEqual(UP);
  });

  // CR-50: the catch-all used to answer "down" without a word in the log.
  it("says so in the log when the check itself fails, and still answers down", async () => {
    const { lines, logger } = capture();
    const now = vi
      .fn<() => number>()
      .mockImplementationOnce(() => {
        throw new RangeError("the clock is broken");
      })
      .mockReturnValue(0);
    const check = createHealthCheck({ probe: async () => undefined, logger, now });
    expect(await check({ requestId: "req-internal-1" })).toEqual(DOWN);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "Health check failed: the check itself failed.",
      component: "health",
      reason: "internal",
      errorName: "RangeError",
      errorMessage: "the clock is broken",
      failedChecks: 1,
      requestId: "req-internal-1",
    });
    // The next check works again.
    expect(await check()).toEqual(UP);
  });

  it("answers down without throwing when the check fails and the log cannot be written either", async () => {
    vi.useFakeTimers();
    const { lines, logger } = capture();
    const check = createHealthCheck({
      probe: async () => undefined,
      logger,
      now: () => {
        throw new Error("the clock is broken");
      },
    });
    expect(await check()).toEqual(DOWN);
    expect(await check()).toEqual(DOWN);
    expect(lines).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
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
    // The variable's name only: the wording around it belongs to the database layer and
    // changes when that layer moves to `readDatabaseUrl` (CR-23).
    expect(logged).toContain("DATABASE_URL");
    expect(logged).not.toContain("://");
  });
});
