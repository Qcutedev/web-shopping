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
 * Never call `request.json()` in a handler: a body that is not valid JSON makes it throw a
 * SyntaxError, which `errorResponse` would turn into a 500 with an error-level log line per
 * request. `readJsonBody` checks the content type first (415) and maps the parse failure to
 * 400 VALIDATION_ERROR.
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

/**
 * Reads the JSON body of a mutation. The one way a handler reads a JSON body:
 *
 *   - a content type other than `application/json` is 415 UNSUPPORTED_MEDIA_TYPE, decided
 *     before the body is read;
 *   - a body that is not valid JSON (an empty body included) is 400 VALIDATION_ERROR with
 *     `details.fields = [{ path: "", code: "invalid_json", message }]`. It is an ordinary
 *     client error: nothing is logged, and the parser's message, which quotes a piece of the
 *     body, is neither sent nor kept as a cause.
 *
 * Any other failure (the body was already read, the connection broke) is passed on unchanged
 * and becomes a 500. The result is `unknown`: pass it to `parseInput`.
 *
 * No size limit is enforced here: docs/API_CONTRACTS.md does not state one for JSON bodies yet.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  assertContentType(request, JSON_CONTENT_TYPE);
  try {
    return (await request.json()) as unknown;
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
