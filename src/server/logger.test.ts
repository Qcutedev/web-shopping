import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError, notFound } from "./errors";
import {
  createLogger,
  isSensitiveKey,
  type LoggerOptions,
  MAX_ENTRY_CHARS,
  MAX_ENTRY_NODES,
  redact,
  REDACTED,
  TRUNCATED,
} from "./logger";

const FIXED = new Date("2026-10-11T03:04:05.678Z");

function capture(options: LoggerOptions = {}) {
  const lines: string[] = [];
  const log = createLogger({ now: () => FIXED, write: (line) => lines.push(line), ...options });
  /** The raw line at `index`; fails the test when it was not written. */
  function line(index = 0): string {
    const found = lines[index];
    if (found === undefined) throw new Error(`expected a log line at index ${index}`);
    return found;
  }
  return {
    log,
    lines,
    line,
    entry: (index = 0) => JSON.parse(line(index)) as Record<string, unknown>,
    entries: () => lines.map((raw) => JSON.parse(raw) as Record<string, unknown>),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("line format", () => {
  it("writes one JSON object with level, UTC timestamp, message, request id, and fields", () => {
    const { log, lines, line, entry } = capture({ requestId: "req-12345678" });
    log.info("order created", { orderId: "o1", itemCount: 3 });

    expect(lines).toHaveLength(1);
    expect(line()).not.toContain("\n");
    expect(entry()).toEqual({
      level: "info",
      timestamp: "2026-10-11T03:04:05.678Z",
      message: "order created",
      requestId: "req-12345678",
      orderId: "o1",
      itemCount: 3,
    });
  });

  it("omits requestId when there is none", () => {
    const { log, entry } = capture();
    log.warn("startup");
    expect(entry()).toEqual({
      level: "warn",
      timestamp: "2026-10-11T03:04:05.678Z",
      message: "startup",
    });
  });

  it("does not let fields override reserved keys", () => {
    const { log, entry } = capture({ requestId: "req-12345678" });
    log.error("real", { level: "debug", message: "fake", timestamp: "never", requestId: "spoof" });
    expect(entry()).toMatchObject({
      level: "error",
      message: "real",
      timestamp: "2026-10-11T03:04:05.678Z",
      requestId: "req-12345678",
    });
  });

  it("keeps a multi-line message on one line", () => {
    const { log, line, entry } = capture();
    log.info('first\nsecond {"level":"error"}');
    expect(line().split("\n")).toHaveLength(1);
    expect(entry().message).toBe('first\nsecond {"level":"error"}');
  });

  it("drops lines below the configured level and defaults to info", () => {
    const quiet = capture({ level: "warn" });
    quiet.log.debug("a");
    quiet.log.info("b");
    quiet.log.warn("c");
    quiet.log.error("d");
    expect(quiet.entries().map((entry) => entry.level)).toEqual(["warn", "error"]);

    const standard = capture();
    standard.log.debug("hidden");
    standard.log.info("shown");
    expect(standard.entries().map((entry) => entry.message)).toEqual(["shown"]);
  });

  it("writes to stdout with a trailing newline by default", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    createLogger({ now: () => FIXED }).info("hello");
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0];
    if (call === undefined) throw new Error("expected one write to stdout");
    const written = String(call[0]);
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written)).toMatchObject({ level: "info", message: "hello" });
  });
});

describe("child", () => {
  it("adds bindings and a request id, and keeps the sink and level", () => {
    const { log, entries } = capture({ level: "warn", bindings: { service: "api" } });
    const child = log.child({ requestId: "req-abcdefgh", route: "/api/v1/cart" });
    child.info("dropped");
    child.warn("kept", { extra: 1 });
    expect(entries()).toEqual([
      {
        level: "warn",
        timestamp: "2026-10-11T03:04:05.678Z",
        message: "kept",
        requestId: "req-abcdefgh",
        service: "api",
        route: "/api/v1/cart",
        extra: 1,
      },
    ]);
  });

  it("redacts sensitive bindings too", () => {
    const { log, line } = capture();
    log.child({ sessionToken: "s3cr3t-session" }).info("x");
    expect(line()).not.toContain("s3cr3t-session");
  });

  it("keeps module and component bindings readable, and redacts a binding called name", () => {
    const { log, entry } = capture();
    log.child({ module: "checkout", component: "stock", name: "Somchai Jaidee" }).info("x");
    expect(entry()).toMatchObject({ module: "checkout", component: "stock", name: REDACTED });
  });
});

describe("redaction by key (SR-04 lists)", () => {
  it.each([
    "password",
    "Password",
    "newPassword",
    "password_hash",
    "token",
    "accessToken",
    "refresh_token",
    "csrfToken",
    "secret",
    "AUTH_SECRET",
    "clientSecret",
    "authorization",
    "Authorization",
    "cookie",
    "Cookie",
    "set-cookie",
    "Set-Cookie",
    "setCookie",
    "session",
    "sessionId",
    "session_id",
    "sid",
    "apiKey",
    "x-api-key",
    "credentials",
    "line1",
    "shipLine1",
    "postalCode",
    "address",
  ])("still treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  // One example per word of the SR-04 "contains" list, as a bare word and inside a longer key.
  it.each([
    ["password", "ADMIN_BOOTSTRAP_PASSWORD"],
    ["passwd", "db_passwd"],
    ["pwd", "userPwd"],
    ["passphrase", "keyPassphrase"],
    ["token", "idToken"],
    ["secret", "webhookSecret"],
    ["authorization", "Proxy-Authorization"],
    ["cookie", "rawCookie"],
    ["session", "sessionToken"],
    ["apikey", "X-API-Key"],
    ["credential", "awsCredential"],
    ["privatekey", "private_key"],
    ["signature", "webhookSignature"],
    ["jwt", "jwtValue"],
    ["email", "ADMIN_BOOTSTRAP_EMAIL"],
    ["phone", "contactPhone"],
    ["recipient", "shipRecipientName"],
    ["postalcode", "shipPostalCode"],
    ["district", "shipSubdistrict"],
    ["province", "shipProvince"],
    ["street", "streetName"],
    ["forwarded", "X-Forwarded-For"],
  ])("redacts keys that contain %s, such as %s", (word, longer) => {
    expect(isSensitiveKey(word)).toBe(true);
    expect(isSensitiveKey(word.toUpperCase())).toBe(true);
    expect(isSensitiveKey(longer)).toBe(true);
    expect(redact({ nested: [{ [longer]: "VALUE-1" }] })).toEqual({
      nested: [{ [longer]: REDACTED }],
    });
  });

  // The SR-04 "equals" list, in the spellings the data model and HTTP use.
  it.each([
    "sid",
    "pass",
    "pin",
    "otp",
    "hash",
    "name",
    "fullName",
    "first_name",
    "lastName",
    "displayName",
    "address",
    "shippingAddress",
    "billing_address",
    "addressLine1",
    "address_line_2",
    "line1",
    "line2",
    "shipLine1",
    "ip",
    "ipAddress",
    "remoteAddress",
    "clientAddress",
    "realIp",
    "x-real-ip",
    "comment",
    "description",
    "reviewNote",
    "statusReason",
    "moderationNote",
    "failureReason",
    "metadata",
    "trackingNumber",
    "q",
    "query",
    "body",
    "headers",
    "rawHeaders",
  ])("redacts the exact key %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
    expect(redact({ [key]: "VALUE-1" })).toEqual({ [key]: REDACTED });
  });

  // Opaque ids (SR-04), the allowed security-event fields, and ordinary technical keys.
  it.each([
    "id",
    "userId",
    "storeId",
    "orderId",
    "orderNumber",
    "sellerOrderId",
    "productId",
    "addressId",
    "requestId",
    "clientRequestId",
    "clientIp",
    "userAgent",
    "status",
    "code",
    "path",
    "module",
    "component",
    "rule",
    "storeSize",
    "sku",
    "productTitle",
    "storeName",
    "categoryName",
    "filename",
    "passed",
    "pinned",
    "spin",
    "queryCount",
    "zip",
    "shipping",
    "details",
    "err",
  ])("leaves %s alone", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it("redacts sensitive keys at any depth, including inside arrays", () => {
    const { log, line, entry } = capture();
    log.info("request", {
      userId: "u1",
      password: "pw-top-level",
      meta: {
        authorization: "Bearer abc.def.ghi",
        cookie: "sid=cookie-value",
        "set-cookie": ["a=set-cookie-value"],
        "content-type": "application/json",
      },
      input: {
        profile: { credentials: { password: "pw-deep", note: "ok" } },
        attempts: [{ token: "tok-in-array" }, { nested: [{ clientSecret: "sec-in-array" }] }],
      },
      session: { id: "session-id-value", userId: "u1" },
      shipping: { line1: "99/1 Sukhumvit Soi 11", province: "Bangkok", postalCode: "10110" },
    });

    for (const leaked of [
      "pw-top-level",
      "abc.def.ghi",
      "cookie-value",
      "set-cookie-value",
      "pw-deep",
      "tok-in-array",
      "sec-in-array",
      "session-id-value",
      "Sukhumvit",
      "Bangkok",
      "10110",
    ]) {
      expect(line()).not.toContain(leaked);
    }

    expect(entry()).toMatchObject({
      userId: "u1",
      password: REDACTED,
      meta: {
        authorization: REDACTED,
        cookie: REDACTED,
        "set-cookie": REDACTED,
        "content-type": "application/json",
      },
      input: {
        profile: { credentials: REDACTED },
        attempts: [{ token: REDACTED }, { nested: [{ clientSecret: REDACTED }] }],
      },
      session: REDACTED,
      shipping: { line1: REDACTED, province: REDACTED, postalCode: REDACTED },
    });
  });

  it("redacts whole payloads logged as body, headers, query, or metadata", () => {
    const { log, line, entry } = capture();
    log.info("request", {
      body: { anything: "BODY-MARKER" },
      headers: { "content-type": "HEADER-MARKER" },
      rawHeaders: ["Accept", "RAWHEADER-MARKER"],
      query: { page: "QUERY-MARKER" },
      metadata: { before: "METADATA-MARKER" },
      orderId: "o1",
    });
    for (const marker of ["BODY-", "HEADER-", "RAWHEADER-", "QUERY-", "METADATA-"]) {
      expect(line()).not.toContain(marker);
    }
    expect(entry()).toMatchObject({ body: REDACTED, headers: REDACTED, orderId: "o1" });
  });

  it("redacts a whole order row: every personal field of the data model, ids stay", () => {
    const { log, line, entry } = capture();
    log.info("order placed", {
      order: {
        id: "ord_1",
        orderNumber: "TH-2026-000123",
        userId: "usr_1",
        addressId: "adr_1",
        email: "somchai@example.com",
        phone: "0812345678",
        name: "Somchai Jaidee",
        shipRecipientName: "Somying Rakdee",
        shipPhone: "0898765432",
        shipLine1: "99/1 Sukhumvit 21",
        shipSubdistrict: "Khlong Toei Nuea",
        shipDistrict: "Watthana",
        shipProvince: "Krung Thep",
        shipPostalCode: "10110",
        ipAddress: "203.0.113.77",
        comment: "Deliver to my mother at the blue house",
        trackingNumber: "TH0123456789X",
        failureReason: "card of Mr Somchai declined",
        grandTotalSatang: 129_000,
      },
    });
    for (const leaked of [
      "somchai@example.com",
      "0812345678",
      "Somchai",
      "Somying",
      "0898765432",
      "Sukhumvit",
      "Khlong Toei",
      "Watthana",
      "Krung Thep",
      "10110",
      "203.0.113.77",
      "blue house",
      "TH0123456789X",
      "declined",
    ]) {
      expect(line()).not.toContain(leaked);
    }
    expect(entry().order).toMatchObject({
      id: "ord_1",
      orderNumber: "TH-2026-000123",
      userId: "usr_1",
      addressId: "adr_1",
      grandTotalSatang: 129_000,
    });
  });

  it("writes clientIp and userAgent, the two fields SR-04 allows on security events", () => {
    const { log, entry } = capture();
    log.warn("rate limit refused", { clientIp: "203.0.113.7", userAgent: "Mozilla/5.0" });
    expect(entry()).toMatchObject({ clientIp: "203.0.113.7", userAgent: "Mozilla/5.0" });
  });

  it("does not mutate the logged object", () => {
    const { log } = capture();
    const fields = { password: "keep-me", nested: { token: "keep-me-too" } };
    log.info("x", fields);
    expect(fields).toEqual({ password: "keep-me", nested: { token: "keep-me-too" } });
  });
});

describe("an Error keeps its own name (SR-04)", () => {
  it("writes the name of a built-in error and of an AppError, which sets it as an own property", () => {
    const { log, entry } = capture();
    log.error("failed", {
      plain: new TypeError("inner"),
      app: notFound(),
      custom: new AppError("CONFLICT", { cause: new RangeError("deep") }),
    });
    expect(entry()).toMatchObject({
      plain: { name: "TypeError", message: "inner" },
      app: { name: "AppError", code: "NOT_FOUND", status: 404 },
      custom: { name: "AppError", code: "CONFLICT", cause: { name: "RangeError" } },
    });
  });

  it("still redacts name on an ordinary object, also one nested inside an error", () => {
    const error = Object.assign(new Error("outer"), { user: { name: "Somchai Jaidee", id: "u1" } });
    expect(redact({ name: "Somchai Jaidee", err: error })).toMatchObject({
      name: REDACTED,
      err: { name: "Error", user: { name: REDACTED, id: "u1" } },
    });
  });

  it("scrubs an error name that carries data", () => {
    const error = new Error("x");
    error.name = "Lookup failed for somchai@example.com";
    expect(JSON.stringify(redact(error))).not.toContain("somchai@example.com");
  });
});

describe("string scrubbing: credentials (SEC-002)", () => {
  it("masks URL credentials and bearer tokens inside strings, messages, and errors", () => {
    const { log, line } = capture();
    const error = new Error("connect failed: postgresql://app:db-pass-123@db.internal:5432/shop");
    log.error("upstream said Bearer eyJhbGciOi.payload.sig", {
      url: "https://user:url-pass-456@example.com/path",
      err: error,
    });

    for (const leaked of ["db-pass-123", "url-pass-456", "eyJhbGciOi"]) {
      expect(line()).not.toContain(leaked);
    }
    expect(line()).toContain("db.internal:5432/shop");
    expect(line()).toContain("example.com/path");
  });

  it.each([
    [
      "a password containing @",
      "postgresql://app:Pa@ssTAIL99@db:5432/shop",
      "postgresql://[REDACTED]@db:5432/shop",
    ],
    [
      "a password containing /",
      "postgresql://app:pa/ssTAIL99@db.internal:5432/shop",
      "postgresql://[REDACTED]@db.internal:5432/shop",
    ],
    [
      "a password containing @, /, : and ?",
      "redis://default:p@ss/w:rd?x@cache.internal:6379",
      "redis://[REDACTED]@cache.internal:6379",
    ],
    [
      "a user name without a password",
      "https://deploy-user@git.example/repo.git",
      "https://[REDACTED]@git.example/repo.git",
    ],
    [
      "two URLs in one message",
      "primary postgres://a:one@db1/x replica postgres://b:two@db2/x",
      "primary postgres://[REDACTED]@db1/x replica postgres://[REDACTED]@db2/x",
    ],
  ])("masks URL user-info up to the last @: %s", (_label, input, expected) => {
    expect(redact(input)).toBe(expected);
    const { log, line } = capture();
    log.error("db down", { err: new Error(`connect failed ${input}`) });
    expect(line()).toContain(expected);
  });

  it("leaves URLs without credentials readable", () => {
    for (const url of [
      "https://shop.example/products/shirt-01?page=2",
      "postgresql://db.internal:5432/shop",
      "http://localhost:3000/api/v1/cart",
    ]) {
      expect(redact(url)).toBe(url);
    }
  });

  it.each([
    [
      "password=hunter2VALUE",
      "auth failed; password=hunter2VALUE",
      "auth failed; password=[REDACTED]",
    ],
    [
      "a value in the middle",
      "pwd=hunter2VALUE host=db1 port=5432",
      "pwd=[REDACTED] host=db1 port=5432",
    ],
    ["blanks around =", "client_secret = hunter2VALUE done", "client_secret = [REDACTED] done"],
    ["a quoted value with blanks", 'password="hunter2 VALUE two" id=5', "password=[REDACTED] id=5"],
    ["a single-quoted value", "passphrase='hunter2 VALUE' id=5", "passphrase=[REDACTED] id=5"],
    [
      "key: value",
      "login rejected, otp_token: hunter2VALUE",
      "login rejected, otp_token: [REDACTED]",
    ],
    ["JSON text", '{"apiKey":"hunter2VALUE"}', '{"apiKey":[REDACTED]'],
    ["an email key", "email: 'hunter2VALUE'", "email: [REDACTED]"],
  ])("masks key=value and key: value secrets in free text: %s", (_label, input, expected) => {
    expect(redact(input)).toBe(expected);
    const { log, line } = capture();
    log.error("Unhandled error", { err: new Error(input) });
    expect(line()).not.toContain("hunter2");
    expect(line()).not.toContain("VALUE");
  });

  it("masks the message of the project's own unknown-error fixture", () => {
    const { log, line } = capture();
    log.error("Unhandled error", {
      err: new Error(
        'relation "User" does not exist; postgresql://app:pw@db:5432/shop; password=hunter2',
      ),
    });
    expect(line()).not.toContain("hunter2");
    expect(line()).not.toContain("app:pw");
    expect(line()).toContain('relation \\"User\\" does not exist');
  });

  it.each([
    [
      "token",
      "https://shop.example/reset?token=QUERYTOKEN123&next=/",
      "https://shop.example/reset?token=[REDACTED]&next=/",
    ],
    [
      "a later parameter",
      "/api/v1/files?page=2&access_token=QUERYTOKEN123",
      "/api/v1/files?page=2&access_token=[REDACTED]",
    ],
    [
      "several parameters",
      "/callback?code=1&session_id=QUERYTOKEN123&signature=QUERYTOKEN456&x=1",
      "/callback?code=1&session_id=[REDACTED]&signature=[REDACTED]&x=1",
    ],
    [
      "an email parameter",
      "/sign-in?email=QUERYTOKEN123%40example.com&next=%2F",
      "/sign-in?email=[REDACTED]&next=%2F",
    ],
  ])("masks secret query parameters in a logged URL: %s", (_label, input, expected) => {
    expect(redact({ url: input })).toEqual({ url: expected });
  });

  it("masks raw Cookie, Set-Cookie, and Authorization header lines held in strings", () => {
    const { log, line } = capture();
    log.info("request", {
      lines: [
        "Cookie: better-auth.session_token=COOKIEVALUE123; theme=dark",
        "Set-Cookie: sid=COOKIEVALUE456; Path=/; HttpOnly",
        "Authorization: Basic QkFTSUNWQUxVRTc4OQ==",
        "Proxy-Authorization: Digest username=BASICVALUE000",
        "Accept: application/json",
      ],
      dump: "Host: shop.example\r\nCookie: a=COOKIEVALUE789; b=2\r\nAccept: */*",
    });
    for (const leaked of ["COOKIEVALUE", "QkFTSUNWQUxVRTc4OQ", "BASICVALUE", "theme=dark"]) {
      expect(line()).not.toContain(leaked);
    }
    expect(line()).toContain("Accept: application/json");
    expect(line()).toContain("Host: shop.example");
    expect(redact("Host: a\r\nCookie: a=1; b=2\r\nAccept: */*")).toBe(
      "Host: a\r\nCookie: [REDACTED]\r\nAccept: */*",
    );
  });

  it("masks Basic and Bearer credentials that stand without a header name", () => {
    expect(redact("upstream got Basic dXNlcjpwYXNzd29yZA== and refused")).toBe(
      "upstream got Basic [REDACTED] and refused",
    );
    expect(redact("upstream got bearer abc.def-ghi_123 and refused")).toBe(
      "upstream got Bearer [REDACTED] and refused",
    );
    // Prose is spared: lower case, or nothing that looks like a credential after the word.
    expect(redact("the basic plan and Basic care")).toBe("the basic plan and Basic care");
  });

  it.each([
    "pwd",
    "pass",
    "passphrase",
    "otp",
    "pin",
    "signature",
    "jwt",
    "hash",
    "passwordHash",
    "oneTimeCode_token",
  ])("redacts the value under the key %s", (key) => {
    const { log, line } = capture();
    log.info("x", { [key]: "SENSITIVE-VALUE-42" });
    expect(line()).not.toContain("SENSITIVE-VALUE-42");
  });

  it("keeps file positions in stack frames, also for files named after a sensitive word", () => {
    const frames = [
      "    at verify (C:\\app\\src\\server\\auth\\session.ts:12:5)",
      "    at read (/srv/app/src/server/auth/password-reset.ts:40:11)",
      "    at load (file:///C:/app/node_modules/@scope/pkg/session-token.js:10:3)",
      "    at run (webpack-internal:///(rsc)/./node_modules/@scope/pkg/cookie.js:7:1)",
    ];
    for (const frame of frames) expect(redact(frame)).toBe(frame);

    const { log, entry } = capture();
    const error = new Error("boom");
    error.stack = `Error: boom\n${frames.join("\n")}`;
    log.error("failed", { err: error });
    expect((entry().err as { stack?: unknown }).stack).toBe(error.stack);
  });
});

describe("string scrubbing: email addresses (SEC-001)", () => {
  it("masks email-shaped substrings wherever they stand", () => {
    expect(redact("contact somchai@example.com or SOMYING.R+shop@mail.example.co.th now")).toBe(
      "contact [REDACTED] or [REDACTED] now",
    );
    expect(redact("<somchai@example.com>, 'a_b%c@x-y.example.org'.")).toBe(
      "<[REDACTED]>, '[REDACTED]'.",
    );
  });

  it("masks an email in a message, an error message, a stack, a value, an array, and a key", () => {
    const { log, line } = capture({ requestId: "req-12345678" });
    const error = new Error("Invalid `prisma.user.create()` invocation: somchai@example.com");
    log.error("sign-up failed for somying@example.com", {
      err: error,
      note: "duplicate of somsak@example.com",
      list: ["x", "somjai@example.com"],
      counts: { "sommai@example.com": 3 },
      cause: new Error("outer", { cause: new Error("inner sompong@example.com") }),
    });
    for (const person of ["somchai", "somying", "somsak", "somjai", "sommai", "sompong"]) {
      expect(line()).not.toContain(`${person}@example.com`);
      expect(line()).not.toContain(person);
    }
  });

  it("leaves things that only look a little like an email", () => {
    for (const text of [
      "pnpm add zod@4.6.5",
      "vitest+runner@5.0.3/node_modules",
      "user@localhost",
      "mention @somchai please",
      "a@b",
      "price @ 100.50 THB",
      "@",
      "@@@@",
    ]) {
      expect(redact(text)).toBe(text);
    }
  });

  it("leaves Thai text and ordinary identifiers untouched", () => {
    for (const text of [
      "สั่งซื้อสำเร็จ orderId=ord_1 total=129000",
      "status: PAID, itemCount: 3",
      "GET /api/v1/orders/ord_1 200 12ms",
      "2026-10-11T03:04:05.678Z",
    ]) {
      expect(redact(text)).toBe(text);
    }
  });
});

describe("output escaping (SEC-007)", () => {
  const UNSAFE = [
    0x85, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ];
  const escapeOf = (code: number): string => `${"\\"}u${code.toString(16).padStart(4, "0")}`;

  it.each(UNSAFE.map((code) => [code.toString(16).padStart(4, "0"), code] as const))(
    "writes U+%s as an escape in the message, a value, a key, an error, and the request id",
    (_hex, code) => {
      const character = String.fromCharCode(code);
      const hostile = `before${character}after`;
      const { log, lines, line, entry } = capture({ requestId: hostile });
      log.info(hostile, {
        value: hostile,
        [hostile]: 1,
        list: [hostile],
        err: new Error(hostile),
      });

      expect(lines).toHaveLength(1);
      expect(line()).not.toContain(character);
      expect(line()).toContain(`before${escapeOf(code)}after`);
      // Still the same data for a machine: the escape decodes back to the character.
      expect(entry()).toMatchObject({
        message: hostile,
        requestId: hostile,
        value: hostile,
        [hostile]: 1,
        list: [hostile],
        err: { message: hostile },
      });
    },
  );

  it("leaves no raw line separator or bidirectional control anywhere in a line", () => {
    const all = UNSAFE.map((code) => String.fromCharCode(code)).join("x");
    const { log, line } = capture();
    log.warn(`title ${all}`, { userAgent: all, nested: { deep: [all] } });
    for (const code of UNSAFE) expect(line()).not.toContain(String.fromCharCode(code));
    for (let index = 0; index < line().length; index += 1) {
      expect(UNSAFE).not.toContain(line().charCodeAt(index));
    }
  });

  it("does not touch ordinary non-ASCII text", () => {
    const { log, line, entry } = capture();
    log.info("สินค้าหมด", { title: "เสื้อยืด สีขาว" });
    expect(line()).toContain("สินค้าหมด");
    expect(entry()).toMatchObject({ message: "สินค้าหมด", title: "เสื้อยืด สีขาว" });
  });
});

describe("collections (Map, Set, Headers, URL)", () => {
  it("serialises a Map as an object, with the same key redaction as an object", () => {
    const map = new Map<unknown, unknown>([
      ["userId", "u1"],
      ["password", "MAP-SECRET"],
      ["note", "mail somchai@example.com"],
      [42, "number key"],
      [{ complex: true }, "object key"],
      ["inner", new Map([["token", "MAP-SECRET-2"]])],
    ]);
    expect(redact(map)).toEqual({
      userId: "u1",
      password: REDACTED,
      note: "mail [REDACTED]",
      "42": "number key",
      "[Key 4]": "object key",
      inner: { token: REDACTED },
    });
  });

  it("serialises a Set as an array", () => {
    expect(redact(new Set(["a", 2, { token: "SET-SECRET" }, "x somchai@example.com"]))).toEqual([
      "a",
      2,
      { token: REDACTED },
      "x [REDACTED]",
    ]);
  });

  it("serialises Headers through the same redaction as any other name/value collection", () => {
    const headers = new Headers({
      cookie: "sid=HEADER-SECRET-1",
      authorization: "Bearer HEADER-SECRET-2",
      "x-forwarded-for": "203.0.113.7",
      "x-real-ip": "203.0.113.8",
      "x-api-key": "HEADER-SECRET-3",
      "content-type": "application/json",
      referer: "https://shop.example/reset?token=HEADER-SECRET-4",
    });
    expect(redact({ incoming: headers })).toEqual({
      incoming: {
        cookie: REDACTED,
        authorization: REDACTED,
        "x-forwarded-for": REDACTED,
        "x-real-ip": REDACTED,
        "x-api-key": REDACTED,
        "content-type": "application/json",
        referer: "https://shop.example/reset?token=[REDACTED]",
      },
    });
    // Under the key callers are most likely to use, the whole collection is dropped.
    expect(redact({ headers })).toEqual({ headers: REDACTED });
  });

  it("serialises a URL as its text, through the same string masks", () => {
    const url = new URL("https://user:URL-SECRET-1@shop.example/reset?token=URL-SECRET-2&page=2");
    expect(redact({ url })).toEqual({
      url: "https://[REDACTED]@shop.example/reset?token=[REDACTED]&page=2",
    });
    expect(redact(new URL("https://shop.example/products?page=2"))).toBe(
      "https://shop.example/products?page=2",
    );
  });

  it("serialises URLSearchParams with key redaction and never writes raw bytes", () => {
    expect(redact(new URLSearchParams("q=red+shirt&page=2&token=PARAM-SECRET"))).toEqual({
      q: REDACTED,
      page: "2",
      token: REDACTED,
    });
    expect(redact({ file: Buffer.from("secret-bytes"), raw: new Uint8Array(16) })).toEqual({
      file: "[Binary 12 bytes]",
      raw: "[Binary 16 bytes]",
    });
  });

  it("writes them usefully in a log line, not as {}", () => {
    const { log, entry } = capture();
    log.info("x", {
      ids: new Set(["o1", "o2"]),
      counts: new Map([["PAID", 2]]),
      target: new URL("https://shop.example/a"),
    });
    expect(entry()).toMatchObject({
      ids: ["o1", "o2"],
      counts: { PAID: 2 },
      target: "https://shop.example/a",
    });
  });

  it("bounds large and circular collections", () => {
    const big = new Set(Array.from({ length: 500 }, (_, index) => index));
    const bigMap = new Map(Array.from({ length: 500 }, (_, index) => [`k${index}`, index]));
    const self = new Map<string, unknown>();
    self.set("self", self);
    const result = redact({ big, bigMap, self }) as {
      big: unknown[];
      bigMap: Record<string, unknown>;
      self: unknown;
    };
    expect(result.big).toHaveLength(101);
    expect(result.big[100]).toBe(TRUNCATED);
    expect(Object.keys(result.bigMap)).toHaveLength(101);
    expect(result.bigMap[TRUNCATED]).toBe(true);
    expect(result.self).toEqual({ self: "[Circular]" });
  });
});

describe("robustness", () => {
  it("does not throw on circular objects and still redacts inside them", () => {
    const { log, entry, line } = capture();
    const parent: Record<string, unknown> = { label: "parent", password: "circular-pw" };
    const child: Record<string, unknown> = { label: "child", parent };
    parent.child = child;
    parent.self = parent;
    const list: unknown[] = [];
    list.push(list);

    expect(() => log.info("circular", { parent, list })).not.toThrow();
    expect(line()).not.toContain("circular-pw");
    expect(entry()).toMatchObject({
      parent: {
        label: "parent",
        password: REDACTED,
        self: "[Circular]",
        child: { label: "child", parent: "[Circular]" },
      },
      list: ["[Circular]"],
    });
  });

  it("serialises a shared, non-circular reference each time it appears", () => {
    const shared = { value: 1 };
    expect(redact({ a: shared, b: shared, list: [shared, shared] })).toEqual({
      a: { value: 1 },
      b: { value: 1 },
      list: [{ value: 1 }, { value: 1 }],
    });
  });

  it("serialises errors with name, message, stack, cause, and own fields", () => {
    const { log, entry } = capture();
    const cause = new TypeError("inner");
    const error = Object.assign(new Error("outer", { cause }), { code: "P2002", token: "t-123" });
    log.error("failed", { err: error });

    const logged = entry().err as Record<string, unknown>;
    expect(logged).toMatchObject({
      name: "Error",
      message: "outer",
      code: "P2002",
      token: REDACTED,
      cause: { name: "TypeError", message: "inner" },
    });
    expect(typeof logged.stack).toBe("string");
  });

  it("handles values JSON cannot represent", () => {
    const { log, entry } = capture();
    const throwing = {
      get boom(): string {
        throw new Error("getter failed");
      },
      fine: 1,
    };
    expect(() =>
      log.info("odd", {
        big: BigInt("9007199254740993"),
        fn: () => 1,
        sym: Symbol("s"),
        nan: Number.NaN,
        when: new Date("2026-01-02T03:04:05.000Z"),
        badDate: new Date("nope"),
        missing: undefined,
        nothing: null,
        throwing,
      }),
    ).not.toThrow();

    expect(entry()).toMatchObject({
      big: "9007199254740993",
      fn: "[Function]",
      sym: "Symbol(s)",
      nan: "NaN",
      when: "2026-01-02T03:04:05.000Z",
      badDate: "[Invalid Date]",
      nothing: null,
      throwing: { boom: "[Unserializable]", fine: 1 },
    });
    expect(entry()).not.toHaveProperty("missing");
  });

  it("bounds depth, array length, and string length", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 30; index += 1) deep = { next: deep };

    const result = redact({
      deep,
      long: "x".repeat(20_000),
      many: Array.from({ length: 500 }, (_, index) => index),
    }) as { deep: unknown; long: string; many: unknown[] };

    expect(JSON.stringify(result.deep)).toContain("[MaxDepth]");
    expect(JSON.stringify(result.deep)).not.toContain("leaf");
    expect(result.long.length).toBeLessThan(8_100);
    expect(result.long.endsWith("[Truncated]")).toBe(true);
    expect(result.many).toHaveLength(101);
    expect(result.many[100]).toBe("[Truncated]");
  });

  it("does not let a key called __proto__ change the shape of the output", () => {
    const hostile = JSON.parse(
      '{"__proto__":{"password":"PROTO-SECRET","ok":1},"id":"x"}',
    ) as object;
    const result = redact(hostile);
    expect(JSON.stringify(result)).not.toContain("PROTO-SECRET");
    expect(result).toMatchObject({ id: "x", "[__proto__]": { password: REDACTED, ok: 1 } });
  });

  it("does not throw when the sink throws", () => {
    const log = createLogger({
      write: () => {
        throw new Error("EPIPE");
      },
    });
    expect(() => log.error("still fine")).not.toThrow();
  });
});

describe("budget per log entry", () => {
  function countValues(value: unknown): number {
    if (Array.isArray(value))
      return 1 + value.reduce<number>((sum, item) => sum + countValues(item), 0);
    if (value !== null && typeof value === "object") {
      return 1 + Object.values(value).reduce<number>((sum, item) => sum + countValues(item), 0);
    }
    return 1;
  }

  it("stops after MAX_ENTRY_NODES values and marks the cut", () => {
    const wide = Array.from({ length: 100 }, (_, row) =>
      Array.from({ length: 100 }, (_, column) => row * 100 + column),
    );
    const result = redact({ wide });
    expect(countValues(result)).toBeLessThanOrEqual(MAX_ENTRY_NODES + 110);
    expect(JSON.stringify(result)).toContain(TRUNCATED);
    // The start of the data is kept intact.
    expect((result as { wide: number[][] }).wide[0]?.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it("stops after MAX_ENTRY_CHARS characters of strings and marks the cut", () => {
    const fields: Record<string, string> = {};
    for (let index = 0; index < 50; index += 1) fields[`field${index}`] = "x".repeat(8_000);
    const result = redact(fields) as Record<string, unknown>;

    const json = JSON.stringify(result);
    expect(json.length).toBeLessThan(MAX_ENTRY_CHARS + 2_000);
    expect(result.field0).toBe("x".repeat(8_000));
    expect(result[TRUNCATED]).toBe(true);
    expect(Object.keys(result).length).toBeLessThan(12);
  });

  it("cuts a string that crosses the budget and appends the marker", () => {
    const result = redact(Array.from({ length: 10 }, () => "y".repeat(7_900))) as string[];
    const last = result[result.length - 1];
    expect(last).toBe(TRUNCATED);
    const cut = result.find((item) => item.startsWith("y") && item.endsWith(TRUNCATED));
    expect(cut?.length).toBeLessThan(7_900);
  });

  it("drops what lies beyond the budget instead of writing it unredacted", () => {
    const fields: Record<string, unknown> = {};
    for (let index = 0; index < 20; index += 1) fields[`field${index}`] = "x".repeat(8_000);
    fields.password = "BEYOND-BUDGET-SECRET";
    fields.note = "write to somchai@example.com";
    fields.tail = ["postgresql://app:BEYOND-BUDGET-URL@db/shop"];

    const { log, line, entry } = capture();
    log.info("large", fields);
    for (const leaked of ["BEYOND-BUDGET", "somchai@example.com"]) {
      expect(line()).not.toContain(leaked);
    }
    // The line itself is intact: level, timestamp, and message are never part of the budget.
    expect(entry()).toMatchObject({ level: "info", message: "large", [TRUNCATED]: true });
    expect(line().length).toBeLessThan(MAX_ENTRY_CHARS + 10_000);
  });

  it("gives every log entry a fresh budget", () => {
    const { log, entry } = capture();
    const fields: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1) fields[`field${index}`] = "x".repeat(8_000);
    log.info("first", fields);
    log.info("second", { orderId: "o1" });
    expect(entry(1)).toMatchObject({ message: "second", orderId: "o1" });
    expect(entry(1)).not.toHaveProperty(TRUNCATED);
  });
});

describe("cost of redaction", () => {
  // 8,000 characters each (the per-string cap), built to make a naive pattern backtrack.
  const PATHOLOGICAL: [string, string][] = [
    ["scheme look-alikes (the reported case)", "a.".repeat(4_000)],
    ["scheme separators", "://".repeat(2_667)],
    ["scheme separators with @", "x://y@".repeat(1_334)],
    ["one endless scheme", `${"a".repeat(7_990)}://x@y`],
    ["at signs", "@".repeat(8_000)],
    ["local parts", "a@".repeat(4_000)],
    ["almost emails", "a.b@c.".repeat(1_334)],
    ["one endless local part", `${"a".repeat(7_990)}@b.example`],
    ["one endless domain", `a@${"b.".repeat(3_995)}`],
    ["equals signs", "=".repeat(8_000)],
    ["short pairs", "a=".repeat(4_000)],
    ["sensitive pairs", "password=".repeat(889)],
    ["sensitive keys without a value", "token:".repeat(1_334)],
    ["colons", ":".repeat(8_000)],
    ["one endless key", `${"k".repeat(7_990)}=v`],
    ["open quotes", 'pwd="'.repeat(1_600)],
    ["bearer words", "Bearer ".repeat(1_143)],
    ["bearer and blanks", `Bearer${" ".repeat(7_994)}`],
    ["basic words", "Basic ".repeat(1_334)],
    ["blanks", " ".repeat(8_000)],
    ["line breaks after a header", "Cookie: a\n".repeat(800)],
  ];

  it.each(PATHOLOGICAL)("scrubs 100 strings of %s well within the time bound", (_label, text) => {
    expect(text.length).toBeGreaterThan(7_900);
    const started = performance.now();
    // Each call scrubs the whole 8,000 characters: 800,000 characters in total.
    for (let round = 0; round < 100; round += 1) redact(text);
    const elapsed = performance.now() - started;
    // Linear scanning needs a few milliseconds here. The quadratic pattern this replaced took
    // 16 to 17 ms for ONE such string, so about 1,600 ms for this loop.
    expect(elapsed).toBeLessThan(500);
  });

  it("redacts the reported worst case (100 objects x 100 pathological strings) within the bound", () => {
    const text = "a.".repeat(4_000);
    const row: Record<string, string> = {};
    for (let index = 0; index < 100; index += 1) row[`column${index}`] = text;
    const rows = Array.from({ length: 100 }, () => ({ ...row }));

    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line) });
    const started = performance.now();
    log.error("Unhandled error", { rows });
    const elapsed = performance.now() - started;

    // This call stalled the process for 169 seconds before the fix.
    expect(elapsed).toBeLessThan(1_000);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.length).toBeLessThan(MAX_ENTRY_CHARS + 10_000);
    expect(lines[0]).toContain(TRUNCATED);
  });
});
