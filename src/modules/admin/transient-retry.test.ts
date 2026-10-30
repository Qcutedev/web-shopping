/**
 * Unit tests of the bounded retry of an admin write transaction (SECURITY.md SEC-096 remediation
 * (b)): which errors count as a transient conflict, how many attempts are made, the jittered pause
 * between them, and that every other error, an `AppError` above all, goes on at the first attempt.
 * A real deadlock against PostgreSQL is forced in tests/integration/admin/deadlock-retry.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

import { Prisma } from "@/server/db";
import { AppError, unauthenticated } from "@/server/errors";

import {
  ADMIN_RETRY_BASE_DELAY_MS,
  ADMIN_WRITE_ATTEMPTS,
  DEADLOCK_SQLSTATE,
  isTransientTransactionConflict,
  retryDelayMs,
  retryTransientConflict,
  SERIALIZATION_FAILURE_SQLSTATE,
} from "./transient-retry";

function knownError(code: string, cause?: unknown): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("failed", {
    code,
    clientVersion: "test",
    meta: cause === undefined ? undefined : { driverAdapterError: { cause } },
  });
}

/** The shape `@prisma/adapter-pg` 7.10 gives a deadlock of a `$queryRaw` statement. */
function rawDeadlock(): Prisma.PrismaClientKnownRequestError {
  return knownError("P2010", { kind: "TransactionWriteConflict", originalCode: "40P01" });
}

describe("isTransientTransactionConflict", () => {
  it("names the two SQLSTATEs", () => {
    expect(DEADLOCK_SQLSTATE).toBe("40P01");
    expect(SERIALIZATION_FAILURE_SQLSTATE).toBe("40001");
  });

  it.each([
    ["P2034 (model API write conflict or deadlock)", knownError("P2034")],
    ["P2034 with the adapter's cause", knownError("P2034", { originalCode: "40P01" })],
    ["P2010 with 40P01 (raw statement deadlock)", rawDeadlock()],
    [
      "P2010 with 40001 (raw statement serialization failure)",
      knownError("P2010", { originalCode: "40001" }),
    ],
  ])("is true for %s", (_label, error) => {
    expect(isTransientTransactionConflict(error)).toBe(true);
  });

  it.each([
    ["P2010 with another SQLSTATE", knownError("P2010", { originalCode: "23505" })],
    ["P2010 with a lock timeout (55P03)", knownError("P2010", { originalCode: "55P03" })],
    ["P2010 with a statement timeout (57014)", knownError("P2010", { originalCode: "57014" })],
    ["P2010 without meta", knownError("P2010")],
    ["P2010 with the code as a number", knownError("P2010", { originalCode: 40001 })],
    ["P2002 (unique violation)", knownError("P2002", { originalCode: "23505" })],
    ["P2003 (foreign key)", knownError("P2003", { originalCode: "23503" })],
    ["P2028 (transaction API error or timeout)", knownError("P2028")],
    [
      "P2039 with 40P01 (not the adapter's mapped form)",
      knownError("P2039", { originalCode: "40P01" }),
    ],
    ["an AppError", unauthenticated()],
    ["a plain Error that mentions a deadlock", new Error("deadlock detected 40P01 P2034")],
    ["an object with code P2034", { code: "P2034" }],
    ["a string", "P2034"],
    ["null", null],
    ["undefined", undefined],
  ])("is false for %s", (_label, error) => {
    expect(isTransientTransactionConflict(error)).toBe(false);
  });

  it("does not read an inherited SQLSTATE", () => {
    const cause = Object.create({ originalCode: "40P01" }) as object;
    expect(isTransientTransactionConflict(knownError("P2010", cause))).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("doubles per failed attempt and stays within [0.5, 1.5) of the scale", () => {
    expect(retryDelayMs(1, 0, 25)).toBe(12);
    expect(retryDelayMs(1, 0.999, 25)).toBe(37);
    expect(retryDelayMs(2, 0, 25)).toBe(25);
    expect(retryDelayMs(2, 0.999, 25)).toBe(74);
  });

  it("keeps the default pauses short (under 100 ms before the last attempt)", () => {
    for (let failed = 1; failed < ADMIN_WRITE_ATTEMPTS; failed += 1) {
      expect(retryDelayMs(failed, 0.999_999, ADMIN_RETRY_BASE_DELAY_MS)).toBeLessThan(100);
    }
  });
});

function noSleep() {
  return vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
}

describe("retryTransientConflict", () => {
  it("defaults to three attempts", () => {
    expect(ADMIN_WRITE_ATTEMPTS).toBe(3);
  });

  it("returns the first result without a pause", async () => {
    const run = vi.fn().mockResolvedValue("done");
    const sleep = noSleep();
    await expect(retryTransientConflict(run, { sleep })).resolves.toBe("done");
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("runs again after a deadlock and returns the second attempt's result", async () => {
    const run = vi.fn().mockRejectedValueOnce(rawDeadlock()).mockResolvedValueOnce("second");
    const sleep = noSleep();
    await expect(retryTransientConflict(run, { sleep, random: () => 0.5 })).resolves.toBe("second");
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(retryDelayMs(1, 0.5, ADMIN_RETRY_BASE_DELAY_MS));
  });

  it("gives up after three attempts and throws the last error unchanged", async () => {
    const errors = [knownError("P2034"), rawDeadlock(), rawDeadlock()];
    const run = vi
      .fn()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2])
      .mockResolvedValue("never");
    const sleep = noSleep();
    const outcome = await retryTransientConflict(run, { sleep }).catch((error: unknown) => error);
    expect(outcome).toBe(errors[2]);
    expect(run).toHaveBeenCalledTimes(3);
    // A pause between attempts, none after the last.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("pauses longer before the third attempt than before the second (same random)", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(rawDeadlock())
      .mockRejectedValueOnce(rawDeadlock())
      .mockResolvedValue("third");
    const sleep = noSleep();
    await expect(retryTransientConflict(run, { sleep, random: () => 0 })).resolves.toBe("third");
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([12, 25]);
  });

  it.each([
    ["a 401 of the acting-admin check", unauthenticated()],
    ["a unique violation", knownError("P2002", { originalCode: "23505" })],
    ["a transaction timeout", knownError("P2028")],
    ["a plain Error", new Error("boom")],
  ])("throws %s at once, without another attempt", async (_label, error) => {
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("never");
    const sleep = noSleep();
    const outcome = await retryTransientConflict(run, { sleep }).catch((thrown: unknown) => thrown);
    expect(outcome).toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops at a refusal that follows a deadlock: the second attempt's 401 goes on", async () => {
    const refusal = unauthenticated();
    const run = vi
      .fn()
      .mockRejectedValueOnce(rawDeadlock())
      .mockRejectedValueOnce(refusal)
      .mockResolvedValue("never");
    const outcome = await retryTransientConflict(run, { sleep: noSleep() }).catch(
      (error: unknown) => error,
    );
    expect(outcome).toBe(refusal);
    expect(outcome).toBeInstanceOf(AppError);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("honours a smaller bound: one attempt never retries", async () => {
    const error = rawDeadlock();
    const run = vi.fn().mockRejectedValue(error);
    const outcome = await retryTransientConflict(run, { attempts: 1, sleep: noSleep() }).catch(
      (thrown: unknown) => thrown,
    );
    expect(outcome).toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses %s attempts before running anything", async (n) => {
    const run = vi.fn().mockResolvedValue("never");
    await expect(retryTransientConflict(run, { attempts: n })).rejects.toThrow(
      "at least one attempt",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("waits with the real timer by default", async () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn().mockRejectedValueOnce(rawDeadlock()).mockResolvedValueOnce("second");
      const promise = retryTransientConflict(run, { random: () => 0 });
      await vi.advanceTimersByTimeAsync(11);
      expect(run).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(promise).resolves.toBe("second");
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
