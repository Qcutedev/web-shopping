/**
 * Where a user may be sent after signing in (SECURITY.md TM-19: only same-origin relative paths).
 *
 * Pure: no database, no framework, no environment. The sign-in page and src/proxy.ts use it to
 * judge a `next` value that came from the address bar, which anyone can write.
 */

/** The sign-in page. The pages themselves are frontend's (T-018 onwards). */
export const SIGN_IN_PATH = "/login";

/** Where a user goes when the requested target is refused or absent. */
export const DEFAULT_REDIRECT_PATH = "/";

/** A target longer than this is refused; no page of the application has a longer address. */
export const MAX_REDIRECT_PATH_LENGTH = 2_048;

const BASE = "http://redirect.invalid";

/**
 * Returns `value` when it is a path on this site, in the normal form a URL parser gives it, and
 * `fallback` otherwise. Accepted: a string that starts with exactly one `/`, contains no
 * backslash, no blank, and no control character, and that a URL parser resolves to the same
 * origin. Refused, among others: absolute URLs (`https://evil.example`), scheme-relative ones
 * (`//evil.example`), the backslash forms browsers treat as slashes (`/\evil.example`), and a
 * tab or line break that the parser would drop (`/\t/evil.example` becomes `//evil.example`).
 * Never throws.
 */
export function safeRedirectPath(value: unknown, fallback: string = DEFAULT_REDIRECT_PATH): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0 || value.length > MAX_REDIRECT_PATH_LENGTH) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  // Backslash, every blank and control character. `\s` also covers the Unicode line and
  // paragraph separators and the byte order mark, which some parsers drop.
  if (/[\\\s\u0000-\u001F\u007F-\u009F]/u.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // The normal form must itself be a plain path (it always is after the checks above; this is
  // the last line of defence against a parser that reads it otherwise).
  if (!path.startsWith("/") || path.startsWith("//")) return fallback;
  return path;
}
