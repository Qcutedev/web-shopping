import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "../logger";
import { recordSecurityEvent, THROTTLE_INTERVAL_MS } from "./security-events";

const THROTTLE_KEY = Symbol.for("marketplace.auth.securityEventThrottle");

function capture() {
  const lines: Record<string, unknown>[] = [];
  // Level `error`: every line below must still be written, because it is a security line.
  const log = createLogger({
    level: "error",
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return { log, lines };
}

const base = {
  route: "sign-in",
  clientIp: "203.0.113.7",
  userAgent: `Zq7agent ${"x".repeat(400)}`,
} as const;

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[THROTTLE_KEY];
});

describe("recordSecurityEvent", () => {
  it("writes sign-in and sign-up events whatever LOG_LEVEL is, success at info, failure at warn", () => {
    const { log, lines } = capture();
    recordSecurityEvent(log, "sign-in", { ...base, outcome: "succeeded", userId: "u1" });
    recordSecurityEvent(log, "sign-in", { ...base, outcome: "failed" });
    recordSecurityEvent(log, "sign-up", { ...base, outcome: "accepted" });
    expect(lines.map((line) => [line["event"], line["level"], line["outcome"]])).toEqual([
      ["sign-in", "info", "succeeded"],
      ["sign-in", "warn", "failed"],
      ["sign-up", "info", "accepted"],
    ]);
    expect(lines[0]).toMatchObject({ userId: "u1", clientIp: "203.0.113.7", component: "auth" });
    expect(lines[1]).not.toHaveProperty("userId");
  });

  it("cuts the user agent to 200 characters", () => {
    const { log, lines } = capture();
    recordSecurityEvent(log, "sign-up", { ...base, outcome: "accepted" });
    expect(String(lines[0]?.["userAgent"])).toHaveLength(200);
  });

  it("never writes an error-level line", () => {
    const { log, lines } = capture();
    for (const kind of ["sign-in", "sign-up", "origin-refused", "rate-limited"] as const) {
      recordSecurityEvent(log, kind, { ...base, outcome: "refused", rule: kind });
      recordSecurityEvent(log, kind, { ...base, outcome: "failed", rule: `${kind}-2` });
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line["level"] !== "error")).toBe(true);
  });

  it("throttles events that come before any allowance: one line per kind and rule per minute", () => {
    const { log, lines } = capture();
    const at = 1_000_000;
    for (let i = 0; i < 1_000; i += 1) {
      recordSecurityEvent(
        log,
        "rate-limited",
        { ...base, outcome: "refused", rule: "sign-in-address" },
        at + i,
      );
      recordSecurityEvent(log, "origin-refused", { ...base, outcome: "refused" }, at + i);
    }
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line["suppressed"])).toEqual([0, 0]);

    // Another rule has its own slot.
    recordSecurityEvent(log, "rate-limited", { ...base, outcome: "refused", rule: "sign-up" }, at);
    expect(lines).toHaveLength(3);

    // After the interval the next line carries the count of what was not written.
    recordSecurityEvent(
      log,
      "rate-limited",
      { ...base, outcome: "refused", rule: "sign-in-address" },
      at + THROTTLE_INTERVAL_MS,
    );
    expect(lines).toHaveLength(4);
    expect(lines[3]).toMatchObject({ rule: "sign-in-address", suppressed: 999 });
  });

  it("writes nothing that is not an id or an outcome", () => {
    const { log, lines } = capture();
    recordSecurityEvent(log, "sign-in", { ...base, outcome: "failed" });
    expect(Object.keys(lines[0] ?? {}).sort()).toEqual(
      [
        "clientIp",
        "component",
        "event",
        "level",
        "message",
        "outcome",
        "route",
        "timestamp",
        "userAgent",
      ].sort(),
    );
  });
});
