/**
 * SEC-099: the count of refused maintenance requests per client address.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertRateLimitRules } from "@/server/rate-limit";

import { countMaintenanceRefusal, MAINTENANCE_REFUSED_RULE } from "./refusal-limit";

const LIMITER_KEY = Symbol.for("marketplace.maintenance.refusalLimiter");

function resetLimiter(): void {
  delete (globalThis as Record<symbol, unknown>)[LIMITER_KEY];
}

beforeEach(resetLimiter);
afterEach(() => {
  resetLimiter();
  vi.useRealTimers();
  vi.resetModules();
});

describe("MAINTENANCE_REFUSED_RULE", () => {
  it("is a valid rule of its own: 10 per minute, 1,000 addresses", () => {
    expect(() => assertRateLimitRules([MAINTENANCE_REFUSED_RULE])).not.toThrow();
    expect(MAINTENANCE_REFUSED_RULE).toEqual({
      name: "maintenance-refused",
      limit: 10,
      windowMs: 60_000,
      maxKeys: 1_000,
    });
  });
});

describe("countMaintenanceRefusal", () => {
  it("allows the first 10 refusals of an address in a minute and refuses the 11th", async () => {
    for (let index = 0; index < MAINTENANCE_REFUSED_RULE.limit; index += 1) {
      expect((await countMaintenanceRefusal("203.0.113.7")).allowed).toBe(true);
    }
    const eleventh = await countMaintenanceRefusal("203.0.113.7");
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(eleventh.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("counts each address on its own", async () => {
    for (let index = 0; index <= MAINTENANCE_REFUSED_RULE.limit; index += 1) {
      await countMaintenanceRefusal("203.0.113.7");
    }
    expect((await countMaintenanceRefusal("203.0.113.7")).allowed).toBe(false);
    expect((await countMaintenanceRefusal("198.51.100.4")).allowed).toBe(true);
    expect((await countMaintenanceRefusal("unknown")).allowed).toBe(true);
  });

  it("opens again when the window has passed", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-30T00:00:00Z") });
    for (let index = 0; index <= MAINTENANCE_REFUSED_RULE.limit; index += 1) {
      await countMaintenanceRefusal("203.0.113.7");
    }
    expect((await countMaintenanceRefusal("203.0.113.7")).allowed).toBe(false);
    vi.setSystemTime(new Date("2026-10-30T00:01:00.001Z"));
    expect((await countMaintenanceRefusal("203.0.113.7")).allowed).toBe(true);
  });

  it("counts in one table per process, shared by every copy of the module (SEC-030)", async () => {
    for (let index = 0; index < MAINTENANCE_REFUSED_RULE.limit; index += 1) {
      await countMaintenanceRefusal("203.0.113.7");
    }
    vi.resetModules();
    const copy = await import("./refusal-limit");
    expect(copy.countMaintenanceRefusal).not.toBe(countMaintenanceRefusal);
    expect((await copy.countMaintenanceRefusal("203.0.113.7")).allowed).toBe(false);
  });
});
