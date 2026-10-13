/**
 * The per-email rate limits of sign-in (SEC-032, D-036 item 5; docs/SECURITY.md SR-05 item 5;
 * docs/API_CONTRACTS.md section 6).
 *
 * A sign-in request is counted, in this order, against:
 *   1. `sign-in-address` on the client address (SR-01), before the body is read (the route does
 *      this itself; it is not part of `signInEmailChecks`);
 *   2. `sign-in-email` on `<client address>|<normalised email>`, 5 per 60 s: one address's wrong
 *      passwords use only that address's allowance for the account;
 *   3. `sign-in-account` on the normalised email over all addresses, 60 per 300 s: it bounds
 *      distributed guessing on one account (at most 720 password checks an hour).
 * Each check is consumed only after the one before it allowed the request, and all of them
 * before the password is looked at. The first refusal ends the request with the same 429.
 *
 * Why one address cannot keep the owner out: it reaches check 3 at most 5 times per 60 s (checks
 * 1 and 2). At most six of its 60 s windows overlap one 300 s window of check 3, and the first of
 * those six began, with a hit, before that window did, so the address adds at most 4 + 5 * 5 = 29
 * hits to a window of 60. The owner's attempt from another address is then at most the 30th.
 * Two addresses add at most 58; exhausting the window takes a third (fixed windows, as built).
 *
 * This module builds subjects only; it knows nothing about requests. The address must come from
 * `getClientAddress` and the email from `emailRateLimitSubject` (src/modules/auth/schema.ts).
 */
import { RATE_LIMITS, type RateLimitRule } from "./rate-limit";

/** One per-email check of sign-in: what to count, and under which rule. */
export interface SignInLimitCheck {
  subject: string;
  rule: RateLimitRule;
}

/** Separates the address from the email in a `sign-in-email` subject. */
const SUBJECT_SEPARATOR = "|";

/**
 * The longest `Retry-After` a refused sign-in reports, in seconds: the window of the
 * per-address and per-email rules. A refusal by `sign-in-account` (300 s window) is reported with
 * at most this value too, so the answer does not tell which limit refused (SEC-032 item 4). A
 * client that retries earlier than the real window end is refused again; nothing else changes.
 */
export const SIGN_IN_MAX_RETRY_AFTER_SECONDS =
  Math.max(RATE_LIMITS.SIGN_IN_ADDRESS.windowMs, RATE_LIMITS.SIGN_IN_EMAIL.windowMs) / 1000;

/**
 * The `sign-in-email` subject: `<client address>|<normalised email>`. An SR-01 address (IPv4,
 * an IPv6 /64, or `unknown`) never holds the separator, so the first `|` always ends the address
 * even when the email holds one. Throws a TypeError for an empty address or one with the
 * separator, which `getClientAddress` never returns.
 */
export function signInEmailSubject(clientAddress: string, normalisedEmail: string): string {
  if (clientAddress.length === 0 || clientAddress.includes(SUBJECT_SEPARATOR)) {
    throw new TypeError("Sign-in rate-limit address must be a non-empty SR-01 client address.");
  }
  if (normalisedEmail.length === 0) {
    throw new TypeError("Sign-in rate-limit email must be non-empty.");
  }
  return `${clientAddress}${SUBJECT_SEPARATOR}${normalisedEmail}`;
}

/**
 * The per-email checks of one sign-in, in the order they must be consumed (after
 * `sign-in-address` allowed the request and the body passed the schema; before the password).
 */
export function signInEmailChecks(
  clientAddress: string,
  normalisedEmail: string,
): readonly SignInLimitCheck[] {
  return [
    {
      subject: signInEmailSubject(clientAddress, normalisedEmail),
      rule: RATE_LIMITS.SIGN_IN_EMAIL,
    },
    { subject: normalisedEmail, rule: RATE_LIMITS.SIGN_IN_ACCOUNT },
  ];
}

/** The `Retry-After` of a refused sign-in: the limiter's value, at most the cap above. */
export function signInRetryAfterSeconds(retryAfterSeconds: number): number {
  return Math.min(retryAfterSeconds, SIGN_IN_MAX_RETRY_AFTER_SECONDS);
}
