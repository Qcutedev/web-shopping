/**
 * SEC-032 (D-036 item 5): the per-email limits of sign-in, run in the order of the sign-in route
 * (`sign-in-address`, then `signInEmailChecks` in order, each only after the one before allowed)
 * against a limiter with the built-in rule set and a simulated clock. The integration cases in
 * tests/security/t015-t016-auth.itest.ts and tests/integration/auth/limits-and-cookies.test.ts
 * show the same through the route itself.
 */
import { describe, expect, it } from "vitest";

import { createRateLimiter, RATE_LIMITS, type RateLimiter } from "./rate-limit";
import {
  SIGN_IN_MAX_RETRY_AFTER_SECONDS,
  signInEmailChecks,
  signInEmailSubject,
  signInRetryAfterSeconds,
} from "./sign-in-rate-limit";

const START = 1_800_000_000_000;
const SECOND = 1_000;
const EMAIL = "owner@example.com";
const OWNER = "198.51.100.7";

interface Attempt {
  /** True when every limit allowed the request, so the password would be checked. */
  allowed: boolean;
  /** The rule that refused, when one did. */
  refusedBy?: string;
  /** Hits left in the `sign-in-account` window after this attempt, when it got that far. */
  accountRemaining?: number;
  retryAfterSeconds?: number;
}

function harness() {
  const clock = { now: START };
  const limiter: RateLimiter = createRateLimiter({ now: () => clock.now });

  /** One sign-in request from `address` for `email`, limits only, in the route's order. */
  async function attempt(address: string, email = EMAIL): Promise<Attempt> {
    const first = await limiter.consume(address, RATE_LIMITS.SIGN_IN_ADDRESS);
    if (!first.allowed) {
      return {
        allowed: false,
        refusedBy: RATE_LIMITS.SIGN_IN_ADDRESS.name,
        retryAfterSeconds: first.retryAfterSeconds,
      };
    }
    let accountRemaining: number | undefined;
    for (const check of signInEmailChecks(address, email)) {
      const result = await limiter.consume(check.subject, check.rule);
      if (check.rule.name === RATE_LIMITS.SIGN_IN_ACCOUNT.name) {
        accountRemaining = result.remaining;
      }
      if (!result.allowed) {
        return {
          allowed: false,
          refusedBy: check.rule.name,
          retryAfterSeconds: result.retryAfterSeconds,
          ...(accountRemaining === undefined ? {} : { accountRemaining }),
        };
      }
    }
    return { allowed: true, ...(accountRemaining === undefined ? {} : { accountRemaining }) };
  }

  /** `count` attempts from `address` now; returns how many got past every limit. */
  async function burst(address: string, count: number): Promise<number> {
    let passed = 0;
    for (let index = 0; index < count; index += 1) {
      if ((await attempt(address)).allowed) passed += 1;
    }
    return passed;
  }

  return {
    attempt,
    burst,
    at(seconds: number) {
      clock.now = START + seconds * SECOND;
    },
  };
}

/**
 * The strongest timing an address has against one `sign-in-account` window, for each of
 * `addresses` in step. A first hit at `start - 300` opens the account window before; a hit at
 * `start - 1` opens the address's own 60 s windows one second before the next account window
 * starts at `start`, so six of them overlap it. That window then holds 4 + 5 * 5 = 29 hits of each
 * address by `start + 299` s. Returns the attempts that got past every limit, per address.
 */
async function straddle(
  h: ReturnType<typeof harness>,
  addresses: readonly string[],
  start: number,
): Promise<number[]> {
  const passed = addresses.map(() => 0);
  const step = async (seconds: number, count: number) => {
    h.at(seconds);
    for (const [index, address] of addresses.entries()) {
      passed[index] = (passed[index] ?? 0) + (await h.burst(address, count));
    }
  };
  await step(start - 300, 1);
  await step(start - 1, 1);
  await step(start, 10);
  for (let minute = 1; minute <= 5; minute += 1) await step(start - 1 + minute * 60, 10);
  return passed;
}

describe("sign-in-email subject (SEC-032)", () => {
  it("is the client address and the normalised email, joined by |", () => {
    expect(signInEmailSubject("203.0.113.66", EMAIL)).toBe("203.0.113.66|owner@example.com");
    expect(signInEmailSubject("2001:db8:1:2::/64", EMAIL)).toBe(
      "2001:db8:1:2::/64|owner@example.com",
    );
    expect(signInEmailSubject("unknown", EMAIL)).toBe("unknown|owner@example.com");
  });

  it("two addresses get two subjects for one email; an email holding | cannot borrow another's", () => {
    expect(signInEmailSubject("203.0.113.1", EMAIL)).not.toBe(
      signInEmailSubject("203.0.113.2", EMAIL),
    );
    // The address never holds the separator, so the first | always ends it.
    expect(signInEmailSubject("203.0.113.1", "a|b@example.com")).toBe(
      "203.0.113.1|a|b@example.com",
    );
    expect(() => signInEmailSubject("203.0.113.1|a", "b@example.com")).toThrow(TypeError);
  });

  it("refuses an empty address or email", () => {
    expect(() => signInEmailSubject("", EMAIL)).toThrow(TypeError);
    expect(() => signInEmailSubject("203.0.113.1", "")).toThrow(TypeError);
  });

  it("the checks are sign-in-email on address and email, then sign-in-account on the email", () => {
    expect(signInEmailChecks("203.0.113.1", EMAIL)).toEqual([
      { subject: "203.0.113.1|owner@example.com", rule: RATE_LIMITS.SIGN_IN_EMAIL },
      { subject: EMAIL, rule: RATE_LIMITS.SIGN_IN_ACCOUNT },
    ]);
  });
});

describe("one address cannot keep an account from signing in (SEC-032)", () => {
  it("after five attempts from one address, that address is refused and the owner elsewhere is not", async () => {
    const h = harness();
    h.at(0);
    expect(await h.burst("203.0.113.66", 5)).toBe(5);
    expect(await h.attempt("203.0.113.66")).toMatchObject({ allowed: false });
    expect(await h.attempt(OWNER)).toMatchObject({ allowed: true });
  });

  it("an address over its per-address limit uses no per-email or per-account allowance", async () => {
    const h = harness();
    h.at(0);
    expect(await h.burst("203.0.113.66", 50)).toBe(5);
    // 5 of the address's hits reached sign-in-account; the owner's is the 6th.
    expect(await h.attempt(OWNER)).toEqual({ allowed: true, accountRemaining: 54 });
  });

  it("sign-in-account is not exhausted by one address at full rate over 10 simulated minutes", async () => {
    const h = harness();
    // Every second for ten minutes, ten attempts a second, and the owner once a minute.
    for (let second = 0; second < 600; second += 1) {
      h.at(second);
      await h.burst("203.0.113.66", 10);
      if (second % 60 === 59) expect(await h.attempt(OWNER)).toMatchObject({ allowed: true });
    }
  });

  it("at its strongest timing one address adds 29 hits to a window of 60", async () => {
    const h = harness();
    // 1 (window before) + 1 (window before, own window opened) + 4 + 5 * 5.
    expect(await straddle(h, ["203.0.113.66"], 300)).toEqual([31]);
    h.at(599);
    // 29 hits of the address in this window (its first fell in the window before), then this one.
    expect(await h.attempt(OWNER)).toEqual({ allowed: true, accountRemaining: 30 });
  });
});

describe("several addresses together exhaust sign-in-account (SEC-032 residual)", () => {
  it("two addresses at their strongest timing reach 58; a third address exhausts the window", async () => {
    const h = harness();
    expect(await straddle(h, ["203.0.113.66", "203.0.113.67"], 300)).toEqual([31, 31]);
    h.at(599);
    expect(await h.attempt(OWNER)).toEqual({ allowed: true, accountRemaining: 1 });
    expect(await h.burst("192.0.2.1", 1)).toBe(1);
    const refused = await h.attempt(OWNER);
    expect(refused).toMatchObject({ allowed: false, refusedBy: "sign-in-account" });
    // The window ends at 600 s; the reported wait is capped to the per-address window.
    expect(signInRetryAfterSeconds(refused.retryAfterSeconds ?? 0)).toBe(1);
    h.at(600);
    expect(await h.attempt(OWNER)).toMatchObject({ allowed: true });
  });

  it("twelve addresses at five a minute exhaust it; the 61st attempt is refused for every address", async () => {
    const h = harness();
    h.at(0);
    for (let index = 1; index <= 12; index += 1) {
      expect(await h.burst(`203.0.113.${String(index)}`, 5)).toBe(5);
    }
    const refused = await h.attempt(OWNER);
    expect(refused).toMatchObject({ allowed: false, refusedBy: "sign-in-account" });
    expect(refused.retryAfterSeconds).toBe(300);
    // Another email is not affected.
    expect(await h.attempt(OWNER, "other@example.com")).toMatchObject({ allowed: true });
    h.at(299);
    expect(await h.attempt("192.0.2.9")).toMatchObject({ allowed: false });
    h.at(300);
    expect(await h.attempt("192.0.2.9")).toMatchObject({ allowed: true });
  });
});

describe("Retry-After of a refused sign-in (SEC-032 item 4)", () => {
  it("is at most the per-address window, so it does not tell which limit refused", () => {
    expect(SIGN_IN_MAX_RETRY_AFTER_SECONDS).toBe(60);
    expect(signInRetryAfterSeconds(300)).toBe(60);
    expect(signInRetryAfterSeconds(61)).toBe(60);
    expect(signInRetryAfterSeconds(60)).toBe(60);
    expect(signInRetryAfterSeconds(1)).toBe(1);
  });
});
