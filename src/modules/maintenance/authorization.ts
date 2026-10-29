/**
 * Authorization of `POST /api/v1/internal/maintenance` (docs/API_CONTRACTS.md section 5.11; owner
 * decision 2026-10-29, D-051). Machine to machine: the caller is a scheduler (GitHub Actions cron),
 * never a browser, and it proves itself with `Authorization: Bearer <CRON_SECRET>`.
 *
 *   - No session, no cookie, no role: the session cookie is never read, so a browser that holds a
 *     session gains nothing by sending it. A request that carries a `Cookie` or an `Origin` header
 *     is refused outright: a scheduler sends neither, and a browser always sends `Origin` on a
 *     cross-origin `POST` and on a same-origin `fetch` `POST`.
 *   - The secret is compared in constant time: both sides are hashed with SHA-256 and the two
 *     digests are compared with `timingSafeEqual`, so neither the content nor the length of the
 *     configured secret shows in the time a refusal takes.
 *   - Every refusal is the same: no header, a malformed header, a wrong secret, a browser marker,
 *     and an endpoint without a configured secret all give one answer (`401`, nothing in it says
 *     which). The header's value is never logged or echoed.
 *
 * Pure: reads nothing but its arguments.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** The longest `Authorization` value looked at: `Bearer ` and a secret of at most 256 characters. */
export const MAX_AUTHORIZATION_HEADER_LENGTH = 7 + 256;

/** The scheme is case-insensitive (RFC 9110 section 11.1); one space; the token printable ASCII. */
const BEARER = /^bearer ([!-~]+)$/i;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * True when `a` and `b` are the same string. Takes the same time whatever the strings hold and
 * whatever their lengths (up to the cost of hashing them): both are reduced to SHA-256 digests of
 * equal length and those are compared with `crypto.timingSafeEqual`.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** The secret of a well-formed `Bearer` header, or undefined. */
export function bearerToken(header: string | null): string | undefined {
  if (header === null || header.length > MAX_AUTHORIZATION_HEADER_LENGTH) return undefined;
  return BEARER.exec(header)?.[1];
}

/** The parts of a request this check reads. `Headers` of a `Request` fits. */
export interface MaintenanceRequestHeaders {
  get(name: string): string | null;
}

/**
 * True only when the request carries `Authorization: Bearer <secret>` for the configured secret
 * and no browser marker (`Cookie`, `Origin`). False when no secret is configured, so the endpoint
 * is closed unless an operator opened it.
 */
export function isAuthorizedMaintenanceRequest(
  headers: MaintenanceRequestHeaders,
  configuredSecret: string | undefined,
): boolean {
  // Read before any early return, so that the work done does not depend on which check fails.
  const presented = bearerToken(headers.get("authorization"));
  const browserMarker = headers.get("cookie") !== null || headers.get("origin") !== null;
  if (configuredSecret === undefined || configuredSecret === "") {
    // Still hash once, so an unconfigured endpoint answers in the time of a configured one.
    constantTimeEqual(presented ?? "", "");
    return false;
  }
  const matches = constantTimeEqual(presented ?? "", configuredSecret);
  return matches && presented !== undefined && !browserMarker;
}
