/**
 * Response envelope helpers (docs/API_CONTRACTS.md, "Conventions").
 *
 *   success: { "data": ... }
 *   list:    { "data": [...], "meta": { page, pageSize, total, totalPages } }
 *   error:   { "error": { code, message, details, requestId } }
 *
 * Every response carries the request id header and `Cache-Control: no-store`
 * (SEC-006). Only an endpoint that docs/API_CONTRACTS.md documents as public and
 * cacheable passes `cacheControl` to a success helper; error responses are never
 * storable.
 *
 * Handler pattern for a mutation with a JSON body. The order of the calls is the order of
 * refusals of docs/API_CONTRACTS.md section 1.8 (D-031 point 4 as amended by D-032 point 1;
 * SECURITY.md SR-05 item 5) and is not a matter of taste: the first check that fails gives the
 * answer, and no body is read for a caller who is going to be refused. `proxyConfig` is the
 * validated SR-01 configuration and `appOrigin` the validated `APP_URL`, both passed in by the
 * caller; nothing in this module reads the environment. The example is an endpoint of access
 * `seller` that has a rate limit:
 *
 *   const requestId = resolveRequestId(request, {
 *     trustIncoming: trustsIncomingRequestId(proxyConfig),
 *   });
 *   const log = logger.child({ requestId });
 *   try {
 *     assertSameOrigin(request, appOrigin); // step 1: 403 FORBIDDEN
 *     assertContentType(request, JSON_CONTENT_TYPE); // step 2: 415 UNSUPPORTED_MEDIA_TYPE
 *     const actor = await requireActor(request); // step 3: 401 UNAUTHENTICATED
 *     assertRole(actor, "SELLER"); // step 4: 403 FORBIDDEN
 *     assertStoreApproved(actor); // step 4, access `seller` only: 403 SELLER_NOT_APPROVED
 *     const limit = await rateLimiter.consume(actor.userId, RATE_LIMITS.<RULE>); // step 5
 *     if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds); // 429 RATE_LIMITED
 *     const body = await readJsonBody(request); // step 6: 413; a body that is not JSON: 400
 *     const input = parseInput(bodySchema, body); // step 7: 400 VALIDATION_ERROR
 *     return ok(await service(actor, input), { requestId }); // steps 8 to 10, in the service
 *   } catch (error) {
 *     return errorResponse(error, { requestId, logger: log });
 *   }
 *
 * What the pattern fixes:
 *
 *   - Steps 1 to 5 use the headers and the session only. Nothing before `readJsonBody` may touch
 *     the body, and nothing before the service may look up the resource an id names.
 *   - Step 2 is called by the handler itself, although `readJsonBody` checks the content type
 *     again: a wrong content type is 415 for everyone, also for a caller without a session.
 *   - Steps 3 and 4 belong to auth (`src/server/auth/**`, T-015; no guard exists yet).
 *     `requireActor` is its name in the documents; `assertRole` and `assertStoreApproved` stand
 *     here for the role helper (role only) and the second pure helper that judges the store
 *     status, whose names auth chooses. The role is judged first. An endpoint of access
 *     `seller (any store status)` calls the role helper alone; a `public` endpoint skips steps 3
 *     and 4.
 *   - Step 5 only on an endpoint that has a limit (docs/SECURITY.md, SR-02). The subject is
 *     `actor.userId` and nothing else; on a `public` endpoint that takes a body (sign-up,
 *     sign-in) it is the client address, still before the body is read. A request that reaches
 *     this step uses one allowance whatever happens afterwards.
 *   - Step 7 also covers the path parameters, the query, and the required headers: parse them
 *     here, after the body was read (a request that is too large is 413 even when a header or a
 *     parameter is invalid as well). Validation makes no database query.
 *   - The service checks role, store status, and ownership again (steps 8 and 9). The checks of
 *     the handler are refusals made sooner, never the control.
 *   - A mutation without a body ends after step 5 and calls the service; it never reads a body.
 *     A `GET` or `HEAD` skips steps 1, 2, and 6: `requireActor`, the access level, the rate
 *     limit where there is one, then `parseInput` on the path parameters and the query.
 *
 * Never call `request.json()`, `request.text()`, `request.formData()`, `request.arrayBuffer()`,
 * or `request.blob()` in a handler (security rule SR-05): they hold a body of any size in
 * memory, and a body that is not valid JSON makes `request.json()` throw a SyntaxError, which
 * `errorResponse` would turn into a 500 with an error-level log line per request.
 * `readJsonBody` checks the content type first (415), reads at most a fixed number of bytes
 * (413), and maps a body that is not valid UTF-8, is not valid JSON, nests too deep, or holds a
 * string that is not well-formed Unicode to 400 VALIDATION_ERROR.
 *
 * Validation errors: only request input becomes 400 VALIDATION_ERROR, and only
 * because the handler says so, by calling `readJsonBody`, `parseInput` (or
 * `safeParse` followed by `throw fromZodError(result.error)`), or `invalidHeader`.
 * A ZodError that reaches `errorResponse` in any other way (a service parsing a
 * database JSON column, a provider response, or settings) is a server fault: it
 * becomes 500 INTERNAL_ERROR, is logged, and nothing about it is sent to the client.
 */
import type { ZodType } from "zod";

import {
  type AppError,
  type ErrorCode,
  describeErrorForLog,
  type ErrorDetails,
  forbidden,
  fromZodError,
  internalError,
  invalidJsonBody,
  isAppError,
  jsonBodyTooDeep,
  jsonStringNotWellFormed,
  payloadTooLarge,
  RateLimitedError,
  requestBodyAborted,
  RequestBodyAbortedError,
  unsupportedMediaType,
} from "./errors";
import type { Logger } from "./logger";
import { REQUEST_ID_HEADER } from "./request-id";

export const CACHE_CONTROL_HEADER = "Cache-Control";
/** The default for every envelope response: no browser, proxy, or CDN may store it. */
export const NO_STORE = "no-store";

export interface ResponseContext {
  requestId: string;
  /**
   * Extra response headers. The request id header and `Cache-Control` cannot be set here:
   * both are always written by this module (use `cacheControl` on a success helper).
   */
  headers?: HeadersInit;
}

export interface SuccessContext extends ResponseContext {
  /**
   * `Cache-Control` value for an endpoint that docs/API_CONTRACTS.md documents as public and
   * cacheable. Default "no-store". Never set it on a response that depends on who is asking.
   */
  cacheControl?: string;
}

export interface SuccessBody<T> {
  data: T;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedBody<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details: ErrorDetails;
    requestId: string;
  };
}

function buildHeaders(context: ResponseContext, cacheControl: string = NO_STORE): Headers {
  const headers = new Headers(context.headers);
  headers.set(REQUEST_ID_HEADER, context.requestId);
  headers.set(CACHE_CONTROL_HEADER, cacheControl);
  return headers;
}

/** `{ data }` with status 200 unless another success status is given. */
export function ok<T>(data: T, context: SuccessContext & { status?: number }): Response {
  const body: SuccessBody<T> = { data };
  return Response.json(body, {
    status: context.status ?? 200,
    headers: buildHeaders(context, context.cacheControl),
  });
}

/** `{ data }` with status 201. */
export function created<T>(data: T, context: SuccessContext): Response {
  return ok(data, { ...context, status: 201 });
}

export function paginationMeta(input: {
  page: number;
  pageSize: number;
  total: number;
}): PaginationMeta {
  const { page, pageSize, total } = input;
  return { page, pageSize, total, totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 0 };
}

/** `{ data, meta }` for list endpoints. `total` is the unpaginated row count. */
export function paginated<T>(
  items: readonly T[],
  page: { page: number; pageSize: number; total: number },
  context: SuccessContext,
): Response {
  const body: PaginatedBody<T> = { data: [...items], meta: paginationMeta(page) };
  return Response.json(body, {
    status: 200,
    headers: buildHeaders(context, context.cacheControl),
  });
}

/** The two content types a mutation may accept (docs/API_CONTRACTS.md, "Content type"). */
export const JSON_CONTENT_TYPE = "application/json";
export const MULTIPART_CONTENT_TYPE = "multipart/form-data";
export type MutationContentType = typeof JSON_CONTENT_TYPE | typeof MULTIPART_CONTENT_TYPE;

/** Methods that never change state and are therefore exempt from the `Origin` check (TM-16). */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * CSRF check of TM-16 (docs/SECURITY.md) and the "Origin" convention of docs/API_CONTRACTS.md:
 * a state-changing request must carry an `Origin` header equal to the application origin.
 * Throws 403 FORBIDDEN when the header is missing, is `null`, is repeated, or names any other
 * origin. `GET` and `HEAD` are not checked; every other method is (`POST`, `PATCH`, `PUT`,
 * `DELETE`, and anything unexpected, so that an unknown method fails closed).
 *
 * `allowedOrigin` is the validated `APP_URL`, passed in by the caller; this function never
 * reads the environment. Only its origin (scheme, host, port) is compared, so a trailing slash
 * or a path in `APP_URL` does not matter. The comparison is exact: no case folding, no
 * sub-domain, prefix, or suffix matching, and the header is never parsed. A value that is not
 * an absolute http or https URL is a configuration fault and throws a TypeError, which
 * `errorResponse` turns into a 500: the check never passes by accident.
 *
 * Call it inside the handler's `try`, before the body is read and before any work is done.
 * An `Origin` failure is a security event (SR-04): the caller may log it with `clientIp`.
 */
export function assertSameOrigin(request: Request, allowedOrigin: string): void {
  let expected: string;
  try {
    const url = new URL(allowedOrigin);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("scheme");
    expected = url.origin;
  } catch {
    throw new TypeError("allowedOrigin must be an absolute http or https URL.");
  }
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  if (request.headers.get("origin") !== expected) {
    throw forbidden({ message: "The request origin is not allowed." });
  }
}

/**
 * Content-type check for a mutation (TM-16; docs/API_CONTRACTS.md, "Content type"): the request
 * must declare exactly `expected`, otherwise 415 UNSUPPORTED_MEDIA_TYPE. Only the media type is
 * compared, case-insensitively and without its parameters (`application/json; charset=utf-8`
 * and the `boundary` of `multipart/form-data` are fine). A missing header is refused.
 *
 * Reads the header only, never the body, so it runs before the body is read. `readJsonBody`
 * calls it for JSON; the upload handler calls it with MULTIPART_CONTENT_TYPE.
 */
export function assertContentType(request: Request, expected: MutationContentType): void {
  const header = request.headers.get("content-type") ?? "";
  const end = header.indexOf(";");
  const mediaType = (end === -1 ? header : header.slice(0, end)).trim().toLowerCase();
  if (mediaType !== expected) {
    throw unsupportedMediaType({ message: `The content type must be ${expected}.` });
  }
}

/** Default byte limit of a JSON request body: 100 KiB (security rule SR-05). */
export const DEFAULT_JSON_BODY_LIMIT_BYTES = 102_400;
/** The most an endpoint may ask for: 1 MiB. Nothing above it is read as JSON (SR-05). */
export const MAX_JSON_BODY_LIMIT_BYTES = 1_048_576;

export interface ReadJsonBodyOptions {
  /**
   * Largest accepted body in bytes. Default DEFAULT_JSON_BODY_LIMIT_BYTES. An endpoint that
   * needs more passes its limit here, at most MAX_JSON_BODY_LIMIT_BYTES, and states it in its
   * entry in docs/API_CONTRACTS.md.
   */
  maxBytes?: number;
}

const CONTENT_LENGTH_PATTERN = /^[0-9]+$/;
/** Digits of MAX_JSON_BODY_LIMIT_BYTES: a longer declared length is over every limit. */
const MAX_CONTENT_LENGTH_DIGITS = 7;

/**
 * True when the `Content-Length` header allows the body to be read: it is absent, or it is a
 * plain decimal number of at most `maxBytes`. Signs, blanks inside the value, fractions,
 * exponents, hexadecimal, and a list of values (a repeated header) are all refused. Leading
 * zeros are removed before the digits are counted, so a long run of digits is never converted
 * to a number.
 */
function contentLengthAllows(request: Request, maxBytes: number): boolean {
  const header = request.headers.get("content-length");
  if (header === null) return true;
  if (!CONTENT_LENGTH_PATTERN.test(header)) return false;
  const digits = header.replace(/^0+/, "");
  if (digits.length > MAX_CONTENT_LENGTH_DIGITS) return false;
  return Number(digits) <= maxBytes;
}

/** First size of the buffer a body is copied into; it grows from here up to the limit. */
const INITIAL_BODY_BUFFER_BYTES = 4_096;

/**
 * How many chunks with no bytes one body may contain before the read is refused (SR-05 item 9,
 * SEC-021). Fixed, whatever the byte limit of the call: together with the byte limit it bounds
 * the number of reads of one body to `maxBytes + MAX_EMPTY_BODY_CHUNKS + 2`.
 */
export const MAX_EMPTY_BODY_CHUNKS = 200_000;

/**
 * The length of a typed array as the engine knows it, read through the built-in getter of
 * `%TypedArray%.prototype`. A subclass of `Uint8Array` can define a `byteLength` of its own
 * that reports anything (SEC-021); it cannot change what this returns, which is also the number
 * of bytes that `set` copies. No code of the chunk runs.
 */
const realByteLength: (chunk: Uint8Array) => number = (() => {
  const getter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype) as object,
    "byteLength",
  )?.get;
  if (getter === undefined) throw new TypeError("The typed array length getter is missing.");
  return (chunk: Uint8Array): number => Reflect.apply(getter, chunk, []) as number;
})();

/**
 * Reads the body as a stream with a running byte count and stops as soon as the count passes
 * `maxBytes` (`Content-Length` can be absent or untrue). At most one chunk beyond the limit is
 * taken from the stream; the rest is cancelled, not buffered. Returns undefined when the body
 * is over the limit.
 *
 * Memory is in proportion to the limit, not to the number of chunks (SR-05 item 8, SEC-020;
 * the sender chooses the chunk sizes and can send one byte per chunk):
 *   - each chunk is copied into one buffer and dropped. The buffer starts small, at least
 *     doubles when it is full, and never grows past `maxBytes`;
 *   - a chunk with no bytes is skipped: nothing is kept for it;
 *   - a chunk that is not a `Uint8Array` cannot be counted. It is a server fault: the stream is
 *     cancelled and a TypeError is thrown at once (a 500 through `errorResponse`). The message
 *     names nothing of the chunk;
 *   - a cancellation is started and never awaited, so no answer waits for a source that does
 *     not confirm it.
 *
 * The read ends (SR-05 item 9, SEC-021):
 *   - the count uses the real length of each chunk (`realByteLength`), never the `byteLength`
 *     the chunk reports, so the count and the copy always agree and a subclass that reports
 *     `NaN` or too little is counted for what it holds;
 *   - chunks with no bytes are counted over the whole body. One more than
 *     MAX_EMPTY_BODY_CHUNKS is a server fault like a chunk that is not bytes (no body that
 *     arrives from the network is made of them): the stream is cancelled and a TypeError is
 *     thrown.
 *
 * A source that fails (SR-05 item 10, SEC-024): when a read of the stream rejects, the body
 * stopped arriving (the connection broke, the request was aborted, the body ended before its
 * declared length). That is the client's doing: `requestBodyAborted` is thrown, a client error
 * that keeps neither the source's error nor anything of the bytes read so far. Every rejection
 * of a read is treated this way, because it cannot be attributed with certainty. The two
 * refusals above are the reader's own and stay server faults.
 *
 * The result is a view of the buffer, exactly as long as the body.
 */
async function readBytesUpTo(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const reader = body.getReader();
  // The refusal stands whether or not the source accepts, or ever confirms, the cancellation.
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  let buffer = new Uint8Array(Math.min(maxBytes, INITIAL_BODY_BUFFER_BYTES));
  let total = 0;
  let emptyChunks = 0;
  for (;;) {
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } catch (error) {
      // Only the class name and the code of `error` are copied; the error itself is dropped.
      throw requestBodyAborted(error);
    }
    if (result.done) break;
    // The type says bytes; a stream can still hand over anything, so it is checked.
    const chunk: unknown = result.value;
    if (!(chunk instanceof Uint8Array)) {
      cancel();
      throw new TypeError("readJsonBody: the request body produced a chunk that is not bytes.");
    }
    const chunkBytes = realByteLength(chunk);
    if (chunkBytes === 0) {
      emptyChunks += 1;
      if (emptyChunks > MAX_EMPTY_BODY_CHUNKS) {
        cancel();
        throw new TypeError("readJsonBody: the request body produced too many empty chunks.");
      }
      continue;
    }
    const needed = total + chunkBytes;
    if (needed > maxBytes) {
      cancel();
      return undefined;
    }
    if (needed > buffer.byteLength) {
      const grown = new Uint8Array(Math.min(maxBytes, Math.max(buffer.byteLength * 2, needed)));
      grown.set(buffer.subarray(0, total));
      buffer = grown;
    }
    buffer.set(chunk, total);
    total = needed;
  }
  return buffer.subarray(0, total);
}

/**
 * How deep a JSON body may nest arrays and objects (SR-05 item 12, SEC-023; D-032 point 4). A
 * scalar is depth 0, `[]` is 1, `[{}]` is 2. Changing the number is a change of SR-05.
 */
export const MAX_JSON_NESTING_DEPTH = 32;

const CODE_DOUBLE_QUOTE = 34;
const CODE_BACKSLASH = 92;
const CODE_OPEN_BRACKET = 91;
const CODE_CLOSE_BRACKET = 93;
const CODE_OPEN_BRACE = 123;
const CODE_CLOSE_BRACE = 125;

/**
 * True when `text` opens more than `maxDepth` arrays and objects inside one another. One pass
 * from left to right, no recursion, no allocation: the cost is in proportion to the length of
 * the text, and the pass stops at the bracket that exceeds the limit.
 *
 * Brackets inside a string literal do not count; inside a string a backslash takes the next
 * character with it, so an escaped quote does not end the string. For a text that is valid JSON
 * the answer is exact. For any other text it is the answer for the brackets as written: such a
 * text is refused either here or by the parser, with 400 in both cases.
 */
function nestsDeeperThan(text: string, maxDepth: number): boolean {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (inString) {
      if (code === CODE_BACKSLASH) index += 1;
      else if (code === CODE_DOUBLE_QUOTE) inString = false;
    } else if (code === CODE_DOUBLE_QUOTE) {
      inString = true;
    } else if (code === CODE_OPEN_BRACKET || code === CODE_OPEN_BRACE) {
      depth += 1;
      if (depth > maxDepth) return true;
    } else if ((code === CODE_CLOSE_BRACKET || code === CODE_CLOSE_BRACE) && depth > 0) {
      depth -= 1;
    }
  }
  return false;
}

/**
 * True when `value`, as `JSON.parse` returned it, holds a string that is not well-formed
 * Unicode: a surrogate half without its other half, in a string value or in an object key, at
 * any depth (SR-05 item 11, SEC-028). The bytes of a body are strict UTF-8 and cannot carry
 * such a string, but an escape can: `"\ud83d"` is valid JSON in plain ASCII.
 *
 * No recursion: the arrays and objects still to be looked at are kept on a list. Every array,
 * object, key, and string is looked at once and `isWellFormed` is one pass over its string, so
 * the cost is in proportion to the size of the document, which the byte limit bounds. Numbers,
 * booleans, and `null` are passed over where they stand and never put on the list. The walk
 * stops at the first such string, and nothing of it is kept.
 *
 * Written for what `JSON.parse` returns: plain arrays and plain objects with own data
 * properties, a tree with no value shared between two places. It runs no code of the value.
 */
function holdsStringNotWellFormed(value: unknown): boolean {
  if (typeof value === "string") return !value.isWellFormed();
  if (typeof value !== "object" || value === null) return false;

  const pending: object[] = [value];
  /** Judges one child: a string at once, an array or object later. True when it is refused. */
  const refuses = (child: unknown): boolean => {
    if (typeof child === "string") return !child.isWellFormed();
    if (typeof child === "object" && child !== null) pending.push(child);
    return false;
  };
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (Array.isArray(node)) {
      const items: readonly unknown[] = node;
      for (let index = 0; index < items.length; index += 1) {
        if (refuses(items[index])) return true;
      }
    } else {
      const record = node as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (!key.isWellFormed() || refuses(record[key])) return true;
      }
    }
  }
  return false;
}

/**
 * Reads the JSON body of a mutation. The one way a handler reads a JSON body (SR-05), in this
 * order:
 *
 *   1. a content type other than `application/json` is 415 UNSUPPORTED_MEDIA_TYPE, decided
 *      before the body is read;
 *   2. a `Content-Length` that is larger than the limit, or that is not a plain decimal number,
 *      is 413 PAYLOAD_TOO_LARGE, also before the body is read;
 *   3. the body is read as a stream while its bytes are counted; reading stops and the answer is
 *      413 PAYLOAD_TOO_LARGE as soon as the count passes the limit, so a missing or untrue
 *      `Content-Length` does not help. The limit is in bytes, not characters;
 *   4. the bytes are decoded strictly as UTF-8. A body with a byte sequence that is not valid
 *      UTF-8 is refused like a body that is not JSON (item 6); it is never repaired with
 *      replacement characters (SR-05 item 11, SEC-022). A leading byte order mark is removed;
 *   5. a body that nests arrays and objects more than MAX_JSON_NESTING_DEPTH levels deep is 400
 *      VALIDATION_ERROR (SR-05 item 12, SEC-023), decided before the parser sees the text, so a
 *      text that is too deep and also not valid JSON gets this answer. Its field error is
 *      `jsonBodyTooDeep` in src/server/errors.ts, whose `code` is provisional
 *      (docs/API_CONTRACTS.md item 8.2-12);
 *   6. a body that is not valid JSON (an empty body included) is 400 VALIDATION_ERROR with
 *      `details.fields = [{ path: "", code: "invalid_json", message }]`;
 *   7. a body that parses but holds a string that is not well-formed Unicode (a surrogate half
 *      without its other half, written as a `\u` escape), in a value or in a key, is 400
 *      VALIDATION_ERROR (SR-05 item 11, SEC-028): what would later be stored for it is U+FFFD,
 *      a text the client did not send. It is never repaired and never handed out. Its field
 *      error is `jsonStringNotWellFormed` in src/server/errors.ts, whose `code` is provisional
 *      (docs/API_CONTRACTS.md item 8.2-12). A complete pair written as two escapes is ordinary
 *      text.
 *
 * 413 and 400 are ordinary client errors: nothing is logged, nothing of the body is kept, and
 * the decoder's and the parser's errors (the parser's message quotes a piece of the body) are
 * neither sent nor kept as a cause.
 *
 * A body that stops arriving while it is read is a client error as well, `requestBodyAborted`
 * (SR-05 item 10, SEC-024; its status and code are provisional, docs/API_CONTRACTS.md item
 * 8.2-13). `errorResponse` writes one warn-level line for it, without a stack.
 *
 * The limit is `options.maxBytes`, by default DEFAULT_JSON_BODY_LIMIT_BYTES. A `maxBytes` that
 * is not a positive integer of at most MAX_JSON_BODY_LIMIT_BYTES is a programming error and
 * throws a TypeError before anything else is looked at, so it fails on every request and in
 * every test, not only for a large body.
 *
 * Any other failure (the body was already read, a chunk that is not bytes, too many empty
 * chunks) is a server fault: it is passed on unchanged and becomes a 500. The result is
 * `unknown`: pass it to `parseInput`.
 */
export async function readJsonBody(
  request: Request,
  options: ReadJsonBodyOptions = {},
): Promise<unknown> {
  // Only an absent option means the default; null or any other value is checked below.
  const maxBytes =
    options.maxBytes === undefined ? DEFAULT_JSON_BODY_LIMIT_BYTES : options.maxBytes;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_JSON_BODY_LIMIT_BYTES) {
    throw new TypeError(
      `readJsonBody: maxBytes must be an integer from 1 to ${MAX_JSON_BODY_LIMIT_BYTES}.`,
    );
  }
  assertContentType(request, JSON_CONTENT_TYPE);
  if (!contentLengthAllows(request, maxBytes)) throw payloadTooLarge();
  if (request.bodyUsed) throw new TypeError("readJsonBody: the request body was already read.");

  const bytes =
    request.body === null ? new Uint8Array(0) : await readBytesUpTo(request.body, maxBytes);
  if (bytes === undefined) throw payloadTooLarge();

  // Strict UTF-8 (SEC-022): an invalid sequence throws instead of becoming U+FFFD. A leading
  // byte order mark is removed, as `request.json()` does. The decoder's error is not kept.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw invalidJsonBody();
  }
  if (nestsDeeperThan(text, MAX_JSON_NESTING_DEPTH)) {
    throw jsonBodyTooDeep(MAX_JSON_NESTING_DEPTH);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof Error && error.name === "SyntaxError") throw invalidJsonBody();
    throw error;
  }
  // SEC-028: the parsed value is at most MAX_JSON_NESTING_DEPTH deep and no larger than the
  // byte limit allows. The walk is iterative all the same, so it depends on neither.
  if (holdsStringNotWellFormed(parsed)) throw jsonStringNotWellFormed();
  return parsed;
}

/**
 * The cause of the 500 that `parseInput` throws when the schema throws. The log records only
 * its class name (SEC-048), so the name itself says what went wrong. What the schema threw is
 * kept as its `cause`, in memory only.
 */
export class ParseInputSchemaError extends Error {
  constructor(cause: unknown) {
    super(
      "parseInput: the schema threw instead of returning a result. A schema with an async " +
        "refinement or transform is not supported here, and a refinement must not throw.",
      { cause },
    );
    this.name = "ParseInputSchemaError";
  }
}

/**
 * Validates request input (a body, a query, path parameters, or headers) against `schema`.
 * Returns the parsed value, or throws 400 VALIDATION_ERROR with `details.fields`.
 * This is the explicit conversion that makes a schema failure the client's fault; use it for
 * request input only, never for data the server read from somewhere else.
 *
 * A schema with an async refinement or an async transform is not supported: parsing here is
 * synchronous. Such a schema, or one whose refinement throws, is a server fault and becomes
 * 500 INTERNAL_ERROR whose cause is a ParseInputSchemaError, the class name the log shows; move
 * the asynchronous check (for example a uniqueness lookup) into the service.
 */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  let result: ReturnType<typeof schema.safeParse>;
  try {
    result = schema.safeParse(input);
  } catch (error) {
    throw internalError(new ParseInputSchemaError(error));
  }
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}

/**
 * Normalises anything thrown into an AppError.
 * An AppError passes through. Everything else, a ZodError included, becomes a generic
 * INTERNAL_ERROR (see "Validation errors" above) whose cause is `describeErrorForLog(error)`:
 * the class name, and a status and a code of the right form, never the message or the stack
 * (SEC-048; SECURITY.md SR-04). The original is not kept.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return internalError(describeErrorForLog(error));
}

export function errorBody(error: AppError, requestId: string): ErrorBody {
  return { error: { ...error.toPublic(), requestId } };
}

/**
 * Maps anything thrown to the error envelope. Unknown values produce a generic
 * 500 whose body contains nothing from the original error. The response is always
 * `Cache-Control: no-store`.
 *
 * When a logger is given (it redacts what it writes, see src/server/logger.ts):
 *   - a 5xx is logged at error level with `describeErrorForLog` of its cause (of the AppError
 *     itself when it has none);
 *   - a 4xx that carries a `cause` is logged at warn level with `describeErrorForLog` of that
 *     cause, because the service attached it for the operator (for example the database error
 *     behind a CONFLICT, recorded as its class and its code `P2002`);
 *   - in both, what is logged of the error is its class name, status, and code only: never a
 *     message, a stack, or a nested cause, whoever threw it (SEC-048, SR-04). A message of a
 *     library or of the database client can quote configuration, input, or query arguments,
 *     which no pattern of the logger recognises;
 *   - a request body that broke off (RequestBodyAbortedError; SR-05 item 10, SEC-024) is logged
 *     at warn level, one line with a fixed message: the code, the status, and the class name
 *     and code of the source's error. No stack, no error message, nothing of the body, and no
 *     client address. Nothing a client can cause at will is logged at error level;
 *   - any other 4xx without a cause is an ordinary outcome and is not logged here.
 */
export function errorResponse(
  error: unknown,
  context: ResponseContext & { logger?: Pick<Logger, "error" | "warn"> },
): Response {
  const appError = toAppError(error);
  if (appError instanceof RequestBodyAbortedError) {
    context.logger?.warn("Request body was not received completely", {
      code: appError.code,
      status: appError.status,
      sourceError: appError.sourceErrorName,
      sourceCode: appError.sourceErrorCode,
    });
  } else if (appError.status >= 500) {
    context.logger?.error("Unhandled error", {
      code: appError.code,
      err: describeErrorForLog(appError.cause ?? appError),
    });
  } else if (appError.cause !== undefined) {
    context.logger?.warn("Request failed with a recorded cause", {
      code: appError.code,
      status: appError.status,
      err: describeErrorForLog(appError.cause),
    });
  }

  const headers = buildHeaders(context);
  if (appError instanceof RateLimitedError) {
    headers.set("Retry-After", String(appError.retryAfterSeconds));
  }
  return Response.json(errorBody(appError, context.requestId), {
    status: appError.status,
    headers,
  });
}
