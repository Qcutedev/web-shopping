/**
 * Independent re-check of SEC-055 item 1 (commit 35903a1): the start-up hook starts the payment
 * timeout sweep (docs/SECURITY.md, SEC-055; reviewer: security, 2026-10-14).
 *
 * The flipped case in t032-checkout.test.ts only matches the hook's source text. These cases run
 * the real hook (`register`) and the real schedule module (`timeout-sweep.ts`); only the database
 * work below them is replaced (`failOverdueOrders`, the session purge), so no database is needed.
 *
 * What is asserted:
 *   - the hook starts the sweep with the validated `PAYMENT_TIMEOUT_MINUTES`, once at start;
 *   - one schedule per process, even when the hook runs again from a fresh module copy (the
 *     `Symbol.for` slot on `globalThis` is what holds it, not module state);
 *   - a sweep that rejects does not make the hook throw, does not end the process, and does not
 *     stop the schedule; its log line holds the error class only, never the message;
 *   - runs do not overlap, and the timer does not keep a stopping process alive;
 *   - nothing starts with NODE_ENV=test, in the build phase, or outside the Node.js runtime.
 *
 * The real start (next start, a disposable PostgreSQL, an overdue order failed with reason
 * TIMEOUT) is recorded as evidence in docs/SECURITY.md, SEC-055.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCHEDULE_KEY = Symbol.for("marketplace.orders.paymentTimeoutSweepSchedule");
const PURGE_MODULE = "../../src/server/auth/session-purge";
const SERVICE_MODULE = "../../src/modules/orders/service";

// Made-up values, unmistakable, never real.
const BASE_ENV: Record<string, string | undefined> = {
  NEXT_RUNTIME: "nodejs",
  NEXT_PHASE: undefined,
  NODE_ENV: "development",
  APP_URL: "https://shop.example.test",
  DATABASE_URL: "postgresql://shop_app:Zq7canaryPw@db.example.test:5432/shop",
  AUTH_SECRET: "Zq7canary-auth-secret-0123456789abcdef",
  DATABASE_URL_TEST: undefined,
  PGPASSWORD: undefined,
  TRUSTED_PROXY_HOPS: undefined,
  TRUSTED_CLIENT_IP_HEADER: undefined,
  PAYMENT_TIMEOUT_MINUTES: "7",
  LOG_LEVEL: undefined,
};

function stubEnvironment(overrides: Record<string, string | undefined> = {}): void {
  for (const [name, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    vi.stubEnv(name, value);
  }
}

type SweepFn = (minutes: number) => Promise<{ found: number; failed: number; errored: number }>;

interface Harness {
  sweep: ReturnType<typeof vi.fn<SweepFn>>;
  written: string[];
  exit: ReturnType<typeof vi.spyOn>;
}

/** Replaces only the database work; the hook and the schedule module stay real. */
function harness(sweepImpl: SweepFn): Harness {
  const sweep = vi.fn<SweepFn>(sweepImpl);
  vi.doMock(PURGE_MODULE, () => ({ startSessionPurgeSchedule: vi.fn() }));
  vi.doMock(SERVICE_MODULE, async (importOriginal) => ({
    ...(await importOriginal<object>()),
    failOverdueOrders: sweep,
  }));
  const written: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    written.push(String(chunk));
    const callback = rest.find((item) => typeof item === "function") as (() => void) | undefined;
    callback?.();
    return true;
  }) as never);
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  return { sweep, written, exit };
}

async function loadRegister(): Promise<() => Promise<void>> {
  const hook = await import("../../src/instrumentation");
  return hook.register;
}

function scheduleSlot(): { timer: ReturnType<typeof setInterval>; running: boolean } | undefined {
  return (globalThis as Record<symbol, never>)[SCHEDULE_KEY];
}

function clearSlot(): void {
  const slot = scheduleSlot();
  if (slot !== undefined) clearInterval(slot.timer);
  delete (globalThis as Record<symbol, unknown>)[SCHEDULE_KEY];
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(() => {
  clearSlot();
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  clearSlot();
  vi.useRealTimers();
  vi.doUnmock(PURGE_MODULE);
  vi.doUnmock(SERVICE_MODULE);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  process.exitCode = undefined;
});

const OK = async () => ({ found: 0, failed: 0, errored: 0 });

describe("SEC-055 item 1 re-check: the hook starts the sweep", () => {
  it("runs the sweep once at start with the validated timeout, then once per minute", async () => {
    stubEnvironment();
    const { sweep, written, exit } = harness(OK);
    await expect((await loadRegister())()).resolves.toBeUndefined();
    await flush();
    expect(sweep.mock.calls.map((call) => call[0])).toEqual([7]);
    expect(written.join("")).toContain('"message":"Payment timeout sweep ran"');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sweep).toHaveBeenCalledTimes(4);
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("keeps one schedule per process when the hook runs again from a fresh module copy", async () => {
    stubEnvironment();
    const { sweep } = harness(OK);
    await (
      await loadRegister()
    )();
    // A second copy of every module (as the framework's separate bundles would load), same process.
    vi.resetModules();
    await (
      await loadRegister()
    )();
    await flush();
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("does not end start-up or the schedule when the sweep rejects, and logs the class only", async () => {
    stubEnvironment();
    const failure = Object.assign(new Error("Zq7canary row contents"), { code: "P2028" });
    const { sweep, written, exit } = harness(async () => {
      throw failure;
    });
    await expect((await loadRegister())()).resolves.toBeUndefined();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    const out = written.join("");
    expect(out).toContain('"message":"Payment timeout sweep failed"');
    expect(out).toContain('"errorCode":"P2028"');
    expect(out).not.toContain("Zq7canary");
    expect(exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("does not overlap runs, and the timer does not hold the process open", async () => {
    stubEnvironment();
    let release: () => void = () => undefined;
    const { sweep } = harness(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ found: 0, failed: 0, errored: 0 });
        }),
    );
    await (
      await loadRegister()
    )();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sweep).toHaveBeenCalledTimes(1);
    release();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(scheduleSlot()?.timer.hasRef()).toBe(false);
  });

  it.each([
    ["NODE_ENV=test", { NODE_ENV: "test" }],
    ["the build phase", { NEXT_PHASE: "phase-production-build" }],
    ["the edge runtime", { NEXT_RUNTIME: "edge" }],
    ["no runtime", { NEXT_RUNTIME: undefined }],
  ])("starts nothing in %s", async (_label, overrides) => {
    stubEnvironment(overrides);
    const { sweep } = harness(OK);
    await (
      await loadRegister()
    )();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sweep).not.toHaveBeenCalled();
    expect(scheduleSlot()).toBeUndefined();
  });

  it("starts nothing when the environment is invalid", async () => {
    stubEnvironment({ PAYMENT_TIMEOUT_MINUTES: "0" });
    const { sweep, exit } = harness(OK);
    await expect((await loadRegister())()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sweep).not.toHaveBeenCalled();
    expect(scheduleSlot()).toBeUndefined();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
