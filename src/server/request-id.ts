/**
 * Request id: one id per request, echoed in the response header, in the error
 * envelope (`error.requestId`), and in every log line for that request.
 *
 * Header: `X-Request-Id` on both the request and the response
 * (docs/API_CONTRACTS.md, "Conventions").
 *
 * Security rule SR-03 (docs/SECURITY.md): by default the server generates every
 * id and ignores an incoming `X-Request-Id`, because a client that chooses the
 * id can reuse someone else's or put one id on thousands of requests. An
 * incoming id is reused only when the caller states that a trusted proxy sits
 * in front of the application (`trustIncoming: true`, which the caller derives
 * from the SR-01 proxy configuration) and the value matches REQUEST_ID_PATTERN
 * (letters, digits, `-`, `_`; 8 to 64 characters). This module never reads the
 * environment.
 *
 * A well-formed id from an untrusted client may still be logged, but only as a
 * separate field named `clientRequestId` (see `readIncomingRequestId`), never
 * as `requestId`.
 *
 * Note for Cache Components: reading a request header and calling
 * crypto.randomUUID() both make a GET handler dynamic, which is intended for
 * every handler that uses this module.
 */

export const REQUEST_ID_HEADER = "X-Request-Id";

export const REQUEST_ID_MIN_LENGTH = 8;
export const REQUEST_ID_MAX_LENGTH = 64;
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type RequestIdSource = Request | Headers | string | null | undefined;

export interface ResolveRequestIdOptions {
  /**
   * True only when a trusted proxy is configured under SR-01 (`TRUSTED_PROXY_HOPS` of 1 or
   * more, or `TRUSTED_CLIENT_IP_HEADER` set), so that the proxy sets or overwrites the header.
   * Default false: the incoming value is ignored.
   */
  trustIncoming?: boolean;
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function generateRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The incoming `X-Request-Id` when it is well-formed, otherwise undefined.
 * The result is client-controlled: log it as `clientRequestId` only, and never use it as the
 * request id (use `resolveRequestId` for that).
 */
export function readIncomingRequestId(source?: RequestIdSource): string | undefined {
  let candidate: string | null | undefined;
  if (typeof source === "string" || source == null) {
    candidate = source;
  } else if (source instanceof Headers) {
    candidate = source.get(REQUEST_ID_HEADER);
  } else {
    candidate = source.headers.get(REQUEST_ID_HEADER);
  }
  return isValidRequestId(candidate) ? candidate : undefined;
}

/**
 * Returns the request id for this request: a new UUID, unless `trustIncoming` is true and the
 * incoming id is well-formed. Accepts a Request, a Headers object, or the raw header value.
 */
export function resolveRequestId(
  source?: RequestIdSource,
  options: ResolveRequestIdOptions = {},
): string {
  if (options.trustIncoming !== true) return generateRequestId();
  return readIncomingRequestId(source) ?? generateRequestId();
}
