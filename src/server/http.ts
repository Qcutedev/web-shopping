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
 * Handler pattern for a mutation with a JSON body (`proxyConfig` is the validated SR-01
 * configuration and `appOrigin` the validated `APP_URL`, both passed in by the caller; nothing
 * in this module reads the environment):
 *
 *   const requestId = resolveRequestId(request, {
 *     trustIncoming: trustsIncomingRequestId(proxyConfig),
 *   });
 *   const log = logger.child({ requestId });
 *   try {
 *     assertSameOrigin(request, appOrigin);
 *     const input = parseInput(bodySchema, await readJsonBody(request));
 *     const actor = await requireUser(request);
 *     return ok(await service(actor, input), { requestId });
 *   } catch (error) {
 *     return errorResponse(error, { requestId, logger: log });
 *   }
 *
 * Never call `request.json()`, `request.text()`, `request.formData()`, `request.arrayBuffer()`,
 * or `request.blob()` in a handler (security rule SR-05): they hold a body of any size in
 * memory, and a body that is not valid JSON makes `request.json()` throw a SyntaxError, which
 * `errorResponse` would turn into a 500 with an error-level log line per request.
 * `readJsonBody` checks the content type first (415), reads at most a fixed number of bytes
 * (413), and maps the parse failure to 400 VALIDATION_ERROR. The order in a handler is: origin
 * check, content-type check, size-limited read, schema validation.
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
  type ErrorDetails,
  forbidden,
  fromZodError,
  internalError,
  invalidJsonBody,
  isAppError,
  payloadTooLarge,
  RateLimitedError,
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
    const result = await reader.read();
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
 *   4. a body that is not valid JSON (an empty body included) is 400 VALIDATION_ERROR with
 *      `details.fields = [{ path: "", code: "invalid_json", message }]`.
 *
 * 413 and 400 are ordinary client errors: nothing is logged, nothing of the body is kept, and
 * the parser's message, which quotes a piece of the body, is neither sent nor kept as a cause.
 *
 * The limit is `options.maxBytes`, by default DEFAULT_JSON_BODY_LIMIT_BYTES. A `maxBytes` that
 * is not a positive integer of at most MAX_JSON_BODY_LIMIT_BYTES is a programming error and
 * throws a TypeError before anything else is looked at, so it fails on every request and in
 * every test, not only for a large body.
 *
 * Any other failure (the body was already read, the connection broke) is passed on unchanged
 * and becomes a 500. The result is `unknown`: pass it to `parseInput`.
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

  // Decoded like `request.json()` does: UTF-8, a leading byte order mark removed.
  const text = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof Error && error.name === "SyntaxError") throw invalidJsonBody();
    throw error;
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
 * 500 INTERNAL_ERROR with an explanatory cause in the log; move the asynchronous check (for
 * example a uniqueness lookup) into the service.
 */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  let result: ReturnType<typeof schema.safeParse>;
  try {
    result = schema.safeParse(input);
  } catch (error) {
    throw internalError(
      new Error(
        "parseInput: the schema threw instead of returning a result. A schema with an async " +
          "refinement or transform is not supported here, and a refinement must not throw.",
        { cause: error },
      ),
    );
  }
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}

/**
 * Normalises anything thrown into an AppError.
 * An AppError passes through. Everything else, a ZodError included, becomes a generic
 * INTERNAL_ERROR that keeps the original only as `cause` (see "Validation errors" above).
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return internalError(error);
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
 *   - a 5xx is logged at error level with the original error, stack included;
 *   - a 4xx that carries a `cause` is logged at warn level with that cause, because the
 *     service attached it for the operator (for example the constraint behind a CONFLICT);
 *   - a 4xx without a cause is an ordinary outcome and is not logged here.
 */
export function errorResponse(
  error: unknown,
  context: ResponseContext & { logger?: Pick<Logger, "error" | "warn"> },
): Response {
  const appError = toAppError(error);
  if (appError.status >= 500) {
    context.logger?.error("Unhandled error", {
      code: appError.code,
      err: appError.cause ?? appError,
    });
  } else if (appError.cause !== undefined) {
    context.logger?.warn("Request failed with a recorded cause", {
      code: appError.code,
      status: appError.status,
      err: appError.cause,
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
