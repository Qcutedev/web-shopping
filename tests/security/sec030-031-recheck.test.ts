/**
 * Eighth round, 2026-10-12: independent re-check of the fixes of SEC-030 (the process-wide rate
 * limiter counts in one data-only table on `globalThis[Symbol.for(
 * "marketplace.rateLimit.processState")]`) and SEC-031 (`security(level, message, fields)` of the
 * logger, which `LOG_LEVEL` does not filter), both commit f66ab8c, backend-api. Owner: security
 * agent.
 *
 *   it(...)  behaviour that was checked on 2026-10-12 and holds. A failure is a regression.
 *
 * Some cases below record behaviour that is accepted rather than wanted (a slot that another
 * piece of code in the same process fills is trusted; a malformed slot is replaced and its
 * counters are lost). They pin what the code does so that a change is noticed; the decisions
 * are in docs/SECURITY.md, SEC-030 re-check evidence.
 *
 * Nobody but the security agent may edit an assertion, a threshold, or a timeout here, or skip
 * or delete a case. Nothing here starts a server or opens a connection.
 *
 * Part of `pnpm test` (project "security"). Run alone with:
 *   pnpm exec vitest run --project security tests/security/sec030-031-recheck.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLogger,
  DEFAULT_LOG_LEVEL,
  logger as processLogger,
  setLogLevel,
} from "../../src/server/logger";

type RateLimitModule = typeof import("../../src/server/rate-limit");

const STATE_KEY = Symbol.for("marketplace.rateLimit.processState");
const LEVEL_KEY = Symbol.for("marketplace.logger.processLevel");
const globalRecord = globalThis as unknown as Record<symbol, unknown>;

/** A second (third, ...) evaluation of the limiter in this process, as a separate bundle gets. */
async function freshCopy(): Promise<RateLimitModule> {
  vi.resetModules();
  return import("../../src/server/rate-limit");
}

function clearSlots(): void {
  Reflect.deleteProperty(globalThis, STATE_KEY);
  Reflect.deleteProperty(globalThis, LEVEL_KEY);
}

/** The lines the process-wide logger wrote to standard output while `action` ran. */
async function captureStdout(action: () => unknown): Promise<string[]> {
  const written: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  }) as never);
  try {
    await action();
  } finally {
    spy.mockRestore();
  }
  return written
    .join("")
    .split("\n")
    .filter((line) => line.length > 0);
}

/** A logger of this module that writes into an array, at `level`. */
function capturingLogger(level: "debug" | "info" | "warn" | "error") {
  const lines: string[] = [];
  const log = createLogger({ level, write: (line) => lines.push(line) });
  return { log, lines };
}

describe("SEC-030 re-check: one table per process", () => {
  beforeEach(clearSlots);
  afterEach(() => {
    clearSlots();
    setLogLevel(DEFAULT_LOG_LEVEL);
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("the window capacity of a rule is one per process: two copies together hold at most maxKeys", async () => {
    const hook = await freshCopy();
    const handlers = await freshCopy();
    const rule = hook.RATE_LIMITS.CHECKOUT;
    const half = rule.maxKeys / 2;
    for (let index = 0; index < half; index += 1) {
      await hook.rateLimiter.consume(`h-${index}`, hook.RATE_LIMITS.CHECKOUT);
      await handlers.rateLimiter.consume(`r-${index}`, handlers.RATE_LIMITS.CHECKOUT);
    }
    // The rule is now full in the shared table; a new subject is refused by either copy.
    const lines = await captureStdout(async () => {
      for (const copy of [hook, handlers]) {
        expect(
          await copy.rateLimiter.consume("new-subject", copy.RATE_LIMITS.CHECKOUT),
        ).toMatchObject({ allowed: false, saturated: true });
      }
    });
    const state = globalRecord[STATE_KEY] as { windows: Map<string, unknown> };
    expect(state.windows.size).toBe(rule.maxKeys);
    // One saturation line for the process, not one per copy.
    expect(lines.filter((line) => line.includes("Rate limit store saturated"))).toHaveLength(1);
  }, 30_000);

  it("a subject hammering one rule holds one window, and a key never grows past its bound", async () => {
    const copy = await freshCopy();
    for (let attempt = 0; attempt < 5_000; attempt += 1) {
      await copy.rateLimiter.consume("203.0.113.60", copy.RATE_LIMITS.SIGN_IN_ADDRESS);
    }
    const long = "x".repeat(1_000_000);
    await copy.rateLimiter.consume(long, copy.RATE_LIMITS.SIGN_IN_ADDRESS);
    await copy.rateLimiter.consume(`sha256:${"0".repeat(64)}`, copy.RATE_LIMITS.SIGN_IN_ADDRESS);
    const state = globalRecord[STATE_KEY] as {
      windows: Map<string, { count: number }>;
      ruleSizes: Map<string, number>;
      lastSaturationLogAt: Map<string, number>;
    };
    expect(state.windows.size).toBe(3);
    expect(state.windows.get("sign-in-address:203.0.113.60")?.count).toBe(5_000);
    for (const key of state.windows.keys()) {
      expect(key.length).toBeLessThanOrEqual("sign-in-address:".length + 128);
    }
    expect([...state.ruleSizes.keys()]).toEqual(["sign-in-address"]);
    expect(state.lastSaturationLogAt.size).toBe(0);
  });

  it("an unregistered rule name never reaches the shared table, whatever copy is asked", async () => {
    const copy = await freshCopy();
    for (const rule of [
      { name: "__proto__", limit: 5, windowMs: 60_000, maxKeys: 40_000 },
      { name: "constructor", limit: 5, windowMs: 60_000, maxKeys: 40_000 },
      { ...copy.RATE_LIMITS.SIGN_IN_ADDRESS, limit: 1_000_000 },
      { ...copy.RATE_LIMITS.SIGN_IN_ADDRESS, maxKeys: 200_000 },
    ]) {
      await expect(copy.rateLimiter.consume("203.0.113.61", rule)).rejects.toThrow(TypeError);
    }
    expect(STATE_KEY in globalThis).toBe(false);
  });

  it("a slot that cannot be replaced fails closed: consume rejects, it never allows", async () => {
    Object.defineProperty(globalThis, STATE_KEY, {
      configurable: true,
      writable: false,
      value: "not a table",
    });
    const copy = await freshCopy();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        copy.rateLimiter.consume("203.0.113.62", copy.RATE_LIMITS.SIGN_IN_ADDRESS),
      ).rejects.toThrow(TypeError);
    }
  });

  it("a frozen table fails closed when the sweep falls due", async () => {
    globalRecord[STATE_KEY] = Object.freeze({
      version: 1,
      windows: new Map(),
      ruleSizes: new Map(),
      lastSweepAt: Number.NEGATIVE_INFINITY,
      lastSaturationLogAt: new Map(),
    });
    const copy = await freshCopy();
    await expect(
      copy.rateLimiter.consume("203.0.113.63", copy.RATE_LIMITS.SIGN_IN_ADDRESS),
    ).rejects.toThrow(TypeError);
  });

  it("a poisoned sweep time (NaN) stops the sweep, and the full rule stays closed, not open", async () => {
    const copy = await freshCopy();
    const rule = copy.RATE_LIMITS.SIGN_UP;
    const windows = new Map<string, { rule: string; count: number; resetAt: number }>();
    // Every window long expired; only a sweep would free them.
    for (let index = 0; index < rule.maxKeys; index += 1) {
      windows.set(`sign-up:old-${index}`, { rule: "sign-up", count: 1, resetAt: 0 });
    }
    globalRecord[STATE_KEY] = {
      version: 1,
      windows,
      ruleSizes: new Map([["sign-up", rule.maxKeys]]),
      lastSweepAt: Number.NaN,
      lastSaturationLogAt: new Map(),
    };
    await captureStdout(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(
          await copy.rateLimiter.consume(`fresh-${attempt}`, copy.RATE_LIMITS.SIGN_UP),
        ).toMatchObject({ allowed: false, saturated: true });
      }
    });
    // An expired window of the subject itself is still reused (no capacity needed).
    expect(await copy.rateLimiter.consume("old-7", copy.RATE_LIMITS.SIGN_UP)).toMatchObject({
      allowed: true,
    });
  });

  it("accepted: a well-formed table that other code in the process planted is trusted as it is", async () => {
    // In-process code can already do anything the process can; the slot is not a boundary
    // against it. Pinned so that a change of this trust is a decision, not an accident.
    globalRecord[STATE_KEY] = {
      version: 1,
      windows: new Map([
        ["sign-in-address:203.0.113.64", { rule: "sign-in-address", count: 99, resetAt: 9e15 }],
      ]),
      ruleSizes: new Map([["sign-in-address", 1]]),
      lastSweepAt: 0,
      lastSaturationLogAt: new Map(),
    };
    const copy = await freshCopy();
    expect(
      (await copy.rateLimiter.consume("203.0.113.64", copy.RATE_LIMITS.SIGN_IN_ADDRESS)).allowed,
    ).toBe(false);
  });

  it("accepted: a slot of another version is replaced, and the counters it held are lost", async () => {
    const copy = await freshCopy();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await copy.rateLimiter.consume("203.0.113.65", copy.RATE_LIMITS.SIGN_IN_ADDRESS);
    }
    expect(
      (await copy.rateLimiter.consume("203.0.113.65", copy.RATE_LIMITS.SIGN_IN_ADDRESS)).allowed,
    ).toBe(false);
    (globalRecord[STATE_KEY] as { version: number }).version = 2;
    // Only code in the process can do this; a client cannot. Recorded under residual risks.
    expect(
      (await copy.rateLimiter.consume("203.0.113.65", copy.RATE_LIMITS.SIGN_IN_ADDRESS)).allowed,
    ).toBe(true);
  });

  it("the saturation line holds the rule name and sizes only, written at level error, never a subject", async () => {
    const copy = await freshCopy();
    const rule = copy.RATE_LIMITS.SIGN_IN_EMAIL;
    globalRecord[STATE_KEY] = {
      version: 1,
      windows: new Map(),
      ruleSizes: new Map([[rule.name, rule.maxKeys]]),
      lastSweepAt: Number.MAX_SAFE_INTEGER,
      lastSaturationLogAt: new Map(),
    };
    setLogLevel("error");
    const subject = 'victim.person@example.com\n{"level":"error"}';
    const lines = await captureStdout(async () => {
      await copy.rateLimiter.consume(subject, copy.RATE_LIMITS.SIGN_IN_EMAIL);
    });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ["level", "message", "rule", "ruleSize", "storeSize", "timestamp"].sort(),
    );
    expect(lines[0]).not.toContain("victim");
    expect(lines[0]).not.toContain("example.com");
  });
});

describe("SEC-031 re-check: security() is written at every level and is as safe as any line", () => {
  afterEach(() => {
    clearSlots();
    setLogLevel(DEFAULT_LOG_LEVEL);
    vi.restoreAllMocks();
  });

  it.each(["debug", "info", "warn", "error"] as const)(
    "at configured level %s, security() writes info, warn, and error, and the other methods are filtered as before",
    (configured) => {
      const { log, lines } = capturingLogger(configured);
      log.security("info", "s-info");
      log.security("warn", "s-warn");
      log.security("error", "s-error");
      log.child({ requestId: "req-1" }).security("info", "s-child");
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
      const messages = lines.map((line) => (JSON.parse(line) as { message: string }).message);
      expect(messages.slice(0, 4)).toEqual(["s-info", "s-warn", "s-error", "s-child"]);
      const order = ["debug", "info", "warn", "error"];
      const expectedPlain = ["d", "i", "w", "e"].filter(
        (_message, index) => index >= order.indexOf(configured),
      );
      expect(messages.slice(4)).toEqual(expectedPlain);
    },
  );

  it("the process-wide logger and its children write security() with the process level at error", async () => {
    setLogLevel("error");
    const lines = await captureStdout(() => {
      processLogger.security("warn", "process-line");
      processLogger.child({ requestId: "req-2", module: "auth" }).security("info", "child-line");
      processLogger.warn("filtered-line");
    });
    expect(lines.map((line) => (JSON.parse(line) as { message: string }).message)).toEqual([
      "process-line",
      "child-line",
    ]);
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ requestId: "req-2", module: "auth" });
  });

  it.each([["debug"], ["fatal"], ["__proto__"], ["toString"], [undefined], [7], [null]])(
    "a level that is not info, warn, or error (%s) is written as warn, never dropped",
    (level) => {
      const { log, lines } = capturingLogger("error");
      (log.security as (level: unknown, message: string) => void)(level, "coerced");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "warn", message: "coerced" });
    },
  );

  it("fields cannot replace level, message, or timestamp, nor a bound request id", () => {
    const { log, lines } = capturingLogger("error");
    log.child({ requestId: "real-request" }).security("warn", "genuine", {
      level: "debug",
      message: "forged",
      timestamp: "1970-01-01T00:00:00.000Z",
      requestId: "forged-request",
    });
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(parsed.level).toBe("warn");
    expect(parsed.message).toBe("genuine");
    expect(parsed.timestamp).not.toBe("1970-01-01T00:00:00.000Z");
    expect(parsed.requestId).toBe("real-request");
  });

  it("a message or field cannot start a second line or hide text with control characters", () => {
    const { log, lines } = capturingLogger("error");
    // Built from code points so that no raw control character sits in this source file:
    // LF, CR, U+2028, U+2029, U+202E, U+0085, U+009B, U+200B, U+2066.
    const controls = [0x0a, 0x0d, 0x2028, 0x2029, 0x202e, 0x85, 0x9b, 0x200b, 0x2066].map((code) =>
      String.fromCharCode(code),
    );
    const hostile = `sign-in failed${controls[0]}{"level":"info","message":"all good"}${controls.join("")}[31m`;
    log.security("warn", hostile, {
      reason: hostile,
      outcome: [`x${controls[0]}y`, `${controls[8]}z`],
    });
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? "";
    for (const control of controls) {
      expect(line.includes(control)).toBe(false);
    }
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.message).toBe(hostile);
    expect(parsed.reason).toBe(hostile);
  });

  it("secrets and personal data are redacted in security() lines exactly as in other lines", () => {
    // Level warn, so that the comparison line written with warn() is not filtered.
    const { log, lines } = capturingLogger("warn");
    const secretMessage =
      "sign-in failed for victim.person@example.com via postgres://app:Sup3rS3cret@db:5432/x " +
      "with Bearer abcdefghijklmnopqrstuvwxyz0123456789 password=hunter22";
    const fields = {
      clientIp: "203.0.113.70",
      ip: "203.0.113.71",
      email: "victim.person@example.com",
      password: "hunter22",
      sessionToken: "tok_live_abcdefghijklmnop",
      cookie: "better-auth.session_token=abcdef",
      authorization: "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      headers: { "x-forwarded-for": "198.51.100.1" },
      body: { password: "hunter22" },
      name: "Somchai Jaidee",
      userId: "usr_123",
    };
    log.security("warn", secretMessage, fields);
    // The same input through warn() gives the same line apart from the time: one redaction path.
    log.warn(secretMessage, fields);
    expect(lines).toHaveLength(2);
    const [security, plain] = lines.map((line) => JSON.parse(line) as Record<string, unknown>) as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect({ ...security, timestamp: "t" }).toEqual({ ...plain, timestamp: "t" });
    for (const leaked of [
      "victim.person",
      "Sup3rS3cret",
      "hunter22",
      "abcdefghijklmnopqrstuvwxyz0123456789",
      "tok_live",
      "203.0.113.71",
      "198.51.100.1",
      "Somchai",
    ]) {
      expect(lines[0]).not.toContain(leaked);
    }
    // Allowed by SR-04 on security events: the client address under clientIp, and ids.
    expect(security.clientIp).toBe("203.0.113.70");
    expect(security.userId).toBe("usr_123");
  });

  it("security() never throws, whatever it is given or wherever it writes", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const hostileFields = {
      circular,
      big: BigInt(10),
      get trap(): never {
        throw new Error("getter");
      },
    };
    const hostileMessage = {
      toString(): never {
        throw new Error("toString");
      },
    };
    const { log, lines } = capturingLogger("error");
    expect(() => {
      log.security("warn", "ok", hostileFields as never);
    }).not.toThrow();
    expect(() => {
      (log.security as (level: string, message: unknown) => void)("warn", hostileMessage);
    }).not.toThrow();
    expect(lines).toHaveLength(2);
    const failing = createLogger({
      level: "error",
      write: () => {
        throw new Error("sink down");
      },
    });
    expect(() => {
      failing.security("error", "x");
    }).not.toThrow();
  });
});
