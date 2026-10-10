import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, isSensitiveKey, type LoggerOptions, redact, REDACTED } from "./logger";

const FIXED = new Date("2026-10-11T03:04:05.678Z");

function capture(options: LoggerOptions = {}) {
  const lines: string[] = [];
  const log = createLogger({ now: () => FIXED, write: (line) => lines.push(line), ...options });
  return {
    log,
    lines,
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("line format", () => {
  it("writes one JSON object with level, UTC timestamp, message, request id, and fields", () => {
    const { log, lines, entries } = capture({ requestId: "req-12345678" });
    log.info("order created", { orderId: "o1", itemCount: 3 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("\n");
    expect(entries()[0]).toEqual({
      level: "info",
      timestamp: "2026-10-11T03:04:05.678Z",
      message: "order created",
      requestId: "req-12345678",
      orderId: "o1",
      itemCount: 3,
    });
  });

  it("omits requestId when there is none", () => {
    const { log, entries } = capture();
    log.warn("startup");
    expect(entries()[0]).toEqual({
      level: "warn",
      timestamp: "2026-10-11T03:04:05.678Z",
      message: "startup",
    });
  });

  it("does not let fields override reserved keys", () => {
    const { log, entries } = capture({ requestId: "req-12345678" });
    log.error("real", { level: "debug", message: "fake", timestamp: "never", requestId: "spoof" });
    expect(entries()[0]).toMatchObject({
      level: "error",
      message: "real",
      timestamp: "2026-10-11T03:04:05.678Z",
      requestId: "req-12345678",
    });
  });

  it("keeps a multi-line message on one line", () => {
    const { log, lines, entries } = capture();
    log.info('first\nsecond {"level":"error"}');
    expect(lines[0].split("\n")).toHaveLength(1);
    expect(entries()[0].message).toBe('first\nsecond {"level":"error"}');
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
    const written = String(spy.mock.calls[0][0]);
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
    const { log, lines } = capture();
    log.child({ sessionToken: "s3cr3t-session" }).info("x");
    expect(lines[0]).not.toContain("s3cr3t-session");
  });
});

describe("redaction", () => {
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
  ])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["id", "userId", "orderId", "addressId", "email", "status", "code", "province", "path"])(
    "leaves %s alone",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );

  it("redacts sensitive keys at any depth, including inside arrays", () => {
    const { log, lines, entries } = capture();
    log.info("request", {
      userId: "u1",
      password: "pw-top-level",
      headers: {
        authorization: "Bearer abc.def.ghi",
        cookie: "sid=cookie-value",
        "set-cookie": ["a=set-cookie-value"],
        "content-type": "application/json",
      },
      body: {
        profile: { credentials: { password: "pw-deep", note: "ok" } },
        attempts: [{ token: "tok-in-array" }, { nested: [{ clientSecret: "sec-in-array" }] }],
      },
      session: { id: "session-id-value", userId: "u1" },
      shipping: { line1: "99/1 Sukhumvit Soi 11", province: "Bangkok", postalCode: "10110" },
    });

    const line = lines[0];
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
      "10110",
    ]) {
      expect(line).not.toContain(leaked);
    }

    expect(entries()[0]).toMatchObject({
      userId: "u1",
      password: REDACTED,
      headers: {
        authorization: REDACTED,
        cookie: REDACTED,
        "set-cookie": REDACTED,
        "content-type": "application/json",
      },
      body: {
        profile: { credentials: REDACTED },
        attempts: [{ token: REDACTED }, { nested: [{ clientSecret: REDACTED }] }],
      },
      session: REDACTED,
      shipping: { line1: REDACTED, province: "Bangkok", postalCode: REDACTED },
    });
  });

  it("masks URL credentials and bearer tokens inside strings, messages, and errors", () => {
    const { log, lines } = capture();
    const error = new Error("connect failed: postgresql://app:db-pass-123@db.internal:5432/shop");
    log.error("upstream said Bearer eyJhbGciOi.payload.sig", {
      url: "https://user:url-pass-456@example.com/path",
      err: error,
    });

    const line = lines[0];
    for (const leaked of ["db-pass-123", "url-pass-456", "eyJhbGciOi"]) {
      expect(line).not.toContain(leaked);
    }
    expect(line).toContain("db.internal:5432/shop");
    expect(line).toContain("example.com/path");
  });

  it("does not mutate the logged object", () => {
    const { log } = capture();
    const fields = { password: "keep-me", nested: { token: "keep-me-too" } };
    log.info("x", fields);
    expect(fields).toEqual({ password: "keep-me", nested: { token: "keep-me-too" } });
  });
});

describe("robustness", () => {
  it("does not throw on circular objects and still redacts inside them", () => {
    const { log, entries, lines } = capture();
    const parent: Record<string, unknown> = { name: "parent", password: "circular-pw" };
    const child: Record<string, unknown> = { name: "child", parent };
    parent.child = child;
    parent.self = parent;
    const list: unknown[] = [];
    list.push(list);

    expect(() => log.info("circular", { parent, list })).not.toThrow();
    expect(lines[0]).not.toContain("circular-pw");
    expect(entries()[0]).toMatchObject({
      parent: {
        name: "parent",
        password: REDACTED,
        self: "[Circular]",
        child: { name: "child", parent: "[Circular]" },
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
    const { log, entries } = capture();
    const cause = new TypeError("inner");
    const error = Object.assign(new Error("outer", { cause }), { code: "P2002", token: "t-123" });
    log.error("failed", { err: error });

    const logged = entries()[0].err as Record<string, unknown>;
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
    const { log, entries } = capture();
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

    expect(entries()[0]).toMatchObject({
      big: "9007199254740993",
      fn: "[Function]",
      sym: "Symbol(s)",
      nan: "NaN",
      when: "2026-01-02T03:04:05.000Z",
      badDate: "[Invalid Date]",
      nothing: null,
      throwing: { boom: "[Unserializable]", fine: 1 },
    });
    expect(entries()[0]).not.toHaveProperty("missing");
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

  it("does not throw when the sink throws", () => {
    const log = createLogger({
      write: () => {
        throw new Error("EPIPE");
      },
    });
    expect(() => log.error("still fine")).not.toThrow();
  });
});
