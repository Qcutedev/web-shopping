/**
 * The security events of the auth routes (SECURITY.md SR-04, "Allowed with limits", and the
 * caller rules of `security()`).
 *
 * Every line is written with `logger.security(...)`, which `LOG_LEVEL` does not filter. Because
 * of that, every line must be bounded by a rate limit (SR-04 caller rule 4; the T-015 hand-over):
 *
 *   - Events written after a request has used an allowance of the rate limit that counts it
 *     (`sign-in` success and failure, `sign-up`) are bounded by that limit: at most 5 sign-in
 *     lines a minute and 5 sign-up lines an hour per client address (docs/API_CONTRACTS.md
 *     section 6). They are written as they happen.
 *   - Events that come before any allowance is used (an `Origin` refusal, a rate-limit refusal)
 *     can be caused without limit. They go through a throttle: at most one line per kind and
 *     rule per THROTTLE_INTERVAL_MS, carrying the number of events of that kind that were not
 *     written since the last line (`suppressed`). The throttle's state is data only and lives on
 *     `globalThis` under a `Symbol.for` key, so every copy of this module in the process shares
 *     it (docs/ARCHITECTURE.md, module copies; SEC-030).
 *
 * Content (SR-04): ids and outcomes only. `clientIp` is the SR-01 result (`getClientAddress`),
 * the user agent is cut to 200 characters. Never an email, a password, a token, a body, or a
 * rate-limit subject. A failed sign-in carries no user id: the caller is not known.
 *
 * Levels (SR-05 item 10, SR-04 caller rule 4): nothing a client can cause at will is written at
 * `error`. Refusals and failures are `warn`, successes `info`.
 */
import type { StructuredLogger } from "../logger";
import { clipText, LOG_USER_AGENT_MAX_LENGTH } from "./config";

/** One throttled line per kind and rule at most this often. */
export const THROTTLE_INTERVAL_MS = 60_000;

export type SecurityEventKind = "sign-in" | "sign-up" | "origin-refused" | "rate-limited";

export interface SecurityEventFields {
  outcome: "succeeded" | "failed" | "accepted" | "refused";
  /** The route, for example `sign-in`. */
  route: string;
  /** The SR-01 client address: an IPv4 address, an IPv6 /64 network, or `unknown`. */
  clientIp: string;
  /** The raw `User-Agent` header; it is cut before it is written. */
  userAgent: string | null;
  /** Only on a success, when the user is known. */
  userId?: string;
  /** The rate-limit rule name, on a rate-limit refusal. */
  rule?: string;
  /** True when the rate-limit store was full (SR-02), on a rate-limit refusal. */
  saturated?: boolean;
}

const MESSAGES: Record<SecurityEventKind, string> = {
  "sign-in": "Sign-in attempt",
  "sign-up": "Sign-up attempt",
  "origin-refused": "Mutation refused: Origin does not match",
  "rate-limited": "Request refused by rate limit",
};

/** Kinds that come before any allowance is used, and so are throttled. */
const THROTTLED: ReadonlySet<SecurityEventKind> = new Set(["origin-refused", "rate-limited"]);

interface ThrottleSlot {
  lastWrittenAt: number;
  suppressed: number;
}

const THROTTLE_STATE_KEY = Symbol.for("marketplace.auth.securityEventThrottle");
type GlobalWithThrottle = typeof globalThis & { [THROTTLE_STATE_KEY]?: unknown };

/** The throttle table of the process. A slot that holds anything else is replaced. */
function throttleTable(): Map<string, ThrottleSlot> {
  const holder = globalThis as GlobalWithThrottle;
  const existing = holder[THROTTLE_STATE_KEY];
  if (existing instanceof Map) return existing as Map<string, ThrottleSlot>;
  const created = new Map<string, ThrottleSlot>();
  holder[THROTTLE_STATE_KEY] = created;
  return created;
}

/**
 * Writes one security event, or counts it as suppressed when its kind is throttled and a line
 * of the same kind and rule was written less than THROTTLE_INTERVAL_MS ago. Never throws.
 */
export function recordSecurityEvent(
  log: StructuredLogger,
  kind: SecurityEventKind,
  fields: SecurityEventFields,
  now: number = Date.now(),
): void {
  try {
    const line: Record<string, unknown> = {
      component: "auth",
      event: kind,
      outcome: fields.outcome,
      route: fields.route,
      clientIp: fields.clientIp,
      userAgent: clipText(fields.userAgent, LOG_USER_AGENT_MAX_LENGTH),
    };
    if (fields.userId !== undefined) line["userId"] = fields.userId;
    if (fields.rule !== undefined) line["rule"] = fields.rule;
    if (fields.saturated !== undefined) line["saturated"] = fields.saturated;

    if (THROTTLED.has(kind)) {
      const table = throttleTable();
      const key = `${kind}:${fields.rule ?? fields.route}`;
      const slot = table.get(key);
      // `now < slot.lastWrittenAt` covers a clock that stepped backwards.
      if (
        slot !== undefined &&
        now >= slot.lastWrittenAt &&
        now - slot.lastWrittenAt < THROTTLE_INTERVAL_MS
      ) {
        slot.suppressed += 1;
        return;
      }
      line["suppressed"] = slot?.suppressed ?? 0;
      table.set(key, { lastWrittenAt: now, suppressed: 0 });
    }

    const level = fields.outcome === "succeeded" || fields.outcome === "accepted" ? "info" : "warn";
    log.security(level, MESSAGES[kind], line);
  } catch {
    // A log line must never turn a request into a failure.
  }
}
