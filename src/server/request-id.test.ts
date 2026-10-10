import { describe, expect, it } from "vitest";

import {
  generateRequestId,
  isValidRequestId,
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "./request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("isValidRequestId", () => {
  it.each([
    "abcdefgh",
    "0f8fad5b-d9cb-469f-a165-70867728950e",
    "req_01HZX9-abcDEF",
    "a".repeat(64),
  ])("accepts %s", (value) => {
    expect(isValidRequestId(value)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["too short", "abc1234"],
    ["too long", "a".repeat(65)],
    ["space", "abcd efgh"],
    ["newline (log injection)", "abcdefgh\nlevel=error"],
    ["carriage return (header injection)", "abcdefgh\r\nSet-Cookie: x=1"],
    ["trailing newline", "abcdefgh\n"],
    ["quote", 'abcdefgh"'],
    ["angle brackets", "<script>alert(1)</script>"],
    ["dot and slash", "../../etc/passwd"],
    ["non-ascii", "รหัสคำขอ-12345"],
    ["null byte", "abcdefgh\u0000"],
  ])("rejects %s", (_label, value) => {
    expect(isValidRequestId(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidRequestId(undefined)).toBe(false);
    expect(isValidRequestId(null)).toBe(false);
    expect(isValidRequestId(12345678)).toBe(false);
  });
});

describe("generateRequestId", () => {
  it("returns a valid, unique UUID", () => {
    const first = generateRequestId();
    const second = generateRequestId();
    expect(first).toMatch(UUID);
    expect(isValidRequestId(first)).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe("resolveRequestId", () => {
  it("uses the documented header name", () => {
    expect(REQUEST_ID_HEADER).toBe("X-Request-Id");
  });

  it("reuses a safe incoming id from a Request, Headers, or string", () => {
    const id = "client-id-12345";
    const request = new Request("http://localhost/api/v1/cart", {
      headers: { "x-request-id": id },
    });
    expect(resolveRequestId(request)).toBe(id);
    expect(resolveRequestId(new Headers({ [REQUEST_ID_HEADER]: id }))).toBe(id);
    expect(resolveRequestId(id)).toBe(id);
  });

  it("generates an id when none is supplied", () => {
    expect(resolveRequestId(new Request("http://localhost/"))).toMatch(UUID);
    expect(resolveRequestId(new Headers())).toMatch(UUID);
    expect(resolveRequestId(null)).toMatch(UUID);
    expect(resolveRequestId()).toMatch(UUID);
  });

  it("replaces an unsafe incoming id", () => {
    for (const unsafe of ["short", "has space in it", "x".repeat(200), "<b>bold-text</b>"]) {
      const resolved = resolveRequestId(new Headers({ [REQUEST_ID_HEADER]: unsafe }));
      expect(resolved).not.toBe(unsafe);
      expect(resolved).toMatch(UUID);
    }
  });
});
