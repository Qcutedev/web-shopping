/**
 * Validated configuration: the one place that reads the application's environment variables
 * (docs/DEPLOYMENT.md, "Environment variables", is the list; this file is its implementation).
 *
 * Server only. Nothing here may be imported by a client component, and no variable read here is
 * prefixed `NEXT_PUBLIC_`.
 *
 * When validation runs:
 *
 *   - Importing this module reads no variable and cannot throw, so `next build` and unit tests
 *     need no variable at all (the same property as src/server/db since D-033 point 1).
 *   - `getEnv()` validates `process.env` on its first call and keeps the result. A failed
 *     validation is not kept: the next call validates again and throws again.
 *   - `loadEnvAtStartup()` is what a server start-up hook calls (the framework's `register`
 *     function, see docs/DEPLOYMENT.md): it runs the validation before the first request is
 *     served, logs the outcome, and throws when the configuration is invalid.
 *
 * A failed validation throws `EnvValidationError`. Its message and its `issues` name every
 * variable at fault and the rule it broke. They never contain a value: a value may be a secret,
 * and a rejected value is as likely to be one as an accepted value. Every rule text is a
 * constant of this file (ENV_RULES); nothing a validator library writes about its input is
 * passed on.
 *
 * Variables this file does not know are ignored. An empty string counts as "not set".
 */
import { z } from "zod";

import { type ClientAddressConfig, MAX_TRUSTED_PROXY_HOPS } from "./client-address";
import { type Logger, type LogLevel, logger as defaultLogger } from "./logger";

export type NodeEnv = "development" | "test" | "production";

export interface Env {
  /** `NODE_ENV`. The framework sets it; `development` when it is not set at all. */
  nodeEnv: NodeEnv;
  /** `APP_URL` as configured. Use `appOrigin` for the `Origin` check. */
  appUrl: string;
  /** Scheme, host, and port of `APP_URL`: the `allowedOrigin` of `assertSameOrigin` (TM-16). */
  appOrigin: string;
  /** `DATABASE_URL`. A secret: never log it. */
  databaseUrl: string;
  /** `TRUSTED_PROXY_HOPS` and `TRUSTED_CLIENT_IP_HEADER`, as `getClientAddress` takes them (SR-01). */
  trustedProxy: ClientAddressConfig;
  /** `PAYMENT_TIMEOUT_MINUTES`: how long an order may await payment before it is failed (D-028). */
  paymentTimeoutMinutes: number;
  /** `LOG_LEVEL`. */
  logLevel: LogLevel;
}

/** The longest payment timeout accepted: one day. A bound against a typing error, not a product rule. */
export const MAX_PAYMENT_TIMEOUT_MINUTES = 1_440;
export const DEFAULT_PAYMENT_TIMEOUT_MINUTES = 15;

/**
 * How often the payment-timeout sweep runs: every minute. Decided by the owner (D-033 point 12)
 * and therefore a constant, not a setting: no document asks for it to be configurable, and an
 * unpaid order must be failed within about 16 minutes whatever an environment is given.
 */
export const PAYMENT_SWEEP_INTERVAL_MS = 60_000;

/** SEC-009: the throwaway passwords of `.env.example` and `docker-compose.yml`. Not secrets. */
const LOCAL_PLACEHOLDER_PASSWORDS = [
  "local_dev_only_not_a_secret",
  "local_test_only_not_a_secret",
] as const;

/** SR-01: the pattern of a header name, and the headers that may never be named. */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const FORBIDDEN_CLIENT_IP_HEADERS: ReadonlySet<string> = new Set([
  "x-forwarded-for",
  "forwarded",
  "cookie",
  "authorization",
  "host",
]);

/** Every rule text a validation failure can carry. None of them contains a value. */
export const ENV_RULES = {
  required: "is required",
  invalid: "is invalid",
  nodeEnv: "must be development, test, or production",
  appUrl: "must be an absolute http or https URL",
  databaseUrl: "must be a postgresql:// or postgres:// URL",
  databaseUrlPlaceholder:
    "must not contain a local placeholder password from .env.example when NODE_ENV=production",
  databaseUrlTestInProduction: "must not be set when NODE_ENV=production",
  trustedProxyHops: `must be an integer from 0 to ${MAX_TRUSTED_PROXY_HOPS}`,
  trustedProxyHopsExplicit: "must be set explicitly when NODE_ENV=production",
  trustedClientIpHeader: "must match ^[A-Za-z0-9-]{1,64}$",
  trustedClientIpHeaderForbidden:
    "cannot be X-Forwarded-For, Forwarded, Cookie, Authorization, or Host",
  trustedClientIpHeaderWithHops: "cannot be set when TRUSTED_PROXY_HOPS is greater than 0",
  paymentTimeoutMinutes: `must be an integer from 1 to ${MAX_PAYMENT_TIMEOUT_MINUTES}`,
  logLevel: "must be debug, info, warn, or error",
} as const;

const KNOWN_RULES: ReadonlySet<string> = new Set(Object.values(ENV_RULES));

export interface EnvIssue {
  /** Name of the environment variable. */
  variable: string;
  /** The rule it broke: one of ENV_RULES. */
  rule: string;
}

export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    super(
      [
        "Invalid environment configuration. The server cannot start.",
        ...issues.map((issue) => `- ${issue.variable} ${issue.rule}`),
      ].join("\n"),
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

function hasProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// One schema per variable. Each is given the raw value, or `undefined` when the variable is not
// set or is empty. Every check carries its own rule text.
const SCHEMAS = {
  NODE_ENV: z
    .enum(["development", "test", "production"], { error: ENV_RULES.nodeEnv })
    .default("development"),
  // The same test as `assertSameOrigin` in src/server/http.ts, so that function's TypeError for
  // a broken configuration is never reached in a running server (SECURITY.md, TM-16 review).
  APP_URL: z
    .string({ error: ENV_RULES.required })
    .refine((value) => hasProtocol(value, ["http:", "https:"]), { error: ENV_RULES.appUrl }),
  DATABASE_URL: z
    .string({ error: ENV_RULES.required })
    .refine((value) => hasProtocol(value, ["postgresql:", "postgres:"]), {
      error: ENV_RULES.databaseUrl,
    }),
  // A string of one digit, so that "1.0", " 1", "+1", "0x1", and "true" are all refused. SR-01
  // forbids a boolean "trust proxy" switch; no such variable exists and none is accepted here.
  TRUSTED_PROXY_HOPS: z
    .string()
    .regex(new RegExp(`^[0-${MAX_TRUSTED_PROXY_HOPS}]$`), { error: ENV_RULES.trustedProxyHops })
    .transform(Number)
    .optional(),
  TRUSTED_CLIENT_IP_HEADER: z
    .string()
    .regex(HEADER_NAME_PATTERN, { error: ENV_RULES.trustedClientIpHeader })
    .refine((value) => !FORBIDDEN_CLIENT_IP_HEADERS.has(value.toLowerCase()), {
      error: ENV_RULES.trustedClientIpHeaderForbidden,
    })
    .optional(),
  PAYMENT_TIMEOUT_MINUTES: z
    .string()
    .regex(/^[1-9][0-9]{0,3}$/, { error: ENV_RULES.paymentTimeoutMinutes })
    .transform(Number)
    .refine((value) => value <= MAX_PAYMENT_TIMEOUT_MINUTES, {
      error: ENV_RULES.paymentTimeoutMinutes,
    })
    .default(DEFAULT_PAYMENT_TIMEOUT_MINUTES),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"], { error: ENV_RULES.logLevel })
    .default("info"),
} as const;

type VariableName = keyof typeof SCHEMAS;

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** The raw value of a variable, with "not set" and "empty" both given as `undefined`. */
function raw(source: EnvSource, name: string): string | undefined {
  const value = source[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Validates one variable. On failure the issue is recorded and `undefined` is returned. Only a
 * rule text of this file is recorded; the validator's own message is never passed on, because
 * it is the one string here that this file did not write.
 */
function read<Name extends VariableName>(
  source: EnvSource,
  name: Name,
  issues: EnvIssue[],
): z.output<(typeof SCHEMAS)[Name]> | undefined {
  const result = SCHEMAS[name].safeParse(raw(source, name));
  if (result.success) return result.data as z.output<(typeof SCHEMAS)[Name]>;
  const message = result.error.issues[0]?.message;
  issues.push({
    variable: name,
    rule: message !== undefined && KNOWN_RULES.has(message) ? message : ENV_RULES.invalid,
  });
  return undefined;
}

/** SEC-009, first half: the published local passwords are refused when `NODE_ENV=production`. */
function checkDatabaseUrlForProduction(databaseUrl: string | undefined, issues: EnvIssue[]): void {
  if (databaseUrl === undefined) return;
  if (LOCAL_PLACEHOLDER_PASSWORDS.some((placeholder) => databaseUrl.includes(placeholder))) {
    issues.push({ variable: "DATABASE_URL", rule: ENV_RULES.databaseUrlPlaceholder });
  }
}

/**
 * Validates `source` and returns the configuration, or throws `EnvValidationError` naming every
 * variable at fault. Pure: reads nothing but its argument and logs nothing.
 */
export function parseEnv(source: EnvSource): Env {
  const issues: EnvIssue[] = [];

  const nodeEnv = read(source, "NODE_ENV", issues);
  const appUrl = read(source, "APP_URL", issues);
  const databaseUrl = read(source, "DATABASE_URL", issues);
  const trustedProxyHops = read(source, "TRUSTED_PROXY_HOPS", issues);
  const trustedClientIpHeader = read(source, "TRUSTED_CLIENT_IP_HEADER", issues);
  const paymentTimeoutMinutes = read(source, "PAYMENT_TIMEOUT_MINUTES", issues);
  const logLevel = read(source, "LOG_LEVEL", issues);

  // SR-01: the two ways of trusting a proxy cannot be combined.
  if (
    trustedProxyHops !== undefined &&
    trustedProxyHops > 0 &&
    raw(source, "TRUSTED_CLIENT_IP_HEADER") !== undefined
  ) {
    issues.push({
      variable: "TRUSTED_CLIENT_IP_HEADER",
      rule: ENV_RULES.trustedClientIpHeaderWithHops,
    });
  }

  if (nodeEnv === "production") {
    // SEC-009: nothing of the local set-up may reach a deployed environment.
    checkDatabaseUrlForProduction(databaseUrl, issues);
    if (raw(source, "DATABASE_URL_TEST") !== undefined) {
      issues.push({ variable: "DATABASE_URL_TEST", rule: ENV_RULES.databaseUrlTestInProduction });
    }
    // SR-01: no silent default in production. `0` is a valid answer, but it must be given.
    if (raw(source, "TRUSTED_PROXY_HOPS") === undefined) {
      issues.push({ variable: "TRUSTED_PROXY_HOPS", rule: ENV_RULES.trustedProxyHopsExplicit });
    }
  }

  if (
    issues.length > 0 ||
    nodeEnv === undefined ||
    appUrl === undefined ||
    databaseUrl === undefined ||
    paymentTimeoutMinutes === undefined ||
    logLevel === undefined
  ) {
    throw new EnvValidationError(issues);
  }

  return Object.freeze({
    nodeEnv,
    appUrl,
    appOrigin: new URL(appUrl).origin,
    databaseUrl,
    trustedProxy: Object.freeze({
      trustedProxyHops: trustedProxyHops ?? 0,
      ...(trustedClientIpHeader === undefined ? {} : { trustedClientIpHeader }),
    }),
    paymentTimeoutMinutes,
    logLevel,
  });
}

/**
 * Validates `DATABASE_URL` alone, with the SEC-009 refusal, and returns it. For the database
 * layer and for scripts that need the database and nothing else: creating the client must not
 * depend on `APP_URL` or the proxy variables being set. Not kept between calls, because the
 * integration harness points the variable at a different database per worker.
 */
export function readDatabaseUrl(source: EnvSource = process.env): string {
  const issues: EnvIssue[] = [];
  const nodeEnv = read(source, "NODE_ENV", issues);
  const databaseUrl = read(source, "DATABASE_URL", issues);
  if (nodeEnv === "production") checkDatabaseUrlForProduction(databaseUrl, issues);
  if (issues.length > 0 || databaseUrl === undefined) throw new EnvValidationError(issues);
  return databaseUrl;
}

let cached: Env | undefined;

/**
 * The validated configuration of this process. Validates `process.env` on the first call;
 * throws `EnvValidationError` when it is invalid. Never call it at module scope: that would
 * make an import fail during `next build` and in unit tests.
 */
export function getEnv(): Env {
  if (typeof window !== "undefined") {
    throw new Error("src/server/env.ts was loaded in a browser. It is server-only.");
  }
  return (cached ??= parseEnv(process.env));
}

/** True when no proxy is trusted, so the client address is always "unknown" (SR-01). */
function trustsNoProxy(config: ClientAddressConfig): boolean {
  return config.trustedProxyHops === 0 && config.trustedClientIpHeader === undefined;
}

/**
 * Start-up validation: call once, before the server takes its first request. Returns the
 * configuration, or logs one error line that names the variables and rules (never a value) and
 * throws, so that a misconfigured server stops at start instead of failing at a later request.
 *
 * In production it also writes the one warning SR-01 requires when no proxy is trusted.
 */
export function loadEnvAtStartup(options: { logger?: Logger } = {}): Env {
  const log = options.logger ?? defaultLogger;
  let env: Env;
  try {
    env = getEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      log.error("Environment validation failed. The server cannot start.", {
        component: "env",
        issues: error.issues.map((issue) => ({ variable: issue.variable, rule: issue.rule })),
      });
    }
    throw error;
  }
  if (env.nodeEnv === "production" && trustsNoProxy(env.trustedProxy)) {
    log.warn(
      "No trusted proxy is configured: the client address is unknown, so every per-address rate limit is shared by all clients.",
      { component: "env" },
    );
  }
  return env;
}
