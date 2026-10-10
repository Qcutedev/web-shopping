/**
 * Request id: one id per request, echoed in the response header, in the error
 * envelope (`error.requestId`), and in every log line for that request.
 *
 * Header: `X-Request-Id` on both the request and the response.
 * docs/API_CONTRACTS.md does not name a header, so this constant is the single
 * place to change it.
 *
 * An incoming id is client-controlled. It is reused only when it matches
 * REQUEST_ID_PATTERN (letters, digits, `-`, `_`; 8 to 64 characters), which
 * keeps control characters, whitespace, and oversized values out of logs and
 * response headers. Anything else is replaced by a generated UUID.
 *
 * Note for Cache Components: reading a request header and calling
 * crypto.randomUUID() both make a GET handler dynamic, which is intended for
 * every handler that uses this module.
 */

export const REQUEST_ID_HEADER = "X-Request-Id";

export const REQUEST_ID_MIN_LENGTH = 8;
export const REQUEST_ID_MAX_LENGTH = 64;
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function generateRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Returns the incoming request id when it is safe, otherwise a new one.
 * Accepts a Request, a Headers object, or the raw header value.
 */
export function resolveRequestId(source?: Request | Headers | string | null): string {
  let candidate: string | null | undefined;
  if (typeof source === "string" || source == null) {
    candidate = source;
  } else if (source instanceof Headers) {
    candidate = source.get(REQUEST_ID_HEADER);
  } else {
    candidate = source.headers.get(REQUEST_ID_HEADER);
  }
  return isValidRequestId(candidate) ? candidate : generateRequestId();
}
