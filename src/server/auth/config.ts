/**
 * The values the auth layer is configured with. docs/SECURITY.md, "Session and cookie settings",
 * lists them; a change here is a change there.
 *
 * No database and no framework import.
 */
import { AUTH_SECRET_MIN_LENGTH, ENV_RULES, readAuthSecret } from "../env";

/**
 * How long a session lives: 7 days from sign-in, fixed. The session is not renewed while it is
 * used (`disableSessionRefresh`), so this is also the longest a stolen cookie can be used, and
 * nothing is written while a session is read (D-029 point 1).
 */
export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/** REQ-C-01 and the auth rules: at least 8 characters and at most 128, checked on the server. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Longest display name accepted at sign-up. A technical bound (API_CONTRACTS.md section 4). */
export const NAME_MAX_LENGTH = 100;
/** Longest email address accepted (RFC 5321 path limit). */
export const EMAIL_MAX_LENGTH = 254;

/** SR-07 item 3: the browser details stored with a session are cut to this many characters. */
export const SESSION_USER_AGENT_MAX_LENGTH = 512;
/** SR-04: the `User-Agent` written on a security event is cut to this many characters. */
export const LOG_USER_AGENT_MAX_LENGTH = 200;

/** How often expired sessions are removed: every hour (SR-07 item 5 requires at most 12 hours). */
export const SESSION_PURGE_INTERVAL_MS = 60 * 60 * 1_000;

/**
 * SEC-035, TM-03: the shortest time a failed sign-in and any sign-up answer take, measured from
 * the start of the password step (after the rate limits, the body, and the schema, so a refusal
 * stays cheap), plus a random 0 to `jitterMs` milliseconds. The library's own work (scrypt hash or
 * verify, user and account inserts) took about 60 to 70 ms on the development machine; the floor
 * is well above that, so an unknown email, a wrong password, a new sign-up, and a duplicate one
 * answer after the same time. When the work takes longer than the floor (an overloaded server)
 * nothing is added and the difference shows again; the per-address and per-email limits bound
 * how many samples an attacker gets.
 */
export interface ResponseFloor {
  readonly minimumMs: number;
  readonly jitterMs: number;
}

export const AUTH_RESPONSE_FLOOR: ResponseFloor = Object.freeze({ minimumMs: 250, jitterMs: 25 });

/**
 * `AUTH_SECRET` is validated by src/server/env.ts: at server start with the rest of the
 * configuration (CR-66), and here, on first use of the auth instance, with the same function. The
 * rules, their texts, and the length are defined there and re-exported under their old names, so
 * the two can never disagree. A fault is reported by variable name and rule, never by value.
 */
export { AUTH_SECRET_MIN_LENGTH, readAuthSecret };

/** Rule texts of `readAuthSecret`. None of them contains a value. */
export const AUTH_SECRET_RULES = {
  required: ENV_RULES.required,
  tooShort: ENV_RULES.authSecretTooShort,
  placeholder: ENV_RULES.authSecretPlaceholder,
  weak: ENV_RULES.authSecretWeak,
  libraryVariable: ENV_RULES.authLibraryVariable,
} as const;

/**
 * Cuts client-written text to at most `max` UTF-16 code units; `null` for an absent or empty
 * value. A surrogate pair is never split: when the cut would fall inside one, the pair is left
 * out whole.
 */
export function clipText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length <= max) return value;
  const last = value.charCodeAt(max - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return value.slice(0, end);
}
