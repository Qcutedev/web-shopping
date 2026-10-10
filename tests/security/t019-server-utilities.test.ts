/**
 * Security review of the server utilities (T-019). Owner: security agent.
 *
 * Findings are registered in docs/SECURITY.md. Two kinds of test live here:
 *
 *   it(...)        a control that was checked and holds today. A failure is a regression.
 *   it.fails(...)  an OPEN finding. The body asserts the SECURE behaviour, which the
 *                  code does not have yet, so the assertion fails and Vitest reports
 *                  the test as passed. When the owner fixes the code the test turns
 *                  red; the security agent then re-checks and changes it to `it`.
 *                  Nobody else may flip, skip, or delete these.
 *
 * Not part of `pnpm test` yet (vitest.config.mts includes only src/**). Run with:
 *   pnpm exec vitest run --config tests/security/vitest.security.config.mts
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fromZodError, internalError } from "../../src/server/errors";
import { errorResponse, ok } from "../../src/server/http";
import { createLogger, type Logger } from "../../src/server/logger";
import { createRateLimiter, MemoryRateLimitStore, RATE_LIMITS } from "../../src/server/rate-limit";
import { REQUEST_ID_HEADER, resolveRequestId } from "../../src/server/request-id";

function capture(): { lines: string[]; log: Logger } {
  const lines: string[] = [];
  const log = createLogger({ level: "debug", write: (line) => lines.push(line) });
  return { lines, log };
}

const REQUEST_ID = "req_security_review_1";

describe("controls that hold (regression guards)", () => {
  it("error envelope: an unknown error exposes nothing but the fixed 500 body", async () => {
    const thrown = new Error(
      'relation "User" does not exist; postgresql://app:pw@db:5432/shop; somchai@example.com',
    );
    const response = errorResponse(thrown, { requestId: REQUEST_ID });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        details: {},
        requestId: REQUEST_ID,
      },
    });
    expect(text).not.toContain("User");
    expect(text).not.toContain("somchai");
    expect(text).not.toContain("stack");
  });

  it("error envelope: JSON.stringify of an AppError never includes cause or stack", () => {
    const serialised = JSON.stringify(internalError(new Error("SELECT * FROM secrets")));
    expect(serialised).not.toContain("SELECT");
    expect(serialised).not.toContain("stack");
  });

  it("error envelope: a Zod failure does not echo the rejected value", async () => {
    const schema = z.strictObject({
      email: z.email(),
      password: z.string().min(12),
      role: z.enum(["CUSTOMER"]),
    });
    const parsed = schema.safeParse({
      email: "not-an-email-MARKER1",
      password: "MARKER2",
      role: "MARKER3",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const text = await errorResponse(fromZodError(parsed.error), { requestId: REQUEST_ID }).text();
    expect(text).not.toContain("MARKER1");
    expect(text).not.toContain("MARKER2");
    expect(text).not.toContain("MARKER3");
  });

  it("response headers: a caller cannot replace the request id header", () => {
    const response = ok({}, { requestId: REQUEST_ID, headers: { "x-request-id": "spoofed-id-1" } });
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(REQUEST_ID);
  });

  it("log injection: CR, LF, NUL, ESC, and DEL in any position stay inside one JSON line", () => {
    const { lines, log } = capture();
    const hostile = 'a\r\n{"level":"error","message":"forged"}\u0000\u001b[2J\u007f';
    createLogger({ write: (line) => lines.push(line), requestId: hostile }).info(hostile, {
      [hostile]: hostile,
      nested: [hostile],
    });
    log.info("second");
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toMatch(/[\r\n\u0000\u001b]/);
    expect(JSON.parse(lines[0] ?? "").level).toBe("info");
  });

  it("request id: values that could break a header or a log line are never reused", () => {
    for (const hostile of [
      "abc\r\nSet-Cookie: a=b",
      "abcdefgh\n",
      "abcdefgh ",
      "a".repeat(65),
      "short",
      "abcdefg ",
      "ａｂｃｄｅｆｇｈ",
    ]) {
      expect(resolveRequestId(hostile)).not.toBe(hostile);
    }
  });

  it("rate limiter: a blocked key stays blocked for the whole window and is not extended", async () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    for (let i = 0; i < 5; i += 1)
      await limiter.consume("signin:ip:203.0.113.7", RATE_LIMITS.SIGN_IN_ADDRESS);
    const blocked = await limiter.consume("signin:ip:203.0.113.7", RATE_LIMITS.SIGN_IN_ADDRESS);
    expect(blocked.allowed).toBe(false);
    now += 59_999;
    expect(
      (await limiter.consume("signin:ip:203.0.113.7", RATE_LIMITS.SIGN_IN_ADDRESS)).allowed,
    ).toBe(false);
    now += 1;
    expect(
      (await limiter.consume("signin:ip:203.0.113.7", RATE_LIMITS.SIGN_IN_ADDRESS)).allowed,
    ).toBe(true);
  });

  it("rate limiter: flooding a full store with new keys cannot reset an existing counter", async () => {
    const now = 1_000_000;
    const store = new MemoryRateLimitStore({ maxKeys: 50 });
    const limiter = createRateLimiter({ store, now: () => now });
    for (let i = 0; i < 5; i += 1)
      await limiter.consume("signin:email:victim", RATE_LIMITS.SIGN_IN_ADDRESS);
    for (let i = 0; i < 5_000; i += 1)
      await limiter.consume(`signin:ip:flood-${i}`, RATE_LIMITS.SIGN_IN_ADDRESS);
    expect(store.size).toBeLessThanOrEqual(50);
    expect(
      (await limiter.consume("signin:email:victim", RATE_LIMITS.SIGN_IN_ADDRESS)).allowed,
    ).toBe(false);
  });

  it("rate limiter: the default store holds 100 000 keys and refuses the next new one", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    for (let i = 0; i < 100_000; i += 1) await limiter.consume(`k:${i}`, RATE_LIMITS.SIGN_UP);
    expect((await limiter.consume("k:one-more", RATE_LIMITS.SIGN_UP)).allowed).toBe(false);
    expect((await limiter.consume("k:0", RATE_LIMITS.SIGN_UP)).allowed).toBe(true);
  });
});

describe("SEC-001 personal data is written to logs in clear text", () => {
  const personal = {
    email: "somchai@example.com",
    phone: "0812345678",
    contactPhone: "021234567",
    shipPhone: "0898765432",
    name: "Somchai Jaidee",
    recipientName: "Somying Rakdee",
    shipRecipientName: "Somsak Deejai",
    subdistrict: "Khlong Toei Nuea",
    district: "Watthana",
    province: "Bangkok",
    shipSubdistrict: "Suthep",
    shipDistrict: "Mueang Chiang Mai",
    shipProvince: "Chiang Mai",
    ipAddress: "203.0.113.77",
    comment: "Deliver to my mother at the blue house",
    trackingNumber: "TH0123456789X",
  };

  for (const [key, value] of Object.entries(personal)) {
    it(`redacts the value under the key "${key}"`, () => {
      const { lines, log } = capture();
      log.info("order placed", { order: { [key]: value } });
      expect(lines[0]).not.toContain(value);
    });
  }

  it("masks an email address inside free text such as an error message", () => {
    const { lines, log } = capture();
    log.error("Unhandled error", {
      err: new Error("Invalid `prisma.user.create()` invocation: email: 'somchai@example.com'"),
    });
    expect(lines[0]).not.toContain("somchai@example.com");
  });

  it("still redacts what the implementer listed (street line, postal code, session, cookie)", () => {
    const { lines, log } = capture();
    log.info("x", {
      line1: "99/1 Sukhumvit 21",
      shipLine1: "12 Nimman Rd",
      postalCode: "10110",
      shipPostalCode: "50200",
      sessionId: "sess-abc",
      "set-cookie": "sid=abc",
      password: "pw-value-1",
    });
    for (const value of [
      "Sukhumvit",
      "Nimman",
      "10110",
      "50200",
      "sess-abc",
      "sid=abc",
      "pw-value-1",
    ]) {
      expect(lines[0]).not.toContain(value);
    }
  });
});

describe("SEC-002 secrets survive logger redaction", () => {
  it("masks a URL password that contains an unencoded @", () => {
    const { lines, log } = capture();
    log.error("db down", {
      err: new Error("connect failed postgresql://app:Pa@ssTAIL99@db:5432/shop"),
    });
    expect(lines[0]).not.toContain("ssTAIL99");
  });

  it("masks key=value secrets inside free text", () => {
    const { lines, log } = capture();
    log.error("Unhandled error", { err: new Error("auth failed; password=hunter2VALUE") });
    expect(lines[0]).not.toContain("hunter2VALUE");
  });

  it("masks secret query parameters in a logged URL", () => {
    const { lines, log } = capture();
    log.info("request", { url: "https://shop.example/reset?token=QUERYTOKEN123&next=/" });
    expect(lines[0]).not.toContain("QUERYTOKEN123");
  });

  it("masks a raw Cookie header line held in a string", () => {
    const { lines, log } = capture();
    log.info("request", { rawHeaders: ["Cookie: better-auth.session_token=COOKIEVALUE123"] });
    expect(lines[0]).not.toContain("COOKIEVALUE123");
  });

  for (const key of ["pwd", "pass", "passphrase", "otp", "pin", "signature", "jwt", "hash"]) {
    it(`redacts the value under the key "${key}"`, () => {
      const { lines, log } = capture();
      log.info("x", { [key]: "SENSITIVE-VALUE-42" });
      expect(lines[0]).not.toContain("SENSITIVE-VALUE-42");
    });
  }
});

describe("SEC-003 a client chooses the request id written to logs and responses", () => {
  it("ignores a well-formed X-Request-Id from an untrusted client by default", () => {
    const request = new Request("http://localhost/api/v1/cart", {
      headers: { [REQUEST_ID_HEADER]: "attacker-chosen-id-0001" },
    });
    expect(resolveRequestId(request)).not.toBe("attacker-chosen-id-0001");
  });
});

describe("SEC-004 one flood of new keys refuses every other rate-limited action", () => {
  it("keeps serving checkout keys while the sign-up keys fill their capacity", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    // 100 000 distinct sign-up keys (one per IPv6 /64, or per spoofed X-Forwarded-For value).
    for (let i = 0; i < 100_000; i += 1) {
      await limiter.consume(`signup:ip:2001:db8:${i.toString(16)}::/64`, RATE_LIMITS.SIGN_UP);
    }
    const checkout = await limiter.consume("checkout:user:cku1", RATE_LIMITS.CHECKOUT);
    expect(checkout.allowed).toBe(true);
  });

  it("tells a refused client to retry soon, not after the full window", async () => {
    const now = 1_000_000;
    const store = new MemoryRateLimitStore({ maxKeys: 1 });
    const limiter = createRateLimiter({ store, now: () => now });
    await limiter.consume("signup:ip:a", RATE_LIMITS.SIGN_UP);
    const refused = await limiter.consume("sellerapp:user:u1", RATE_LIMITS.SELLER_APPLICATION);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});

describe("SEC-005 two rules that share a key share one counter and one window", () => {
  it("counts the same subject separately per rule", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    // Same caller-built key used for two rules, as nothing in the API prevents.
    for (let i = 0; i < 10; i += 1) await limiter.consume("user:cku1", RATE_LIMITS.CHECKOUT);
    const firstReview = await limiter.consume("user:cku1", RATE_LIMITS.REVIEW_CREATE);
    expect(firstReview.remaining).toBe(RATE_LIMITS.REVIEW_CREATE.limit - 1);
  });
});

describe("SEC-006 API responses carry no cache directive", () => {
  it("marks success and error envelopes as not storable", () => {
    const success = ok({ email: "x" }, { requestId: REQUEST_ID });
    const failure = errorResponse(new Error("x"), { requestId: REQUEST_ID });
    expect(success.headers.get("cache-control")).toContain("no-store");
    expect(failure.headers.get("cache-control")).toContain("no-store");
  });
});
