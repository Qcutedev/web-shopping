import { describe, expect, it } from "vitest";

import { ROUTES, SIGN_IN_NEXT_PARAM } from "@/lib/routes";

import {
  DEFAULT_REDIRECT_PATH,
  MAX_REDIRECT_PATH_LENGTH,
  safeRedirectPath,
  SIGN_IN_PATH,
} from "./redirect";

describe("SIGN_IN_PATH (D-036 item 4)", () => {
  it("is /sign-in, the path the shell links to", () => {
    expect(SIGN_IN_PATH).toBe("/sign-in");
    expect(SIGN_IN_PATH).toBe(ROUTES.signIn);
  });

  it("is a path safeRedirectPath accepts unchanged", () => {
    expect(safeRedirectPath(SIGN_IN_PATH)).toBe(SIGN_IN_PATH);
  });

  it("uses the same query parameter name as the shell's sign-in links", () => {
    // src/proxy.ts writes `next`; signInHref writes SIGN_IN_NEXT_PARAM.
    expect(SIGN_IN_NEXT_PARAM).toBe("next");
  });
});

describe("safeRedirectPath (TM-19)", () => {
  it.each([
    ["/", "/"],
    ["/seller", "/seller"],
    ["/seller/products?page=2#top", "/seller/products?page=2#top"],
    ["/products/%E0%B8%AA%E0%B8%B4%E0%B8%99", "/products/%E0%B8%AA%E0%B8%B4%E0%B8%99"],
    ["/a/../b", "/b"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
  ])("accepts the same-origin path %j as %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "http://evil.example/seller",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/ /evil.example",
    "/\u0000",
    "/\u2028/evil.example",
    "javascript:alert(1)",
    "data:text/html,x",
    "seller",
    "",
    " /seller",
    "/seller ",
  ])("refuses %j", (input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_REDIRECT_PATH);
  });

  it("refuses anything that is not a string", () => {
    for (const value of [undefined, null, 42, {}, ["/seller"], new URL("http://x/seller")]) {
      expect(safeRedirectPath(value)).toBe(DEFAULT_REDIRECT_PATH);
    }
  });

  it("refuses a path longer than the limit", () => {
    expect(safeRedirectPath(`/${"a".repeat(MAX_REDIRECT_PATH_LENGTH)}`)).toBe("/");
    expect(safeRedirectPath(`/${"a".repeat(MAX_REDIRECT_PATH_LENGTH - 1)}`)).toHaveLength(
      MAX_REDIRECT_PATH_LENGTH,
    );
  });

  it("returns the given fallback", () => {
    expect(safeRedirectPath("//evil.example", "/account")).toBe("/account");
  });
});
