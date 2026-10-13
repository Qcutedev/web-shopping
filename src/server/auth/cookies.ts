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

/** Removes only SP and HTAB at both ends: the whitespace RFC 6265 allows around a pair. */
function trimRfcWhitespace(text: string): string {
  return text.replace(/^[\t ]+|[\t ]+$/g, "");
}

/**
 * The pairs of a `Cookie` header whose name is unambiguous, each as `name=value` with the
 * surrounding SP and HTAB removed (SEC-038).
 *
 * The library's cookie parser (better-call 1.4.0 `parseCookies`) trims a name with
 * `String.prototype.trim`, which also removes U+00A0, U+000B, U+000C, U+FEFF, and other Unicode
 * spaces, and keeps the first pair of a name. A browser treats such a padded name as another
 * cookie, to which the `__Host-` rules do not apply, so a sibling host could plant one that the
 * library would read as the session cookie. A pair whose name `trim()` would shorten beyond SP
 * and HTAB is therefore dropped, as is a pair without `=` (which the library ignores as well).
 */
function unambiguousCookiePairs(cookieHeader: string): { name: string; pair: string }[] {
  const pairs: { name: string; pair: string }[] = [];
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const rawName = part.slice(0, separator);
    const name = trimRfcWhitespace(rawName);
    if (name !== rawName.trim()) continue;
    pairs.push({ name, pair: `${name}=${trimRfcWhitespace(part.slice(separator + 1))}` });
  }
  return pairs;
}

/**
 * True when the `Cookie` header carries a cookie with one of the session cookie names and a
 * non-empty value. Says nothing about whether that value is a valid session. A name padded with
 * anything but SP or HTAB is not the session cookie (SEC-038).
 */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  if (typeof cookieHeader !== "string" || cookieHeader.length === 0) return false;
  return unambiguousCookiePairs(cookieHeader).some(
    ({ name, pair }) =>
      (SESSION_COOKIE_NAMES as readonly string[]).includes(name) && pair.length > name.length + 1,
  );
}

/**
 * A copy of `headers` for the auth library: the `Cookie` header keeps only the unambiguous pairs
 * (SEC-038), so a padded name can neither be read as the session cookie nor shadow the real one.
 * Every call that hands request headers to the library goes through here (session.ts,
 * routes.ts). The other headers are copied unchanged; `headers` itself is not modified.
 */
export function headersForAuthLibrary(headers: Headers): Headers {
  const copy = new Headers(headers);
  const cookieHeader = headers.get("cookie");
  if (cookieHeader === null) return copy;
  const pairs = unambiguousCookiePairs(cookieHeader);
  if (pairs.length === 0) copy.delete("cookie");
  else copy.set("cookie", pairs.map(({ pair }) => pair).join("; "));
  return copy;
}
