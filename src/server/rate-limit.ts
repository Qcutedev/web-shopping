/**
 * Fixed-window rate limiter (D-012; security rule SR-02 in docs/SECURITY.md).
 *
 * A caller passes a subject and a rule: `rateLimiter.consume(subject, RATE_LIMITS.CHECKOUT)`.
 * The rule carries its own name, and the limiter builds the stored key itself as
 * `<rule name>:<subject>`. Two rules applied to the same subject therefore never share a
 * counter or a window, whatever the caller does (SEC-005).
 *
 * The rule set is fixed when the limiter is created (SEC-018). `createRateLimiter` takes the
 * complete set (default: every rule of RATE_LIMITS), validates it as a whole with
 * `assertRateLimitRules`, and throws a TypeError right there when a rule is invalid, a name is
 * used twice, or the capacities do not fit the budget. `consume` accepts only a rule of that
 * set and rejects any other rule with a TypeError on every call, whatever was called before.
 * Nothing depends on the order in which rules are first used.
 *
 * Adding a rule: add it to RATE_LIMITS and take its capacity from the other rules, because the
 * built-in capacities use the whole budget on purpose (SR-02, "Capacity split"; a new split
 * must be recorded there). A set that does not fit makes this module throw when it is loaded,
 * so the mistake stops every test run and the build instead of one endpoint in production.
 *
 * Subjects (SR-01) are built only from `getClientAddress` in src/server/client-address.ts,
 * `actor.userId`, or a normalised email (trimmed, lower-cased, Unicode NFKC). A per-email
 * subject is consumed only after the per-address check has allowed the request. This module
 * knows nothing about requests, users, or addresses, and it never logs a key or a subject.
 *
 * The default store is in-process, so limits hold for a single long-running instance only. A
 * shared store (for example Redis) can be plugged in by implementing RateLimitStore; the
 * interface is asynchronous for that reason.
 *
 * Memory bound of the in-process store (SEC-004):
 *   - every rule has its own key capacity (`rule.maxKeys`), so filling one rule cannot refuse a
 *     subject of another rule;
 *   - the capacities of all rules of one limiter may add up to at most MAX_TOTAL_WINDOWS
 *     (200 000); the built-in RATE_LIMITS add up to exactly that; a set that exceeds the total
 *     is rejected with a TypeError when the limiter is created, as is a set in which two rules
 *     share a name;
 *   - each window holds a counter, a reset time, and a key of at most 128 characters after the
 *     rule name (longer keys are stored as a SHA-256 digest).
 * Expired windows are removed by a sweep that runs at most once per `sweepIntervalMs` (default
 * 60 s), or once per second while a rule is full.
 *
 * At the cap the limiter fails closed: when a rule is still full of live windows after a sweep,
 * a subject that has no window yet is refused. A live counter is never evicted, so flooding
 * with new subjects cannot reset anyone's limit, and the limiter never fails open. Such a
 * refusal is marked `saturated: true` in the result, reports a retry time of at most 60
 * seconds (space may free long before the rule's window ends), and writes one warn-level log
 * line per rule per minute at most, holding the rule name and window counts only.
 */
import { createHash } from "node:crypto";

import { logger as defaultLogger, type Logger } from "./logger";

export interface RateLimitRule {
  /**
   * Stable name of the rule, matching `^[a-z][a-z0-9-]{0,31}$`. It prefixes every stored key
   * and identifies the rule's capacity, so it must be unique per rule.
   */
  name: string;
  /** Maximum number of allowed hits per window. Positive integer. */
  limit: number;
  /** Window length in milliseconds. Positive integer. */
  windowMs: number;
  /** Key capacity: how many subjects of this rule can hold a window at once. Positive integer. */
  maxKeys: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Hits left in the current window after this one. */
  remaining: number;
  /** When the client may try again: the end of the window, or sooner after a saturated refusal. */
  resetAt: number;
  /** Whole seconds until `resetAt`, at least 1. Use for `Retry-After` when blocked. */
  retryAfterSeconds: number;
  /**
   * True when the hit was refused because the rule's store is full, not because this subject
   * exceeded its limit. `allowed` is then false and `retryAfterSeconds` is at most 60.
   */
  saturated: boolean;
}

/** What a store is asked to count. */
export interface RateLimitIncrement {
  /** Validated rule name. */
  rule: string;
  /** Non-empty subject within the rule. The stored key is `<rule>:<subject>`. */
  subject: string;
  windowMs: number;
  /** Key capacity of the rule. */
  maxKeys: number;
  /** Current time in epoch milliseconds. */
  now: number;
}

export interface RateLimitHit {
  /** Hits recorded in the current window, including this one. */
  count: number;
  resetAt: number;
  /** True when the store could not track the key and the hit must be refused. */
  saturated?: boolean;
  /** At saturation: windows held for this rule and in the whole store, for the log line. */
  ruleSize?: number;
  storeSize?: number;
}

/** Storage behind the limiter. `increment` must be atomic per rule and subject. */
export interface RateLimitStore {
  increment(hit: RateLimitIncrement): Promise<RateLimitHit>;
}

export interface RateLimiter {
  /**
   * Records one hit for `subject` under `rule` and reports whether it is within the rule.
   * Rejects with a TypeError when `rule` is not one of the rules the limiter was created with
   * (same name and same settings), or when `subject` is empty.
   */
  consume(subject: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

/** Upper bound on the windows held for all rules together (SR-02). */
export const MAX_TOTAL_WINDOWS = 200_000;
/** Upper bound on the number of rules in one limiter's rule set. */
export const MAX_RULES = 64;
/** Longest retry time reported for a refusal caused by a full store (SR-02). */
export const SATURATION_RETRY_MS = 60_000;
/** Shortest time between two saturation log lines for one rule (SR-02). */
export const SATURATION_LOG_INTERVAL_MS = 60_000;
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const FULL_STORE_SWEEP_INTERVAL_MS = 1_000;
const MAX_KEY_LENGTH = 128;
const RULE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const DIGEST_PREFIX = "sha256:";

/**
 * Initial limits from docs/API_CONTRACTS.md, "Rate limits", one rule per line of SR-02.
 * This is the complete rule set of the process-wide limiter; a rule that is not listed here
 * cannot be used with it. The capacities add up to exactly MAX_TOTAL_WINDOWS, so there is no
 * headroom: a new rule needs a new split (SR-02), and a set that does not fit fails when the
 * limiter is created. The anonymous rules get the larger shares because
 * their subjects (addresses, emails) are cheaper for an attacker to vary than signed-in users.
 */
export const RATE_LIMITS = {
  SIGN_IN_ADDRESS: { name: "sign-in-address", limit: 5, windowMs: 60_000, maxKeys: 40_000 },
  SIGN_IN_EMAIL: { name: "sign-in-email", limit: 5, windowMs: 60_000, maxKeys: 40_000 },
  SIGN_UP: { name: "sign-up", limit: 5, windowMs: 3_600_000, maxKeys: 40_000 },
  CHECKOUT: { name: "checkout", limit: 10, windowMs: 60_000, maxKeys: 20_000 },
  UPLOADS: { name: "uploads", limit: 30, windowMs: 3_600_000, maxKeys: 20_000 },
  SELLER_APPLICATION: {
    name: "seller-application",
    limit: 3,
    windowMs: 86_400_000,
    maxKeys: 20_000,
  },
  REVIEW_CREATE: { name: "review-create", limit: 10, windowMs: 3_600_000, maxKeys: 20_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface MemoryRateLimitStoreOptions {
  /**
   * Hard bound on the windows held for all rules together. Default and maximum:
   * MAX_TOTAL_WINDOWS. A lower value is meant for tests; when it is smaller than the sum of the
   * rule capacities, rules compete for it and are no longer isolated from each other.
   */
  maxKeys?: number;
  sweepIntervalMs?: number;
}

interface Window {
  rule: string;
  count: number;
  resetAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();
  private readonly ruleSizes = new Map<string, number>();
  private readonly maxKeys: number;
  private readonly sweepIntervalMs: number;
  private lastSweepAt = Number.NEGATIVE_INFINITY;

  constructor(options: MemoryRateLimitStoreOptions = {}) {
    this.maxKeys = options.maxKeys ?? MAX_TOTAL_WINDOWS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    assertPositiveInteger(this.maxKeys, "maxKeys");
    assertPositiveInteger(this.sweepIntervalMs, "sweepIntervalMs");
    if (this.maxKeys > MAX_TOTAL_WINDOWS) {
      throw new TypeError(`Rate limit maxKeys must be at most ${MAX_TOTAL_WINDOWS}.`);
    }
  }

  /** Number of windows currently held for all rules, including expired ones not yet swept. */
  get size(): number {
    return this.windows.size;
  }

  /** Number of windows currently held for one rule, including expired ones not yet swept. */
  sizeOf(rule: string): number {
    return this.ruleSizes.get(rule) ?? 0;
  }

  increment(hit: RateLimitIncrement): Promise<RateLimitHit> {
    return Promise.resolve(this.incrementSync(hit));
  }

  private incrementSync({
    rule,
    subject,
    windowMs,
    maxKeys,
    now,
  }: RateLimitIncrement): RateLimitHit {
    const key = storedKey(rule, subject);
    if (now - this.lastSweepAt >= this.sweepIntervalMs) this.sweep(now);

    const existing = this.windows.get(key);
    if (existing) {
      if (now < existing.resetAt) {
        existing.count += 1;
      } else {
        // The subject's own expired window is reused: no capacity is needed.
        existing.count = 1;
        existing.resetAt = now + windowMs;
      }
      return { count: existing.count, resetAt: existing.resetAt };
    }

    if (this.isFull(rule, maxKeys)) {
      if (now - this.lastSweepAt >= FULL_STORE_SWEEP_INTERVAL_MS) this.sweep(now);
      if (this.isFull(rule, maxKeys)) {
        return {
          count: 0,
          resetAt: now + Math.min(windowMs, SATURATION_RETRY_MS),
          saturated: true,
          ruleSize: this.sizeOf(rule),
          storeSize: this.windows.size,
        };
      }
    }

    const fresh: Window = { rule, count: 1, resetAt: now + windowMs };
    this.windows.set(key, fresh);
    this.ruleSizes.set(rule, this.sizeOf(rule) + 1);
    return { count: fresh.count, resetAt: fresh.resetAt };
  }

  private isFull(rule: string, maxKeys: number): boolean {
    return this.sizeOf(rule) >= maxKeys || this.windows.size >= this.maxKeys;
  }

  private sweep(now: number): void {
    this.lastSweepAt = now;
    for (const [key, window] of this.windows) {
      if (now < window.resetAt) continue;
      this.windows.delete(key);
      const remaining = this.sizeOf(window.rule) - 1;
      if (remaining > 0) this.ruleSizes.set(window.rule, remaining);
      else this.ruleSizes.delete(window.rule);
    }
  }
}

/**
 * Validates a complete rule set: every rule is well-formed, no name is used twice, there are at
 * most MAX_RULES rules, and the capacities add up to at most MAX_TOTAL_WINDOWS. Throws a
 * TypeError otherwise. This is the budget check of SR-02, and it is part of defining rules:
 * `createRateLimiter` runs it on its whole set before the limiter exists.
 */
export function assertRateLimitRules(rules: readonly RateLimitRule[]): void {
  if (rules.length > MAX_RULES) {
    throw new TypeError(`A rate limiter accepts at most ${MAX_RULES} rules.`);
  }
  const names = new Set<string>();
  let totalCapacity = 0;
  for (const rule of rules) {
    if (typeof rule.name !== "string" || !RULE_NAME_PATTERN.test(rule.name)) {
      throw new TypeError("Rate limit rule name must match ^[a-z][a-z0-9-]{0,31}$.");
    }
    assertPositiveInteger(rule.limit, "limit");
    assertPositiveInteger(rule.windowMs, "windowMs");
    assertPositiveInteger(rule.maxKeys, "rule maxKeys");
    if (names.has(rule.name)) {
      throw new TypeError(`Rate limit rule "${rule.name}" is defined more than once.`);
    }
    names.add(rule.name);
    totalCapacity += rule.maxKeys;
    if (totalCapacity > MAX_TOTAL_WINDOWS) {
      throw new TypeError(
        `Rate limit rule capacities must add up to at most ${MAX_TOTAL_WINDOWS} windows.`,
      );
    }
  }
}

export interface RateLimiterOptions {
  /**
   * The complete rule set of this limiter. Default: every rule of RATE_LIMITS, which is what
   * production code uses. Validated as a whole at creation; `consume` accepts no other rule.
   */
  rules?: readonly RateLimitRule[];
  store?: RateLimitStore;
  /** Clock in epoch milliseconds, injectable for tests. */
  now?: () => number;
  /** Receives the saturation warning. Default: the process-wide logger. */
  logger?: Pick<Logger, "warn">;
}

/**
 * Creates a limiter for a fixed rule set. Throws a TypeError when the set is not valid as a
 * whole (see `assertRateLimitRules`), so a rule that does not fit fails here, not at its first
 * use.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const ruleSet = options.rules ?? Object.values(RATE_LIMITS);
  assertRateLimitRules(ruleSet);
  /** The rule set by name, copied so that a later change to a caller's object has no effect. */
  const rules = new Map<string, RateLimitRule>();
  for (const { name, limit, windowMs, maxKeys } of ruleSet) {
    rules.set(name, { name, limit, windowMs, maxKeys });
  }

  const store = options.store ?? new MemoryRateLimitStore();
  const now = options.now ?? Date.now;
  const log = options.logger ?? defaultLogger;
  /** When the last saturation line was written, per rule name. Bounded by MAX_RULES. */
  const lastSaturationLogAt = new Map<string, number>();

  /** The registered rule that `rule` names. The outcome never depends on earlier calls. */
  function registered(rule: RateLimitRule): RateLimitRule {
    const known = typeof rule.name === "string" ? rules.get(rule.name) : undefined;
    if (known === undefined) {
      throw new TypeError(
        "Rate limit rule is not part of this limiter's rule set. Define it where the limiter is created.",
      );
    }
    if (
      known.limit !== rule.limit ||
      known.windowMs !== rule.windowMs ||
      known.maxKeys !== rule.maxKeys
    ) {
      throw new TypeError(
        `Rate limit rule "${known.name}" is already defined with different settings.`,
      );
    }
    return known;
  }

  function reportSaturation(rule: string, hit: RateLimitHit, at: number): void {
    const last = lastSaturationLogAt.get(rule);
    // `at < last` covers a clock that stepped backwards.
    if (last !== undefined && at >= last && at - last < SATURATION_LOG_INTERVAL_MS) return;
    lastSaturationLogAt.set(rule, at);
    // Rule name and sizes only: a key or a subject holds an email or an address (SR-04).
    log.warn("Rate limit store saturated", {
      rule,
      ruleSize: hit.ruleSize,
      storeSize: hit.storeSize,
    });
  }

  return {
    async consume(subject, candidate) {
      if (typeof subject !== "string" || subject.length === 0) {
        throw new TypeError("Rate limit subject must be a non-empty string.");
      }
      const rule = registered(candidate);

      const at = now();
      const hit = await store.increment({
        rule: rule.name,
        subject,
        windowMs: rule.windowMs,
        maxKeys: rule.maxKeys,
        now: at,
      });

      if (hit.saturated === true) {
        reportSaturation(rule.name, hit, at);
        // Whatever the store reports, a saturated refusal never asks for a long wait.
        const resetAt = Math.min(hit.resetAt, at + SATURATION_RETRY_MS);
        return {
          allowed: false,
          limit: rule.limit,
          remaining: 0,
          resetAt,
          retryAfterSeconds: retryAfter(resetAt, at),
          saturated: true,
        };
      }
      return {
        allowed: hit.count <= rule.limit,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - hit.count),
        resetAt: hit.resetAt,
        retryAfterSeconds: retryAfter(hit.resetAt, at),
        saturated: false,
      };
    },
  };
}

/**
 * Process-wide limiter backed by the in-process store, with the built-in rule set. Created when
 * this module is loaded, which is also when an over-budget RATE_LIMITS would throw.
 */
export const rateLimiter: RateLimiter = createRateLimiter();

function retryAfter(resetAt: number, now: number): number {
  const seconds = Math.ceil((resetAt - now) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, seconds) : 1;
}

/**
 * `<rule>:<subject>`. A rule name cannot contain a colon, so the first colon always separates
 * the two. A long subject, and any subject that itself looks like a digest, is replaced by its
 * SHA-256 digest so that the key has a bounded size and a short subject can never equal the
 * digest form of another one.
 */
function storedKey(rule: string, subject: string): string {
  if (subject.length <= MAX_KEY_LENGTH && !subject.startsWith(DIGEST_PREFIX)) {
    return `${rule}:${subject}`;
  }
  return `${rule}:${DIGEST_PREFIX}${createHash("sha256").update(subject).digest("hex")}`;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`Rate limit ${name} must be a positive integer.`);
  }
}
