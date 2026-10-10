/**
 * Security review and re-check of the server utilities (T-019). Owner: security agent.
 *
 * Findings are registered in docs/SECURITY.md. Two kinds of test live here:
 *
 *   it(...)        a control that was checked and holds today. A failure is a regression.
 *                  This includes the reproductions of SEC-001 to SEC-007, which were open
 *                  findings until the fix was re-checked on 2026-10-11.
 *   it.fails(...)  an OPEN finding (SEC-012 to SEC-018 at the time of writing). The body
 *                  asserts the SECURE behaviour, which the code does not have yet, so the
 *                  assertion fails and Vitest reports the test as passed ("expected fail").
 *                  When the owner fixes the code the test turns red; the owner may then
 *                  change `it.fails` to `it` without touching the body, and the security
 *                  agent re-checks. Nobody else may edit an assertion, skip, or delete these.
 *
 * Part of `pnpm test` (project "security" in vitest.config.mts). Run alone with:
 *   pnpm exec vitest run --project security
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type ClientAddressConfig,
  getClientAddress,
  NO_TRUSTED_PROXY,
} from "../../src/server/client-address";
import { AppError, fromZodError, internalError } from "../../src/server/errors";
import { created, errorResponse, ok, paginated } from "../../src/server/http";
import { createLogger, type Logger } from "../../src/server/logger";
import {
  createRateLimiter,
  MemoryRateLimitStore,
  RATE_LIMITS,
  type RateLimitRule,
} from "../../src/server/rate-limit";
import { REQUEST_ID_HEADER, resolveRequestId } from "../../src/server/request-id";

function capture(): { lines: string[]; log: Logger } {
  const lines: string[] = [];
  const log = createLogger({ level: "debug", write: (line) => lines.push(line) });
  return { lines, log };
}

/** The single line written for `log.info(message, fields)`. */
function logged(fields: Record<string, unknown>, message = "probe"): string {
  const { lines, log } = capture();
  log.info(message, fields);
  expect(lines).toHaveLength(1);
  return lines[0] ?? "";
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
      "abcdefg ",
      "ａｂｃｄｅｆｇｈ",
    ]) {
      expect(resolveRequestId(hostile)).not.toBe(hostile);
      expect(resolveRequestId(hostile, { trustIncoming: true })).not.toBe(hostile);
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
    const limiter = createRateLimiter({ store, now: () => now, logger: { warn: () => {} } });
    for (let i = 0; i < 5; i += 1)
      await limiter.consume("signin:email:victim", RATE_LIMITS.SIGN_IN_ADDRESS);
    for (let i = 0; i < 5_000; i += 1)
      await limiter.consume(`signin:ip:flood-${i}`, RATE_LIMITS.SIGN_IN_ADDRESS);
    expect(store.size).toBeLessThanOrEqual(50);
    expect(
      (await limiter.consume("signin:email:victim", RATE_LIMITS.SIGN_IN_ADDRESS)).allowed,
    ).toBe(false);
  });

  it("rate limiter: the sign-up rule holds exactly its own capacity and refuses the next new key", async () => {
    const now = 1_000_000;
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter({ store, now: () => now, logger: { warn: () => {} } });
    const capacity = RATE_LIMITS.SIGN_UP.maxKeys;
    let lastAllowed = false;
    for (let i = 0; i < capacity; i += 1) {
      lastAllowed = (await limiter.consume(`k:${i}`, RATE_LIMITS.SIGN_UP)).allowed;
    }
    expect(lastAllowed).toBe(true);
    // Keep flooding well past the capacity: the store must not grow and must not fail open.
    for (let i = capacity; i < 100_000; i += 1) {
      await limiter.consume(`k:${i}`, RATE_LIMITS.SIGN_UP);
    }
    expect(store.size).toBe(capacity);
    const refused = await limiter.consume("k:one-more", RATE_LIMITS.SIGN_UP);
    expect(refused.allowed).toBe(false);
    expect(refused.saturated).toBe(true);
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

  describe("re-check 2026-10-11: adversarial inputs", () => {
    const emailCarriers: Record<string, () => Record<string, unknown>> = {
      "a value under an innocuous key": () => ({ note: "contact somchai@example.com now" }),
      "an upper-case address with a two-part suffix": () => ({ id: "SOMCHAI@EXAMPLE.CO.TH" }),
      "a mailto link": () => ({ link: "mailto:somchai@example.com?subject=x" }),
      "an address in angle brackets with a tag": () => ({
        from: "Khun S <somchai+tag@mail.example.com>.",
      }),
      "a Map key": () => ({ seen: new Map([["somchai@example.com", 1]]) }),
      "an object key": () => ({ seen: { "somchai@example.com": 1 } }),
      "a Set member": () => ({ seen: new Set(["somchai@example.com"]) }),
      "a symbol description": () => ({ tag: Symbol("somchai@example.com") }),
      "the cause of the cause of an error": () => ({
        err: new Error("outer", {
          cause: new Error("inner", { cause: "lookup failed for somchai@example.com" }),
        }),
      }),
      "an extra property of an error": () => ({
        err: Object.assign(new Error("unique constraint"), {
          meta: { target: "somchai@example.com" },
        }),
      }),
      "a query parameter of a URL object": () => ({
        url: new URL("https://shop.example/a?to=somchai@example.com"),
      }),
    };
    for (const [label, build] of Object.entries(emailCarriers)) {
      it(`masks an email address held in ${label}`, () => {
        expect(logged(build())).not.toContain("somchai");
      });
    }

    it("masks an email address in the message, the request id, and logger bindings", () => {
      const lines: string[] = [];
      createLogger({
        write: (line) => lines.push(line),
        bindings: { owner: "binding somchai@example.com" },
      })
        .child({ requestId: "rid somchai@example.com", phone: "0812345678" })
        .info("sign-in failed for somchai@example.com");
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toContain("somchai");
      expect(lines[0]).not.toContain("0812345678");
    });

    it("matches keys whatever their case and punctuation", () => {
      const line = logged({
        E_Mail: "VALUE-01",
        "user-email": "VALUE-02",
        Phone_Number: "VALUE-03",
        "X-Forwarded-For": "VALUE-04",
        "X-Real-IP": "VALUE-05",
        RemoteAddress: "VALUE-06",
        recipient_name: "VALUE-07",
        Sub_District: "VALUE-08",
        "postal code": "VALUE-09",
        FULL_NAME: "VALUE-10",
        Q: "VALUE-11",
      });
      expect(line).not.toMatch(/VALUE-\d\d/);
    });

    it("redacts by name inside Headers and URLSearchParams", () => {
      const line = logged({
        headers2: new Headers({
          cookie: "sid=VALUE-01",
          authorization: "Token VALUE-02",
          "x-forwarded-for": "VALUE-03",
          "x-api-key": "VALUE-04",
        }),
        params: new URLSearchParams("q=VALUE-05&email=VALUE-06&token=VALUE-07&page=2"),
      });
      expect(line).not.toMatch(/VALUE-\d\d/);
      expect(line).toContain('"page":"2"');
    });

    it("keeps an error's class name while redacting a person's name", () => {
      const line = logged({ err: new AppError("NOT_FOUND"), customer: { name: "Somchai Jaidee" } });
      expect(line).toContain('"name":"AppError"');
      expect(line).not.toContain("Somchai");
    });

    it("does not call toJSON on a logged object", () => {
      const line = logged({ row: { toJSON: () => ({ email: "somchai@example.com" }), id: 7 } });
      expect(line).not.toContain("somchai");
    });
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

  describe("re-check 2026-10-11: adversarial inputs", () => {
    // Every value below hides the marker SECRETPW (and sometimes SECRET2) in a different shape.
    const texts: Record<string, string> = {
      "an upper-case scheme": "POSTGRES://app:SECRETPW@db/shop",
      "a password with / and several @": "mysql://root:SEC/RE@T@SECRETPW@db/shop",
      "a URL after a local-scheme URL and a blank": "file:///a.js redis://:SECRETPW@cache:6379",
      "an empty user name": "amqp://:SECRETPW@queue:5672",
      "tabs around the equals sign": "password\t=\tSECRETPW",
      "a Cookie line with unusual spacing and case": "COOKIE   :   a=SECRETPW; b=SECRET2",
      "a set-cookie line without a blank": "set-cookie:sid=SECRETPW; HttpOnly",
      "JSON text with escaped quotes": '{\\"apiKey\\":\\"SECRETPW SECRET2\\",\\"a\\":1}',
      "a quoted value that contains a blank": "password='SECRET2 SECRETPW' ok",
      "a mixed-case bearer scheme": "auth bEaReR SECRETPW.x.y",
      "an upper-case bearer scheme and a tab": "BEARER\tSECRETPW",
      "a standalone Basic credential": "Basic U0VDUkVUUFc6U0VDUkVUUFc=",
      "a lower-case basic scheme on an authorization line":
        "authorization: basic U0VDUkVUUFc6U0VDUkVUUFc=",
      "several secret query parameters":
        "/cb?access_token=SECRETPW&x=1&client_secret=SECRET2&api-key=SECRETPW",
    };
    for (const [label, text] of Object.entries(texts)) {
      it(`masks ${label}`, () => {
        const line = logged({ detail: text, err: new Error(text) }, text);
        expect(line).not.toContain("SECRETPW");
        expect(line).not.toContain("SECRET2");
        expect(line).not.toContain("U0VDUkVUUFc");
      });
    }

    it("redacts secrets under sensitive keys at any depth of nested arrays and objects", () => {
      const line = logged({
        a: [{ k: "x", accessToken: "SECRETPW" }, [[{ client_secret: "SECRETPW" }]]],
        b: { c: { d: { e: { f: { g: { password: "SECRETPW", h: { token: "SECRETPW" } } } } } } },
        ["pass\u200bword"]: "SECRETPW",
      });
      expect(line).not.toContain("SECRETPW");
    });

    it("keeps a real file position readable (the exemption that SEC-013 narrows)", () => {
      const line = logged({ at: "at verify (C:\\app\\session.ts:12:5)" });
      expect(line).toContain("session.ts:12:5");
    });
  });
});

describe("SEC-003 a client chooses the request id written to logs and responses", () => {
  it("ignores a well-formed X-Request-Id from an untrusted client by default", () => {
    const request = new Request("http://localhost/api/v1/cart", {
      headers: { [REQUEST_ID_HEADER]: "attacker-chosen-id-0001" },
    });
    expect(resolveRequestId(request)).not.toBe("attacker-chosen-id-0001");
  });

  describe("re-check 2026-10-11: adversarial inputs", () => {
    const chosen = "attacker-chosen-id-0002";

    it("ignores the id whichever way it is passed: Request, Headers, or raw value", () => {
      const headers = new Headers({ "x-request-id": chosen });
      const request = new Request("http://localhost/", { headers });
      for (const source of [request, headers, chosen]) {
        expect(resolveRequestId(source)).not.toBe(chosen);
        expect(resolveRequestId(source, {})).not.toBe(chosen);
        expect(resolveRequestId(source, { trustIncoming: false })).not.toBe(chosen);
      }
    });

    it("treats anything but the boolean true as not trusted", () => {
      for (const flag of ["true", 1, {}, [], "yes"]) {
        const options = { trustIncoming: flag as unknown as boolean };
        expect(resolveRequestId(chosen, options)).not.toBe(chosen);
      }
    });

    it("generates a fresh id per call, so an untrusted id cannot tie two requests together", () => {
      const first = resolveRequestId(chosen);
      const second = resolveRequestId(chosen);
      expect(first).not.toBe(second);
      expect(first).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("with a trusted proxy, a client-added second header line is not reused", () => {
      const headers = new Headers();
      headers.append("x-request-id", chosen);
      headers.append("x-request-id", "proxy-id-00000001");
      const resolved = resolveRequestId(headers, { trustIncoming: true });
      expect(resolved).not.toContain("attacker");
      expect(resolved).not.toContain("proxy-id");
    });
  });
});

describe("SEC-004 one flood of new keys refuses every other rate-limited action", () => {
  it("keeps serving checkout keys while the sign-up keys fill their capacity", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now, logger: { warn: () => {} } });
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
    const limiter = createRateLimiter({ store, now: () => now, logger: { warn: () => {} } });
    await limiter.consume("signup:ip:a", RATE_LIMITS.SIGN_UP);
    const refused = await limiter.consume("sellerapp:user:u1", RATE_LIMITS.SELLER_APPLICATION);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("re-check 2026-10-11: with all three anonymous rules flooded, the signed-in rules still serve, refusals are short, visible, and leak no key", async () => {
    let now = 1_000_000;
    const warnings: string[] = [];
    const store = new MemoryRateLimitStore();
    const limiter = createRateLimiter({
      store,
      now: () => now,
      logger: { warn: (message, fields) => warnings.push(`${message} ${JSON.stringify(fields)}`) },
    });
    const anonymous = [RATE_LIMITS.SIGN_UP, RATE_LIMITS.SIGN_IN_ADDRESS, RATE_LIMITS.SIGN_IN_EMAIL];
    for (const rule of anonymous) {
      for (let i = 0; i < rule.maxKeys + 2_000; i += 1) {
        await limiter.consume(`flood-subject-${i}`, rule);
      }
    }
    expect(store.size).toBe(120_000);

    for (const rule of anonymous) {
      const refused = await limiter.consume("203.0.113.200", rule);
      expect(refused.allowed).toBe(false);
      expect(refused.saturated).toBe(true);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
      // A subject that already has a window is still counted normally: no eviction, no fail-open.
      const known = await limiter.consume("flood-subject-0", rule);
      expect(known.saturated).toBe(false);
    }
    for (const rule of [
      RATE_LIMITS.CHECKOUT,
      RATE_LIMITS.UPLOADS,
      RATE_LIMITS.SELLER_APPLICATION,
      RATE_LIMITS.REVIEW_CREATE,
    ]) {
      expect((await limiter.consume("user-1", rule)).allowed).toBe(true);
    }

    // One warn line per rule for the whole flood, holding no subject.
    expect(warnings).toHaveLength(3);
    expect(warnings.join("\n")).not.toContain("flood-subject");
    expect(warnings.join("\n")).not.toContain("203.0.113.200");

    // The one-minute windows expire; the hour-long sign-up windows do not.
    now += 61_000;
    expect((await limiter.consume("203.0.113.200", RATE_LIMITS.SIGN_IN_ADDRESS)).allowed).toBe(
      true,
    );
    expect((await limiter.consume("203.0.113.200", RATE_LIMITS.SIGN_UP)).allowed).toBe(false);
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

  it("re-check 2026-10-11: a subject cannot be shaped to collide with another rule or another subject", async () => {
    const now = 1_000_000;
    const limiter = createRateLimiter({ now: () => now });
    const fresh = RATE_LIMITS.SIGN_IN_EMAIL.limit - 1;

    // "sign-in-address" + ":x" must not equal a rule named like a prefix of it plus a subject.
    for (let i = 0; i < 5; i += 1) await limiter.consume("x", RATE_LIMITS.SIGN_IN_ADDRESS);
    expect((await limiter.consume("x", RATE_LIMITS.SIGN_IN_EMAIL)).remaining).toBe(fresh);
    expect((await limiter.consume("sign-in-address:x", RATE_LIMITS.SIGN_IN_EMAIL)).remaining).toBe(
      fresh,
    );
    expect((await limiter.consume("sign-in-email:x", RATE_LIMITS.SIGN_IN_ADDRESS)).remaining).toBe(
      RATE_LIMITS.SIGN_IN_ADDRESS.limit - 1,
    );

    // Long subjects are stored as a digest: a neighbour and a forged digest get their own window.
    const long = "L".repeat(500);
    for (let i = 0; i < 10; i += 1) await limiter.consume(long, RATE_LIMITS.CHECKOUT);
    expect((await limiter.consume(long, RATE_LIMITS.CHECKOUT)).allowed).toBe(false);
    const digest = createHash("sha256").update(long).digest("hex");
    for (const other of [`${long}X`, `sha256:${digest}`, digest]) {
      expect((await limiter.consume(other, RATE_LIMITS.CHECKOUT)).remaining).toBe(
        RATE_LIMITS.CHECKOUT.limit - 1,
      );
    }

    // The window length belongs to the rule: checkout resets after a minute, review does not.
    const clock = { now: 5_000_000 };
    const second = createRateLimiter({ now: () => clock.now });
    for (let i = 0; i < 11; i += 1) await second.consume("u", RATE_LIMITS.CHECKOUT);
    for (let i = 0; i < 11; i += 1) await second.consume("u", RATE_LIMITS.REVIEW_CREATE);
    clock.now += 60_000;
    expect((await second.consume("u", RATE_LIMITS.CHECKOUT)).allowed).toBe(true);
    expect((await second.consume("u", RATE_LIMITS.REVIEW_CREATE)).allowed).toBe(false);
  });

  it("re-check 2026-10-11: one rule name cannot be reused with other settings", async () => {
    const limiter = createRateLimiter({ now: () => 1_000_000 });
    await limiter.consume("u", RATE_LIMITS.CHECKOUT);
    const looser: RateLimitRule = { ...RATE_LIMITS.CHECKOUT, limit: 10_000 };
    await expect(limiter.consume("u", looser)).rejects.toThrow(TypeError);
  });
});

describe("SEC-006 API responses carry no cache directive", () => {
  it("marks success and error envelopes as not storable", () => {
    const success = ok({ email: "x" }, { requestId: REQUEST_ID });
    const failure = errorResponse(new Error("x"), { requestId: REQUEST_ID });
    expect(success.headers.get("cache-control")).toContain("no-store");
    expect(failure.headers.get("cache-control")).toContain("no-store");
  });

  it("re-check 2026-10-11: no helper and no caller-supplied header can make a response storable by accident", () => {
    const hostile = { "Cache-Control": "public, max-age=600" };
    const responses = [
      ok({}, { requestId: REQUEST_ID, headers: hostile }),
      created({}, { requestId: REQUEST_ID, headers: [["cache-control", "public"]] }),
      paginated([], { page: 1, pageSize: 10, total: 0 }, { requestId: REQUEST_ID }),
      ok({}, { requestId: REQUEST_ID, cacheControl: undefined }),
      errorResponse(new AppError("NOT_FOUND"), { requestId: REQUEST_ID, headers: hostile }),
      errorResponse(new AppError("RATE_LIMITED"), { requestId: REQUEST_ID }),
      errorResponse(fromZodError(z.string().safeParse(1).error as z.ZodError), {
        requestId: REQUEST_ID,
      }),
      // An error response has no opt-in at all, even when a caller forces the property in.
      errorResponse(new Error("x"), {
        requestId: REQUEST_ID,
        cacheControl: "public",
      } as unknown as { requestId: string }),
    ];
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    // The opt-in for a documented public endpoint is explicit and only on success helpers.
    const optedIn = ok({}, { requestId: REQUEST_ID, cacheControl: "public, max-age=60" });
    expect(optedIn.headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("SEC-007 Unicode line separators and bidirectional controls reach the log unescaped", () => {
  // The code points SR-04 listed when SEC-007 was registered.
  const listed = [
    0x85, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ];
  for (const codePoint of listed) {
    const label = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    it(`escapes ${label} in the message, keys, values, bindings, errors, and the request id`, () => {
      const character = String.fromCodePoint(codePoint);
      const message = `before${character}{"level":"error","message":"forged"}`;
      const lines: string[] = [];
      createLogger({
        write: (line) => lines.push(line),
        requestId: `rid${character}rid`,
        bindings: { [`bound${character}key`]: character },
      }).info(message, {
        [`field${character}key`]: [`value${character}value`, { deep: character }],
        err: new Error(`failed${character}here`),
      });
      expect(lines).toHaveLength(1);
      const line = lines[0] ?? "";
      expect(line).not.toContain(character);
      expect(line).toContain(`\\u${codePoint.toString(16).padStart(4, "0")}`);
      // Escaping must not change what a JSON parser reads back.
      expect((JSON.parse(line) as { message: string }).message).toBe(message);
    });
  }
});

describe("SR-01 client address cannot be forged", () => {
  const spoofed = {
    "x-forwarded-for": "198.51.100.66",
    forwarded: "for=198.51.100.66",
    "x-real-ip": "198.51.100.66",
    "cf-connecting-ip": "198.51.100.66",
    "true-client-ip": "198.51.100.66",
    "x-client-ip": "198.51.100.66",
  };
  const hops = (count: number): ClientAddressConfig => ({ trustedProxyHops: count });
  const forwardedFor = (value: string): Headers =>
    new Headers({ ...spoofed, "x-forwarded-for": value });

  it("default configuration: every forwarding header is ignored", () => {
    const request = new Request("http://localhost/", { headers: spoofed });
    expect(getClientAddress(request, NO_TRUSTED_PROXY)).toBe("unknown");
    expect(getClientAddress(new Headers(spoofed), hops(0))).toBe("unknown");
  });

  it("hop mode: only the entry written by the trusted proxy is used", () => {
    // What the client sent is on the left; what each trusted proxy appended is on the right.
    expect(getClientAddress(forwardedFor("198.51.100.66, 203.0.113.9"), hops(1))).toBe(
      "203.0.113.9",
    );
    expect(getClientAddress(forwardedFor("198.51.100.66,, 203.0.113.9"), hops(1))).toBe(
      "203.0.113.9",
    );
    expect(getClientAddress(forwardedFor("198.51.100.66, 203.0.113.9, 10.0.0.2"), hops(2))).toBe(
      "203.0.113.9",
    );
    expect(
      getClientAddress(forwardedFor("1.1.1.1, 2.2.2.2, 198.51.100.66, 203.0.113.9"), hops(1)),
    ).toBe("203.0.113.9");
  });

  it("hop mode: too few entries, or an entry that is not a plain address, is unknown", () => {
    const cases: [string, number][] = [
      ["198.51.100.66", 2],
      ["1.1.1.1,2.2.2.2,3.3.3.3,4.4.4.4", 5],
      ["203.0.113.9, ", 1],
      ["198.51.100.66, 203.0.113.9:4711", 1],
      ["[2001:db8::1]:443", 1],
      ["fe80::1%eth0", 1],
      ["evil.example", 1],
      ["0177.0.0.1", 1],
      ["127.1", 1],
      ["0x7f.0.0.1", 1],
      ["2130706433", 1],
      ["203.0.113.9 198.51.100.66", 1],
      ["::ffff:::ffff:203.0.113.9", 1],
      ["1".repeat(100_000), 1],
      [",".repeat(100_000), 1],
    ];
    for (const [value, count] of cases) {
      expect(getClientAddress(forwardedFor(value), hops(count))).toBe("unknown");
    }
    expect(getClientAddress(new Headers({ "x-real-ip": "198.51.100.66" }), hops(1))).toBe(
      "unknown",
    );
  });

  it("IPv6: every spelling of an address in one /64 gives one subject, another /64 another", () => {
    const sameNetwork = [
      "2001:db8:85a3::8a2e:370:7334",
      "2001:DB8:85A3:0:FFFF:FFFF:FFFF:FFFF",
      "2001:0db8:85a3:0000:0000:0000:0000:0001",
      "2001:db8:85a3:0::",
      "2001:db8:85a3::1.2.3.4",
    ];
    for (const address of sameNetwork) {
      expect(getClientAddress(forwardedFor(address), hops(1))).toBe("2001:0db8:85a3:0000::/64");
    }
    expect(getClientAddress(forwardedFor("2001:db8:85a3:1::1"), hops(1))).toBe(
      "2001:0db8:85a3:0001::/64",
    );
    expect(getClientAddress(forwardedFor("::2:3:4:5:6:7:8"), hops(1))).toBe(
      "0000:0002:0003:0004::/64",
    );
    expect(getClientAddress(forwardedFor("1:2:3:4:5:6:7::"), hops(1))).toBe(
      "0001:0002:0003:0004::/64",
    );
  });

  it("IPv4-mapped forms never create more than one subject per IPv4 address plus shared ones", () => {
    // Decided 2026-10-11 (SR-01): dotted mapped form is the IPv4 address; the hexadecimal form is
    // "unknown"; fully written-out forms fall into the all-zero /64. All of these are shared
    // subjects, so no spelling gives a client a private, fresh allowance.
    expect(getClientAddress(forwardedFor("::ffff:203.0.113.9"), hops(1))).toBe("203.0.113.9");
    expect(getClientAddress(forwardedFor("::FFFF:203.0.113.9"), hops(1))).toBe("203.0.113.9");
    expect(getClientAddress(forwardedFor("::ffff:cb00:7109"), hops(1))).toBe("unknown");
    for (const spelling of ["0:0:0:0:0:ffff:203.0.113.9", "0:0:0:0:0:ffff:cb00:7109", "::1"]) {
      expect(getClientAddress(forwardedFor(spelling), hops(1))).toBe("0000:0000:0000:0000::/64");
    }
  });

  it("single-header mode: only that header, only as a single value", () => {
    const config: ClientAddressConfig = {
      trustedProxyHops: 0,
      trustedClientIpHeader: "CF-Connecting-IP",
    };
    expect(
      getClientAddress(new Headers({ ...spoofed, "cf-connecting-ip": "203.0.113.9" }), config),
    ).toBe("203.0.113.9");
    // The header is absent: nothing else is consulted.
    expect(
      getClientAddress(
        new Headers({ "x-forwarded-for": "198.51.100.66", "x-real-ip": "198.51.100.66" }),
        config,
      ),
    ).toBe("unknown");
    // A client that adds its own line next to the proxy's produces a list, which is refused.
    const repeated = new Headers();
    repeated.append("cf-connecting-ip", "198.51.100.66");
    repeated.append("cf-connecting-ip", "203.0.113.9");
    expect(getClientAddress(repeated, config)).toBe("unknown");
    expect(getClientAddress(new Headers({ "cf-connecting-ip": "203.0.113.9:80" }), config)).toBe(
      "unknown",
    );
  });

  it("a configuration outside SR-01 is refused instead of widening what is trusted", () => {
    const invalid = [
      { trustedProxyHops: -1 },
      { trustedProxyHops: 6 },
      { trustedProxyHops: 1.5 },
      { trustedProxyHops: Number.NaN },
      { trustedProxyHops: "1" },
      { trustedProxyHops: true },
      {},
      { trustedProxyHops: 1, trustedClientIpHeader: "X-Real-IP" },
      { trustedProxyHops: 0, trustedClientIpHeader: "X-FORWARDED-FOR" },
      { trustedProxyHops: 0, trustedClientIpHeader: "Forwarded" },
      { trustedProxyHops: 0, trustedClientIpHeader: "cookie" },
      { trustedProxyHops: 0, trustedClientIpHeader: "" },
      { trustedProxyHops: 0, trustedClientIpHeader: "a b" },
      { trustedProxyHops: 0, trustedClientIpHeader: null },
    ];
    for (const config of invalid) {
      expect(() =>
        getClientAddress(new Headers(spoofed), config as unknown as ClientAddressConfig),
      ).toThrow(TypeError);
    }
  });
});

describe("logger cost stays bounded (re-check of the reported 169-second stall)", () => {
  // Measured on 2026-10-11: every case below took under 20 ms (most under 2 ms). The bound here
  // is deliberately loose so that a slow machine does not fail it, and tight enough to catch a
  // return to quadratic behaviour (a quadratic scan of 1 000 000 characters takes minutes).
  const BOUND_MS = 1_000;
  const shapes: Record<string, (size: number) => string> = {
    "scheme and @ runs": (size) => "a://b@".repeat(size / 6),
    "bare scheme separators": (size) => "://".repeat(size / 3),
    "@ only": (size) => "@".repeat(size),
    "alternating a@": (size) => "a@".repeat(size / 2),
    "almost-emails": (size) => "a@a.".repeat(size / 4),
    "long local part then many @": (size) => "a".repeat(size / 2) + "@a".repeat(size / 4),
    "equals only": (size) => "=".repeat(size),
    "colons only": (size) => ":".repeat(size),
    "sensitive key with empty value": (size) => "password= ".repeat(size / 10),
    "longest inline key": (size) => `${"k".repeat(56)}password= `.repeat(size / 66),
    "unclosed quote": (size) => `password="${"a".repeat(size)}`,
    "sensitive key per line": (size) => "token:x\n".repeat(size / 8),
    "bearer without a token": (size) => "Bearer ".repeat(size / 7),
    "bearer and blank runs": (size) => `Bearer${" ".repeat(9)}`.repeat(size / 15),
    "dotted domain run": (size) => `a@${"a.".repeat(size / 2)}`,
    "hyphen tail": (size) => `a@a${"-".repeat(size)}`,
  };

  for (const [label, build] of Object.entries(shapes)) {
    it(`one line of "${label}" at 8 000 and 1 000 000 characters`, () => {
      for (const size of [8_000, 1_000_000]) {
        const text = build(size);
        const started = performance.now();
        const line = logged({ value: text, err: new Error(text) }, text);
        expect(performance.now() - started).toBeLessThan(BOUND_MS);
        // The entry is clipped, not copied: 3 strings of at most 8 000 characters plus a stack.
        expect(line.length).toBeLessThan(80_000);
      }
    });
  }

  it("large and deep structures are cut by the entry budget", () => {
    const structures: Record<string, unknown> = {
      wide: Object.fromEntries(
        Array.from({ length: 100_000 }, (_, index) => [`password${index}@x.co`, "a://b@c"]),
      ),
      longArray: new Array(1_000_000).fill("a@b.co password=x"),
      fan: Array.from({ length: 100 }, () =>
        Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => "x=1 a@b.co")),
      ),
      bigSet: new Set(Array.from({ length: 1_000_000 }, (_, index) => index)),
      full: Array.from({ length: 100 }, () => "a@".repeat(4_000)),
    };
    for (const value of Object.values(structures)) {
      const started = performance.now();
      const line = logged({ value });
      expect(performance.now() - started).toBeLessThan(BOUND_MS);
      expect(line.length).toBeLessThan(80_000);
    }
  });
});

// ---------------------------------------------------------------------------
// OPEN findings registered by the re-check of 2026-10-11. Owner of the code: backend-api.
// ---------------------------------------------------------------------------

describe("SEC-012 a URL password survives when a local-scheme URL starts the same run of text", () => {
  const texts: Record<string, string> = {
    "a stack frame directly followed by a connection URL":
      "at connect (file:///app/db.js:1:1):postgresql://app:SECRETPW@db:5432/shop",
    "a bundler URL with a connection URL in its query":
      "webpack-internal:///./src/db.ts?u=postgresql://app:SECRETPW@db:5432/shop",
    "a comma-separated list without blanks": "[file:///a.js,redis://:SECRETPW@cache:6379]",
  };
  for (const [label, text] of Object.entries(texts)) {
    it(`masks the password in ${label}`, () => {
      expect(logged({ err: new Error(text) })).not.toContain("SECRETPW");
    });
  }
});

describe("SEC-013 a secret shaped like a file position is exempt from masking", () => {
  for (const text of [
    "config db.password.prod:9SECRETPW loaded",
    "api.token.v1:12345SECRETPW",
    "auth.secret.key:0SECRETPW",
  ]) {
    it(`masks the value in "${text.replace("SECRETPW", "...")}"`, () => {
      expect(logged({ detail: text })).not.toContain("SECRETPW");
    });
  }
});

describe("SEC-014 clipping before scrubbing leaves the start of a secret or an email at the cut", () => {
  it("leaves no part of a URL password that straddles the 8 000-character clip", () => {
    // The clip falls after "SECRET", in front of the "@" that the URL mask needs to see.
    const text = `${"x ".repeat(3_988)}xpostgresql://app:SECRETPW@db:5432/shop`;
    expect(logged({ detail: text })).not.toContain("SECRET");
  });

  it("leaves no part of an email address that straddles the 8 000-character clip", () => {
    // The clip falls after "somchai@exam", which no longer looks like an email address.
    const text = `${"x ".repeat(3_994)}somchai@example.com`;
    expect(logged({ detail: text })).not.toContain("somchai");
  });
});

describe("SEC-015 key and key=value matching misses shapes that SR-04 now lists", () => {
  const texts: Record<string, string> = {
    "an aligned assignment with a long run of blanks": "DB_PASSWORD        = SECRETPW",
    "a long run of blanks after the equals sign": "password=      SECRETPW",
    "an arrow between key and value": "'password' => 'SECRETPW'",
    "a sid query parameter": "/cb?sid=SECRETPW&page=2",
    "an otp query parameter": "/verify?otp=SECRETPW",
    "a pin pair in free text": "rejected pin=SECRETPW for user 7",
    "a pass pair in free text": "smtp login user=app pass=SECRETPW",
  };
  for (const [label, text] of Object.entries(texts)) {
    it(`masks ${label}`, () => {
      expect(logged({ detail: text })).not.toContain("SECRETPW");
    });
  }

  it("masks the whole local part of an email address that contains an apostrophe", () => {
    // z.email() accepts this address, so it can be a customer's.
    expect(logged({ detail: "sign-in failed for somchai'o@example.com" })).not.toContain("somchai");
  });

  for (const key of ["userName", "customerName", "contactName", "tel", "mobile"]) {
    it(`redacts the value under the key "${key}"`, () => {
      expect(logged({ order: { [key]: "PERSONAL-VALUE-7" } })).not.toContain("PERSONAL-VALUE-7");
    });
  }
});

describe("SEC-016 invisible, format, and C1 control characters reach the log unescaped", () => {
  // One representative per group that SR-04 lists since 2026-10-11: DEL and C1 controls
  // (U+009B is a terminal escape introducer), soft hyphen, bidirectional marks, zero-width
  // characters, invisible operators, the byte order mark, annotation anchors, and tag characters.
  const codePoints = [
    0x7f, 0x80, 0x9b, 0x9f, 0xad, 0x61c, 0x180e, 0x200b, 0x200d, 0x200e, 0x200f, 0x2060, 0x2064,
    0x206f, 0xfeff, 0xfff9, 0xe0001, 0xe0041,
  ];
  for (const codePoint of codePoints) {
    const label = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    it(`escapes ${label}`, () => {
      const character = String.fromCodePoint(codePoint);
      const line = logged({ [`key${character}`]: `value${character}` }, `message${character}`);
      expect(line).not.toContain(character);
    });
  }
});

describe("SEC-017 details passed to an INTERNAL_ERROR reach the client", () => {
  it("sends empty details for a 500 whatever the service attached", async () => {
    const error = new AppError("INTERNAL_ERROR", {
      message: "query failed",
      details: { sql: "SELECT * FROM users", target: "somchai@example.com" },
    });
    const body = (await errorResponse(error, { requestId: REQUEST_ID }).json()) as {
      error: { details: unknown; message: string };
    };
    expect(body.error.message).toBe("An unexpected error occurred.");
    expect(body.error.details).toEqual({});
  });
});

describe("SEC-018 one extra rate-limit rule makes a built-in rule throw at its first use", () => {
  it("never lets a later rule definition disable a built-in rule", async () => {
    const limiter = createRateLimiter({ now: () => 1_000_000 });
    // A new rule is used first. Refusing it right here would be fine: it does not fit.
    try {
      await limiter.consume("user-1", {
        name: "cart-add",
        limit: 60,
        windowMs: 60_000,
        maxKeys: 10_000,
      });
    } catch {
      // Rejected at definition: acceptable.
    }
    // Whatever happened above, every built-in rule must still work.
    for (const rule of Object.values(RATE_LIMITS)) {
      const result = await limiter.consume("user-1", rule);
      expect(result.allowed).toBe(true);
    }
  });
});
