/**
 * Next.js proxy (the former `middleware` convention, renamed in Next.js 16).
 *
 * For the user's convenience only: a visitor without a session cookie who opens a seller, admin,
 * or account page is sent to the sign-in page, with the page they wanted as `next`. It is NOT the
 * security boundary (SECURITY.md TM-07): it only looks whether a cookie with the session cookie's
 * name is present, not whether it is valid, and it never reads the database. Every page and
 * every route handler checks the session itself (`requireActor` and the role helpers in
 * src/server/auth), and every service checks again.
 *
 * Nothing is shared with route handlers through module state: the proxy is compiled on its own
 * (docs/ARCHITECTURE.md, the module-copy measurement).
 *
 * Matchers (each was checked against real paths in src/proxy.test.ts; a `:path*` needs the
 * leading `/`): `/seller` and everything below it, the same for `/admin` and `/account`.
 */
import { type NextRequest, NextResponse } from "next/server";

import { hasSessionCookie } from "@/server/auth/cookies";
import { safeRedirectPath, SIGN_IN_PATH } from "@/server/auth/redirect";

export function proxy(request: NextRequest): NextResponse {
  if (hasSessionCookie(request.headers.get("cookie"))) return NextResponse.next();
  const target = new URL(SIGN_IN_PATH, request.nextUrl.origin);
  target.searchParams.set(
    "next",
    safeRedirectPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
  );
  return NextResponse.redirect(target);
}

export const config = {
  matcher: ["/seller/:path*", "/admin/:path*", "/account/:path*"],
};
