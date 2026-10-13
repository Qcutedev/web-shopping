import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

const ORIGIN = "http://localhost:3000";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, cookie === undefined ? {} : { headers: { cookie } });
}

describe("proxy matcher", () => {
  it.each([
    "/seller",
    "/seller/",
    "/seller/products",
    "/seller/products/abc/edit",
    "/admin",
    "/admin/users",
    "/account",
    "/account/addresses",
  ])("runs for %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each([
    "/",
    "/sign-in",
    "/login",
    "/products/abc",
    "/stores/abc",
    "/sellers",
    "/administrator",
    "/accounting",
    "/api/v1/auth/sign-in",
    "/api/health",
    "/_next/static/chunk.js",
  ])("does not run for %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});

describe("proxy", () => {
  it("lets a request with a session cookie through, without judging it", () => {
    for (const cookie of [
      "better-auth.session_token=abc.def",
      "__Host-better-auth.session_token=abc.def",
      "theme=dark; better-auth.session_token=forged",
    ]) {
      const response = proxy(request("/seller/products", cookie));
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("sends a visitor without a session cookie to the sign-in page with the page as next", () => {
    const response = proxy(request("/admin/users?page=2"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/admin/users?page=2");
  });

  it("treats an empty or look-alike cookie as no cookie", () => {
    for (const cookie of [
      "better-auth.session_token=",
      "better-auth.session_tokenx=abc",
      "xbetter-auth.session_token=abc",
      "session_token=abc",
      // The production name before SEC-034; the library no longer writes or reads it.
      "__Secure-better-auth.session_token=abc",
      // SEC-038: a name padded with anything but SP or HTAB is another cookie.
      "theme=dark; \u00A0better-auth.session_token=abc",
      "theme=dark; \u000c__Host-better-auth.session_token=abc",
      "theme=dark; __Host-better-auth.session_token\u000b=abc",
    ]) {
      expect(proxy(request("/account", cookie)).status).toBe(307);
    }
  });
});
