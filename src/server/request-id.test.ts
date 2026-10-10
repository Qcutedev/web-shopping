import { describe, expect, it } from "vitest";

import {
  generateRequestId,
  isValidRequestId,
  readIncomingRequestId,
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

  const id = "client-id-12345";
  const trusted = { trustIncoming: true };

  function requestWith(value: string): Request {
    return new Request("http://localhost/api/v1/cart", { headers: { "x-request-id": value } });
  }

  it("ignores a well-formed incoming id by default (SR-03)", () => {
    for (const source of [requestWith(id), new Headers({ [REQUEST_ID_HEADER]: id }), id]) {
      const resolved = resolveRequestId(source);
      expect(resolved).not.toBe(id);
      expect(resolved).toMatch(UUID);
    }
  });

  it("ignores an incoming id when trust is explicitly off or not exactly true", () => {
    expect(resolveRequestId(requestWith(id), { trustIncoming: false })).toMatch(UUID);
    expect(resolveRequestId(requestWith(id), {})).toMatch(UUID);
    // A truthy value that is not `true` (for example an unparsed environment string) is not trust.
    const sloppy = { trustIncoming: "false" } as unknown as { trustIncoming: boolean };
    expect(resolveRequestId(requestWith(id), sloppy)).toMatch(UUID);
  });

  it("reuses a well-formed incoming id from a Request, Headers, or string when trusted", () => {
    expect(resolveRequestId(requestWith(id), trusted)).toBe(id);
    expect(resolveRequestId(new Headers({ [REQUEST_ID_HEADER]: id }), trusted)).toBe(id);
    expect(resolveRequestId(id, trusted)).toBe(id);
  });

  it("generates an id when none is supplied, trusted or not", () => {
    for (const options of [undefined, trusted]) {
      expect(resolveRequestId(new Request("http://localhost/"), options)).toMatch(UUID);
      expect(resolveRequestId(new Headers(), options)).toMatch(UUID);
      expect(resolveRequestId(null, options)).toMatch(UUID);
      expect(resolveRequestId(undefined, options)).toMatch(UUID);
    }
    expect(resolveRequestId()).toMatch(UUID);
  });

  it("replaces a malformed incoming id even when trusted", () => {
    for (const unsafe of ["short", "has space in it", "x".repeat(200), "<b>bold-text</b>"]) {
      const resolved = resolveRequestId(new Headers({ [REQUEST_ID_HEADER]: unsafe }), trusted);
      expect(resolved).not.toBe(unsafe);
      expect(resolved).toMatch(UUID);
    }
  });
});

describe("readIncomingRequestId", () => {
  it("returns a well-formed client id for logging as clientRequestId, and undefined otherwise", () => {
    const id = "client-id-12345";
    expect(readIncomingRequestId(new Headers({ [REQUEST_ID_HEADER]: id }))).toBe(id);
    expect(
      readIncomingRequestId(new Request("http://localhost/", { headers: { "x-request-id": id } })),
    ).toBe(id);
    expect(readIncomingRequestId(id)).toBe(id);
    expect(readIncomingRequestId(new Headers({ [REQUEST_ID_HEADER]: "bad id\twith tab" }))).toBe(
      undefined,
    );
    expect(readIncomingRequestId(new Headers())).toBe(undefined);
    expect(readIncomingRequestId(null)).toBe(undefined);
    expect(readIncomingRequestId()).toBe(undefined);
  });
});
