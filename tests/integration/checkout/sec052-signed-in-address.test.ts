/**
 * SEC-052: `signed-in-address` against the real route handlers and the real test database
 * (docs/API_CONTRACTS.md sections 1.8 step 5 and 6). Every signed-in endpoint with a limit
 * consumes it on the client address (SR-01) before its per-user rule, and one counter covers the
 * four endpoints together. The test environment trusts no proxy, so every request has the SR-01
 * subject `unknown`: one address, as one attacking client would be.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as checkoutRoute } from "@/app/api/v1/checkout/route";
import { POST as reviewRoute } from "@/app/api/v1/orders/[id]/items/[itemId]/review/route";
import { RATE_LIMITS } from "@/server/rate-limit";

import { APP_ORIGIN, APP_URL, resetProcessRateLimiter, stubAuthEnvironment } from "../auth/support";
import { newKey, signedIn, type SignedIn } from "./support";

beforeAll(() => {
  stubAuthEnvironment();
});

beforeEach(() => {
  resetProcessRateLimiter();
});

/** A checkout whose body is invalid JSON: it can only end at 400, or at 429 before the body. */
function invalidCheckout(user: SignedIn): Request {
  return new Request(`${APP_URL}/api/v1/checkout`, {
    method: "POST",
    headers: {
      origin: APP_ORIGIN,
      "content-type": "application/json",
      cookie: user.cookie,
      "idempotency-key": newKey(),
    },
    body: "{broken",
  });
}

/** Users enough to spend the address allowance without any one of them reaching `checkout`'s. */
async function users(count: number): Promise<SignedIn[]> {
  const made: SignedIn[] = [];
  for (let i = 0; i < count; i += 1) made.push(await signedIn());
  // `signedIn` resets the limiter; the cases start from empty counters.
  resetProcessRateLimiter();
  return made;
}

/** Spends the 60 requests of the address on checkout, at most 10 per user (the per-user limit). */
async function spendAddressAllowance(spenders: SignedIn[]): Promise<void> {
  const perUser = RATE_LIMITS.CHECKOUT.limit;
  expect(spenders.length * perUser).toBe(RATE_LIMITS.SIGNED_IN_ADDRESS.limit);
  for (const user of spenders) {
    for (let i = 0; i < perUser; i += 1) {
      const response = await checkoutRoute(invalidCheckout(user));
      // Allowed by both rules: the body is read and refused.
      expect(response.status).toBe(400);
    }
  }
}

describe("SEC-052: signed-in-address on the signed-in endpoints", () => {
  it("the 61st checkout from one address in a minute is 429 with Retry-After, its body unread, although that user has used nothing", async () => {
    const [fresh, ...spenders] = await users(7);
    if (fresh === undefined) throw new Error("no user");
    await spendAddressAllowance(spenders);

    const sent = invalidCheckout(fresh);
    const response = await checkoutRoute(sent);
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "RATE_LIMITED",
    );
    expect(sent.bodyUsed).toBe(false);
  });

  it("one counter covers the endpoints together: after 60 checkouts, a review from another user is 429 before its body and path are read", async () => {
    const [reviewer, ...spenders] = await users(7);
    if (reviewer === undefined) throw new Error("no user");
    await spendAddressAllowance(spenders);

    const sent = new Request(`${APP_URL}/api/v1/orders/x/items/y/review`, {
      method: "POST",
      headers: { origin: APP_ORIGIN, "content-type": "application/json", cookie: reviewer.cookie },
      body: "{broken",
    });
    const response = await reviewRoute(sent, {
      params: Promise.resolve({ id: "x", itemId: "y" }),
    } as never);
    expect(response.status).toBe(429);
    expect(sent.bodyUsed).toBe(false);
  });

  it("a request refused for its session uses none of the address allowance", async () => {
    const [user, ...spenders] = await users(7);
    if (user === undefined) throw new Error("no user");
    // 61 anonymous checkouts: each is 401 at step 3, before step 5.
    for (let i = 0; i < RATE_LIMITS.SIGNED_IN_ADDRESS.limit + 1; i += 1) {
      const anonymous = new Request(`${APP_URL}/api/v1/checkout`, {
        method: "POST",
        headers: { origin: APP_ORIGIN, "content-type": "application/json" },
        body: "{}",
      });
      expect((await checkoutRoute(anonymous)).status).toBe(401);
    }
    // The whole allowance is still there: 60 signed-in requests pass it, the 61st does not.
    await spendAddressAllowance(spenders);
    expect((await checkoutRoute(invalidCheckout(user))).status).toBe(429);
  });
});
