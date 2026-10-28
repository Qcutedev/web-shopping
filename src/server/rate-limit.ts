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
 * subject is consumed only after the per-address check has allowed the request, and so is the
 * per-user subject of a signed-in rule (`signed-in-address` first, SEC-052). This module
 * knows nothing about requests, users, or addresses, and it never logs a key or a subject.
 *
 * Two per-user rules, `seller-application` and `review-create`, are not in this table: they are
 * counted in the database (SEC-052 option (b)) by a `UserRateLimitStore` that
 * src/modules/rate-limit provides, because this file may not import src/server/db (CLAUDE.md
 * rule 7). This file defines their rules (USER_RATE_LIMITS) and the limiter over such a store
 * (`createUserRateLimiter`).
 *
 * The default store is in-process, so limits hold for a single long-running instance only. A
 * shared store (for example Redis) can be plugged in by implementing RateLimitStore; the
 * interface is asynchronous for that reason. Within one process, the counters of the exported
 * `rateLimiter` are kept on `globalThis` and shared by every copy of this module the process
 * holds (SEC-030; see PROCESS_STATE_KEY).
 *
 * Memory bound of the in-process store (SEC-004):
 *   - every rule has its own key capacity (`rule.maxKeys`), so filling one rule cannot refuse a
 *     subject of another rule;
 *   - the capacities of all rules of one limiter may add up to at most MAX_TOTAL_WINDOWS
 *     (180 000); the built-in RATE_LIMITS add up to exactly that; a set that exceeds the total
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
 * line per rule per minute at most, holding the rule name and window counts only. That line is
 * written whatever LOG_LEVEL is (logger `security`, SR-04; SEC-031).
 */
import { createHash } from "node:crypto";

import { logger as defaultLogger, type Logger, type StructuredLogger } from "./logger";

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

/**
 * Upper bound on the windows held for all rules together (SR-02). 200,000 until SEC-052 option
 * (b) (2026-10-29) moved `seller-application` and `review-create` (10,000 windows each) to the
 * database (USER_RATE_LIMITS below); the budget dropped by their 20,000 and no other rule's
 * capacity changed.
 */
export const MAX_TOTAL_WINDOWS = 180_000;
/** Upper bound on the number of rules in one limiter's rule set. */
export const MAX_RULES = 64;
/** Longest retry time reported for a refusal caused by a full store (SR-02). */
export const SATURATION_RETRY_MS = 60_000;
/** Shortest time between two saturation log lines for one rule (SR-02). */
export const SATURATION_LOG_INTERVAL_MS = 60_000;
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
/** The message of the saturation line of SR-02 item 4. */
const SATURATION_MESSAGE = "Rate limit store saturated";
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
  /**
   * Subject `<client address>|<normalised email>` (SEC-032, D-036 item 5): an address's failures
   * use only its own allowance for that account. Built by `signInEmailSubject`.
   */
  SIGN_IN_EMAIL: { name: "sign-in-email", limit: 5, windowMs: 60_000, maxKeys: 30_000 },
  /**
   * Subject the normalised email, over all addresses (SEC-032). Consumed only after
   * `sign-in-address` and `sign-in-email` allowed the request. One address reaches it at most 5
   * times per 60 s, so it can add at most 29 hits to one 300 s window and never exhaust it.
   *
   * Capacity (SEC-050, D-038 option (a)): 50,000 windows, 40,000 of them taken from the four
   * signed-in rules below. A full rule refuses new emails, so keeping it full takes
   * 50,000 / 300 s, about 167 new emails a second (it was 10,000 / 300 s, about 33), each from an
   * address that passed `sign-in-address`.
   */
  SIGN_IN_ACCOUNT: { name: "sign-in-account", limit: 60, windowMs: 300_000, maxKeys: 50_000 },
  SIGN_UP: { name: "sign-up", limit: 5, windowMs: 3_600_000, maxKeys: 40_000 },
  /**
   * Subject the client address (SR-01), over the four signed-in endpoints together (SEC-052,
   * owner ruling option (a)). Every handler of `checkout`, `uploads`, `seller-application`, and
   * `review-create` consumes it at step 5, after the access level and before its per-user rule,
   * and consumes the per-user rule only when this one allowed the request. Without it one client
   * could renew the windows of 10,000 cheap accounts and keep a per-user rule full; now one
   * address adds at most 60 per-user windows a minute, so keeping `checkout` full (10,000 windows
   * of 60 s) takes about 167 distinct networks at the full rate.
   *
   * Capacity 5,000, taken from `uploads` (10,000 to 5,000). Keeping this rule full takes 5,000
   * new addresses a minute (about 83 a second), each with a signed-in request; a full rule
   * refuses new addresses at all four endpoints.
   */
  SIGNED_IN_ADDRESS: { name: "signed-in-address", limit: 60, windowMs: 60_000, maxKeys: 5_000 },
  /*
   * The per-user signed-in rules of this table hold 10,000 windows (`checkout`, 20,000 before
   * SEC-050) and 5,000 (`uploads`, since SEC-052: its subjects are approved sellers, which an admin
   * approves one by one). Their subject is the user id, so only that many distinct accounts active
   * inside one window can fill one of them; accounts are limited by `sign-up`, and since SEC-052
   * the requests of one client address by `signed-in-address`. Each user's own limit is unchanged.
   * `seller-application` and `review-create` are not in this table since SEC-052 option (b): see
   * USER_RATE_LIMITS.
   */
  CHECKOUT: { name: "checkout", limit: 10, windowMs: 60_000, maxKeys: 10_000 },
  UPLOADS: { name: "uploads", limit: 30, windowMs: 3_600_000, maxKeys: 5_000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * A per-user rule whose windows are kept outside this process (SEC-052 option (b), owner ruling
 * 2026-10-29): one database row per user and rule, so the rule has no shared capacity that other
 * accounts can fill. No `maxKeys`: the number of windows is bounded by the number of accounts,
 * which `sign-up` bounds.
 */
export interface UserRateLimitRule {
  /** Stable name, matching `^[a-z][a-z0-9-]{0,31}$`, and not the name of a RATE_LIMITS rule. */
  name: string;
  /** Maximum number of allowed hits per window. Positive integer. */
  limit: number;
  /** Window length in milliseconds. Positive integer, at most MAX_USER_RATE_LIMIT_WINDOW_MS. */
  windowMs: number;
}

/** Longest window of a per-user rule: one week, a bound against a typing error. */
export const MAX_USER_RATE_LIMIT_WINDOW_MS = 7 * 86_400_000;

/**
 * The per-user rules counted in the database (docs/DATA_MODEL.md section 6.18; the table's
 * `UserRateLimitWindow_rule_check` accepts exactly these names). Their windows (24 h and 1 h) are
 * the ones the one-minute `signed-in-address` rule does not bound (SEC-052). Consumed through
 * `consumeUserRateLimit` of src/modules/rate-limit, which holds the database store, after
 * `signed-in-address` allowed the request. The limits and windows are those of SR-02.
 */
export const USER_RATE_LIMITS = {
  SELLER_APPLICATION: { name: "seller-application", limit: 3, windowMs: 86_400_000 },
  REVIEW_CREATE: { name: "review-create", limit: 10, windowMs: 3_600_000 },
} as const satisfies Record<string, UserRateLimitRule>;

/** What a per-user store is asked to count: one request of `userId` under `rule`. */
export interface UserRateLimitCount {
  /** Validated rule name. */
  rule: string;
  /** Non-empty user id. */
  userId: string;
  limit: number;
  windowMs: number;
}

/** The window after one counted request, in the store's clock. */
export interface UserRateLimitWindowState {
  /** Requests counted in the current window, this one included; at most `limit + 1`. */
  count: number;
  /** End of the window, epoch milliseconds. */
  resetAt: number;
  /** The store's current time, epoch milliseconds; `Retry-After` is computed against it. */
  now: number;
}

/**
 * Storage behind a per-user limiter. `count` must be one atomic operation per user and rule, and
 * must not run inside a transaction of the request, so that the count survives whatever happens
 * to the request afterwards (API_CONTRACTS section 6).
 */
export interface UserRateLimitStore {
  count(input: UserRateLimitCount): Promise<UserRateLimitWindowState>;
}

export interface UserRateLimiter {
  /**
   * Records one request of `userId` under `rule`. Rejects with a TypeError when `rule` is not one
   * of the limiter's rules (same name and settings) or `userId` is empty, and with the store's
   * error, or a TypeError for an impossible answer, when the store fails: the caller then fails
   * closed. `saturated` is always false: these rules have no shared capacity.
   */
  consume(userId: string, rule: UserRateLimitRule): Promise<RateLimitResult>;
}

/**
 * Validates a complete per-user rule set: well-formed rules, no name used twice, no name that is
 * also a rule of RATE_LIMITS (one name, one counter). Throws a TypeError otherwise.
 */
export function assertUserRateLimitRules(rules: readonly UserRateLimitRule[]): void {
  if (rules.length > MAX_RULES) {
    throw new TypeError(`A rate limiter accepts at most ${MAX_RULES} rules.`);
  }
  const inProcess = new Set<string>(Object.values(RATE_LIMITS).map((rule) => rule.name));
  const names = new Set<string>();
  for (const rule of rules) {
    if (typeof rule.name !== "string" || !RULE_NAME_PATTERN.test(rule.name)) {
      throw new TypeError("Rate limit rule name must match ^[a-z][a-z0-9-]{0,31}$.");
    }
    assertPositiveInteger(rule.limit, "limit");
    assertPositiveInteger(rule.windowMs, "windowMs");
    if (rule.windowMs > MAX_USER_RATE_LIMIT_WINDOW_MS) {
      throw new TypeError(
        `Rate limit windowMs of a per-user rule must be at most ${MAX_USER_RATE_LIMIT_WINDOW_MS}.`,
      );
    }
    if (names.has(rule.name) || inProcess.has(rule.name)) {
      throw new TypeError(`Rate limit rule "${rule.name}" is defined more than once.`);
    }
    names.add(rule.name);
  }
}

/**
 * Creates a per-user limiter over `store` for a fixed rule set (default: USER_RATE_LIMITS).
 * Throws a TypeError when the set is not valid as a whole. The answer is computed from the
 * store's own count, end of window, and clock, so every process agrees on when a window ends.
 */
export function createUserRateLimiter(
  store: UserRateLimitStore,
  ruleSet: readonly UserRateLimitRule[] = Object.values(USER_RATE_LIMITS),
): UserRateLimiter {
  assertUserRateLimitRules(ruleSet);
  const rules = new Map<string, UserRateLimitRule>();
  for (const { name, limit, windowMs } of ruleSet) rules.set(name, { name, limit, windowMs });

  return {
    async consume(userId, candidate) {
      if (typeof userId !== "string" || userId.length === 0) {
        throw new TypeError("Rate limit subject must be a non-empty string.");
      }
      const known = typeof candidate.name === "string" ? rules.get(candidate.name) : undefined;
      if (known === undefined) {
        throw new TypeError(
          "Rate limit rule is not part of this limiter's rule set. Define it where the limiter is created.",
        );
      }
      if (known.limit !== candidate.limit || known.windowMs !== candidate.windowMs) {
        throw new TypeError(
          `Rate limit rule "${known.name}" is already defined with different settings.`,
        );
      }
      const hit = await store.count({
        rule: known.name,
        userId,
        limit: known.limit,
        windowMs: known.windowMs,
      });
      // An answer the store cannot give is a fault, never an allowance (fail closed).
      if (
        !Number.isInteger(hit.count) ||
        hit.count < 1 ||
        hit.count > known.limit + 1 ||
        !Number.isFinite(hit.resetAt) ||
        !Number.isFinite(hit.now)
      ) {
        throw new TypeError(`Rate limit store gave an impossible answer for "${known.name}".`);
      }
      return {
        allowed: hit.count <= known.limit,
        limit: known.limit,
        remaining: Math.max(0, known.limit - hit.count),
        resetAt: hit.resetAt,
        retryAfterSeconds: retryAfter(hit.resetAt, hit.now),
        saturated: false,
      };
    },
  };
}

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

/**
 * Everything an in-process store counts with. Data only (built-in maps of plain objects and a
 * number), so that it can be shared between copies of this module through `globalThis` (SEC-030):
 * no function, class instance, or error of one copy is ever used by another.
 */
interface WindowTable {
  readonly windows: Map<string, Window>;
  /** Windows held per rule name. */
  readonly ruleSizes: Map<string, number>;
  /** When expired windows were last removed. There is no timer: a hit runs the sweep when due. */
  lastSweepAt: number;
}

function createWindowTable(): WindowTable {
  return { windows: new Map(), ruleSizes: new Map(), lastSweepAt: Number.NEGATIVE_INFINITY };
}

function ruleSizeIn(table: WindowTable, rule: string): number {
  return table.ruleSizes.get(rule) ?? 0;
}

function sweepTable(table: WindowTable, now: number): void {
  table.lastSweepAt = now;
  for (const [key, window] of table.windows) {
    if (now < window.resetAt) continue;
    table.windows.delete(key);
    const remaining = ruleSizeIn(table, window.rule) - 1;
    if (remaining > 0) table.ruleSizes.set(window.rule, remaining);
    else table.ruleSizes.delete(window.rule);
  }
}

/**
 * One hit against `table`, which holds at most `totalKeys` windows and is swept at most once per
 * `sweepIntervalMs` (once per FULL_STORE_SWEEP_INTERVAL_MS while a rule is full). Synchronous, so
 * it is atomic per rule and subject in one process.
 */
function incrementIn(
  table: WindowTable,
  totalKeys: number,
  sweepIntervalMs: number,
  { rule, subject, windowMs, maxKeys, now }: RateLimitIncrement,
): RateLimitHit {
  const key = storedKey(rule, subject);
  if (now - table.lastSweepAt >= sweepIntervalMs) sweepTable(table, now);

  const existing = table.windows.get(key);
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

  const isFull = (): boolean =>
    ruleSizeIn(table, rule) >= maxKeys || table.windows.size >= totalKeys;
  if (isFull()) {
    if (now - table.lastSweepAt >= FULL_STORE_SWEEP_INTERVAL_MS) sweepTable(table, now);
    if (isFull()) {
      return {
        count: 0,
        resetAt: now + Math.min(windowMs, SATURATION_RETRY_MS),
        saturated: true,
        ruleSize: ruleSizeIn(table, rule),
        storeSize: table.windows.size,
      };
    }
  }

  const fresh: Window = { rule, count: 1, resetAt: now + windowMs };
  table.windows.set(key, fresh);
  table.ruleSizes.set(rule, ruleSizeIn(table, rule) + 1);
  return { count: fresh.count, resetAt: fresh.resetAt };
}

/**
 * An in-process store with its own windows. The process-wide `rateLimiter` does not use an
 * instance of this class; it counts in the one table of the process (see PROCESS_STATE_KEY).
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly table: WindowTable = createWindowTable();
  private readonly maxKeys: number;
  private readonly sweepIntervalMs: number;

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
    return this.table.windows.size;
  }

  /** Number of windows currently held for one rule, including expired ones not yet swept. */
  sizeOf(rule: string): number {
    return ruleSizeIn(this.table, rule);
  }

  increment(hit: RateLimitIncrement): Promise<RateLimitHit> {
    return Promise.resolve(incrementIn(this.table, this.maxKeys, this.sweepIntervalMs, hit));
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
  /**
   * Receives the saturation warning. Default: the process-wide logger. A logger of this module
   * (`createLogger`, `logger`, and their children) writes it through `security`, which no
   * configured level filters (SEC-031); a logger with `warn` only, such as a test stub, gets
   * `warn`.
   */
  logger?: Pick<Logger, "warn"> | Pick<StructuredLogger, "security">;
}

/**
 * Creates a limiter for a fixed rule set. Throws a TypeError when the set is not valid as a
 * whole (see `assertRateLimitRules`), so a rule that does not fit fails here, not at its first
 * use.
 *
 * Without `store`, the limiter gets a store of its own, and its saturation-log times are its
 * own too. Only the exported `rateLimiter` counts in the table shared by the whole process.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const lastSaturationLogAt = new Map<string, number>();
  return buildRateLimiter(options, options.store ?? new MemoryRateLimitStore(), () => {
    return lastSaturationLogAt;
  });
}

function buildRateLimiter(
  options: RateLimiterOptions,
  store: RateLimitStore,
  /** When the last saturation line was written, per rule name. Bounded by the rule count. */
  saturationLog: () => Map<string, number>,
): RateLimiter {
  const ruleSet = options.rules ?? Object.values(RATE_LIMITS);
  assertRateLimitRules(ruleSet);
  /** The rule set by name, copied so that a later change to a caller's object has no effect. */
  const rules = new Map<string, RateLimitRule>();
  for (const { name, limit, windowMs, maxKeys } of ruleSet) {
    rules.set(name, { name, limit, windowMs, maxKeys });
  }

  const now = options.now ?? Date.now;
  const log = options.logger ?? defaultLogger;

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
    const lastSaturationLogAt = saturationLog();
    const last = lastSaturationLogAt.get(rule);
    // `at < last` covers a clock that stepped backwards.
    if (last !== undefined && at >= last && at - last < SATURATION_LOG_INTERVAL_MS) return;
    lastSaturationLogAt.set(rule, at);
    // Rule name and sizes only: a key or a subject holds an email or an address (SR-04).
    const fields = { rule, ruleSize: hit.ruleSize, storeSize: hit.storeSize };
    // SR-02 item 4 requires this line, so it is written whatever LOG_LEVEL is (SR-04, SEC-031).
    if ("security" in log && typeof log.security === "function") {
      log.security("warn", SATURATION_MESSAGE, fields);
    } else if ("warn" in log) {
      log.warn(SATURATION_MESSAGE, fields);
    }
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
 * Where the process-wide limiter keeps its counters: one property of `globalThis`, under a key
 * from the global symbol registry (SEC-030).
 *
 * Not module state, because one process can hold more than one copy of this module. Measured
 * with Next.js 16.4.0: the start-up hook and the route handlers are compiled separately and each
 * gets its own copy of a module under src/server. With the store in a module variable, every
 * copy counted for itself, so a limit was multiplied by the number of copies that consumed it
 * and the bound of SR-02 held per copy. `globalThis` and the symbol registry are what all copies
 * share, as src/server/db/client.ts and the logger's level rely on.
 *
 * The property holds data only (ProcessLimiterState): the windows, the per-rule sizes, the time
 * of the last sweep, and the time of the last saturation line per rule. Each copy runs its own
 * functions over that one table, so no function, class instance, or error crosses from one copy
 * to another (an AppError of one copy is a generic 500 for another). There is no sweep timer:
 * the sweep runs inside a hit when it is due, and since its time is in the shared table, it runs
 * on one schedule for the whole process.
 *
 * Importing this file does not touch the property; the table is created on the first hit. A
 * property that holds anything else is replaced by an empty table.
 */
const PROCESS_STATE_KEY = Symbol.for("marketplace.rateLimit.processState");
const PROCESS_STATE_VERSION = 1;

interface ProcessLimiterState extends WindowTable {
  readonly version: typeof PROCESS_STATE_VERSION;
  /** When the last saturation line was written, per rule name (SR-02 item 4). */
  readonly lastSaturationLogAt: Map<string, number>;
}

type GlobalWithLimiterState = typeof globalThis & { [PROCESS_STATE_KEY]?: unknown };

function isProcessLimiterState(value: unknown): value is ProcessLimiterState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<Record<keyof ProcessLimiterState, unknown>>;
  return (
    state.version === PROCESS_STATE_VERSION &&
    state.windows instanceof Map &&
    state.ruleSizes instanceof Map &&
    state.lastSaturationLogAt instanceof Map &&
    typeof state.lastSweepAt === "number"
  );
}

/** The table of the process, created on first use. */
function processState(): ProcessLimiterState {
  // No alias of `globalThis`: the lint guard refuses one (SEC-081).
  const existing = (globalThis as GlobalWithLimiterState)[PROCESS_STATE_KEY];
  if (isProcessLimiterState(existing)) return existing;
  const created: ProcessLimiterState = {
    version: PROCESS_STATE_VERSION,
    ...createWindowTable(),
    lastSaturationLogAt: new Map(),
  };
  (globalThis as GlobalWithLimiterState)[PROCESS_STATE_KEY] = created;
  return created;
}

/** The store of the process-wide limiter: this copy's functions over the process's table. */
const processStore: RateLimitStore = {
  increment(hit) {
    // Inside the promise, so that a failure to reach the table rejects (the caller fails closed).
    return new Promise((resolve) => {
      resolve(incrementIn(processState(), MAX_TOTAL_WINDOWS, DEFAULT_SWEEP_INTERVAL_MS, hit));
    });
  },
};

/**
 * Process-wide limiter with the built-in rule set. Every copy of this module in the process
 * counts in the same table (see PROCESS_STATE_KEY), so a limit used up through one copy is used
 * up for all. Created when this module is loaded, which is also when an over-budget RATE_LIMITS
 * would throw.
 */
export const rateLimiter: RateLimiter = buildRateLimiter(
  {},
  processStore,
  () => processState().lastSaturationLogAt,
);

/** The largest `sign-up` limit `signUpRateLimiter` accepts. A bound against a typing error. */
export const MAX_SIGN_UP_LIMIT_OVERRIDE = 1_000;

// Intentionally a module-level value and not part of `processState()` (CR-S116-05): it holds a rule
// set and a limiter object, not counts, and the table shared across copies is data only. A copy
// that rebuilds it (for example under HMR) counts in the same table, so nothing is lost.
let signUpOverride: { limit: number; limiter: RateLimiter } | undefined;

/**
 * The process-wide limiter with the `sign-up` limit set to `limit` (T-060: the e2e suite signs up
 * more than 5 times an hour from one address). The default limit returns `rateLimiter` itself.
 * Any other value is refused with a TypeError when `NODE_ENV=production`, whatever the caller
 * checked before, and when it is not an integer from 1 to MAX_SIGN_UP_LIMIT_OVERRIDE. The table
 * is the one of `rateLimiter`, so the other rules are shared. Returns the rule too, because a
 * limiter accepts only a rule that equals its own.
 */
export function signUpRateLimiter(
  limit: number,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): { limiter: RateLimiter; rule: RateLimitRule } {
  if (limit === RATE_LIMITS.SIGN_UP.limit)
    return { limiter: rateLimiter, rule: RATE_LIMITS.SIGN_UP };
  if (nodeEnv === "production") {
    throw new TypeError("The sign-up rate limit cannot be changed when NODE_ENV=production.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SIGN_UP_LIMIT_OVERRIDE) {
    throw new TypeError(
      `The sign-up rate limit must be an integer from 1 to ${MAX_SIGN_UP_LIMIT_OVERRIDE}.`,
    );
  }
  const rule: RateLimitRule = { ...RATE_LIMITS.SIGN_UP, limit };
  if (signUpOverride?.limit !== limit) {
    const rules = Object.values(RATE_LIMITS).map((each) => (each.name === rule.name ? rule : each));
    signUpOverride = {
      limit,
      limiter: buildRateLimiter({ rules }, processStore, () => processState().lastSaturationLogAt),
    };
  }
  return { limiter: signUpOverride.limiter, rule };
}

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
