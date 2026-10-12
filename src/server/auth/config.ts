/**
 * The values the auth layer is configured with. docs/SECURITY.md, "Session and cookie settings",
 * lists them; a change here is a change there.
 *
 * No database and no framework import.
 */
import { EnvValidationError, type EnvSource } from "../env";

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

/** The secret signs the session cookie. Better Auth itself asks for at least 32 characters. */
export const AUTH_SECRET_MIN_LENGTH = 32;

/**
 * The marker every throwaway value of `.env.example` carries (SEC-009). A secret that contains it
 * is refused when NODE_ENV=production.
 */
const PLACEHOLDER_MARKER = "not_a_secret";

/** Rule texts of `readAuthSecret`. None of them contains a value. */
export const AUTH_SECRET_RULES = {
  required: "is required",
  tooShort: `must be at least ${AUTH_SECRET_MIN_LENGTH} characters long`,
  placeholder: "must not be a placeholder from .env.example when NODE_ENV=production",
} as const;

/**
 * Reads and validates `AUTH_SECRET`. Throws `EnvValidationError` (the variable name and a rule,
 * never the value) when it is absent or empty, shorter than AUTH_SECRET_MIN_LENGTH, or, when
 * NODE_ENV=production, a placeholder. There is no default in any environment: without the
 * variable no session can be created or read, and the auth routes answer 500.
 *
 * Not kept between calls. It is read when the auth instance is created (auth.ts), once per copy
 * of that module.
 *
 * Ownership note: src/server/env.ts is the one place that is meant to read the environment, and
 * this variable belongs in its validation at start-up (devops, handed on with T-015). Until it is
 * there, this reader keeps the same rules: a fault is reported by name and rule, never by value.
 */
export function readAuthSecret(source: EnvSource = process.env): string {
  const value = source["AUTH_SECRET"];
  if (value === undefined || value === "") {
    throw new EnvValidationError([{ variable: "AUTH_SECRET", rule: AUTH_SECRET_RULES.required }]);
  }
  if (value.length < AUTH_SECRET_MIN_LENGTH) {
    throw new EnvValidationError([{ variable: "AUTH_SECRET", rule: AUTH_SECRET_RULES.tooShort }]);
  }
  if (source["NODE_ENV"] === "production" && value.includes(PLACEHOLDER_MARKER)) {
    throw new EnvValidationError([
      { variable: "AUTH_SECRET", rule: AUTH_SECRET_RULES.placeholder },
    ]);
  }
  return value;
}

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
