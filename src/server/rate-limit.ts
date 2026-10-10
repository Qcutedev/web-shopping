/**
 * Fixed-window rate limiter (D-012).
 *
 * The caller supplies the key and the rule; this module knows nothing about
 * requests, users, or IP addresses. In particular it does not derive a client
 * IP: which proxy headers may be trusted is an open security decision.
 *
 * The default store is in-process, so limits hold for a single long-running
 * instance only. A shared store (for example Redis) can be plugged in by
 * implementing RateLimitStore; the interface is asynchronous for that reason.
 *
 * Memory bound of the in-process store: at most `maxKeys` live windows
 * (default 100 000), each holding a counter, a reset time, and a key of at most
 * 128 characters (longer keys are stored as a SHA-256 digest). Expired windows
 * are removed by a sweep that runs at most once per `sweepIntervalMs`
 * (default 60 s), or once per second while the store is full. When the store is
 * still full after a sweep, a key that has no window yet is refused
 * (fail closed) instead of evicting a live counter, so flooding the store with
 * new keys cannot reset anyone's limit.
 */
import { createHash } from "node:crypto";

export interface RateLimitRule {
  /** Maximum number of allowed hits per window. Positive integer. */
  limit: number;
  /** Window length in milliseconds. Positive integer. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  /** Hits left in the current window after this one. */
  remaining: number;
  /** When the current window ends, in epoch milliseconds. */
  resetAt: number;
  /** Whole seconds until `resetAt`, at least 1. Use for `Retry-After` when blocked. */
  retryAfterSeconds: number;
}

export interface RateLimitHit {
  /** Hits recorded in the current window, including this one. */
  count: number;
  resetAt: number;
  /** True when the store could not track the key and the hit must be refused. */
  saturated?: boolean;
}

/** Storage behind the limiter. `increment` must be atomic per key. */
export interface RateLimitStore {
  increment(key: string, windowMs: number, now: number): Promise<RateLimitHit>;
}

export interface RateLimiter {
  /** Records one hit for `key` and reports whether it is within `rule`. */
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

/** Initial limits from docs/API_CONTRACTS.md, "Rate limits". */
export const RATE_LIMITS = {
  SIGN_IN: { limit: 5, windowMs: 60_000 },
  SIGN_UP: { limit: 5, windowMs: 3_600_000 },
  CHECKOUT: { limit: 10, windowMs: 60_000 },
  UPLOADS: { limit: 30, windowMs: 3_600_000 },
  SELLER_APPLICATION: { limit: 3, windowMs: 86_400_000 },
  REVIEW_CREATE: { limit: 10, windowMs: 3_600_000 },
} as const satisfies Record<string, RateLimitRule>;

export const DEFAULT_MAX_KEYS = 100_000;
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const FULL_STORE_SWEEP_INTERVAL_MS = 1_000;
const MAX_KEY_LENGTH = 128;

export interface MemoryRateLimitStoreOptions {
  maxKeys?: number;
  sweepIntervalMs?: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();
  private readonly maxKeys: number;
  private readonly sweepIntervalMs: number;
  private lastSweepAt = Number.NEGATIVE_INFINITY;

  constructor(options: MemoryRateLimitStoreOptions = {}) {
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    assertPositiveInteger(this.maxKeys, "maxKeys");
    assertPositiveInteger(this.sweepIntervalMs, "sweepIntervalMs");
  }

  /** Number of windows currently held, including expired ones not yet swept. */
  get size(): number {
    return this.windows.size;
  }

  increment(key: string, windowMs: number, now: number): Promise<RateLimitHit> {
    return Promise.resolve(this.incrementSync(key, windowMs, now));
  }

  private incrementSync(rawKey: string, windowMs: number, now: number): RateLimitHit {
    const key = boundedKey(rawKey);
    if (now - this.lastSweepAt >= this.sweepIntervalMs) this.sweep(now);

    const existing = this.windows.get(key);
    if (existing && now < existing.resetAt) {
      existing.count += 1;
      return { count: existing.count, resetAt: existing.resetAt };
    }

    if (!existing && this.windows.size >= this.maxKeys) {
      if (now - this.lastSweepAt >= FULL_STORE_SWEEP_INTERVAL_MS) this.sweep(now);
      if (this.windows.size >= this.maxKeys) {
        return { count: 0, resetAt: now + windowMs, saturated: true };
      }
    }

    const fresh: Window = { count: 1, resetAt: now + windowMs };
    this.windows.set(key, fresh);
    return { count: fresh.count, resetAt: fresh.resetAt };
  }

  private sweep(now: number): void {
    this.lastSweepAt = now;
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
  }
}

export interface RateLimiterOptions {
  store?: RateLimitStore;
  /** Clock in epoch milliseconds, injectable for tests. */
  now?: () => number;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const store = options.store ?? new MemoryRateLimitStore();
  const now = options.now ?? Date.now;

  return {
    async consume(key, rule) {
      if (typeof key !== "string" || key.length === 0) {
        throw new TypeError("Rate limit key must be a non-empty string.");
      }
      assertPositiveInteger(rule.limit, "limit");
      assertPositiveInteger(rule.windowMs, "windowMs");

      const at = now();
      const hit = await store.increment(key, rule.windowMs, at);
      const allowed = hit.saturated !== true && hit.count <= rule.limit;
      return {
        allowed,
        limit: rule.limit,
        remaining: hit.saturated === true ? 0 : Math.max(0, rule.limit - hit.count),
        resetAt: hit.resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((hit.resetAt - at) / 1000)),
      };
    },
  };
}

/** Process-wide limiter backed by the in-process store. */
export const rateLimiter: RateLimiter = createRateLimiter();

function boundedKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  return `sha256:${createHash("sha256").update(key).digest("hex")}`;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`Rate limit ${name} must be a positive integer.`);
  }
}
