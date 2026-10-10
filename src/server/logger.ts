/**
 * Structured logger: one JSON object per line on stdout.
 *
 * Line shape: { level, timestamp (UTC ISO 8601), message, requestId?, ...fields }.
 * The four reserved keys always win over a field with the same name.
 *
 * Redaction (docs/SECURITY.md: no passwords, session tokens, cookies, or full
 * addresses in logs):
 *   - any key whose name contains a sensitive word (see SENSITIVE_KEY_PARTS), at
 *     any depth, has its value replaced by "[REDACTED]";
 *   - street-level address keys (see ADDRESS_KEYS) are replaced the same way;
 *   - credentials embedded in URLs and `Bearer` tokens inside strings are masked.
 * Key-based redaction cannot recognise a secret stored under an innocent key or
 * inside free text, so callers must still log identifiers, not payloads.
 *
 * The logger never throws: circular references, throwing getters, BigInt, and
 * very deep or very large values are all rendered as placeholders.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `bindings` (and optionally a request id) to every line. */
  child(bindings: LogFields & { requestId?: string }): Logger;
}

export interface LoggerOptions {
  /** Lines below this level are dropped. Default "info". */
  level?: LogLevel;
  requestId?: string;
  /** Fields added to every line. */
  bindings?: LogFields;
  /** Receives one JSON line without the trailing newline. Default: stdout. */
  write?: (line: string) => void;
  /** Clock, injectable for tests. */
  now?: () => Date;
}

export const REDACTED = "[REDACTED]";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Matched against the key lowercased with every non-alphanumeric character removed. */
const SENSITIVE_KEY_PARTS = [
  "password",
  "passwd",
  "token",
  "secret",
  "authorization",
  "cookie", // also covers set-cookie
  "session", // session, sessionId, session_token
  "apikey",
  "credential",
  "privatekey",
] as const;

/** Exact normalised key names that hold a street-level address. */
const ADDRESS_KEYS: ReadonlySet<string> = new Set([
  "address",
  "shippingaddress",
  "billingaddress",
  "addressline1",
  "addressline2",
  "line1",
  "line2",
  "shipline1",
  "street",
  "postalcode",
  "shippostalcode",
]);

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 8_000;

export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalised === "sid" || ADDRESS_KEYS.has(normalised)) return true;
  return SENSITIVE_KEY_PARTS.some((part) => normalised.includes(part));
}

function scrubString(value: string): string {
  const clipped =
    value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}[Truncated]` : value;
  return clipped
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
}

function sanitise(value: unknown, ancestors: object[]): unknown {
  switch (typeof value) {
    case "string":
      return scrubString(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
      return undefined;
    case "symbol":
      return value.toString();
    case "function":
      return "[Function]";
  }
  if (value === null) return null;

  const object = value as object;
  if (ancestors.includes(object)) return "[Circular]";
  if (ancestors.length >= MAX_DEPTH) return "[MaxDepth]";

  if (object instanceof Date) {
    return Number.isNaN(object.getTime()) ? "[Invalid Date]" : object.toISOString();
  }

  ancestors.push(object);
  try {
    if (Array.isArray(object)) {
      const items = object.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitise(item, ancestors));
      if (object.length > MAX_ARRAY_ITEMS) items.push("[Truncated]");
      return items;
    }

    const output: Record<string, unknown> = {};
    if (object instanceof Error) {
      // name, message, stack, and cause are not enumerable, so copy them explicitly.
      output.name = object.name;
      output.message = scrubString(object.message);
      if (typeof object.stack === "string") output.stack = scrubString(object.stack);
      if (object.cause !== undefined) output.cause = sanitise(object.cause, ancestors);
    }
    const keys = Object.keys(object);
    for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
        continue;
      }
      try {
        output[key] = sanitise((object as Record<string, unknown>)[key], ancestors);
      } catch {
        output[key] = "[Unserializable]";
      }
    }
    if (keys.length > MAX_OBJECT_KEYS) output["[Truncated]"] = true;
    return output;
  } finally {
    ancestors.pop();
  }
}

/** Returns a JSON-safe copy of `value` with sensitive values replaced. Never throws. */
export function redact(value: unknown): unknown {
  try {
    return sanitise(value, []);
  } catch {
    return "[Unserializable]";
  }
}

function writeToStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minimum = LEVEL_ORDER[options.level ?? "info"];
  const write = options.write ?? writeToStdout;
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};
  const requestId = options.requestId;

  function emit(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < minimum) return;
    let line: string;
    try {
      const safeFields = redact({ ...bindings, ...fields });
      line = JSON.stringify({
        ...(safeFields !== null && typeof safeFields === "object" ? safeFields : {}),
        level,
        timestamp: now().toISOString(),
        message: scrubString(String(message)),
        ...(requestId === undefined ? {} : { requestId: scrubString(requestId) }),
      });
    } catch {
      line = JSON.stringify({
        level,
        timestamp: new Date().toISOString(),
        message: "Log entry could not be serialised.",
      });
    }
    try {
      write(line);
    } catch {
      // A failing sink must never break the request that is being logged.
    }
  }

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child(childBindings) {
      const { requestId: childRequestId, ...rest } = childBindings;
      return createLogger({
        level: options.level,
        write,
        now,
        requestId: childRequestId ?? requestId,
        bindings: { ...bindings, ...rest },
      });
    },
  };
}

/** Process-wide logger. Use `logger.child({ requestId })` inside a request. */
export const logger: Logger = createLogger();
