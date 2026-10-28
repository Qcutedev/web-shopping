/**
 * Security re-check of SEC-052 (commit f3cedda, owner option (a): `signed-in-address`),
 * 2026-10-29. Owner: security. No database: the real limiter with a simulated clock, the real
 * SR-01 address derivation, and the route sources.
 *
 * The author's cases (sec050-recheck.test.ts, SEC-052 block) show that one client can no longer
 * renew 10,000 per-user windows, the new thresholds, and the 24 h residual of
 * `seller-application`. This file adds:
 *
 *   1. a source gate: every route handler under src/app that consumes one of the four signed-in
 *      per-user rules consumes `signed-in-address` first, on `getClientAddress`, and the per-user
 *      rule only when the address rule allowed it. A new handler that forgets the address rule
 *      fails here;
 *   2. the residual of the new rule itself: it holds 5,000 windows and fails closed, and its
 *      subject is the client address, so one account and 5,000 IPv6 /64 networks of one /48 in a
 *      minute (about 83 requests a second) refuse checkout to every address without a live
 *      window. Before the fix that needed 10,000 accounts (an hour of sign-ups from one /48) and
 *      one client; now no extra accounts are needed. Same class as the standing SR-02 residual of
 *      the anonymous rules (one /48 fills a 40,000-window rule), recorded in SECURITY.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 *   it(...)  behaviour checked on 2026-10-29. A failure is a regression, or (block 2) a change
 *            of the residual that SECURITY.md must record.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { getClientAddress } from "@/server/client-address";
import { createRateLimiter, MemoryRateLimitStore, RATE_LIMITS } from "@/server/rate-limit";

const ROOT = process.cwd();
const PER_USER_RULES = ["CHECKOUT", "UPLOADS", "SELLER_APPLICATION", "REVIEW_CREATE"] as const;

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...routeFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("SEC-052 re-check: every signed-in per-user rule sits behind signed-in-address", () => {
  const files = [
    ...routeFiles(join(ROOT, "src", "app")),
    ...routeFiles(join(ROOT, "src", "server")),
  ]
    .map((path) => ({
      path: relative(ROOT, path).split(sep).join("/"),
      text: readFileSync(path, "utf8"),
    }))
    .filter(({ text }) =>
      PER_USER_RULES.some((rule) => new RegExp(`RATE_LIMITS\\.${rule}\\b`).test(text)),
    )
    .filter(({ path }) => path !== "src/server/rate-limit.ts");

  it("the four handlers, and no other file, consume a signed-in per-user rule", () => {
    expect(files.map(({ path }) => path).sort()).toEqual([
      "src/app/api/v1/checkout/route.ts",
      "src/app/api/v1/orders/[id]/items/[itemId]/review/route.ts",
      "src/app/api/v1/seller/application/route.ts",
      "src/app/api/v1/seller/uploads/route.ts",
    ]);
  });

  it("each consumes signed-in-address on the client address, then its rule only when allowed", () => {
    for (const { path, text } of files) {
      const consumes = [...text.matchAll(/rateLimiter\.consume\(([^,]+),\s*RATE_LIMITS\.(\w+)\)/g)];
      expect(
        consumes.map((m) => [m[1]?.trim(), m[2]]),
        path,
      ).toEqual([
        ["clientIp", "SIGNED_IN_ADDRESS"],
        ["actor.userId", expect.stringMatching(new RegExp(`^(${PER_USER_RULES.join("|")})$`))],
      ]);
      expect(text, path).toMatch(
        /const clientIp = getClientAddress\(request, env\.trustedProxy\);/,
      );
      // The per-user consume is the true branch of `byAddress.allowed ? ... : byAddress`.
      expect(text, path).toMatch(
        /byAddress\.allowed\s*\?\s*await rateLimiter\.consume\(actor\.userId, RATE_LIMITS\.\w+\)\s*:\s*byAddress/,
      );
      // The address rule runs after the session (an anonymous request uses no allowance).
      expect(text.indexOf("requireActor("), path).toBeGreaterThan(-1);
      expect(text.indexOf("requireActor("), path).toBeLessThan(
        text.indexOf("RATE_LIMITS.SIGNED_IN_ADDRESS"),
      );
    }
  });
});

const START = 1_800_000_000_000;
const TRUSTED = { trustedProxyHops: 1 };

/** The SR-01 subject of host `::1` in /64 network `i` of 2001:db8:52::/48. */
function network(i: number): string {
  return getClientAddress(
    new Headers({ "x-forwarded-for": `2001:db8:52:${i.toString(16)}::1` }),
    TRUSTED,
  );
}

/** The handlers' order: the address rule, then the per-user rule only when it allowed. */
async function checkout(
  limiter: ReturnType<typeof createRateLimiter>,
  address: string,
  userId: string,
) {
  const byAddress = await limiter.consume(address, RATE_LIMITS.SIGNED_IN_ADDRESS);
  return byAddress.allowed ? limiter.consume(userId, RATE_LIMITS.CHECKOUT) : byAddress;
}

describe("SEC-052 residual: signed-in-address itself is filled by one account and one /48", () => {
  async function attack(networks: number) {
    const clock = { now: START };
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter({ store, now: () => clock.now, logger: { warn: () => {} } });
    // One account only: every request carries the same session.
    for (let i = 0; i < networks; i += 1) await checkout(limiter, network(i), "one-bot-account");
    const addressWindows = store.sizeOf(RATE_LIMITS.SIGNED_IN_ADDRESS.name);
    const userWindows = store.sizeOf(RATE_LIMITS.CHECKOUT.name);
    clock.now += 30_000;
    const customer = await checkout(limiter, "198.51.100.200", "real-customer");
    return { addressWindows, userWindows, customer };
  }

  it("4,999 networks leave room; 5,000 in one minute refuse checkout to every new address", async () => {
    expect(new Set(Array.from({ length: 5_000 }, (_, i) => network(i))).size).toBe(5_000);
    const below = await attack(4_999);
    expect(below.customer).toMatchObject({ allowed: true, saturated: false });
    const at = await attack(5_000);
    expect(at.addressWindows).toBe(5_000);
    // The per-user rule holds one window: the attack needs no extra accounts.
    expect(at.userWindows).toBe(1);
    expect(at.customer).toMatchObject({ allowed: false, saturated: true });
    expect(at.customer.retryAfterSeconds).toBeLessThanOrEqual(60);
    // Steady state: 5,000 new /64 networks a minute, about 83 requests a second.
    expect(Math.round(5_000 / 60)).toBe(83);
  });
});
