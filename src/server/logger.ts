/**
 * Structured logger: one JSON object per line on stdout.
 *
 * Line shape: { level, timestamp (UTC ISO 8601), message, requestId?, ...fields }.
 * The four reserved keys always win over a field with the same name.
 *
 * Redaction implements "What the logger must do" of security rule SR-04 in
 * docs/SECURITY.md, including its additions of 2026-10-11 (findings SEC-001,
 * SEC-002, SEC-007, and SEC-012 to SEC-016). That section is the specification;
 * the lists below are copied from it.
 *
 *   By key, at any depth (the key is lower-cased and stripped of every
 *   non-alphanumeric character first): a key that contains a word of
 *   SENSITIVE_KEY_PARTS, or equals an entry of SENSITIVE_KEYS, has its whole
 *   value replaced by "[REDACTED]". The exact key `name` is redacted on ordinary
 *   objects, but an Error's own `name` is written. Use `module` or `component`,
 *   not `name`, for logger bindings.
 *
 *   Inside every string (messages, error messages, stacks, values under harmless
 *   keys, and object keys): URL user-info up to the last `@`, the value of a
 *   `key=value`, `key => value`, or `key: value` pair and of a URL query
 *   parameter whose key contains a word of SENSITIVE_KEY_PARTS or equals an
 *   entry of INLINE_SENSITIVE_KEYS, `Bearer` and `Basic` credentials, and
 *   email-shaped substrings are masked. Phone numbers in free text are not
 *   pattern-masked (SR-04 explains why).
 *
 *   A string longer than its limit is clipped before it is scanned, and the cut
 *   is treated as hostile: an unfinished URL or email address at the cut is
 *   masked as well (SEC-014, see `scrubString`).
 *
 *   In the output line, DEL, the C1 controls, U+2028, U+2029, and every format
 *   character (Unicode category Cf: bidirectional controls, zero-width and other
 *   invisible characters, tag characters) are written as \uXXXX escapes, like
 *   the C0 controls that JSON.stringify already escapes.
 *
 * Redaction is a second line of defence, not the control. Callers log
 * identifiers and outcomes, never a request body, a Request, a Headers object, a
 * database row, user-typed text, or a rate-limit key (SR-04, "What callers must
 * do"). A secret under an unlisted key, or in free text in a shape these
 * patterns do not know, is still written.
 *
 * Cost: every string scan is linear in the string's length, and one entry is
 * limited to MAX_ENTRY_NODES values and MAX_ENTRY_CHARS characters of strings
 * and keys; whatever lies beyond is replaced by "[Truncated]".
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
export const TRUNCATED = "[Truncated]";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** SR-04 "contains" list. Matched against the normalised key, and against keys inside strings. */
const SENSITIVE_KEY_PARTS = [
  "password",
  "passwd",
  "pwd",
  "passphrase",
  "token",
  "secret",
  "authorization",
  "cookie", // also covers set-cookie
  "session", // session, sessionId, session_token
  "apikey",
  "credential",
  "privatekey",
  "signature",
  "jwt",
  "email",
  "phone",
  "recipient",
  "postalcode",
  "district", // also covers subdistrict
  "province",
  "street",
  "forwarded", // x-forwarded-for, forwarded
] as const;

/** SR-04 "equals" list. `address` is exact so that `addressId` stays readable. */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "sid",
  "pass",
  "pin",
  "otp",
  "hash",
  "name",
  "fullname",
  "firstname",
  "lastname",
  "displayname",
  "username",
  "customername",
  "contactname",
  "address",
  "shippingaddress",
  "billingaddress",
  "addressline1",
  "addressline2",
  "line1",
  "line2",
  "shipline1",
  "ip",
  "ipaddress",
  "remoteaddress",
  "clientaddress",
  "realip",
  "xrealip",
  "comment",
  "description",
  "reviewnote",
  "statusreason",
  "moderationnote",
  "failurereason",
  "metadata",
  "trackingnumber",
  "tel",
  "mobile",
  "q",
  "query",
  "body",
  "headers",
  "rawheaders",
]);

/**
 * The short secret names of the "equals" list that are also matched in front of `=`, `=>`, or
 * `:` inside a string (SR-04, SEC-015). The rest of SENSITIVE_KEYS stays key-only, because words
 * such as `name`, `query`, and `hash` are too common in ordinary text.
 */
const INLINE_SENSITIVE_KEYS: ReadonlySet<string> = new Set(["sid", "pass", "pin", "otp"]);

/** URL schemes that name local code, not a network location, and so never hold credentials. */
const LOCAL_URL_SCHEMES: ReadonlySet<string> = new Set([
  "file",
  "node",
  "webpack",
  "webpack-internal",
  "turbopack",
]);

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 8_000;
const MAX_KEY_LENGTH = 256;
/** Budget of one log entry: values visited, and characters of strings and keys copied. */
export const MAX_ENTRY_NODES = 2_000;
export const MAX_ENTRY_CHARS = 64_000;
/** Longest key looked at in front of `=` or `:` inside a string. */
const MAX_INLINE_KEY_LENGTH = 64;
/** Longest run of blanks accepted on either side of a separator inside a string (SR-04). */
const MAX_SEPARATOR_BLANKS = 32;
/** Most digits of a line or column number in a file position such as `session.ts:12:5`. */
const MAX_POSITION_DIGITS = 10;
/** How far back from a clip an unfinished email address is looked for (SR-04, SEC-014). */
const CLIP_EMAIL_WINDOW = 256;

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasSensitivePart(normalisedKey: string): boolean {
  return SENSITIVE_KEY_PARTS.some((part) => normalisedKey.includes(part));
}

export function isSensitiveKey(key: string): boolean {
  const normalised = normaliseKey(key);
  return SENSITIVE_KEYS.has(normalised) || hasSensitivePart(normalised);
}

// ---------------------------------------------------------------------------
// String scrubbing. Every function below is a single left-to-right pass: a
// character is looked at a bounded number of times, so the cost is linear in
// the length of the string whatever it contains.
// ---------------------------------------------------------------------------

const AT = 64;
const BACKSLASH = 92;
const COLON = 58;
const DOT = 46;
const DOUBLE_QUOTE = 34;
const EQUALS = 61;
const GREATER_THAN = 62;
const HYPHEN = 45;
const SINGLE_QUOTE = 39;
const SLASH = 47;
const CLOSE_PARENTHESIS = 41;

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isQuote(code: number): boolean {
  return code === DOUBLE_QUOTE || code === SINGLE_QUOTE;
}

function isBlank(code: number): boolean {
  return code === 32 || code === 9;
}

function isLineEnd(code: number): boolean {
  return code === 10 || code === 13;
}

/** Characters of a key written in front of `=` or `:`, such as `session_token` or `Set-Cookie`. */
function isInlineKeyChar(code: number): boolean {
  return isLetter(code) || isDigit(code) || code === 95 || code === DOT || code === HYPHEN;
}

/** Ends an unquoted value and a URL: whitespace, control characters, quotes, angle brackets. */
function isTokenEnd(code: number): boolean {
  return code <= 32 || isQuote(code) || code === 60 || code === 62 || code === 96;
}

function isSchemeSeparator(text: string, index: number): boolean {
  return (
    text.charCodeAt(index) === COLON &&
    text.charCodeAt(index + 1) === SLASH &&
    text.charCodeAt(index + 2) === SLASH
  );
}

/**
 * Masks URL user-info. A run is the unbroken text from a `://` to the next blank, quote, or
 * angle bracket. In each run, everything from the first `://` whose scheme is not local up to
 * the LAST `@` of the run is replaced, so a password that contains `@`, `/`, or `://` leaves no
 * tail. The price is that a URL with an `@` in its path or query loses the part in front of it.
 *
 * A local-scheme URL (LOCAL_URL_SCHEMES) is exempt so that stack frames stay readable, but the
 * exemption covers only that URL: a further `://` with another scheme inside the same run is
 * masked like any other (SEC-012). The run is walked once and the scheme in front of each `://`
 * is read back over at most 32 characters, so the pass is linear.
 */
function maskUrlUserInfo(text: string): string {
  let separator = text.indexOf("://");
  if (separator === -1) return text;

  const length = text.length;
  let output = "";
  let copied = 0;
  while (separator !== -1) {
    // The first `://` of this run that may carry credentials, and the last `@` behind it.
    let maskFrom = -1;
    let lastAt = -1;
    let end = separator;
    while (end < length) {
      const code = text.charCodeAt(end);
      if (isTokenEnd(code)) break;
      if (code === AT) {
        if (maskFrom !== -1) lastAt = end;
      } else if (maskFrom === -1 && isSchemeSeparator(text, end)) {
        if (!LOCAL_URL_SCHEMES.has(schemeBefore(text, end, copied))) maskFrom = end + 3;
        end += 2;
      }
      end += 1;
    }
    if (lastAt !== -1) {
      output += `${text.slice(copied, maskFrom)}${REDACTED}`;
      copied = lastAt;
    }
    // The whole run is consumed, so no character is scanned by two iterations.
    separator = text.indexOf("://", end);
  }
  return output + text.slice(copied);
}

/** The lower-cased scheme that ends at `end`, looking back at most 32 characters. */
function schemeBefore(text: string, end: number, floor: number): string {
  let start = end;
  while (start > floor && end - start < 32) {
    const code = text.charCodeAt(start - 1);
    if (!isLetter(code) && !isDigit(code) && code !== 43 && code !== DOT && code !== HYPHEN) break;
    start -= 1;
  }
  return text.slice(start, end).toLowerCase();
}

/** `session.ts:12:5` in a stack frame is a file position, not a `key: value` pair. */
const FILE_NAME_PATTERN = /\.[A-Za-z0-9]{1,4}$/;

/** Skips at most MAX_POSITION_DIGITS digits from `index`; returns `index` when there is none. */
function skipPositionDigits(text: string, index: number): number {
  let end = index;
  while (end - index < MAX_POSITION_DIGITS && isDigit(text.charCodeAt(end))) end += 1;
  return end;
}

/**
 * True when what follows the colon at `colon` is a line number and nothing else: digits,
 * optionally `:` and more digits, and then the end of the text, a blank, a line end, or `)`
 * (SR-04, SEC-013). `session.ts:12:5` qualifies; `db.password.prod:9x7Qz` does not.
 */
function isFilePositionAfter(text: string, colon: number): boolean {
  let end = skipPositionDigits(text, colon + 1);
  if (end === colon + 1) return false;
  if (text.charCodeAt(end) === COLON) {
    const columnEnd = skipPositionDigits(text, end + 1);
    if (columnEnd === end + 1) return false;
    end = columnEnd;
  }
  if (end >= text.length) return true;
  const code = text.charCodeAt(end);
  return isBlank(code) || isLineEnd(code) || code === CLOSE_PARENTHESIS;
}

/** A key written inside a string whose value must be masked (SR-04, "contains" list plus four). */
function isSensitiveInlineKey(key: string): boolean {
  const normalised = normaliseKey(key);
  return INLINE_SENSITIVE_KEYS.has(normalised) || hasSensitivePart(normalised);
}

/**
 * Masks the value of `key=value`, `key => value`, and `key: value` when the key contains a word
 * of SENSITIVE_KEY_PARTS or equals an entry of INLINE_SENSITIVE_KEYS. Covers `password=...` in
 * free text, URL query parameters (`?token=...&`), JSON-like text (`"apiKey":"..."`), a printed
 * Map entry (`'password' => '...'`), and raw header lines (`Cookie: a=b; c=d`,
 * `Authorization: Basic ...`). Up to MAX_SEPARATOR_BLANKS blanks may stand on either side of the
 * separator (an aligned configuration dump).
 *
 * After `=` and `=>` the value runs to the next blank, `&`, quote, or angle bracket, or to the
 * closing quote when it starts with one. After `:` it runs to the end of the line, because a
 * header value may contain blanks.
 */
function maskKeyValuePairs(text: string): string {
  const length = text.length;
  let output = "";
  let copied = 0;
  let index = 0;

  while (index < length) {
    const separator = text.charCodeAt(index);
    if (separator !== EQUALS && separator !== COLON) {
      index += 1;
      continue;
    }

    // The key, read backwards: optional blanks (a bounded number), an optional (escaped) quote,
    // then key characters (a bounded number). It never reaches back past `copied`, and every
    // separator costs at most a constant number of backward steps, so the pass is linear.
    let keyEnd = index;
    while (
      keyEnd > copied &&
      index - keyEnd < MAX_SEPARATOR_BLANKS &&
      isBlank(text.charCodeAt(keyEnd - 1))
    ) {
      keyEnd -= 1;
    }
    if (keyEnd > copied && isQuote(text.charCodeAt(keyEnd - 1))) {
      keyEnd -= 1;
      if (keyEnd > copied && text.charCodeAt(keyEnd - 1) === BACKSLASH) keyEnd -= 1;
    }
    let keyStart = keyEnd;
    while (
      keyStart > copied &&
      keyEnd - keyStart < MAX_INLINE_KEY_LENGTH &&
      isInlineKeyChar(text.charCodeAt(keyStart - 1))
    ) {
      keyStart -= 1;
    }
    const key = text.slice(keyStart, keyEnd);
    if (key.length === 0 || !isSensitiveInlineKey(key)) {
      index += 1;
      continue;
    }

    // `=>` (a printed Map entry, a PHP or Ruby style dump) is one separator of two characters.
    const isArrow = separator === EQUALS && text.charCodeAt(index + 1) === GREATER_THAN;
    const afterSeparator = isArrow ? index + 2 : index + 1;
    let valueStart = afterSeparator;
    if (separator === COLON) {
      const next = text.charCodeAt(valueStart);
      const isScheme = next === SLASH && text.charCodeAt(valueStart + 1) === SLASH;
      const isFilePosition = FILE_NAME_PATTERN.test(key) && isFilePositionAfter(text, index);
      if (isScheme || isFilePosition) {
        index += 1;
        continue;
      }
    }
    while (
      valueStart < length &&
      valueStart - afterSeparator < MAX_SEPARATOR_BLANKS &&
      isBlank(text.charCodeAt(valueStart))
    ) {
      valueStart += 1;
    }

    let valueEnd = valueStart;
    if (separator === COLON) {
      while (valueEnd < length && !isLineEnd(text.charCodeAt(valueEnd))) valueEnd += 1;
    } else {
      let quoteAt = valueStart;
      if (text.charCodeAt(quoteAt) === BACKSLASH) quoteAt += 1;
      const quote = text.charCodeAt(quoteAt);
      if (quoteAt < length && isQuote(quote)) {
        // A quoted value may contain blanks: mask up to and including the closing quote.
        valueEnd = quoteAt + 1;
        while (valueEnd < length) {
          const code = text.charCodeAt(valueEnd);
          if (isLineEnd(code)) break;
          valueEnd += 1;
          if (code === quote) break;
        }
      } else {
        while (valueEnd < length) {
          const code = text.charCodeAt(valueEnd);
          if (isTokenEnd(code) || code === 38) break;
          valueEnd += 1;
        }
      }
    }
    if (valueEnd === valueStart) {
      index += 1;
      continue;
    }

    output += `${text.slice(copied, valueStart)}${REDACTED}`;
    copied = valueEnd;
    index = valueEnd;
  }
  return copied === 0 ? text : output + text.slice(copied);
}

/**
 * Masks `Bearer <token>` and `Basic <base64>` wherever they stand. Both patterns have bounded
 * quantifiers in front of a single character class, so they cannot backtrack beyond a constant.
 * "Basic" is matched case-sensitively and needs 8 or more base64 characters, to spare prose.
 */
function maskAuthSchemes(text: string): string {
  return text
    .replace(/\bBearer\s{1,8}[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bBasic\s{1,8}[A-Za-z0-9+/=_-]{8,}/g, `Basic ${REDACTED}`);
}

function isEmailLocalChar(code: number): boolean {
  return (
    isLetter(code) ||
    isDigit(code) ||
    code > 127 ||
    code === DOT ||
    code === 95 || // _
    code === 37 || // %
    code === 43 || // +
    code === SINGLE_QUOTE || // o'brien@example.com is a valid address (SR-04, SEC-015)
    code === HYPHEN
  );
}

function isEmailDomainChar(code: number): boolean {
  return isLetter(code) || isDigit(code) || code > 127 || code === DOT || code === HYPHEN;
}

/**
 * Masks email-shaped substrings: a local part, `@`, and a domain with at least one dot whose
 * last label is two or more letters (so `pkg@1.2.3` is left alone). Works outwards from each
 * `@`; the backward walk stops at the end of the previous match and the forward walk is where
 * the search continues, so the pass is linear.
 */
function maskEmails(text: string): string {
  let at = text.indexOf("@");
  if (at === -1) return text;

  const length = text.length;
  let output = "";
  let copied = 0;
  while (at !== -1) {
    let start = at;
    while (start > copied && isEmailLocalChar(text.charCodeAt(start - 1))) start -= 1;
    // An apostrophe in front of the local part is far more often an opening quote
    // (`email: 'a@b.co'`) than part of the address; leaving it in place discloses nothing.
    while (start < at && text.charCodeAt(start) === SINGLE_QUOTE) start += 1;

    let end = at + 1;
    while (end < length && isEmailDomainChar(text.charCodeAt(end))) end += 1;
    const scannedTo = end;
    while (end > at + 1) {
      const code = text.charCodeAt(end - 1);
      if (code !== DOT && code !== HYPHEN) break;
      end -= 1;
    }
    // The last label: letters only, at least two, with a dot in front that is not right after `@`.
    let labelStart = end;
    while (labelStart > at + 1) {
      const code = text.charCodeAt(labelStart - 1);
      if (!isLetter(code) && code <= 127) break;
      labelStart -= 1;
    }
    const isEmail =
      start < at &&
      end - labelStart >= 2 &&
      labelStart - 1 > at + 1 &&
      text.charCodeAt(labelStart - 1) === DOT;

    if (isEmail) {
      output += `${text.slice(copied, start)}${REDACTED}`;
      copied = end;
    }
    at = text.indexOf("@", Math.max(scannedTo, at + 1));
  }
  return copied === 0 ? text : output + text.slice(copied);
}

/** All string masks, in an order in which no mask can undo or re-read another's marker. */
function scrubText(text: string): string {
  return maskEmails(maskAuthSchemes(maskKeyValuePairs(maskUrlUserInfo(text))));
}

/**
 * Where a clipped text must be cut again because the clip may have split something the masks
 * would have recognised in the full string (SR-04, SEC-014). Returns `clipped.length` when the
 * end is harmless. Two shapes are treated as unfinished:
 *
 *   - a URL: the unbroken run that reaches the cut contains a `://`. Whatever its scheme, the
 *     `@` that ends its user-info may lie beyond the cut, so everything after the first `://`
 *     of that run goes;
 *   - an email address: the last `@` lies within CLIP_EMAIL_WINDOW characters of the cut and
 *     only domain characters follow it, so the domain may continue beyond the cut. Its local
 *     part and what follows go.
 *
 * Both walks go backwards from the cut once, so the cost is linear in the clipped length.
 */
function hostileClipBoundary(clipped: string): number {
  const length = clipped.length;

  let runStart = length;
  while (runStart > 0 && !isTokenEnd(clipped.charCodeAt(runStart - 1))) runStart -= 1;
  const scheme = clipped.indexOf("://", runStart);
  if (scheme !== -1) return scheme + 3;

  const at = clipped.lastIndexOf("@");
  if (at === -1 || length - at > CLIP_EMAIL_WINDOW) return length;
  for (let index = at + 1; index < length; index += 1) {
    if (!isEmailDomainChar(clipped.charCodeAt(index))) return length;
  }
  let start = at;
  while (start > 0 && isEmailLocalChar(clipped.charCodeAt(start - 1))) start -= 1;
  return start === at ? length : start;
}

/**
 * Clips to `limit` characters, then scrubs. The clip comes first so the scan is bounded; the
 * cut itself is then treated as hostile (see `hostileClipBoundary`).
 */
function scrubString(value: string, limit: number = MAX_STRING_LENGTH): string {
  if (value.length <= limit) return scrubText(value);
  const clipped = value.slice(0, limit);
  const boundary = hostileClipBoundary(clipped);
  if (boundary === clipped.length) return `${scrubText(clipped)}${TRUNCATED}`;
  return `${scrubText(clipped.slice(0, boundary))}${REDACTED}${TRUNCATED}`;
}

// ---------------------------------------------------------------------------
// Structure walk.
// ---------------------------------------------------------------------------

interface Budget {
  /** Values that may still be visited. */
  nodes: number;
  /** Characters of strings and keys that may still be copied. */
  chars: number;
}

function exhausted(budget: Budget): boolean {
  return budget.nodes <= 0 || budget.chars <= 0;
}

function scrubWithinBudget(value: string, limit: number, budget: Budget): string {
  if (budget.chars <= 0) return TRUNCATED;
  const allowed = Math.min(limit, budget.chars);
  budget.chars -= Math.min(value.length, allowed);
  return scrubString(value, allowed);
}

function sanitise(value: unknown, ancestors: object[], budget: Budget): unknown {
  if (budget.nodes <= 0) return TRUNCATED;
  budget.nodes -= 1;

  switch (typeof value) {
    case "string":
      return scrubWithinBudget(value, MAX_STRING_LENGTH, budget);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
      return undefined;
    case "symbol":
      return scrubWithinBudget(value.toString(), MAX_KEY_LENGTH, budget);
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
  // A URL goes through the same string masks as any other text (user-info, query parameters).
  if (object instanceof URL) return scrubWithinBudget(object.href, MAX_STRING_LENGTH, budget);
  // Raw bytes are never useful in a log line and may be a payload.
  if (ArrayBuffer.isView(object)) return `[Binary ${object.byteLength} bytes]`;
  if (object instanceof ArrayBuffer) return `[Binary ${object.byteLength} bytes]`;

  ancestors.push(object);
  try {
    if (Array.isArray(object)) return sanitiseList(object, object.length, ancestors, budget);
    if (object instanceof Set) return sanitiseList(object, object.size, ancestors, budget);
    if (object instanceof Map) return sanitiseEntries(object, ancestors, budget);
    // Headers and query parameters are name/value collections: each name is checked like an
    // object key (so `cookie`, `authorization`, `x-forwarded-for`, `token` are redacted) and
    // each value is scrubbed like any string.
    if (object instanceof Headers || object instanceof URLSearchParams) {
      return sanitiseEntries(object, ancestors, budget);
    }
    return sanitiseObject(object, ancestors, budget);
  } finally {
    ancestors.pop();
  }
}

function sanitiseList(
  items: Iterable<unknown>,
  size: number,
  ancestors: object[],
  budget: Budget,
): unknown[] {
  const output: unknown[] = [];
  for (const item of items) {
    if (output.length >= MAX_ARRAY_ITEMS || exhausted(budget)) break;
    output.push(sanitise(item, ancestors, budget));
  }
  if (output.length < size) output.push(TRUNCATED);
  return output;
}

/** Writes one key of an output object, applying key redaction, key scrubbing, and the budget. */
function setEntry(
  output: Record<string, unknown>,
  key: string,
  read: () => unknown,
  ancestors: object[],
  budget: Budget,
): void {
  // Keys can hold data too (an email used as a map key), so they are scrubbed like values.
  // "__proto__" as a key would set the prototype of `output` instead of a property.
  const scrubbed = scrubWithinBudget(key, MAX_KEY_LENGTH, budget);
  const safeKey = scrubbed === "__proto__" ? "[__proto__]" : scrubbed;
  if (isSensitiveKey(key)) {
    output[safeKey] = REDACTED;
    return;
  }
  try {
    output[safeKey] = sanitise(read(), ancestors, budget);
  } catch {
    output[safeKey] = "[Unserializable]";
  }
}

function sanitiseEntries(
  entries: Iterable<[unknown, unknown]>,
  ancestors: object[],
  budget: Budget,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of entries) {
    if (count >= MAX_OBJECT_KEYS || exhausted(budget)) {
      output[TRUNCATED] = true;
      break;
    }
    const label =
      typeof key === "string"
        ? key
        : key === null || (typeof key !== "object" && typeof key !== "function")
          ? String(key)
          : `[Key ${count}]`;
    setEntry(output, label, () => value, ancestors, budget);
    count += 1;
  }
  return output;
}

function sanitiseObject(
  object: object,
  ancestors: object[],
  budget: Budget,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const isError = object instanceof Error;
  if (isError) {
    // name, message, stack, and cause are usually not enumerable, so copy them explicitly.
    // An Error's own `name` is its class, not a person's name, and stays visible (SR-04).
    output.name = scrubWithinBudget(String(object.name), MAX_KEY_LENGTH, budget);
    output.message = scrubWithinBudget(String(object.message), MAX_STRING_LENGTH, budget);
    if (typeof object.stack === "string") {
      output.stack = scrubWithinBudget(object.stack, MAX_STRING_LENGTH, budget);
    }
    if (object.cause !== undefined) output.cause = sanitise(object.cause, ancestors, budget);
  }

  const record = object as Record<string, unknown>;
  let count = 0;
  for (const key of Object.keys(object)) {
    // Already written above; AppError, for one, sets `name` as an own enumerable property.
    if (isError && (key === "name" || key === "message" || key === "stack" || key === "cause")) {
      continue;
    }
    if (count >= MAX_OBJECT_KEYS || exhausted(budget)) {
      output[TRUNCATED] = true;
      break;
    }
    setEntry(output, key, () => record[key], ancestors, budget);
    count += 1;
  }
  return output;
}

/**
 * Returns a JSON-safe copy of `value` with sensitive values replaced. Never throws.
 * One call has one budget (MAX_ENTRY_NODES, MAX_ENTRY_CHARS).
 */
export function redact(value: unknown): unknown {
  try {
    return sanitise(value, [], { nodes: MAX_ENTRY_NODES, chars: MAX_ENTRY_CHARS });
  } catch {
    return "[Unserializable]";
  }
}

/**
 * Characters that JSON.stringify leaves raw but that must not reach a log viewer or a terminal
 * as they are (SR-04 as widened on 2026-10-11; SEC-007, SEC-016):
 *
 *   - U+007F to U+009F: DEL and the C1 controls. U+0085 is a line break for some viewers and
 *     U+009B starts a terminal escape sequence on terminals that honour 8-bit controls;
 *   - U+2028 and U+2029: line and paragraph separators;
 *   - every character of Unicode general category Cf (format): the soft hyphen, the Arabic
 *     letter mark, zero-width characters and direction marks, all bidirectional controls, the
 *     invisible operators, the byte order mark, annotation anchors, and the tag characters.
 *     They can reorder a line visually or hide text from a human reader.
 *
 * Inclusive code point ranges; the pattern is built from numbers so that this source file never
 * contains one of these characters itself. The pattern has the `u` flag, so a match is one whole
 * code point, and the category escape keeps the list current with the runtime's Unicode data.
 */
const UNSAFE_OUTPUT_RANGES: readonly (readonly [number, number])[] = [
  [0x7f, 0x9f],
  [0x2028, 0x2029],
];

function unicodeEscape(code: number): string {
  return `${"\\"}u${code.toString(16).padStart(4, "0")}`;
}

const UNSAFE_OUTPUT_CHARACTERS = new RegExp(
  `[${UNSAFE_OUTPUT_RANGES.map(([from, to]) => `${unicodeEscape(from)}-${unicodeEscape(to)}`).join("")}${"\\"}p{Cf}]`,
  "gu",
);

/**
 * Safe on a whole JSON text: these characters can only occur inside its string literals.
 * A character outside the Basic Multilingual Plane becomes its two surrogate escapes, which a
 * JSON parser reads back as the original character.
 */
function escapeUnsafeCharacters(json: string): string {
  return json.replace(UNSAFE_OUTPUT_CHARACTERS, (character) => {
    let escaped = "";
    for (let index = 0; index < character.length; index += 1) {
      escaped += unicodeEscape(character.charCodeAt(index));
    }
    return escaped;
  });
}

function writeToStdout(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The level of a logger that was given none, and of the process-wide logger until it is set. */
export const DEFAULT_LOG_LEVEL: LogLevel = "info";

/** The level of one logger and of every child made from it. Read at each line, so it can change. */
interface LevelCell {
  current: LogLevel;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return buildLogger(options, { current: options.level ?? DEFAULT_LOG_LEVEL });
}

function buildLogger(options: Omit<LoggerOptions, "level">, levelCell: LevelCell): Logger {
  const write = options.write ?? writeToStdout;
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};
  const requestId = options.requestId;

  function emit(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[levelCell.current]) return;
    let line: string;
    try {
      const safeFields = redact({ ...bindings, ...fields });
      line = escapeUnsafeCharacters(
        JSON.stringify({
          ...(safeFields !== null && typeof safeFields === "object" ? safeFields : {}),
          level,
          timestamp: now().toISOString(),
          message: scrubString(String(message)),
          ...(requestId === undefined ? {} : { requestId: scrubString(requestId) }),
        }),
      );
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
      // The child shares the parent's level cell: a level set later reaches it as well.
      return buildLogger(
        {
          write,
          now,
          requestId: childRequestId ?? requestId,
          bindings: { ...bindings, ...rest },
        },
        levelCell,
      );
    },
  };
}

/** The level of the process-wide logger. Module state: importing this file reads no variable. */
const processLevel: LevelCell = { current: DEFAULT_LOG_LEVEL };

/**
 * Process-wide logger. Use `logger.child({ requestId })` inside a request.
 *
 * Its level is DEFAULT_LOG_LEVEL until `setLogLevel` is called. This module never reads the
 * environment, at import or later: src/server/env.ts is the one place that does, and it imports
 * this module, so the validated `LOG_LEVEL` is handed over by a call, not fetched from here.
 */
export const logger: Logger = buildLogger({}, processLevel);

/**
 * Sets the level of the process-wide logger and of every child made from it, before or after
 * this call. For the server's start-up code, with the validated `LOG_LEVEL`
 * (`getEnv().logLevel` of src/server/env.ts). A logger made with `createLogger` is not affected.
 *
 * A value that is not a level is a programming error and throws a TypeError; the level is left
 * as it was. The message names nothing of the value.
 */
export function setLogLevel(level: LogLevel): void {
  if (typeof level !== "string" || !Object.hasOwn(LEVEL_ORDER, level)) {
    throw new TypeError("setLogLevel: the level must be debug, info, warn, or error.");
  }
  processLevel.current = level;
}

/** The current level of the process-wide logger. */
export function getLogLevel(): LogLevel {
  return processLevel.current;
}
