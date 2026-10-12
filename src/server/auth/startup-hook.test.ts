/**
 * The start-up hook starts the expired-session purge (SR-07 item 5) only after the environment
 * was validated, and never in a test process. The purge module is replaced, so nothing here
 * reaches a database; the hook's own tests are in src/instrumentation.test.ts (devops).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "../../instrumentation";
// One spy for every fresh copy of the module (the hook loads it after `vi.resetModules()`).
const scheduled = vi.hoisted(() => vi.fn(() => true));
vi.mock("./session-purge", () => ({ startSessionPurgeSchedule: scheduled }));

function stubEnvironment(overrides: Record<string, string | undefined> = {}): void {
  const values: Record<string, string | undefined> = {
    NEXT_RUNTIME: "nodejs",
    NEXT_PHASE: undefined,
    NODE_ENV: "development",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://u:Zq7canaryPw@db.example.test:5432/shop",
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

function silence(): void {
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  vi.spyOn(process.stdout, "write").mockImplementation(((_chunk: unknown, ...rest: unknown[]) => {
    const callback = rest.find((item) => typeof item === "function") as (() => void) | undefined;
    callback?.();
    return true;
  }) as never);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // getEnv() keeps its result per copy of src/server/env.ts: each case gets a fresh copy.
  vi.resetModules();
  scheduled.mockClear();
  process.exitCode = undefined;
});

describe("register and the session purge", () => {
  it("starts the purge once, in a server process with a valid environment", async () => {
    stubEnvironment();
    silence();
    await register();
    expect(scheduled).toHaveBeenCalledTimes(1);
  });

  it("starts nothing when the environment is invalid", async () => {
    stubEnvironment({ APP_URL: undefined });
    silence();
    await expect(register()).rejects.toThrow();
    expect(scheduled).not.toHaveBeenCalled();
  });

  it("starts nothing in a test process, in the build phase, or outside Node.js", async () => {
    for (const overrides of [
      { NODE_ENV: "test" },
      { NEXT_PHASE: "phase-production-build" },
      { NEXT_RUNTIME: "edge" },
    ]) {
      stubEnvironment(overrides);
      silence();
      await register();
      vi.restoreAllMocks();
      vi.resetModules();
    }
    expect(scheduled).not.toHaveBeenCalled();
  });
});
