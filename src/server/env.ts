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
 * Variables this file does not know are ignored, except the auth library's own variables
 * (AUTH_LIBRARY_VARIABLES, SEC-045), which are refused when set, and the Vercel Blob library's
 * request overrides (BLOB_LIBRARY_VARIABLES, D-051), which are refused when NODE_ENV=production.
 * An empty string counts as "not set".
 */
import { isAbsolute } from "node:path";

import { z } from "zod";

import { type ClientAddressConfig, MAX_TRUSTED_PROXY_HOPS } from "./client-address";
import {
  type LogLevel,
  logger as defaultLogger,
  setLogLevel,
  type StructuredLogger,
} from "./logger";

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
  /** `AUTH_SECRET`: signs the session cookie. A secret: never log it. */
  authSecret: string;
  /** `TRUSTED_PROXY_HOPS` and `TRUSTED_CLIENT_IP_HEADER`, as `getClientAddress` takes them (SR-01). */
  trustedProxy: ClientAddressConfig;
  /** `PAYMENT_TIMEOUT_MINUTES`: how long an order may await payment before it is failed (D-028). */
  paymentTimeoutMinutes: number;
  /** `SIGN_UP_RATE_LIMIT`: 5 unless set; only the e2e server sets it, never production. */
  signUpRateLimit: number;
  /** `LOG_LEVEL`. */
  logLevel: LogLevel;
  /**
   * `UPLOAD_DIR`: absolute directory of the local disk upload adapter (T-041). When `nodeEnv` is
   * `production`, exactly one of it and `blobReadWriteToken` is present (D-051); in development
   * and test both may be absent, and the upload and file endpoints then answer 500 until one is
   * set.
   */
  uploadDir?: string;
  /**
   * `BLOB_READ_WRITE_TOKEN`: the Vercel Blob read-write token of the Blob upload adapter (D-051).
   * A secret: never log it. When it is set, uploads go to Vercel Blob and `UPLOAD_DIR` must not be
   * set; when `nodeEnv` is `production`, exactly one of the two is present.
   */
  blobReadWriteToken?: string;
}

/** The longest payment timeout accepted: one day. A bound against a typing error, not a product rule. */
export const MAX_PAYMENT_TIMEOUT_MINUTES = 1_440;
export const DEFAULT_PAYMENT_TIMEOUT_MINUTES = 15;
/** The `sign-up` limit per address and hour. A test pins it to `RATE_LIMITS.SIGN_UP.limit`. */
export const DEFAULT_SIGN_UP_RATE_LIMIT = 5;
/** Highest `SIGN_UP_RATE_LIMIT`. Same value as `MAX_SIGN_UP_LIMIT_OVERRIDE` in rate-limit.ts. */
export const MAX_SIGN_UP_RATE_LIMIT = 1_000;

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

/** `AUTH_SECRET`: Better Auth itself asks for at least 32 characters. */
export const AUTH_SECRET_MIN_LENGTH = 32;

/**
 * The marker every throwaway value of `.env.example` carries (SEC-009). An `AUTH_SECRET` that
 * contains it is refused when NODE_ENV=production.
 */
const PLACEHOLDER_MARKER = "not_a_secret";

/**
 * SEC-044: the fewest distinct characters a production `AUTH_SECRET` may have. A random value of
 * the length DEPLOYMENT.md asks for has far more: 32 hexadecimal digits from a random source have
 * fewer than 8 distinct characters with a probability below one in a million (simulated), and
 * the documented base64url value of 43 characters has about 30.
 */
export const AUTH_SECRET_MIN_DISTINCT_CHARACTERS = 8;

/**
 * SEC-044: secret values that are public, refused when NODE_ENV=production whatever their form.
 * The library's built-in default (better-auth 1.7.7 `DEFAULT_SECRET`, used when no secret is
 * given) and the secret of the integration tests (tests/integration/auth/support.ts). A list of
 * published values can never be complete; it catches the values someone is most likely to copy.
 */
const PUBLISHED_AUTH_SECRETS: ReadonlySet<string> = new Set([
  "better-auth-secret-12345678901234567890",
  "integration-test-secret-0123456789-abcdefghij",
]);

/**
 * SEC-045, SEC-046: variables the auth library reads by itself from the process environment
 * (better-auth 1.7.7 `dist/context/create-context.mjs`, `dist/context/helpers.mjs`, and
 * @better-auth/telemetry `dist/node.mjs`). This application configures the library only from
 * `AUTH_SECRET` and `APP_URL`, but passing a value explicitly does not always win: the library
 * also reads these variables, and for some it ORs or merges them with the option (the telemetry
 * variables override `telemetry: { enabled: false }` in src/server/auth/auth.ts). One of them
 * being set means a configuration the operator believes is in force while it is not, or, for
 * `BETTER_AUTH_SECRETS` and `BETTER_AUTH_TRUSTED_ORIGINS`, one that would change the signing
 * secret or the trusted origins behind the validation of this file, or, for the telemetry
 * variables, an outbound report of host details. They are refused in every NODE_ENV. Only the
 * name is reported: a value of one of them may be a secret. Re-list the library's `env.*` reads
 * when it is updated.
 */
export const AUTH_LIBRARY_VARIABLES = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_SECRETS",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_TRUSTED_ORIGINS",
  "BETTER_AUTH_TELEMETRY",
  "BETTER_AUTH_TELEMETRY_ENDPOINT",
  "BETTER_AUTH_TELEMETRY_DEBUG",
] as const;

/**
 * D-051: the form of a Vercel Blob read-write token, `vercel_blob_rw_<store id>_<secret>`, as
 * @vercel/blob 2.8.2 reads it (`parseStoreIdFromReadWriteToken` splits on `_` and takes the
 * fourth part as the store id). The store id becomes part of a host name in the library
 * (`https://<store id>.private.blob.vercel-storage.com/`), so it is letters and digits only; the
 * secret part is printable ASCII without blanks. The upload module checks the same pattern
 * (src/modules/uploads/config.ts), so a value that starts the server is one the module accepts.
 */
export const BLOB_READ_WRITE_TOKEN_PATTERN = /^vercel_blob_rw_[A-Za-z0-9]+_[!-~]+$/;

/**
 * D-051: variables the Vercel Blob library (@vercel/blob 2.8.2, `dist/chunk-*.js` and
 * `dist/index.js`) reads by itself from the process environment and that change where or how
 * its requests go. `VERCEL_BLOB_API_URL` sends every API request, with the read-write token in
 * its `authorization` header, to another address; the proxy and version overrides change the
 * request the store receives. Refused when NODE_ENV=production, where nothing but the real store
 * may receive the token; allowed elsewhere, where a local emulator may need them. Only the name
 * is reported. Re-list the library's `process.env` reads when it is updated.
 */
export const BLOB_LIBRARY_VARIABLES = [
  "VERCEL_BLOB_API_URL",
  "NEXT_PUBLIC_VERCEL_BLOB_API_URL",
  "VERCEL_BLOB_PROXY_THROUGH_ALTERNATIVE_API",
  "NEXT_PUBLIC_VERCEL_BLOB_PROXY_THROUGH_ALTERNATIVE_API",
  "VERCEL_BLOB_API_VERSION_OVERRIDE",
  "NEXT_PUBLIC_VERCEL_BLOB_API_VERSION_OVERRIDE",
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
  pgPasswordPlaceholder:
    "must not hold a local placeholder password from .env.example when NODE_ENV=production",
  databaseUrlTestInProduction: "must not be set when NODE_ENV=production",
  authSecretTooShort: `must be at least ${AUTH_SECRET_MIN_LENGTH} characters long`,
  authSecretPlaceholder: "must not be a placeholder from .env.example when NODE_ENV=production",
  authSecretWeak:
    "must be a randomly generated value when NODE_ENV=production: printable ASCII only, with enough distinct characters, no repeated or sequential pattern, and not a published value",
  authLibraryVariable: "must not be set; this application reads AUTH_SECRET and APP_URL only",
  trustedProxyHops: `must be an integer from 0 to ${MAX_TRUSTED_PROXY_HOPS}`,
  trustedProxyHopsExplicit: "must be set explicitly when NODE_ENV=production",
  trustedClientIpHeader: "must match ^[A-Za-z0-9-]{1,64}$",
  trustedClientIpHeaderForbidden:
    "cannot be X-Forwarded-For, Forwarded, Cookie, Authorization, or Host",
  trustedClientIpHeaderWithHops: "cannot be set when TRUSTED_PROXY_HOPS is greater than 0",
  paymentTimeoutMinutes: `must be an integer from 1 to ${MAX_PAYMENT_TIMEOUT_MINUTES}`,
  logLevel: "must be debug, info, warn, or error",
  uploadDir: "must be an absolute directory path",
  uploadDirRequired: "must be set when NODE_ENV=production, unless BLOB_READ_WRITE_TOKEN is set",
  blobReadWriteToken: "must be a Vercel Blob read-write token (vercel_blob_rw_<store id>_<secret>)",
  blobReadWriteTokenWithUploadDir:
    "cannot be set together with UPLOAD_DIR; configure exactly one upload storage",
  blobReadWriteTokenPlaceholder:
    "must not be a placeholder from .env.example when NODE_ENV=production",
  blobLibraryVariableInProduction:
    "must not be set when NODE_ENV=production; it redirects or alters the upload storage requests",
  signUpRateLimit: `must be an integer from 1 to ${MAX_SIGN_UP_RATE_LIMIT}`,
  signUpRateLimitInProduction: "must not be set when NODE_ENV=production",
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
  // The length counts UTF-16 code units, as `String.prototype.length` does; the rule text is the
  // constant, never anything the validator writes about the value.
  AUTH_SECRET: z
    .string({ error: ENV_RULES.required })
    .min(AUTH_SECRET_MIN_LENGTH, { error: ENV_RULES.authSecretTooShort }),
  // A string of one digit, so that "1.0", " 1", "+1", "0x1", and "true" are all refused. SR-01
  // forbids a boolean "trust proxy" switch; no such variable exists and none is accepted here.
  // The pattern is one character class, "[0-MAX]", which is right only while
  // MAX_TRUSTED_PROXY_HOPS is a single digit (0 to 9). A case in env.test.ts fails if the
  // constant ever leaves that range; the pattern must be rewritten in the same change.
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
  // Raises the sign-up limit for the e2e suite only; refused when NODE_ENV=production (parseEnv).
  SIGN_UP_RATE_LIMIT: z
    .string()
    .regex(/^[1-9][0-9]{0,3}$/, { error: ENV_RULES.signUpRateLimit })
    .transform(Number)
    .refine((value) => value <= MAX_SIGN_UP_RATE_LIMIT, { error: ENV_RULES.signUpRateLimit })
    .default(DEFAULT_SIGN_UP_RATE_LIMIT),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"], { error: ENV_RULES.logLevel })
    .default("info"),
  // Same test as `readUploadDir` in src/modules/uploads/config.ts (isAbsolute, not blank), so a
  // value that starts the server is a value the upload module accepts. A NUL byte is never a path.
  UPLOAD_DIR: z
    .string()
    .refine((value) => value.trim() !== "" && !value.includes("\0") && isAbsolute(value), {
      error: ENV_RULES.uploadDir,
    })
    .optional(),
  // D-051. A secret: the rule text is the constant, never anything about the value.
  BLOB_READ_WRITE_TOKEN: z
    .string()
    .regex(BLOB_READ_WRITE_TOKEN_PATTERN, { error: ENV_RULES.blobReadWriteToken })
    .optional(),
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

function containsPlaceholder(text: string): boolean {
  return LOCAL_PLACEHOLDER_PASSWORDS.some((placeholder) => text.includes(placeholder));
}

/**
 * Replaces every well-formed escape (`%` and two hexadecimal digits) with the character of that
 * byte and leaves everything else as it is. It cannot throw, unlike `decodeURIComponent`, which
 * refuses a string with one broken escape as a whole. The placeholders are plain ASCII, so a
 * byte-by-byte reading finds them however the bytes around them decode.
 */
function decodeEscapes(text: string): string {
  return text.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/**
 * True when a published local password is in `databaseUrl`, as written or in a form the
 * database driver turns into it (SEC-025). The driver does not use the variable as written: it
 * parses it as a URL, percent-decodes the password in front of the host, and prefers a
 * `password` query parameter to it. Where a string holds a broken escape the driver still
 * decodes some of the well-formed ones, so every well-formed escape is decoded here.
 *
 * Looked at, each as written and with its escapes decoded: the whole text (this is the test
 * that also finds a placeholder in places the URL parser does not name), and, as the URL parser
 * gives them (it drops tabs and line breaks), the user name, the password, and every `password`
 * query parameter.
 */
function hasPlaceholderPassword(databaseUrl: string): boolean {
  const texts = [databaseUrl];
  try {
    const url = new URL(databaseUrl);
    texts.push(url.username, url.password, ...url.searchParams.getAll("password"));
  } catch {
    // Not a URL: the rule `databaseUrl` has reported that. The text is still judged as written.
  }
  return texts.some(
    (text) => containsPlaceholder(text) || containsPlaceholder(decodeEscapes(text)),
  );
}

/**
 * SEC-009, first half, with SEC-025: the published local passwords are refused when
 * `NODE_ENV=production`, in `DATABASE_URL` and in `PGPASSWORD`. The driver falls back to
 * `PGPASSWORD` when the URL carries no password, and it takes that variable as written, so it
 * is judged as written. It is the one use this file makes of `PGPASSWORD`; the application does
 * not read it otherwise. Each refusal names the variable and a fixed rule, never a value.
 */
function checkDatabaseUrlForProduction(
  source: EnvSource,
  databaseUrl: string | undefined,
  issues: EnvIssue[],
): void {
  if (databaseUrl !== undefined && hasPlaceholderPassword(databaseUrl)) {
    issues.push({ variable: "DATABASE_URL", rule: ENV_RULES.databaseUrlPlaceholder });
  }
  const pgPassword = raw(source, "PGPASSWORD");
  if (pgPassword !== undefined && containsPlaceholder(pgPassword)) {
    issues.push({ variable: "PGPASSWORD", rule: ENV_RULES.pgPasswordPlaceholder });
  }
}

/**
 * SEC-009 for `AUTH_SECRET`: a throwaway value of `.env.example` is refused when
 * `NODE_ENV=production`. Only a value that passed the other rules is looked at.
 */
function checkAuthSecretForProduction(secret: string | undefined, issues: EnvIssue[]): void {
  if (secret === undefined) return;
  if (secret.includes(PLACEHOLDER_MARKER)) {
    issues.push({ variable: "AUTH_SECRET", rule: ENV_RULES.authSecretPlaceholder });
  } else if (isWeakAuthSecret(secret)) {
    issues.push({ variable: "AUTH_SECRET", rule: ENV_RULES.authSecretWeak });
  }
}

/** SEC-047: the length of the windows of the repeated-substring and constant-step rules. */
const PATTERN_WINDOW = 8;

/** True when `text` is a shorter unit written twice or more ("abcabc"). */
function isRepetition(text: string): boolean {
  // The classic test: a string is periodic exactly when it occurs inside itself doubled, at an
  // offset other than 0 and its own length.
  return text.length > 1 && (text + text).indexOf(text, 1) < text.length;
}

/** SEC-047 (a): true when every code point is printable ASCII, U+0021 to U+007E. */
function isPrintableAscii(text: string): boolean {
  return /^[\u0021-\u007e]+$/.test(text);
}

/** SEC-047 (b): true when some run of PATTERN_WINDOW characters occurs twice or more. */
function hasRepeatedWindow(text: string): boolean {
  const seen = new Set<string>();
  for (let start = 0; start + PATTERN_WINDOW <= text.length; start += 1) {
    const window = text.slice(start, start + PATTERN_WINDOW);
    if (seen.has(window)) return true;
    seen.add(window);
  }
  return false;
}

/**
 * SEC-047 (c): true when some run of PATTERN_WINDOW characters has a constant code-point step
 * ("abcdefgh", "12345678", "hgfedcba", and the step 0 of "aaaaaaaa"). Text is printable ASCII
 * here, so a code unit is a code point.
 */
function hasConstantStepRun(text: string): boolean {
  let runLength = 1;
  let step = 0;
  for (let index = 1; index < text.length; index += 1) {
    const nextStep = text.charCodeAt(index) - text.charCodeAt(index - 1);
    if (runLength > 1 && nextStep === step) {
      runLength += 1;
    } else {
      runLength = 2;
      step = nextStep;
    }
    if (runLength >= PATTERN_WINDOW) return true;
  }
  return false;
}

/** SEC-047 (d): true when a published value is inside `secret`, whatever the case. */
function containsPublishedSecret(secret: string): boolean {
  const lower = secret.toLowerCase();
  for (const published of PUBLISHED_AUTH_SECRETS) {
    if (lower.includes(published.toLowerCase())) return true;
  }
  return false;
}

/**
 * SEC-049, SEC-051: the prefixes of the two published values (D-036 item 6), written without
 * separators. A value is compared after it is lower-cased and every character that is not a
 * letter or a digit is removed, so `better-auth-secret`, `better_auth_secret`, `Better.Auth.Secret`,
 * and `BetterAuthSecret` all match. A value that starts with one is refused, so the published
 * value with its tail or its separators changed is refused as well.
 */
const PUBLISHED_PREFIXES: readonly string[] = ["betterauthsecret", "integrationtestsecret"];

function hasPublishedPrefix(secret: string): boolean {
  const squeezed = secret.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PUBLISHED_PREFIXES.some((prefix) => squeezed.startsWith(prefix));
}

/**
 * SEC-049: the largest lag (distance between two compared positions) of the lag rule, and the
 * share of positions one code-point difference must cover to count as a pattern. Measured
 * (docs/reviews/SEC-046-047-recheck.md): refuses `secret1secret2...`, interleaved runs, and
 * hexadecimal counting; 0 of 1,000,000 random values refused in each of hex-64, hex-32, base64-44,
 * and base64url-43.
 */
const MAX_PATTERN_LAG = 8;
const MIN_PATTERN_SHARE = 0.5;

/**
 * SEC-049: true when, for some lag from 1 to MAX_PATTERN_LAG, a single difference between the
 * code points `lag` apart covers at least MIN_PATTERN_SHARE of the positions. Difference 0 is a
 * period of `lag` ("abcdefg!abcdefg@" repeats at lag 8); a constant non-zero difference is a
 * counter or an interleaved sequence ("a1b2c3d4" at lag 2). Text is printable ASCII here.
 */
function hasLagPattern(text: string): boolean {
  for (let lag = 1; lag <= MAX_PATTERN_LAG; lag += 1) {
    const positions = text.length - lag;
    if (positions <= 0) break;
    const counts = new Map<number, number>();
    let most = 0;
    for (let index = 0; index < positions; index += 1) {
      const difference = text.charCodeAt(index + lag) - text.charCodeAt(index);
      const count = (counts.get(difference) ?? 0) + 1;
      counts.set(difference, count);
      if (count > most) most = count;
    }
    if (most >= positions * MIN_PATTERN_SHARE) return true;
  }
  return false;
}

/**
 * SEC-044, SEC-047, SEC-049: a production `AUTH_SECRET` that is long enough but plainly not random.
 * Refused: a code point outside printable ASCII U+0021 to U+007E (blanks, invisible padding,
 * look-alikes; every documented generator emits ASCII); fewer than
 * AUTH_SECRET_MIN_DISTINCT_CHARACTERS distinct characters; a shorter unit repeated; a run of 8
 * characters that occurs twice; a run of 8 characters with a constant code-point step; a
 * published value inside it, in any case; a start with `better-auth-secret` or
 * `integration-test-secret`, in any case and with any separators or none (SEC-051); a single code-point difference at one lag from 1 to 8
 * that covers at least half of the positions (SEC-049). This is a floor against mistakes, not an entropy
 * measurement: a value that passes is not thereby random. A random value from the generation
 * commands of docs/DEPLOYMENT.md is refused with a probability below one in 100,000 (measured
 * in src/server/env.test.ts).
 */
function isWeakAuthSecret(secret: string): boolean {
  return (
    !isPrintableAscii(secret) ||
    new Set(secret).size < AUTH_SECRET_MIN_DISTINCT_CHARACTERS ||
    isRepetition(secret) ||
    hasRepeatedWindow(secret) ||
    hasConstantStepRun(secret) ||
    containsPublishedSecret(secret) ||
    hasPublishedPrefix(secret) ||
    hasLagPattern(secret)
  );
}

/**
 * SEC-045: refuses every variable of AUTH_LIBRARY_VARIABLES that is set (an empty value counts as
 * not set, as everywhere in this file; the library ignores an empty value too). Names only.
 */
function checkAuthLibraryVariables(source: EnvSource, issues: EnvIssue[]): void {
  for (const variable of AUTH_LIBRARY_VARIABLES) {
    if (raw(source, variable) !== undefined) {
      issues.push({ variable, rule: ENV_RULES.authLibraryVariable });
    }
  }
}

/**
 * Validates `AUTH_SECRET` alone and returns it, for the auth layer, which creates its instance on
 * first use and must not depend on the other variables (src/server/auth/config.ts delegates here).
 * It applies the same rules as `parseEnv`, so a value that starts a server is a value this
 * accepts. Throws `EnvValidationError` naming the variable and a rule, never the value. The
 * production check looks at `NODE_ENV` as written: the variable is not judged here. The
 * library's own variables (SEC-045) are refused here too, so an auth instance created on first
 * use without the start-up hook having run obeys the same rule.
 */
export function readAuthSecret(source: EnvSource = process.env): string {
  const issues: EnvIssue[] = [];
  const secret = read(source, "AUTH_SECRET", issues);
  if (raw(source, "NODE_ENV") === "production") checkAuthSecretForProduction(secret, issues);
  checkAuthLibraryVariables(source, issues);
  if (issues.length > 0 || secret === undefined) throw new EnvValidationError(issues);
  return secret;
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
  const authSecret = read(source, "AUTH_SECRET", issues);
  const trustedProxyHops = read(source, "TRUSTED_PROXY_HOPS", issues);
  const trustedClientIpHeader = read(source, "TRUSTED_CLIENT_IP_HEADER", issues);
  const paymentTimeoutMinutes = read(source, "PAYMENT_TIMEOUT_MINUTES", issues);
  const signUpRateLimit = read(source, "SIGN_UP_RATE_LIMIT", issues);
  const logLevel = read(source, "LOG_LEVEL", issues);
  const uploadDir = read(source, "UPLOAD_DIR", issues);
  const blobReadWriteToken = read(source, "BLOB_READ_WRITE_TOKEN", issues);
  checkAuthLibraryVariables(source, issues);

  // D-051: one upload storage. Both set is refused in every NODE_ENV, so the adapter in use is
  // never a guess (src/modules/uploads/config.ts refuses the same combination).
  const uploadDirSet = raw(source, "UPLOAD_DIR") !== undefined;
  const blobTokenSet = raw(source, "BLOB_READ_WRITE_TOKEN") !== undefined;
  if (uploadDirSet && blobTokenSet) {
    issues.push({
      variable: "BLOB_READ_WRITE_TOKEN",
      rule: ENV_RULES.blobReadWriteTokenWithUploadDir,
    });
  }

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
    checkDatabaseUrlForProduction(source, databaseUrl, issues);
    checkAuthSecretForProduction(authSecret, issues);
    // The production limit is the code default: the variable may not be set at all, not even to 5.
    if (raw(source, "SIGN_UP_RATE_LIMIT") !== undefined) {
      issues.push({ variable: "SIGN_UP_RATE_LIMIT", rule: ENV_RULES.signUpRateLimitInProduction });
    }
    if (raw(source, "DATABASE_URL_TEST") !== undefined) {
      issues.push({ variable: "DATABASE_URL_TEST", rule: ENV_RULES.databaseUrlTestInProduction });
    }
    // SR-01: no silent default in production. `0` is a valid answer, but it must be given.
    if (raw(source, "TRUSTED_PROXY_HOPS") === undefined) {
      issues.push({ variable: "TRUSTED_PROXY_HOPS", rule: ENV_RULES.trustedProxyHopsExplicit });
    }
    // T-041: no guessed directory in production; a wrong one may not be persistent. A value that
    // is set but not absolute has been reported by the schema already. D-051: the Vercel Blob
    // token is the other accepted upload storage; exactly one of the two must be set.
    if (!uploadDirSet && !blobTokenSet) {
      issues.push({ variable: "UPLOAD_DIR", rule: ENV_RULES.uploadDirRequired });
    }
    // SEC-009 for the Blob token: a throwaway value carrying the placeholder marker.
    const token = raw(source, "BLOB_READ_WRITE_TOKEN");
    if (token !== undefined && token.includes(PLACEHOLDER_MARKER)) {
      issues.push({
        variable: "BLOB_READ_WRITE_TOKEN",
        rule: ENV_RULES.blobReadWriteTokenPlaceholder,
      });
    }
    for (const variable of BLOB_LIBRARY_VARIABLES) {
      if (raw(source, variable) !== undefined) {
        issues.push({ variable, rule: ENV_RULES.blobLibraryVariableInProduction });
      }
    }
  }

  if (
    issues.length > 0 ||
    nodeEnv === undefined ||
    appUrl === undefined ||
    databaseUrl === undefined ||
    authSecret === undefined ||
    paymentTimeoutMinutes === undefined ||
    signUpRateLimit === undefined ||
    logLevel === undefined
  ) {
    throw new EnvValidationError(issues);
  }

  return Object.freeze({
    nodeEnv,
    appUrl,
    appOrigin: new URL(appUrl).origin,
    databaseUrl,
    authSecret,
    trustedProxy: Object.freeze({
      trustedProxyHops: trustedProxyHops ?? 0,
      ...(trustedClientIpHeader === undefined ? {} : { trustedClientIpHeader }),
    }),
    paymentTimeoutMinutes,
    signUpRateLimit,
    logLevel,
    ...(uploadDir === undefined ? {} : { uploadDir }),
    ...(blobReadWriteToken === undefined ? {} : { blobReadWriteToken }),
  });
}

/**
 * Validates `DATABASE_URL` alone, with the SEC-009 refusals (the one of `PGPASSWORD` included,
 * SEC-025), and returns it. For the database layer and for scripts that need the database and
 * nothing else: creating the client must not depend on `APP_URL` or the proxy variables being
 * set. Not kept between calls, because the integration harness points the variable at a
 * different database per worker.
 */
export function readDatabaseUrl(source: EnvSource = process.env): string {
  const issues: EnvIssue[] = [];
  const nodeEnv = read(source, "NODE_ENV", issues);
  const databaseUrl = read(source, "DATABASE_URL", issues);
  if (nodeEnv === "production") checkDatabaseUrlForProduction(source, databaseUrl, issues);
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
 * In production it also writes the one warning SR-01 requires when no proxy is trusted. That
 * line goes through `security("warn", ...)`, the logger path that `LOG_LEVEL` never filters
 * (SR-04; SEC-031), so no level can silence it.
 *
 * Last, it hands the validated `LOG_LEVEL` to the process-wide logger (`setLogLevel`), whichever
 * logger this call itself was given. The level is kept once per process (on `globalThis`, in
 * src/server/logger.ts), so the hook, the proxy file, and the route handlers all read it. The
 * error line is written at the level of that moment, `info` in a process that has just started,
 * and a failed validation leaves the level alone.
 */
export function loadEnvAtStartup(options: { logger?: StructuredLogger } = {}): Env {
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
    log.security(
      "warn",
      "No trusted proxy is configured: the client address is unknown, so every per-address rate limit is shared by all clients.",
      { component: "env" },
    );
  }
  setLogLevel(env.logLevel);
  return env;
}
