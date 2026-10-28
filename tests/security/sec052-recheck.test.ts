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
 *      fails here. Re-pinned 2026-10-29 for SEC-052 option (b): `seller-application` and
 *      `review-create` are consumed through `consumeUserRateLimit(actor, USER_RATE_LIMITS.<rule>)`
 *      (counted in the database), `checkout` and `uploads` still through `rateLimiter.consume`;
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
/** Per-user rules counted in the process table (RATE_LIMITS). */
const PER_USER_RULES = ["CHECKOUT", "UPLOADS"] as const;
/** Per-user rules counted in the database since SEC-052 option (b) (USER_RATE_LIMITS). */
const DATABASE_RULES = ["SELLER_APPLICATION", "REVIEW_CREATE"] as const;
const ALL_RULES = [...PER_USER_RULES, ...DATABASE_RULES];

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
  // src/modules is scanned too since SEC-052 option (b), less the rate-limit module that defines
  // the database store, so that a service consuming a per-user rule on its own is caught.
  const files = [
    ...routeFiles(join(ROOT, "src", "app")),
    ...routeFiles(join(ROOT, "src", "server")),
    ...routeFiles(join(ROOT, "src", "modules")),
  ]
    .map((path) => ({
      path: relative(ROOT, path).split(sep).join("/"),
      text: readFileSync(path, "utf8"),
    }))
    .filter(
      ({ text }) =>
        ALL_RULES.some((rule) => new RegExp(`(USER_)?RATE_LIMITS\\.${rule}\\b`).test(text)) ||
        /consumeUserRateLimit\(/.test(text),
    )
    .filter(
      ({ path }) =>
        path !== "src/server/rate-limit.ts" && !path.startsWith("src/modules/rate-limit/"),
    );

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
      const database = [
        ...text.matchAll(/consumeUserRateLimit\(([^,]+),\s*USER_RATE_LIMITS\.(\w+)\)/g),
      ];
      const steps = [...consumes, ...database]
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((m) => [m[1]?.trim(), m[2]]);
      // Re-pinned 2026-10-29 (SEC-052 option (b)): the in-process rules keep
      // `rateLimiter.consume(actor.userId, RATE_LIMITS.<rule>)`; the database rules are
      // `consumeUserRateLimit(actor, USER_RATE_LIMITS.<rule>)`, whose subject is `actor.userId`.
      expect(steps, path).toEqual([
        ["clientIp", "SIGNED_IN_ADDRESS"],
        expect.toSatisfy(
          (step: unknown) =>
            (Array.isArray(step) &&
              step[0] === "actor.userId" &&
              (PER_USER_RULES as readonly string[]).includes(String(step[1]))) ||
            (Array.isArray(step) &&
              step[0] === "actor" &&
              (DATABASE_RULES as readonly string[]).includes(String(step[1]))),
        ),
      ]);
      expect(text, path).toMatch(
        /const clientIp = getClientAddress\(request, env\.trustedProxy\);/,
      );
      // The per-user consume is the true branch of `byAddress.allowed ? ... : byAddress`.
      expect(text, path).toMatch(
        /byAddress\.allowed\s*\?\s*await (rateLimiter\.consume\(actor\.userId, RATE_LIMITS\.\w+\)|consumeUserRateLimit\(actor, USER_RATE_LIMITS\.\w+\))\s*:\s*byAddress/,
      );
      // A JSON handler consumes the per-user rule before the body is read (API_CONTRACTS 1.8).
      if (text.includes("readJsonBody(")) {
        expect(text.indexOf("byAddress.allowed"), path).toBeLessThan(
          text.indexOf("await readJsonBody("),
        );
      }
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
