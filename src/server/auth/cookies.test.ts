import { describe, expect, it } from "vitest";

import { hasSessionCookie, headersForAuthLibrary, SESSION_COOKIE_NAMES } from "./cookies";

const HOST = "__Host-better-auth.session_token";

/**
 * Every character `String.prototype.trim` removes that RFC 6265 does not allow around a cookie
 * name (it allows SP and HTAB only). Listed from the engine, so a new Unicode space is covered.
 */
const TRIMMED_EXTRA: readonly string[] = (() => {
  const found: string[] = [];
  for (let code = 0; code <= 0xffff; code += 1) {
    if (code >= 0xd800 && code <= 0xdfff) continue;
    const char = String.fromCodePoint(code);
    if (char !== " " && char !== "\t" && `${char}x${char}`.trim() === "x") found.push(char);
  }
  return found;
})();

/**
 * The name handling of better-call 1.4.0 `parseCookies` (`dist/cookies.mjs`), which the library
 * uses for the session cookie: split at `;`, name and value trimmed with `String.prototype.trim`,
 * the first pair of a name wins. better-call is not a direct dependency, so it is restated here;
 * the integration cases in tests/security/sec034-035-recheck.itest.ts run the real parser.
 */
function parseCookies(cookieHeader: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(separator + 1).trim());
  }
  return cookies;
}

function libraryCookies(cookieHeader: string): Map<string, string> {
  const cookie = headersForAuthLibrary(new Headers({ cookie: cookieHeader })).get("cookie");
  return cookie === null ? new Map() : parseCookies(cookie);
}

describe("SEC-038: cookie names padded beyond SP and HTAB", () => {
  it("the engine trims more than SP and HTAB (U+00A0, U+000B, U+000C, U+FEFF among them)", () => {
    for (const char of [" ", "\u000b", "\u000c", "﻿", "　", " "]) {
      expect(TRIMMED_EXTRA).toContain(char);
    }
  });

  it("the parser alone reads a padded name as the session cookie (why the filter exists)", () => {
    expect(parseCookies(` ${HOST}=attacker; ${HOST}=victim`).get(HOST)).toBe("attacker");
  });

  it("no padded name reaches the library, at the start or the end of the name", () => {
    const leaked: string[] = [];
    for (const char of TRIMMED_EXTRA) {
      // Headers refuses CR, LF, and characters above U+00FF; none of them arrives in a Node
      // request header.
      if (char === "\n" || char === "\r" || (char.codePointAt(0) ?? 0) > 0xff) continue;
      for (const padded of [`${char}${HOST}`, `${HOST}${char}`, ` ${char}\t${HOST} `]) {
        const cookies = libraryCookies(`theme=dark; ${padded}=attacker; ${HOST}=victim`);
        if (cookies.get(HOST) !== "victim") leaked.push(JSON.stringify(padded));
      }
    }
    expect(leaked).toEqual([]);
  });

  it("keeps every unpadded pair, removes only SP and HTAB around them, and drops pairs without =", () => {
    expect(
      headersForAuthLibrary(
        new Headers({ cookie: `a=1;\tb = 2 ;novalue; ${HOST}=tok.sig=; c="q"` }),
      ).get("cookie"),
    ).toBe(`a=1; b=2; ${HOST}=tok.sig=; c="q"`);
  });

  it("removes the Cookie header when no pair is left, and copies the other headers unchanged", () => {
    const original = new Headers({ cookie: ` ${HOST}=x`, "user-agent": "ua", origin: "o" });
    const copy = headersForAuthLibrary(original);
    expect(copy.has("cookie")).toBe(false);
    expect(copy.get("user-agent")).toBe("ua");
    expect(copy.get("origin")).toBe("o");
    expect(original.get("cookie")).toBe(` ${HOST}=x`);
    expect(headersForAuthLibrary(new Headers({ "user-agent": "ua" })).has("cookie")).toBe(false);
  });

  it("hasSessionCookie counts only unpadded names with a value", () => {
    for (const name of SESSION_COOKIE_NAMES) {
      expect(hasSessionCookie(`${name}=v`)).toBe(true);
      expect(hasSessionCookie(` \t${name} =v`)).toBe(true);
      expect(hasSessionCookie(`${name}=`)).toBe(false);
      expect(hasSessionCookie(` ${name}=v`)).toBe(false);
      expect(hasSessionCookie(`${name}\u000c=v`)).toBe(false);
    }
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
  });
});
