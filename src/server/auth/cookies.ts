/**
 * The name of the session cookie, as the auth library (Better Auth 1.7.7) writes it.
 *
 * Pure: no database, no framework, no environment, so src/proxy.ts can import it. The value of
 * the cookie is the session token followed by an HMAC signature; only the library reads it
 * (session.ts). Code outside the auth layer may test whether the cookie is present, which is all
 * src/proxy.ts does, and never treats presence as a session.
 *
 * Better Auth names the cookie `<prefix>.session_token`. The prefix is `better-auth` in
 * development and tests, and `__Host-better-auth` in production, where cookies are secure
 * (SEC-034; auth.ts sets it explicitly). `__Host-` makes the browser refuse the cookie unless it
 * is `Secure`, has `Path=/`, and has no `Domain`. Both names are listed so that the presence
 * check needs no environment.
 */
export const COOKIE_PREFIX_NAME = "better-auth";
export const HOST_COOKIE_NAME_PREFIX = "__Host-";
/** The library's cookie prefix in production. */
export const HOST_COOKIE_PREFIX_NAME = `${HOST_COOKIE_NAME_PREFIX}${COOKIE_PREFIX_NAME}`;
export const SESSION_COOKIE_BASE_NAME = `${COOKIE_PREFIX_NAME}.session_token`;

export const SESSION_COOKIE_NAMES = [
  `${HOST_COOKIE_NAME_PREFIX}${SESSION_COOKIE_BASE_NAME}`,
  SESSION_COOKIE_BASE_NAME,
] as const;

/** The session cookie name for one setting of secure cookies. */
export function sessionCookieName(secure: boolean): string {
  return secure
    ? `${HOST_COOKIE_NAME_PREFIX}${SESSION_COOKIE_BASE_NAME}`
    : SESSION_COOKIE_BASE_NAME;
}

/**
 * True when the `Cookie` header carries a cookie with one of the session cookie names and a
 * non-empty value. Says nothing about whether that value is a valid session.
 */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) return false;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (value.length > 0 && (SESSION_COOKIE_NAMES as readonly string[]).includes(name)) {
      return true;
    }
  }
  return false;
}
