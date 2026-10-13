import { afterEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { register } from "./instrumentation";
import { ENV_RULES } from "./server/env";

// The hook is run against the real configuration module, not a mock of it: what is asserted is
// what the server does at start. Nothing here may end the test process, so `process.exit` is
// replaced in every case that can reach it, and standard output is replaced so that each case
// decides whether and when the write reports back.

// Made-up values. Unmistakable, so a case can assert that none of it is written.
const DATABASE_URL = "postgresql://shop_app:Zq7canaryPw@db.example.test:5432/shop";
const APP_URL = "https://shop.example.test";
const AUTH_SECRET = "Zq7canary-auth-secret-0123456789abcdef";

/** A valid environment for the Node.js runtime of a running server; a case overrides parts. */
function stubEnvironment(overrides: Record<string, string | undefined> = {}): void {
  const values: Record<string, string | undefined> = {
    NEXT_RUNTIME: "nodejs",
    NEXT_PHASE: undefined,
    NODE_ENV: "test",
    APP_URL,
    DATABASE_URL,
    AUTH_SECRET,
    DATABASE_URL_TEST: undefined,
    PGPASSWORD: undefined,
    TRUSTED_PROXY_HOPS: undefined,
    TRUSTED_CLIENT_IP_HEADER: undefined,
    PAYMENT_TIMEOUT_MINUTES: undefined,
    LOG_LEVEL: undefined,
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

type WriteCallback = (error?: Error | null) => void;

interface Recorded {
  exit: MockInstance<typeof process.exit>;
  /** Everything written to standard output. */
  written: string[];
  /** Callbacks of writes that have not reported back yet. */
  pending: WriteCallback[];
}

/**
 * Replaces `process.exit` and `process.stdout.write`. With `report: "at once"` a write calls its
 * callback before it returns; with `"never"` the callback is kept in `pending` and not called.
 */
function record(report: "at once" | "never"): Recorded {
  const written: string[] = [];
  const pending: WriteCallback[] = [];
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    written.push(String(chunk));
    const callback = rest.find((item) => typeof item === "function") as WriteCallback | undefined;
    if (callback !== undefined) {
      if (report === "at once") callback();
      else pending.push(callback);
    }
    return true;
  }) as never);
  return { exit, written, pending };
}

/** Runs the hook and returns what it threw, or undefined when it returned. */
async function run(): Promise<unknown> {
  try {
    await register();
  } catch (error) {
    return error;
  }
  return undefined;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = undefined;
});

describe("register: where it does nothing", () => {
  it.each(["edge", "", undefined, "NODEJS", "nodejs "])(
    "does nothing when NEXT_RUNTIME is %j, even with an invalid environment",
    async (runtime) => {
      stubEnvironment({ NEXT_RUNTIME: runtime, APP_URL: undefined, DATABASE_URL: undefined });
      const { exit, written } = record("at once");
      const timers = vi.spyOn(globalThis, "setTimeout");
      expect(await run()).toBeUndefined();
      expect(written).toEqual([]);
      expect(exit).not.toHaveBeenCalled();
      expect(timers).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    },
  );

  it("does nothing in the build phase, even with an invalid environment", async () => {
    stubEnvironment({
      NEXT_PHASE: "phase-production-build",
      APP_URL: undefined,
      DATABASE_URL: undefined,
    });
    const { exit, written } = record("at once");
    const timers = vi.spyOn(globalThis, "setTimeout");
    expect(await run()).toBeUndefined();
    expect(written).toEqual([]);
    expect(exit).not.toHaveBeenCalled();
    expect(timers).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("validates in every other phase of the Node.js runtime", async () => {
    for (const phase of ["phase-production-server", "phase-development-server", "anything"]) {
      stubEnvironment({ NEXT_PHASE: phase, APP_URL: undefined });
      const { exit } = record("at once");
      expect(await run()).toBeInstanceOf(Error);
      expect(exit).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
      vi.resetModules();
    }
  });
});

describe("register: a valid environment", () => {
  it("returns, writes nothing, sets no exit code, and requests no exit", async () => {
    stubEnvironment();
    const { exit, written } = record("at once");
    const timers = vi.spyOn(globalThis, "setTimeout");
    expect(await run()).toBeUndefined();
    expect(written).toEqual([]);
    expect(exit).not.toHaveBeenCalled();
    expect(timers).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("has validated the environment: the configuration is there, and LOG_LEVEL is in force", async () => {
    stubEnvironment({ LOG_LEVEL: "warn", PAYMENT_TIMEOUT_MINUTES: "7" });
    record("at once");
    expect(await run()).toBeUndefined();
    // The same module instances the hook loaded.
    const { getEnv } = await import("./server/env");
    const { getLogLevel } = await import("./server/logger");
    vi.stubEnv("PAYMENT_TIMEOUT_MINUTES", "9");
    expect(getEnv().paymentTimeoutMinutes).toBe(7);
    expect(getLogLevel()).toBe("warn");
  });
});

describe("register: an invalid environment ends the process", () => {
  it("writes the line that names the variables, sets exit code 1, exits from the write callback, and rethrows", async () => {
    stubEnvironment({ APP_URL: undefined, PAYMENT_TIMEOUT_MINUTES: "Zq7canary-soon" });
    const { exit, written, pending } = record("never");
    const thrown = await run();

    const { EnvValidationError } = await import("./server/env");
    expect(thrown).toBeInstanceOf(EnvValidationError);
    expect((thrown as InstanceType<typeof EnvValidationError>).issues).toEqual([
      { variable: "APP_URL", rule: ENV_RULES.required },
      { variable: "PAYMENT_TIMEOUT_MINUTES", rule: ENV_RULES.paymentTimeoutMinutes },
    ]);
    expect(process.exitCode).toBe(1);

    // The log line first, then the empty write whose callback is the exit.
    expect(written).toHaveLength(2);
    expect(JSON.parse(written[0] ?? "{}")).toMatchObject({
      level: "error",
      component: "env",
      message: "Environment validation failed. The server cannot start.",
      issues: [
        { variable: "APP_URL", rule: ENV_RULES.required },
        { variable: "PAYMENT_TIMEOUT_MINUTES", rule: ENV_RULES.paymentTimeoutMinutes },
      ],
    });
    expect(written[1]).toBe("");
    for (const value of ["Zq7canary", "example.test", "shop_app"]) {
      expect(written.join("")).not.toContain(value);
    }

    // Not before standard output has taken the line.
    expect(exit).not.toHaveBeenCalled();
    expect(pending).toHaveLength(1);
    pending[0]?.();
    expect(exit.mock.calls).toEqual([[1]]);
  });

  it("exits once: the callback cancels the fallback timer", async () => {
    vi.useFakeTimers();
    stubEnvironment({ DATABASE_URL: undefined });
    const { exit, pending } = record("never");
    expect(await run()).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(1);
    pending[0]?.();
    expect(exit.mock.calls).toEqual([[1]]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(exit.mock.calls).toEqual([[1]]);
  });

  it("exits once when standard output reports back before the write returns", async () => {
    vi.useFakeTimers();
    stubEnvironment({ DATABASE_URL: undefined });
    const { exit } = record("at once");
    expect(await run()).toBeInstanceOf(Error);
    expect(exit.mock.calls).toEqual([[1]]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(exit.mock.calls).toEqual([[1]]);
  });

  // CR-44: the exit must not depend on the callback alone.
  it("exits after 2 seconds when standard output never reports back", async () => {
    vi.useFakeTimers();
    stubEnvironment({ APP_URL: "not a url" });
    const { exit, pending } = record("never");
    expect(await run()).toBeInstanceOf(Error);
    expect(process.exitCode).toBe(1);
    expect(pending).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit.mock.calls).toEqual([[1]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the process alive for the fallback: the timer is not unref'd", async () => {
    stubEnvironment({ APP_URL: undefined });
    const { pending } = record("never");
    const timers = vi.spyOn(globalThis, "setTimeout");
    let timer: NodeJS.Timeout | undefined;
    try {
      expect(await run()).toBeInstanceOf(Error);
      expect(timers).toHaveBeenCalledTimes(1);
      expect(timers.mock.calls[0]?.[1]).toBe(2_000);
      timer = timers.mock.results[0]?.value as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(true);
    } finally {
      // A real timer: it is cancelled here, as the callback does, so that it never fires.
      clearTimeout(timer);
      pending[0]?.();
    }
  });

  it("ends the process when the configuration module cannot be loaded", async () => {
    stubEnvironment();
    vi.doMock("./server/env", () => {
      throw new Error("module failed to load");
    });
    try {
      const { exit, pending } = record("never");
      const thrown = await run();
      expect(thrown).toBeInstanceOf(Error);
      expect(process.exitCode).toBe(1);
      expect(pending).toHaveLength(1);
      expect(exit).not.toHaveBeenCalled();
      pending[0]?.();
      expect(exit.mock.calls).toEqual([[1]]);
    } finally {
      vi.doUnmock("./server/env");
    }
  });

  it("ends the process for a refusal that applies in production only", async () => {
    stubEnvironment({
      NODE_ENV: "production",
      TRUSTED_PROXY_HOPS: "1",
      DATABASE_URL: "postgresql://shop_app:local%5Fdev_only_not_a_secret@db.example.test/shop",
    });
    const { exit, written } = record("at once");
    const thrown = await run();
    expect((thrown as Error).name).toBe("EnvValidationError");
    expect(process.exitCode).toBe(1);
    expect(exit.mock.calls).toEqual([[1]]);
    expect(written[0]).toContain(ENV_RULES.databaseUrlPlaceholder);
    expect(written.join("")).not.toContain("not_a_secret");
    expect(written.join("")).not.toContain("example.test");
  });
});
