import * as crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bearerToken,
  constantTimeEqual,
  isAuthorizedMaintenanceRequest,
  MAX_AUTHORIZATION_HEADER_LENGTH,
} from "./authorization";

vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return { ...original, timingSafeEqual: vi.fn(original.timingSafeEqual) };
});

// Made up, assembled at run time.
const SECRET = ["Zq7canary", "Cr0nS3cr", "Kd2Xw9Lm", "4Rt6Pn3b"].join("");

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

afterEach(() => {
  vi.mocked(crypto.timingSafeEqual).mockClear();
});

describe("constantTimeEqual", () => {
  it("is true for equal strings and false otherwise", () => {
    expect(constantTimeEqual(SECRET, SECRET)).toBe(true);
    expect(constantTimeEqual(SECRET, `${SECRET}x`)).toBe(false);
    expect(constantTimeEqual(SECRET, SECRET.slice(0, -1))).toBe(false);
    expect(constantTimeEqual(SECRET, "")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("a", "A")).toBe(false);
  });

  it("compares two 32-byte digests with timingSafeEqual, whatever the input lengths", () => {
    for (const [a, b] of [
      [SECRET, SECRET],
      [SECRET, "x"],
      ["", SECRET.repeat(8)],
    ] as const) {
      constantTimeEqual(a, b);
    }
    const calls = vi.mocked(crypto.timingSafeEqual).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [left, right] of calls) {
      expect((left as Buffer).byteLength).toBe(32);
      expect((right as Buffer).byteLength).toBe(32);
    }
  });
});

describe("bearerToken", () => {
  it("reads the token of a Bearer header, the scheme in any case", () => {
    expect(bearerToken(`Bearer ${SECRET}`)).toBe(SECRET);
    expect(bearerToken(`bearer ${SECRET}`)).toBe(SECRET);
    expect(bearerToken(`BEARER ${SECRET}`)).toBe(SECRET);
  });

  it.each([
    null,
    "",
    "Bearer",
    "Bearer ",
    `Bearer  ${SECRET}`,
    `Basic ${SECRET}`,
    `Token ${SECRET}`,
    SECRET,
    `Bearer ${SECRET} extra`,
    `Bearer ${SECRET}é`,
  ])("refuses %j", (value) => {
    expect(bearerToken(value)).toBeUndefined();
  });

  it("refuses a header longer than the bound before looking at it", () => {
    const long = `Bearer ${"a".repeat(MAX_AUTHORIZATION_HEADER_LENGTH)}`;
    expect(bearerToken(long)).toBeUndefined();
    expect(bearerToken(`Bearer ${"a".repeat(256)}`)).toBe("a".repeat(256));
  });
});

describe("isAuthorizedMaintenanceRequest", () => {
  it("accepts the right secret", () => {
    expect(
      isAuthorizedMaintenanceRequest(headers({ authorization: `Bearer ${SECRET}` }), SECRET),
    ).toBe(true);
  });

  it("refuses a missing header", () => {
    expect(isAuthorizedMaintenanceRequest(headers({}), SECRET)).toBe(false);
  });

  it.each([
    ["a wrong secret", `Bearer ${SECRET.slice(0, -1)}x`],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, 16)}`],
    ["the secret with more after it", `Bearer ${SECRET}x`],
    ["another scheme", `Basic ${SECRET}`],
    ["the bare secret", SECRET],
  ])("refuses %s", (_label, value) => {
    expect(isAuthorizedMaintenanceRequest(headers({ authorization: value }), SECRET)).toBe(false);
  });

  it("refuses every request when no secret is configured, the right-looking one included", () => {
    for (const configured of [undefined, ""]) {
      expect(isAuthorizedMaintenanceRequest(headers({}), configured)).toBe(false);
      expect(
        isAuthorizedMaintenanceRequest(headers({ authorization: "Bearer " }), configured),
      ).toBe(false);
      expect(
        isAuthorizedMaintenanceRequest(headers({ authorization: `Bearer ${SECRET}` }), configured),
      ).toBe(false);
    }
  });

  it("refuses the right secret when the request carries a browser's Cookie or Origin", () => {
    const right = { authorization: `Bearer ${SECRET}` };
    expect(isAuthorizedMaintenanceRequest(headers({ ...right, cookie: "session=x" }), SECRET)).toBe(
      false,
    );
    expect(
      isAuthorizedMaintenanceRequest(headers({ ...right, origin: "https://shop.example" }), SECRET),
    ).toBe(false);
    expect(isAuthorizedMaintenanceRequest(headers({ ...right, origin: "null" }), SECRET)).toBe(
      false,
    );
  });

  it("goes through the constant-time comparison on every path", () => {
    isAuthorizedMaintenanceRequest(headers({}), SECRET);
    isAuthorizedMaintenanceRequest(headers({ authorization: `Bearer ${SECRET}` }), SECRET);
    isAuthorizedMaintenanceRequest(headers({ authorization: "Bearer wrong" }), SECRET);
    isAuthorizedMaintenanceRequest(headers({ authorization: `Bearer ${SECRET}` }), undefined);
    expect(vi.mocked(crypto.timingSafeEqual)).toHaveBeenCalledTimes(4);
  });
});
