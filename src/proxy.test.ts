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
      "__Secure-better-auth.session_token=abc.def",
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
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/admin/users?page=2");
  });

  it("treats an empty or look-alike cookie as no cookie", () => {
    for (const cookie of [
      "better-auth.session_token=",
      "better-auth.session_tokenx=abc",
      "xbetter-auth.session_token=abc",
      "session_token=abc",
    ]) {
      expect(proxy(request("/account", cookie)).status).toBe(307);
    }
  });
});
