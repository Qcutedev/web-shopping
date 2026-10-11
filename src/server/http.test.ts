import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ABORTED_BODY_ERROR_CODE,
  AppError,
  conflict,
  ERROR_CODES,
  ERROR_STATUS,
  forbidden,
  fromZodError,
  JSON_STRING_NOT_WELL_FORMED_FIELD_CODE,
  JSON_TOO_DEEP_FIELD_CODE,
  notFound,
  rateLimited,
  requestBodyAborted,
  RequestBodyAbortedError,
  sellerNotApproved,
  unauthenticated,
} from "./errors";
import {
  assertContentType,
  assertSameOrigin,
  created,
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  errorResponse,
  JSON_CONTENT_TYPE,
  MAX_EMPTY_BODY_CHUNKS,
  MAX_JSON_BODY_LIMIT_BYTES,
  MAX_JSON_NESTING_DEPTH,
  MULTIPART_CONTENT_TYPE,
  ok,
  paginated,
  paginationMeta,
  parseInput,
  readJsonBody,
  toAppError,
} from "./http";
import { createLogger } from "./logger";
import { createRateLimiter } from "./rate-limit";
import { REQUEST_ID_HEADER } from "./request-id";

const requestId = "req-test-0001";

async function read(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

/** A logger that collects its lines, parsed. */
function captureLog() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line), requestId });
  return {
    logger,
    lines,
    entry(index: number): Record<string, unknown> {
      const line = lines[index];
      if (line === undefined) throw new Error(`expected a log line at index ${index}`);
      return JSON.parse(line) as Record<string, unknown>;
    },
  };
}

const cartSchema = z.strictObject({ quantity: z.number().int().min(1) });

describe("success envelope", () => {
  it("ok wraps the payload in { data } with status 200 and the request id header", async () => {
    const response = ok({ id: "p1", priceSatang: 12900 }, { requestId });
    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await read(response)).toEqual({ data: { id: "p1", priceSatang: 12900 } });
  });

  it("created uses status 201", async () => {
    const response = created({ id: "o1" }, { requestId });
    expect(response.status).toBe(201);
    expect(await read(response)).toEqual({ data: { id: "o1" } });
  });

  it("keeps extra headers but never lets them replace the request id", () => {
    const response = ok(null, {
      requestId,
      headers: { "Cache-Control": "no-store", "X-Request-Id": "spoofed-value", Vary: "Cookie" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
  });

  it("marks ok, created, and paginated responses as no-store by default", () => {
    const page = { page: 1, pageSize: 20, total: 0 };
    for (const response of [
      ok({ id: "a1" }, { requestId }),
      created({ id: "o1" }, { requestId }),
      paginated([], page, { requestId }),
    ]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("lets a success response opt in to caching only through the cacheControl option", () => {
    const publicValue = "public, max-age=60";
    const page = { page: 1, pageSize: 20, total: 0 };
    expect(ok([], { requestId, cacheControl: publicValue }).headers.get("cache-control")).toBe(
      publicValue,
    );
    expect(
      paginated([], page, { requestId, cacheControl: publicValue }).headers.get("cache-control"),
    ).toBe(publicValue);

    // A Cache-Control smuggled in through the generic headers bag does not count as opting in.
    const viaHeaders = ok([], { requestId, headers: { "cache-control": publicValue } });
    expect(viaHeaders.headers.get("cache-control")).toBe("no-store");
  });

  it("paginated returns { data, meta } exactly as the contract shows", async () => {
    const response = paginated(
      [{ id: "a" }, { id: "b" }],
      { page: 1, pageSize: 20, total: 132 },
      {
        requestId,
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
    expect(await read(response)).toEqual({
      data: [{ id: "a" }, { id: "b" }],
      meta: { page: 1, pageSize: 20, total: 132, totalPages: 7 },
    });
  });

  it.each([
    [0, 20, 0],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [100, 50, 2],
    [101, 50, 3],
  ])("paginationMeta: total %i with pageSize %i gives %i pages", (total, pageSize, totalPages) => {
    expect(paginationMeta({ page: 1, pageSize, total })).toEqual({
      page: 1,
      pageSize,
      total,
      totalPages,
    });
  });
});

describe("error envelope", () => {
  it.each(ERROR_CODES)("%s maps to its documented status and envelope", async (code) => {
    const response = errorResponse(new AppError(code), { requestId });
    expect(response.status).toBe(ERROR_STATUS[code]);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);

    const body = (await read(response)) as { error: Record<string, unknown> };
    expect(Object.keys(body)).toEqual(["error"]);
    expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message", "requestId"]);
    expect(body.error.code).toBe(code);
    expect(body.error.requestId).toBe(requestId);
    expect(typeof body.error.message).toBe("string");
    expect(body.error.details).toEqual({});
  });

  it("includes public message and details of a domain error, never its cause", async () => {
    const error = conflict("DUPLICATE_SKU", {
      message: "SKU already exists.",
      cause: new Error('Unique constraint failed on "Product_storeId_sku_key"'),
    });
    const response = errorResponse(error, { requestId });
    const text = await response.text();

    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "CONFLICT",
        message: "SKU already exists.",
        details: { reason: "DUPLICATE_SKU" },
        requestId,
      },
    });
    expect(text).not.toContain("Product_storeId_sku_key");
  });

  it("sets Retry-After on RATE_LIMITED only", async () => {
    const limited = errorResponse(rateLimited(42), { requestId });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("42");
    expect(((await read(limited)) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");

    expect(errorResponse(notFound(), { requestId }).headers.has("Retry-After")).toBe(false);
  });

  it("error responses are always no-store, even when a caller passes another directive", () => {
    expect(errorResponse(notFound(), { requestId }).headers.get("cache-control")).toBe("no-store");
    expect(errorResponse(new Error("x"), { requestId }).headers.get("cache-control")).toBe(
      "no-store",
    );
    const sneaky = errorResponse(notFound(), {
      requestId,
      headers: { "Cache-Control": "public, max-age=60" },
    });
    expect(sneaky.headers.get("cache-control")).toBe("no-store");
  });
});

describe("validation errors", () => {
  const badInput = { quantity: "two", priceSatang: 1 };

  it("parseInput returns the parsed value for valid request input", () => {
    expect(parseInput(cartSchema, { quantity: 2 })).toEqual({ quantity: 2 });
  });

  it("parseInput turns invalid request input into 400 VALIDATION_ERROR with details.fields", async () => {
    let thrown: unknown;
    try {
      parseInput(cartSchema, badInput);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);

    const { logger, lines } = captureLog();
    const response = errorResponse(thrown, { requestId, logger });
    expect(response.status).toBe(400);
    const body = (await read(response)) as {
      error: { code: string; details: { fields: { path: string }[] }; requestId: string };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.requestId).toBe(requestId);
    expect(body.error.details.fields.map((field) => field.path).sort()).toEqual(["", "quantity"]);
    expect(lines).toHaveLength(0);
  });

  it("safeParse followed by throw fromZodError is the same explicit conversion", () => {
    const result = cartSchema.safeParse(badInput);
    if (result.success) throw new Error("expected the input to be rejected");
    const response = errorResponse(fromZodError(result.error), { requestId });
    expect(response.status).toBe(400);
  });

  it("a ZodError that was not converted by the handler is a 500 with nothing about it in the response", async () => {
    // What a service gets when a database JSON column, a provider response, or settings do not
    // match their schema: the client did nothing wrong and must learn nothing about the shape.
    const settingsSchema = z.object({ commissionBasisPoints: z.number().int() });
    const result = settingsSchema.safeParse({ commissionBasisPoints: "MARKER-FROM-DATABASE" });
    if (result.success) throw new Error("expected the stored value to be rejected");

    const { logger, lines, entry } = captureLog();
    const response = errorResponse(result.error, { requestId, logger });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        details: {},
        requestId,
      },
    });
    for (const leaked of ["commissionBasisPoints", "fields", "invalid_type", "received"]) {
      expect(text).not.toContain(leaked);
    }

    // The original ZodError is the cause and is what the server logs.
    expect(toAppError(result.error).code).toBe("INTERNAL_ERROR");
    expect(toAppError(result.error).cause).toBe(result.error);
    expect(lines).toHaveLength(1);
    const logged = entry(0);
    expect(logged).toMatchObject({ level: "error", code: "INTERNAL_ERROR", requestId });
    expect(JSON.stringify(logged.err)).toContain("commissionBasisPoints");
  });
});

describe("unknown errors", () => {
  const secretMessage =
    'relation "User" does not exist; postgresql://app:pw@db:5432/shop; password=hunter2';

  const thrown: [string, unknown][] = [
    ["Error", new Error(secretMessage)],
    ["TypeError", new TypeError(secretMessage)],
    ["string", secretMessage],
    ["plain object", { message: secretMessage, code: "P2021", status: 418, stack: secretMessage }],
    [
      "look-alike of a domain error",
      { code: "NOT_FOUND", status: 404, message: secretMessage, details: { secret: "hunter2" } },
    ],
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
  ];

  it.each(thrown)("%s becomes a generic 500 with nothing leaked", async (_label, value) => {
    const response = errorResponse(value, { requestId });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        details: {},
        requestId,
      },
    });
    for (const leaked of ["User", "postgresql", "hunter2", "P2021", "stack", "    at "]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("toAppError keeps the original as the cause for server-side logging", () => {
    const original = new Error("boom");
    const mapped = toAppError(original);
    expect(mapped.code).toBe("INTERNAL_ERROR");
    expect(mapped.cause).toBe(original);

    const domain = notFound();
    expect(toAppError(domain)).toBe(domain);
  });

  it("logs the original error on the server for 5xx, and nothing for a 4xx without a cause", () => {
    const { logger, lines, entry } = captureLog();

    errorResponse(notFound(), { requestId, logger });
    expect(lines).toHaveLength(0);

    errorResponse(new Error("database exploded"), { requestId, logger });
    expect(lines).toHaveLength(1);
    const logged = entry(0);
    expect(logged).toMatchObject({ level: "error", requestId, code: "INTERNAL_ERROR" });
    const err = logged.err as { message?: unknown; stack?: unknown };
    expect(err.message).toBe("database exploded");
    expect(typeof err.stack).toBe("string");
  });

  it("logs the cause of a 4xx at warn level, through the redacting logger", async () => {
    const { logger, lines, entry } = captureLog();
    const cause = new Error(
      'Unique constraint failed on "Product_storeId_sku_key"; seller somchai@example.com; password=hunter2',
    );
    const response = errorResponse(
      conflict("DUPLICATE_SKU", { message: "SKU already exists.", cause }),
      { requestId, logger },
    );

    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("Product_storeId_sku_key");

    expect(lines).toHaveLength(1);
    const logged = entry(0);
    expect(logged).toMatchObject({ level: "warn", requestId, code: "CONFLICT", status: 409 });
    const err = logged.err as { name?: unknown; message?: unknown };
    expect(err.name).toBe("Error");
    expect(String(err.message)).toContain("Product_storeId_sku_key");
    expect(lines.join("\n")).not.toContain("somchai@example.com");
    expect(lines.join("\n")).not.toContain("hunter2");
  });

  it("the 5xx log line does not carry secrets or personal data from the error message", () => {
    const { logger, lines } = captureLog();
    errorResponse(new Error(`${secretMessage}; contact somchai@example.com`), {
      requestId,
      logger,
    });
    expect(lines).toHaveLength(1);
    for (const leaked of ["hunter2", "app:pw", "somchai@example.com"]) {
      expect(lines.join("\n")).not.toContain(leaked);
    }
  });
});

/** The AppError thrown by `run`, or a failure when it does not throw one. */
async function thrownBy(run: () => unknown): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError to be thrown");
}

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/cart/items", { method: "POST", body, headers });
}

const JSON_HEADERS = { "Content-Type": "application/json" };

describe("readJsonBody (N12)", () => {
  it("returns the parsed body of a JSON request", async () => {
    expect(await readJsonBody(post('{"quantity":2}', JSON_HEADERS))).toEqual({ quantity: 2 });
    expect(await readJsonBody(post("null", JSON_HEADERS))).toBeNull();
    expect(
      await readJsonBody(post("[1,2]", { "content-type": "application/json; charset=utf-8" })),
    ).toEqual([1, 2]);
  });

  it.each([
    ["an unfinished object", '{"quantity":'],
    ["plain text", "hello MARKER-IN-BODY"],
    ["an empty body", ""],
    ["a trailing comma", '{"quantity":2,}'],
    ["single quotes", "{'quantity':2}"],
    ["form encoding sent as JSON", "quantity=2&MARKER-IN-BODY=1"],
  ])("maps %s to 400 VALIDATION_ERROR with code invalid_json", async (_label, body) => {
    const error = await thrownBy(() => readJsonBody(post(body, JSON_HEADERS)));
    expect(error.toPublic()).toEqual({
      code: "VALIDATION_ERROR",
      message: "The request is invalid.",
      details: {
        fields: [
          { path: "", code: "invalid_json", message: "The request body is not valid JSON." },
        ],
      },
    });
    // The parser's message quotes the body; neither it nor a cause is kept.
    expect(error.cause).toBeUndefined();
  });

  it("a malformed body is a 400 that writes no log line and echoes nothing of the body", async () => {
    const { logger, lines } = captureLog();
    let response: Response;
    try {
      const input = parseInput(
        cartSchema,
        await readJsonBody(post("hello MARKER-IN-BODY", JSON_HEADERS)),
      );
      response = ok(input, { requestId });
    } catch (error) {
      response = errorResponse(error, { requestId, logger });
    }
    const text = await response.text();
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request is invalid.",
        details: {
          fields: [
            { path: "", code: "invalid_json", message: "The request body is not valid JSON." },
          ],
        },
        requestId,
      },
    });
    expect(text).not.toContain("MARKER-IN-BODY");
    expect(lines).toHaveLength(0);
  });

  it("valid JSON of the wrong shape is still the schema's VALIDATION_ERROR, not invalid_json", async () => {
    const error = await thrownBy(async () =>
      parseInput(cartSchema, await readJsonBody(post('{"quantity":"two"}', JSON_HEADERS))),
    );
    const fields = (error.details as { fields: { code: string }[] }).fields;
    expect(fields.map((field) => field.code)).toEqual(["invalid_type"]);
  });

  it.each([
    ["text/plain", "text/plain"],
    ["form encoding", "application/x-www-form-urlencoded"],
    ["multipart", "multipart/form-data; boundary=x"],
    ["a JSON look-alike", "application/json-patch+json"],
    ["a JSON suffix type", "application/problem+json"],
  ])("refuses %s with 415 before the body is read", async (_label, contentType) => {
    const request = post('{"quantity":2}', { "Content-Type": contentType });
    const error = await thrownBy(() => readJsonBody(request));
    expect(error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(error.status).toBe(415);
    expect(request.bodyUsed).toBe(false);
  });

  it("refuses a request without a content type, also when it has no body", async () => {
    // A string body gets `text/plain` from the platform; a request without a body gets nothing.
    expect((await thrownBy(() => readJsonBody(post('{"quantity":2}')))).status).toBe(415);
    expect((await thrownBy(() => readJsonBody(post(null)))).status).toBe(415);
  });

  it("passes on a failure that is not a parse error, so that it becomes a 500", async () => {
    const request = post('{"quantity":2}', JSON_HEADERS);
    await request.text();
    let thrown: unknown;
    try {
      await readJsonBody(request);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(errorResponse(thrown, { requestId }).status).toBe(500);
  });
});

describe("assertContentType (N13; content-type convention)", () => {
  const withType = (contentType?: string): Request =>
    new Request("http://localhost/api/v1/seller/uploads", {
      method: "POST",
      headers: contentType === undefined ? {} : { "Content-Type": contentType },
    });

  it("accepts exactly the expected media type, in any letter case and with parameters", () => {
    for (const value of [
      "application/json",
      "Application/JSON",
      "application/json; charset=utf-8",
      "application/json;charset=UTF-8",
      "  application/json  ",
    ]) {
      expect(() => assertContentType(withType(value), JSON_CONTENT_TYPE)).not.toThrow();
    }
    expect(() =>
      assertContentType(withType("multipart/form-data; boundary=----x"), MULTIPART_CONTENT_TYPE),
    ).not.toThrow();
  });

  it.each([
    [undefined, JSON_CONTENT_TYPE],
    ["", JSON_CONTENT_TYPE],
    ["text/plain", JSON_CONTENT_TYPE],
    ["application/x-www-form-urlencoded", JSON_CONTENT_TYPE],
    ["multipart/form-data; boundary=x", JSON_CONTENT_TYPE],
    ["application/jsonx", JSON_CONTENT_TYPE],
    ["xapplication/json", JSON_CONTENT_TYPE],
    ["application/json, text/plain", JSON_CONTENT_TYPE],
    ["text/plain; application/json", JSON_CONTENT_TYPE],
    ["application/json", MULTIPART_CONTENT_TYPE],
    ["multipart/mixed; boundary=x", MULTIPART_CONTENT_TYPE],
    ["application/x-www-form-urlencoded", MULTIPART_CONTENT_TYPE],
    ["text/plain", MULTIPART_CONTENT_TYPE],
  ] as const)("refuses %s where %s is expected with 415", async (value, expected) => {
    const error = await thrownBy(() => assertContentType(withType(value), expected));
    expect(error.toPublic()).toEqual({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: `The content type must be ${expected}.`,
      details: {},
    });
  });
});

describe("assertSameOrigin (N13; TM-16 Origin check)", () => {
  const APP = "https://shop.example";
  const mutation = (method: string, origin?: string | string[]): Request => {
    const headers = new Headers({ "Content-Type": "application/json" });
    for (const value of origin === undefined ? [] : [origin].flat())
      headers.append("Origin", value);
    return new Request("https://shop.example/api/v1/cart/items", { method, headers });
  };

  it.each(["POST", "PATCH", "PUT", "DELETE"])("%s passes with the application origin", (method) => {
    expect(() => assertSameOrigin(mutation(method, APP), APP)).not.toThrow();
  });

  it.each(["POST", "PATCH", "PUT", "DELETE", "OPTIONS"])(
    "%s is refused with 403 when Origin is missing, null, or foreign",
    async (method) => {
      for (const origin of [
        undefined,
        "",
        "null",
        "https://evil.example",
        "http://shop.example",
        "https://shop.example:8443",
        "https://shop.example.evil.example",
        "https://evil.example/https://shop.example",
        "https://sub.shop.example",
        "https://shop.example/",
        "HTTPS://SHOP.EXAMPLE",
        "https://shop.example https://evil.example",
        [APP, "https://evil.example"],
        [APP, APP],
      ]) {
        const error = await thrownBy(() => assertSameOrigin(mutation(method, origin), APP));
        expect(error.toPublic()).toEqual({
          code: "FORBIDDEN",
          message: "The request origin is not allowed.",
          details: {},
        });
      }
    },
  );

  it("does not check GET and HEAD, which never change state", () => {
    for (const method of ["GET", "HEAD"]) {
      expect(() => assertSameOrigin(mutation(method), APP)).not.toThrow();
      expect(() => assertSameOrigin(mutation(method, "https://evil.example"), APP)).not.toThrow();
    }
  });

  it("compares the origin of the allowed URL only, so a trailing slash or a path does not matter", () => {
    for (const allowed of [
      "https://shop.example/",
      "https://shop.example/th",
      "https://SHOP.example",
      "https://shop.example:443",
    ]) {
      expect(() => assertSameOrigin(mutation("POST", APP), allowed)).not.toThrow();
    }
    expect(() =>
      assertSameOrigin(mutation("POST", "http://localhost:3000"), "http://localhost:3000"),
    ).not.toThrow();
    // The port is part of the origin.
    expect(() =>
      assertSameOrigin(mutation("POST", "http://localhost:3001"), "http://localhost:3000"),
    ).toThrow(AppError);
  });

  it("takes the allowed origin from its argument only, never from the environment", () => {
    const before = process.env.APP_URL;
    process.env.APP_URL = "https://evil.example";
    try {
      expect(() => assertSameOrigin(mutation("POST", "https://evil.example"), APP)).toThrow(
        AppError,
      );
      expect(() => assertSameOrigin(mutation("POST", APP), APP)).not.toThrow();
    } finally {
      if (before === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = before;
    }
  });

  it("an unusable allowed origin is a configuration fault for every method, never a pass", () => {
    for (const allowed of [
      "",
      "shop.example",
      "/relative",
      "null",
      "*",
      "file:///app",
      "ftp://shop.example",
    ]) {
      for (const method of ["GET", "POST"]) {
        expect(() => assertSameOrigin(mutation(method, allowed), allowed)).toThrow(TypeError);
      }
    }
    // Inside a handler's try block that is a 500, not a 403 and not a success.
    let thrown: unknown;
    try {
      assertSameOrigin(mutation("POST", "null"), "null");
    } catch (error) {
      thrown = error;
    }
    expect(errorResponse(thrown, { requestId }).status).toBe(500);
  });
});

describe("parseInput and asynchronous schemas (N14)", () => {
  it("a schema with an async refinement fails with a clear internal error, not a bare throw", async () => {
    const schema = z.strictObject({
      sku: z.string().refine(async (value) => Promise.resolve(value.length > 0)),
    });
    const error = await thrownBy(() => parseInput(schema, { sku: "MARKER-SKU" }));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toContain(
      "async refinement or transform is not supported",
    );
    // What Zod threw is kept underneath for the log.
    expect((error.cause as Error).cause).toBeInstanceOf(Error);

    const { logger, lines, entry } = captureLog();
    const response = errorResponse(error, { requestId, logger });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("async");
    expect(text).not.toContain("MARKER-SKU");
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(entry(0).err)).toContain("parseInput");
  });

  it("a schema with an async transform fails the same way", async () => {
    const schema = z.string().transform(async (value) => Promise.resolve(value.trim()));
    const error = await thrownBy(() => parseInput(schema, " x "));
    expect(error.code).toBe("INTERNAL_ERROR");
  });

  it("a refinement that throws is an internal error as well, not a validation error", async () => {
    const schema = z.string().refine(() => {
      throw new Error("lookup exploded");
    });
    const error = await thrownBy(() => parseInput(schema, "x"));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(((error.cause as Error).cause as Error).message).toBe("lookup exploded");
  });

  it("an ordinary synchronous refinement still works", () => {
    const schema = z.string().refine((value) => value.length > 1);
    expect(parseInput(schema, "ok")).toBe("ok");
    expect(() => parseInput(schema, "x")).toThrow(AppError);
  });
});

describe("readJsonBody body size limit (SR-05, SEC-019)", () => {
  const TOO_LARGE = {
    code: "PAYLOAD_TOO_LARGE",
    message: "The request body is too large.",
    details: {},
  };
  /** Valid JSON (a string literal) of exactly `bytes` bytes. */
  const jsonOfBytes = (bytes: number): string => `"${"a".repeat(bytes - 2)}"`;
  const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

  /** A POST whose body is produced chunk by chunk, with a count of what was taken from it. */
  function streamed(chunks: Iterable<Uint8Array>, headers: Record<string, string> = JSON_HEADERS) {
    const iterator = chunks[Symbol.iterator]();
    const taken = { bytes: 0, chunks: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const next = iterator.next();
          if (next.done === true) {
            controller.close();
            return;
          }
          taken.bytes += next.value.byteLength;
          taken.chunks += 1;
          controller.enqueue(next.value);
        },
        cancel() {
          taken.cancelled = true;
        },
      },
      // Nothing is produced ahead of a read, so `taken` is what the reader asked for.
      { highWaterMark: 0 },
    );
    const request = new Request("http://localhost/api/v1/cart/items", {
      method: "POST",
      headers,
      body,
      duplex: "half",
    } as RequestInit);
    return { request, taken };
  }

  function* endless(chunkBytes: number): Generator<Uint8Array> {
    for (;;) yield new Uint8Array(chunkBytes).fill(0x61);
  }

  it("the default limit is 100 KiB and the ceiling 1 MiB", () => {
    expect(DEFAULT_JSON_BODY_LIMIT_BYTES).toBe(102_400);
    expect(MAX_JSON_BODY_LIMIT_BYTES).toBe(1_048_576);
  });

  it("a body of exactly the limit passes, with and without a declared length", async () => {
    const body = jsonOfBytes(DEFAULT_JSON_BODY_LIMIT_BYTES);
    expect(byteLength(body)).toBe(102_400);
    expect(await readJsonBody(post(body, JSON_HEADERS))).toHaveLength(102_398);
    expect(
      await readJsonBody(post(body, { ...JSON_HEADERS, "Content-Length": "102400" })),
    ).toHaveLength(102_398);
    expect(await readJsonBody(post(jsonOfBytes(64), JSON_HEADERS), { maxBytes: 64 })).toHaveLength(
      62,
    );
  });

  it("a body one byte over the limit is 413, with and without a declared length", async () => {
    const body = jsonOfBytes(DEFAULT_JSON_BODY_LIMIT_BYTES + 1);
    expect((await thrownBy(() => readJsonBody(post(body, JSON_HEADERS)))).toPublic()).toEqual(
      TOO_LARGE,
    );
    const declared = post(body, { ...JSON_HEADERS, "Content-Length": "102401" });
    expect((await thrownBy(() => readJsonBody(declared))).toPublic()).toEqual(TOO_LARGE);
    expect(
      (
        await thrownBy(() => readJsonBody(post(jsonOfBytes(65), JSON_HEADERS), { maxBytes: 64 }))
      ).toPublic(),
    ).toEqual(TOO_LARGE);
  });

  it("a declared length over the limit is refused before any of the body is read", async () => {
    const { request, taken } = streamed(endless(1_024), {
      ...JSON_HEADERS,
      "Content-Length": "102401",
    });
    const error = await thrownBy(() => readJsonBody(request));
    expect(error.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
    expect(taken).toEqual({ bytes: 0, chunks: 0, cancelled: false });
    // Also when the declared length is untrue and the body is in fact small.
    const small = post("{}", { ...JSON_HEADERS, "Content-Length": "999999999" });
    expect((await thrownBy(() => readJsonBody(small))).status).toBe(413);
    expect(small.bodyUsed).toBe(false);
  });

  it("a body without Content-Length over the limit fails after at most the limit plus one chunk", async () => {
    const chunkBytes = 1_024;
    const limit = 10_000;
    const { request, taken } = streamed(endless(chunkBytes));
    const error = await thrownBy(() => readJsonBody(request, { maxBytes: limit }));
    expect(error.toPublic()).toEqual(TOO_LARGE);
    expect(taken.bytes).toBeGreaterThan(limit);
    expect(taken.bytes).toBeLessThanOrEqual(limit + chunkBytes);
    // The rest of the stream was cancelled, not drained.
    expect(taken.cancelled).toBe(true);
  });

  it("an endless body is refused at the default limit as well", async () => {
    const { request, taken } = streamed(endless(16_384));
    expect((await thrownBy(() => readJsonBody(request))).status).toBe(413);
    expect(taken.bytes).toBeLessThanOrEqual(DEFAULT_JSON_BODY_LIMIT_BYTES + 16_384);
  });

  it("a small Content-Length that lies about a larger body is 413", async () => {
    const body = jsonOfBytes(DEFAULT_JSON_BODY_LIMIT_BYTES + 5_000);
    for (const declared of ["2", "0", "102400"]) {
      const request = post(body, { ...JSON_HEADERS, "Content-Length": declared });
      expect((await thrownBy(() => readJsonBody(request))).toPublic()).toEqual(TOO_LARGE);
    }
    const { request, taken } = streamed(endless(1_024), { ...JSON_HEADERS, "Content-Length": "2" });
    expect((await thrownBy(() => readJsonBody(request, { maxBytes: 4_096 }))).status).toBe(413);
    expect(taken.bytes).toBeLessThanOrEqual(4_096 + 1_024);
  });

  it.each([
    "-1",
    "+5",
    "1.5",
    "1e3",
    "0x10",
    "abc",
    "",
    "5 5",
    "5, 5",
    "5;5",
    "Infinity",
    "NaN",
    "9".repeat(400),
    "1048577",
    `${"0".repeat(20)}102401`,
  ])("refuses the Content-Length %j with 413 before the body is read", async (value) => {
    const request = post("{}", JSON_HEADERS);
    request.headers.set("Content-Length", value);
    expect(request.headers.get("Content-Length")).toBe(value);
    expect((await thrownBy(() => readJsonBody(request))).toPublic()).toEqual(TOO_LARGE);
    expect(request.bodyUsed).toBe(false);
  });

  it("a repeated Content-Length header is refused", async () => {
    const request = post("{}", JSON_HEADERS);
    request.headers.append("Content-Length", "2");
    request.headers.append("Content-Length", "2");
    expect((await thrownBy(() => readJsonBody(request))).status).toBe(413);
  });

  it("accepts a plain decimal Content-Length within the limit, leading zeros included", async () => {
    for (const value of ["2", "0002", "102400", `${"0".repeat(20)}2`]) {
      const request = post("{}", { ...JSON_HEADERS, "Content-Length": value });
      expect(await readJsonBody(request)).toEqual({});
    }
  });

  it("counts multi-byte UTF-8 as bytes, not characters", async () => {
    // One Thai character is three bytes: 20 characters are 60 bytes, 62 with the quotes.
    const thai = "\u0e01".repeat(20);
    const body = JSON.stringify(JSON.parse(`"${thai}"`) as string);
    expect(body).toHaveLength(22);
    expect(byteLength(body)).toBe(62);

    expect(await readJsonBody(post(body, JSON_HEADERS), { maxBytes: 62 })).toHaveLength(20);
    const error = await thrownBy(() => readJsonBody(post(body, JSON_HEADERS), { maxBytes: 61 }));
    expect(error.toPublic()).toEqual(TOO_LARGE);
    // 22 characters would fit a limit of 22; 62 bytes do not.
    expect(
      (await thrownBy(() => readJsonBody(post(body, JSON_HEADERS), { maxBytes: 22 }))).status,
    ).toBe(413);
  });

  it("reassembles a multi-byte character split across chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ title: "\u0e01\u0e02" }));
    const chunks = Array.from(bytes, (byte) => Uint8Array.of(byte));
    const { request } = streamed(chunks);
    expect(await readJsonBody(request)).toEqual({ title: JSON.parse('"\u0e01\u0e02"') });
  });

  it("an empty body is still 400 invalid_json, with or without Content-Length: 0", async () => {
    for (const request of [
      post("", JSON_HEADERS),
      post(null, JSON_HEADERS),
      post("", { ...JSON_HEADERS, "Content-Length": "0" }),
      streamed([]).request,
    ]) {
      const error = await thrownBy(() => readJsonBody(request));
      expect(error.status).toBe(400);
      expect(error.cause).toBeUndefined();
      expect((error.details as { fields: { code: string }[] }).fields[0]?.code).toBe(
        "invalid_json",
      );
    }
  });

  it("an endpoint may raise its limit up to the ceiling", async () => {
    const body = jsonOfBytes(MAX_JSON_BODY_LIMIT_BYTES);
    const options = { maxBytes: MAX_JSON_BODY_LIMIT_BYTES };
    expect(await readJsonBody(post(body, JSON_HEADERS), options)).toHaveLength(1_048_574);
    expect((await thrownBy(() => readJsonBody(post(body, JSON_HEADERS)))).status).toBe(413);
    const over = post(jsonOfBytes(MAX_JSON_BODY_LIMIT_BYTES + 1), JSON_HEADERS);
    expect((await thrownBy(() => readJsonBody(over, options))).status).toBe(413);
  });

  it.each([
    MAX_JSON_BODY_LIMIT_BYTES + 1,
    10 * 1024 * 1024,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    0,
    -1,
    1.5,
    Number.NaN,
    "1024" as unknown as number,
    null as unknown as number,
  ])(
    "maxBytes %j is a programming error that fails loudly, even for a tiny body",
    async (maxBytes) => {
      const request = post("{}", JSON_HEADERS);
      let thrown: unknown;
      try {
        await readJsonBody(request, { maxBytes });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect(request.bodyUsed).toBe(false);
      // Inside a handler that is a 500, never a silently larger limit.
      expect(errorResponse(thrown, { requestId }).status).toBe(500);
    },
  );

  it("the content type is still checked first: an oversized form body is 415 and is not read", async () => {
    const request = post(jsonOfBytes(200_000), {
      "Content-Type": "text/plain",
      "Content-Length": "200000",
    });
    expect((await thrownBy(() => readJsonBody(request))).status).toBe(415);
    expect(request.bodyUsed).toBe(false);
  });

  it("an oversized body is a 413 response that writes no log line and keeps nothing of the body", async () => {
    const { logger, lines } = captureLog();
    const error = await thrownBy(() =>
      readJsonBody(post(`"MARKER-IN-BODY${"a".repeat(200_000)}"`, JSON_HEADERS)),
    );
    expect(error.cause).toBeUndefined();
    const response = errorResponse(error, { requestId, logger });
    const text = await response.text();
    expect(response.status).toBe(413);
    expect(JSON.parse(text)).toEqual({ error: { ...TOO_LARGE, requestId } });
    expect(text).not.toContain("MARKER");
    expect(lines).toHaveLength(0);
  });
});

describe("readJsonBody reads into one bounded buffer (SR-05 item 8, SEC-020)", () => {
  /** A POST whose body hands over whatever `chunks` yields, one value per read. */
  function streamedRaw(chunks: Iterable<unknown>, cancel: () => unknown = () => undefined) {
    const iterator = chunks[Symbol.iterator]();
    const taken = { pulls: 0, cancelled: false };
    const body = new ReadableStream<unknown>(
      {
        pull(controller) {
          taken.pulls += 1;
          const next = iterator.next();
          if (next.done === true) controller.close();
          else controller.enqueue(next.value);
        },
        cancel() {
          taken.cancelled = true;
          return cancel() as void | Promise<void>;
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request("http://localhost/api/v1/cart/items", {
      method: "POST",
      headers: JSON_HEADERS,
      body: body as ReadableStream<Uint8Array>,
      duplex: "half",
    } as RequestInit);
    return { request, taken };
  }

  const split = (source: Uint8Array, size: number): Uint8Array[] => {
    const parts: Uint8Array[] = [];
    for (let at = 0; at < source.byteLength; at += size) parts.push(source.slice(at, at + size));
    return parts;
  };

  it("a body that outgrows the first buffer many times comes back byte for byte", async () => {
    // Thai text, so a wrong offset anywhere breaks a character. About 90,000 bytes.
    const value = { title: "กุ้ง".repeat(7_500), tail: "end" };
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    expect(bytes.byteLength).toBeGreaterThan(4_096 * 16);
    for (const size of [1, 7, 4_095, 4_096, 4_097, 10_000, bytes.byteLength]) {
      const { request } = streamedRaw(split(bytes, size));
      expect(await readJsonBody(request), `chunks of ${size}`).toEqual(value);
    }
  });

  it("a body of exactly the limit passes when the last growth is capped at the limit", async () => {
    // 5,000 is not a multiple of the first buffer size: the buffer stops at 5,000, not 8,192.
    const limit = 5_000;
    const bytes = new TextEncoder().encode(`"${"a".repeat(limit - 2)}"`);
    for (const size of [1, 3, 4_096, 4_999, 5_000]) {
      const exact = streamedRaw(split(bytes, size));
      expect(await readJsonBody(exact.request, { maxBytes: limit })).toHaveLength(limit - 2);
      const over = streamedRaw([...split(bytes, size), Uint8Array.of(0x20)]);
      expect((await thrownBy(() => readJsonBody(over.request, { maxBytes: limit }))).status).toBe(
        413,
      );
      expect(over.taken.cancelled).toBe(true);
    }
  });

  it("empty chunks are skipped, wherever they are", async () => {
    const empty = (): Uint8Array => new Uint8Array(0);
    const bytes = new TextEncoder().encode('{"quantity":2}');
    const chunks = [empty(), ...split(bytes, 3).flatMap((part) => [part, empty()]), empty()];
    expect(await readJsonBody(streamedRaw(chunks).request)).toEqual({ quantity: 2 });
    // A body of exactly the limit is not pushed over it by empty chunks.
    expect(await readJsonBody(streamedRaw(chunks).request, { maxBytes: bytes.byteLength })).toEqual(
      { quantity: 2 },
    );
    // Only empty chunks: an empty body, 400 as before.
    const error = await thrownBy(() => readJsonBody(streamedRaw([empty(), empty()]).request));
    expect(error.status).toBe(400);
  });

  it.each([
    ["a string", "MARKER-IN-BODY"],
    ["an ArrayBuffer", new TextEncoder().encode("MARKER-IN-BODY").buffer],
    ["a Uint16Array", new Uint16Array(4)],
    ["a DataView", new DataView(new ArrayBuffer(4))],
    ["an array of numbers", [123, 125]],
    ["an object with a byteLength", { byteLength: 1 }],
    ["null", null],
  ])("a chunk that is %s is a server fault at once, not a counted read", async (_name, chunk) => {
    const { request, taken } = streamedRaw([Uint8Array.of(0x20), chunk, Uint8Array.of(0x31)]);
    let thrown: unknown;
    try {
      await readJsonBody(request);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown).not.toBeInstanceOf(AppError);
    expect(String(thrown)).not.toContain("MARKER");
    // Nothing is read after the bad chunk, and the source is told to stop.
    expect(taken).toEqual({ pulls: 2, cancelled: true });
    const { logger, lines } = captureLog();
    const response = errorResponse(thrown, { requestId, logger });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("MARKER");
    expect(lines.join("\n")).not.toContain("MARKER");
  });

  it("a Buffer is bytes and is accepted", async () => {
    const { request } = streamedRaw([Buffer.from('{"quantity"'), Buffer.from(":2}")]);
    expect(await readJsonBody(request)).toEqual({ quantity: 2 });
  });

  it("neither refusal waits for a source that never confirms the cancellation", async () => {
    const never = (): Promise<void> => new Promise(() => undefined);
    const big = (function* (): Generator<Uint8Array> {
      for (;;) yield new Uint8Array(4_096).fill(0x61);
    })();
    const tooLarge = streamedRaw(big, never);
    expect((await thrownBy(() => readJsonBody(tooLarge.request, { maxBytes: 1_000 }))).status).toBe(
      413,
    );
    expect(tooLarge.taken.cancelled).toBe(true);

    const notBytes = streamedRaw(["text"], never);
    await expect(readJsonBody(notBytes.request)).rejects.toBeInstanceOf(TypeError);
    expect(notBytes.taken.cancelled).toBe(true);
  });
});

describe("readJsonBody always ends (SR-05 item 9, SEC-021)", () => {
  /** A POST whose body hands over whatever `chunks` yields, one value per read. */
  function streamedRaw(
    chunks: Iterable<Uint8Array>,
    maxPulls = Number.POSITIVE_INFINITY,
    cancel: () => void | Promise<void> = () => undefined,
  ) {
    const iterator = chunks[Symbol.iterator]();
    const taken = { pulls: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          taken.pulls += 1;
          // A guard for the test itself: a reader without a bound must fail, not hang.
          if (taken.pulls > maxPulls) {
            controller.error(new Error("the reader asked for more chunks than the test allows"));
            return;
          }
          const next = iterator.next();
          if (next.done === true) controller.close();
          else controller.enqueue(next.value);
        },
        cancel() {
          taken.cancelled = true;
          return cancel();
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request("http://localhost/api/v1/cart/items", {
      method: "POST",
      headers: JSON_HEADERS,
      body,
      duplex: "half",
    } as RequestInit);
    return { request, taken };
  }

  async function failureOf(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    throw new Error("expected readJsonBody to refuse the body");
  }

  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

  function* empties(count: number): Generator<Uint8Array> {
    for (let sent = 0; sent < count; sent += 1) yield new Uint8Array(0);
  }

  function* emptiesThen(count: number, ...rest: Uint8Array[]): Generator<Uint8Array> {
    yield* empties(count);
    yield* rest;
  }

  /** A `Uint8Array` subclass whose `byteLength` reports `reported`, whatever it holds. */
  function lying(reported: number, bytes: Uint8Array): Uint8Array {
    class Lying extends Uint8Array {
      override get byteLength(): number {
        return reported;
      }
    }
    const chunk = new Lying(bytes.length);
    chunk.set(bytes);
    return chunk;
  }

  const REPORTED: [string, number][] = [
    ["NaN", Number.NaN],
    ["zero", 0],
    ["one, an understatement", 1],
    ["a negative number", -1],
    ["a fraction", 0.5],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["far too much", 2 ** 40],
  ];

  it("the allowance is 200,000 empty chunks", () => {
    expect(MAX_EMPTY_BODY_CHUNKS).toBe(200_000);
  });

  it("a body with exactly the allowance of empty chunks is still read", async () => {
    const { request, taken } = streamedRaw(
      emptiesThen(MAX_EMPTY_BODY_CHUNKS, encode('{"quantity":2}')),
    );
    expect(await readJsonBody(request)).toEqual({ quantity: 2 });
    expect(taken.cancelled).toBe(false);
  }, 60_000);

  it("one empty chunk more is a server fault at once, and the source is told to stop", async () => {
    const endless = (function* (): Generator<Uint8Array> {
      for (;;) yield new Uint8Array(0);
    })();
    const { request, taken } = streamedRaw(endless, MAX_EMPTY_BODY_CHUNKS + 10);
    const error = await failureOf(readJsonBody(request));
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(AppError);
    expect((error as Error).message).toBe(
      "readJsonBody: the request body produced too many empty chunks.",
    );
    expect(taken).toEqual({ pulls: MAX_EMPTY_BODY_CHUNKS + 1, cancelled: true });
    // Nothing more is asked of the source afterwards.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(taken.pulls).toBe(MAX_EMPTY_BODY_CHUNKS + 1);

    const { logger, lines, entry } = captureLog();
    const response = errorResponse(error, { requestId, logger });
    expect(response.status).toBe(500);
    expect(((await read(response)) as { error: { code: string } }).error.code).toBe(
      "INTERNAL_ERROR",
    );
    expect(lines).toHaveLength(1);
    expect(entry(0)).toMatchObject({ level: "error", code: "INTERNAL_ERROR" });
  }, 60_000);

  it("the allowance is the same for every byte limit", async () => {
    for (const maxBytes of [1, 64, MAX_JSON_BODY_LIMIT_BYTES]) {
      const allowed = streamedRaw(emptiesThen(MAX_EMPTY_BODY_CHUNKS, encode("7")));
      expect(await readJsonBody(allowed.request, { maxBytes }), `limit ${maxBytes}`).toBe(7);
      const refused = streamedRaw(
        emptiesThen(MAX_EMPTY_BODY_CHUNKS + 1, encode("7")),
        MAX_EMPTY_BODY_CHUNKS + 10,
      );
      expect(
        await failureOf(readJsonBody(refused.request, { maxBytes })),
        `limit ${maxBytes}`,
      ).toBeInstanceOf(TypeError);
      expect(refused.taken.pulls, `limit ${maxBytes}`).toBe(MAX_EMPTY_BODY_CHUNKS + 1);
    }
  }, 120_000);

  it("empty chunks are counted over the whole body, not per run", async () => {
    // One byte between every two empty chunks: no run is longer than one.
    const interleaved = (function* (): Generator<Uint8Array> {
      for (;;) {
        yield new Uint8Array(0);
        yield Uint8Array.of(0x20);
      }
    })();
    const { request, taken } = streamedRaw(interleaved, 2 * MAX_EMPTY_BODY_CHUNKS + 10);
    const error = await failureOf(readJsonBody(request, { maxBytes: MAX_JSON_BODY_LIMIT_BYTES }));
    expect(error).toBeInstanceOf(TypeError);
    // 200,000 pairs, then the empty chunk that is one too many.
    expect(taken).toEqual({ pulls: 2 * MAX_EMPTY_BODY_CHUNKS + 1, cancelled: true });
  }, 60_000);

  it("the byte limit still decides for a body with empty chunks and too many bytes", async () => {
    const chunks = emptiesThen(1_000, new Uint8Array(65).fill(0x37), ...empties(10));
    const { request, taken } = streamedRaw(chunks);
    expect((await thrownBy(() => readJsonBody(request, { maxBytes: 64 }))).status).toBe(413);
    expect(taken).toEqual({ pulls: 1_001, cancelled: true });
  });

  it("the refusal does not wait for a source that never confirms the cancellation", async () => {
    const never = (): Promise<void> => new Promise(() => undefined);
    const { request, taken } = streamedRaw(
      empties(MAX_EMPTY_BODY_CHUNKS + 5),
      MAX_EMPTY_BODY_CHUNKS + 10,
      never,
    );
    expect(await failureOf(readJsonBody(request))).toBeInstanceOf(TypeError);
    expect(taken.cancelled).toBe(true);
  }, 60_000);

  it.each(REPORTED)(
    "chunks that report %s as their length are counted for the bytes they hold",
    async (_label, reported) => {
      // 400 chunks of 1,000 bytes against a limit of 10,000: over the limit with the eleventh.
      const flood = (function* (): Generator<Uint8Array> {
        for (let sent = 0; sent < 400; sent += 1) {
          yield lying(reported, new Uint8Array(1_000).fill(0x20));
        }
      })();
      const { request, taken } = streamedRaw(flood);
      const error = await thrownBy(() => readJsonBody(request, { maxBytes: 10_000 }));
      expect(error.status).toBe(413);
      expect(taken).toEqual({ pulls: 11, cancelled: true });
    },
  );

  it.each(REPORTED)(
    "a body in chunks that report %s as their length comes back byte for byte",
    async (_label, reported) => {
      const value = { title: "กุ้ง".repeat(2_000), quantity: 2 };
      const bytes = encode(JSON.stringify(value));
      expect(bytes.byteLength).toBeGreaterThan(4_096 * 4);
      const chunks: Uint8Array[] = [];
      for (let at = 0; at < bytes.byteLength; at += 777) {
        chunks.push(lying(reported, bytes.slice(at, at + 777)));
      }
      expect(await readJsonBody(streamedRaw(chunks).request)).toEqual(value);
      // The limit is exact for them as well.
      const exact = streamedRaw(chunks);
      expect(await readJsonBody(exact.request, { maxBytes: bytes.byteLength })).toEqual(value);
      const over = streamedRaw(chunks);
      const error = await thrownBy(() =>
        readJsonBody(over.request, { maxBytes: bytes.byteLength - 1 }),
      );
      expect(error.status).toBe(413);
    },
  );

  it("a chunk with no bytes that reports a length is an empty chunk", async () => {
    const hollow = (function* (): Generator<Uint8Array> {
      for (;;) yield lying(5, new Uint8Array(0));
    })();
    const { request, taken } = streamedRaw(hollow, MAX_EMPTY_BODY_CHUNKS + 10);
    expect(await failureOf(readJsonBody(request, { maxBytes: 64 }))).toBeInstanceOf(TypeError);
    expect(taken).toEqual({ pulls: MAX_EMPTY_BODY_CHUNKS + 1, cancelled: true });

    const few = [lying(5, new Uint8Array(0)), encode("[1]"), lying(5, new Uint8Array(0))];
    expect(await readJsonBody(streamedRaw(few).request, { maxBytes: 3 })).toEqual([1]);
  }, 60_000);

  it("the length a chunk defines for itself is never asked for", async () => {
    let asked = 0;
    class Counting extends Uint8Array {
      override get byteLength(): number {
        asked += 1;
        throw new Error("MARKER-IN-GETTER");
      }
    }
    const chunk = new Counting(3);
    chunk.set(encode("[1]"));
    expect(await readJsonBody(streamedRaw([chunk, new Counting(0)]).request)).toEqual([1]);
    expect(asked).toBe(0);
  });

  it("a view into a larger buffer is counted as the view, not as its buffer", async () => {
    const backing = encode(`XXXX[1]YYYY${"Z".repeat(1_000)}`);
    const view = backing.subarray(4, 7);
    expect(await readJsonBody(streamedRaw([view]).request, { maxBytes: 3 })).toEqual([1]);
    const buffer = Buffer.from(backing.buffer, backing.byteOffset + 4, 3);
    expect(await readJsonBody(streamedRaw([buffer]).request, { maxBytes: 3 })).toEqual([1]);
  });
});

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A POST with a JSON content type whose body is exactly `bytes`. */
function postBytes(bytes: Uint8Array | readonly number[]): Request {
  const body = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return new Request("http://localhost/api/v1/cart/items", {
    method: "POST",
    body: body as BodyInit,
    headers: JSON_HEADERS,
  });
}

/** A POST with a JSON content type whose body is whatever `source` produces. */
function postStream(source: UnderlyingDefaultSource<Uint8Array>): Request {
  return new Request("http://localhost/api/v1/cart/items", {
    method: "POST",
    headers: JSON_HEADERS,
    // Nothing is produced ahead of a read.
    body: new ReadableStream<Uint8Array>(source, { highWaterMark: 0 }),
    duplex: "half",
  } as RequestInit);
}

/** Whatever `promise` rejects with; fails when it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

const INVALID_JSON_PUBLIC = {
  code: "VALIDATION_ERROR",
  message: "The request is invalid.",
  details: {
    fields: [{ path: "", code: "invalid_json", message: "The request body is not valid JSON." }],
  },
};

describe("readJsonBody refuses bytes that are not valid UTF-8 (SR-05 item 11, SEC-022)", () => {
  it("the reproduction of SEC-022: a lone FF byte inside a string is 400 invalid_json", async () => {
    // {"a":"?"} with the single byte FF in place of the question mark.
    const bytes = [0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d];
    const error = await thrownBy(() => readJsonBody(postBytes(bytes)));
    expect(error.status).toBe(400);
    expect(error.toPublic()).toEqual(INVALID_JSON_PUBLIC);
    expect(error.cause).toBeUndefined();
  });

  it.each([
    ["a lone continuation byte", [0x80]],
    ["a truncated two-byte sequence", [0xc3]],
    ["a truncated three-byte sequence (part of a Thai letter)", [0xe0, 0xb8]],
    ["a truncated four-byte sequence", [0xf0, 0x9f, 0x98]],
    ["an overlong encoding of a slash", [0xc0, 0xaf]],
    ["an overlong encoding of a quote", [0xe0, 0x80, 0xa2]],
    ["an encoded surrogate half", [0xed, 0xa0, 0x80]],
    ["a code point above U+10FFFF", [0xf4, 0x90, 0x80, 0x80]],
    ["the byte FE", [0xfe]],
  ])("refuses %s inside a string value", async (_label, invalid) => {
    const bytes = [...utf8('{"a":"'), ...invalid, ...utf8('"}')];
    const error = await thrownBy(() => readJsonBody(postBytes(bytes)));
    expect(error.toPublic()).toEqual(INVALID_JSON_PUBLIC);
    expect(error.cause).toBeUndefined();
  });

  it("refuses an invalid sequence in a key, between tokens, and at either end", async () => {
    const cases = [
      [...utf8('{"'), 0xff, ...utf8('":1}')],
      [...utf8('{"a":1'), 0xff, ...utf8("}")],
      [0xff, ...utf8('{"a":1}')],
      [...utf8('{"a":1}'), 0xff],
      [0xff],
    ];
    for (const bytes of cases) {
      const error = await thrownBy(() => readJsonBody(postBytes(bytes)));
      expect(error.toPublic()).toEqual(INVALID_JSON_PUBLIC);
    }
  });

  it("never hands out a replacement character the client did not send", async () => {
    // Two different invalid bodies must not become one value; both are refused.
    for (const invalid of [0xff, 0xfe]) {
      const bytes = [...utf8('{"a":"'), invalid, ...utf8('"}')];
      const outcome = await readJsonBody(postBytes(bytes)).then(
        (value) => JSON.stringify(value),
        () => "refused",
      );
      expect(outcome).toBe("refused");
    }
    // U+FFFD that the client really sent, as its three valid bytes, is ordinary text.
    const sent = [...utf8('{"a":"'), 0xef, 0xbf, 0xbd, ...utf8('"}')];
    expect(await readJsonBody(postBytes(sent))).toEqual({ a: "�" });
  });

  it("judges a sequence that is split across two chunks as a whole", async () => {
    const inChunks = (chunks: Uint8Array[]): Request =>
      postStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      });
    const thai = utf8('{"a":"ก"}');
    // Cut in the middle of the three bytes of the Thai letter: still one valid body.
    expect(await readJsonBody(inChunks([thai.subarray(0, 7), thai.subarray(7)]))).toEqual({
      a: "ก",
    });
    // The same letter with its last byte missing.
    const broken = Uint8Array.from([...thai.subarray(0, 8), ...utf8('"}')]);
    const error = await thrownBy(() =>
      readJsonBody(inChunks([broken.subarray(0, 7), broken.subarray(7)])),
    );
    expect(error.toPublic()).toEqual(INVALID_JSON_PUBLIC);
  });

  it("keeps accepting valid UTF-8: Thai text, four-byte characters, escapes, a byte order mark", async () => {
    const title = "เสื้อยืด \u{1f600}";
    expect(await readJsonBody(postBytes(utf8(JSON.stringify({ title }))))).toEqual({ title });
    // A character written as escapes is plain ASCII on the wire, so valid UTF-8. (A surrogate
    // half written that way passes the decoder too and is refused later: SEC-028, below.)
    expect(await readJsonBody(postBytes(utf8('{"a":"\\u0e01\\ud83d\\ude00"}')))).toEqual({
      a: "ก\u{1f600}",
    });
    // A leading byte order mark is accepted and removed.
    expect(await readJsonBody(postBytes([0xef, 0xbb, 0xbf, ...utf8('{"quantity":2}')]))).toEqual({
      quantity: 2,
    });
    // Only one, and only at the start.
    const twice = [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, ...utf8("1")];
    expect((await thrownBy(() => readJsonBody(postBytes(twice)))).toPublic()).toEqual(
      INVALID_JSON_PUBLIC,
    );
  });

  it("writes no log line and echoes nothing of the body", async () => {
    const { logger, lines } = captureLog();
    const bytes = [...utf8('{"note":"MARKER-IN-BODY'), 0xff, ...utf8('"}')];
    const error = await thrownBy(() => readJsonBody(postBytes(bytes)));
    const response = errorResponse(error, { requestId, logger });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("MARKER");
    expect(lines).toHaveLength(0);
  });

  it("a body over the byte limit is still 413, whatever its bytes are", async () => {
    const bytes = new Uint8Array(2_000).fill(0xff);
    const error = await thrownBy(() => readJsonBody(postBytes(bytes), { maxBytes: 1_000 }));
    expect(error.status).toBe(413);
  });
});

describe("readJsonBody refuses a string that is not well-formed Unicode (SR-05 item 11, SEC-028)", () => {
  const NOT_WELL_FORMED_PUBLIC = {
    code: "VALIDATION_ERROR",
    message: "The request is invalid.",
    details: {
      fields: [
        {
          path: "",
          code: JSON_STRING_NOT_WELL_FORMED_FIELD_CODE,
          message: "The request body contains a string that is not well-formed Unicode.",
        },
      ],
    },
  };
  const jsonPost = (text: string): Request => post(text, JSON_HEADERS);
  const HIGH = "\\ud83d";
  const LOW = "\\ude00";

  async function expectRefused(text: string, options = {}): Promise<void> {
    // The control under test is the only thing between this body and a parsed value: the bytes
    // are valid UTF-8, the text is valid JSON, and the parser hands out the half (written back
    // as an escape by `JSON.stringify`, which is how it is seen here).
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(utf8(text)), text).not.toThrow();
    expect(JSON.stringify(JSON.parse(text)), text).toMatch(/\\ud[89a-f][0-9a-f]{2}/);
    const error = await thrownBy(() => readJsonBody(jsonPost(text), options));
    expect(error.status, text).toBe(400);
    expect(error.toPublic(), text).toEqual(NOT_WELL_FORMED_PUBLIC);
    expect(error.cause, text).toBeUndefined();
  }

  it("the reproduction of SEC-028: a surrogate half written as an escape is 400", async () => {
    await expectRefused(`{"note":"A${HIGH}B"}`);
    // Without the refusal, two different bodies would be stored as one value, A U+FFFD B.
    const stored = (text: string): number[] =>
      Array.from(utf8((JSON.parse(text) as { note: string }).note));
    expect(stored(`{"note":"A${HIGH}B"}`)).toEqual(stored('{"note":"A\\ud83eB"}'));
    await expectRefused('{"note":"A\\ud83eB"}');
  });

  it.each([
    ["a high half alone", `"${HIGH}"`],
    ["a low half alone", `"${LOW}"`],
    ["the first and the last half there is", '["\\ud800","\\udfff"]'],
    ["a high half at the end of a string", `"abc${HIGH}"`],
    ["a low half at the start of a string", `"${LOW}abc"`],
    ["two high halves", `"${HIGH}${HIGH}"`],
    ["a pair in the wrong order", `"${LOW}${HIGH}"`],
    ["a high half followed by an escaped character that is not a low half", `"${HIGH}\\u0041"`],
    ["a half next to a complete pair", `"${HIGH}${LOW}${HIGH}"`],
    ["a half written with upper-case digits", '"\\uD83D"'],
    ["a half between Thai letters", `"ก${HIGH}ข"`],
    ["a half in a key", `{"k${HIGH}":1}`],
    ["a half that is the whole key", `{"${LOW}":1}`],
    ["a half in a key of an inner object", `{"a":{"b":[{"c${HIGH}":null}]}}`],
    ["a half in the last element of an array", `[1,true,null,"ok","${HIGH}"]`],
    ["a half under the last of many keys", `{"a":"x","b":[1,2],"c":{"d":"${LOW}"}}`],
    ["a half in a key whose value is an array", `{"${HIGH}":[]}`],
    ["a half under the key __proto__", `{"__proto__":{"a":"${HIGH}"}}`],
    ["a half in a key beside the key __proto__", `{"__proto__":1,"${HIGH}":2}`],
  ])("refuses %s", async (_label, text) => {
    await expectRefused(text);
  });

  it("refuses a half at every depth the nesting limit allows, in arrays and in objects", async () => {
    for (const depth of [1, 2, 31, 32]) {
      await expectRefused(`${"[".repeat(depth)}"${HIGH}"${"]".repeat(depth)}`);
      await expectRefused(`${'{"k":'.repeat(depth)}"${LOW}"${"}".repeat(depth)}`);
      await expectRefused(`${'{"k":'.repeat(depth - 1)}{"${HIGH}":1}${"}".repeat(depth - 1)}`);
    }
  });

  it("keeps accepting well-formed text, however it is written", async () => {
    const accepted: [string, unknown][] = [
      [`"${HIGH}${LOW}"`, "\u{1f600}"],
      ['"\\uD83D\\uDE00"', "\u{1f600}"],
      [`"${HIGH}${LOW}${HIGH}${LOW}"`, "\u{1f600}\u{1f600}"],
      ['"\\ud7ff\\ue000"', "퟿"],
      ['"\\ufffd"', "�"],
      ['"\\u0000"', "\u0000"],
      // An escaped backslash followed by the letters: six ordinary characters, not an escape.
      ['"\\\\ud83d"', "\\ud83d"],
      [`{"${HIGH}${LOW}":"${HIGH}${LOW}"}`, { "\u{1f600}": "\u{1f600}" }],
      [JSON.stringify({ title: "เสื้อยืด \u{1f600}", tags: ["ก", "\u{10ffff}"] }), undefined],
      ["[]", []],
      ["{}", {}],
      ['""', ""],
      ["null", null],
      ["0", 0],
      ["true", true],
    ];
    for (const [text, expected] of accepted) {
      const value = await readJsonBody(jsonPost(text));
      expect(value, text).toEqual(expected === undefined ? JSON.parse(text) : expected);
      expect(JSON.stringify(value).isWellFormed(), text).toBe(true);
    }
  });

  it("hands out the parsed value itself when nothing is refused, __proto__ key included", async () => {
    const value = (await readJsonBody(jsonPost('{"__proto__":{"a":"ok"},"b":[1]}'))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(value)).toEqual(["__proto__", "b"]);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).a).toBeUndefined();
  });

  it("the other refusals come first: too large is 413, too deep and not JSON keep their answers", async () => {
    const large = `"${HIGH}${"a".repeat(2_000)}"`;
    expect((await thrownBy(() => readJsonBody(jsonPost(large), { maxBytes: 1_000 }))).status).toBe(
      413,
    );
    const deep = `${"[".repeat(33)}"${HIGH}"${"]".repeat(33)}`;
    const tooDeep = await thrownBy(() => readJsonBody(jsonPost(deep)));
    expect(tooDeep.toPublic().details).toEqual({
      fields: [
        {
          path: "",
          code: JSON_TOO_DEEP_FIELD_CODE,
          message: "The request body nests arrays and objects more than 32 levels deep.",
        },
      ],
    });
    const notJson = await thrownBy(() => readJsonBody(jsonPost(`{"a":"${HIGH}"`)));
    expect(notJson.toPublic()).toEqual(INVALID_JSON_PUBLIC);
    // An escape that is not four hexadecimal digits is not JSON at all.
    const badEscape = await thrownBy(() => readJsonBody(jsonPost('"\\ud83"')));
    expect(badEscape.toPublic()).toEqual(INVALID_JSON_PUBLIC);
  });

  it("writes no log line and echoes nothing of the body, in the error or in the response", async () => {
    const { logger, lines } = captureLog();
    const text = `{"note":"MARKER-IN-BODY${HIGH}","MARKER-IN-KEY${LOW}":1}`;
    const error = await thrownBy(() => readJsonBody(jsonPost(text)));
    expect(`${String(error)}\n${error.stack ?? ""}\n${JSON.stringify(error)}`).not.toContain(
      "MARKER",
    );
    const response = errorResponse(error, { requestId, logger });
    expect(response.status).toBe(400);
    const sent = await response.text();
    expect(sent).not.toContain("MARKER");
    expect(sent).not.toMatch(/\\ud[89a-f]/i);
    expect(sent.isWellFormed()).toBe(true);
    expect(lines).toHaveLength(0);
  });

  it("the walk does not recurse and follows the size of the document, at the 1 MiB ceiling", async () => {
    const ceiling = { maxBytes: MAX_JSON_BODY_LIMIT_BYTES };
    const megabyte = MAX_JSON_BODY_LIMIT_BYTES;
    // The half is the very last thing in each document, so the whole of it is walked.
    const shapes: [string, string][] = [
      ["a flat array of numbers", `[${"0,".repeat((megabyte - 20) / 2)}"${HIGH}"]`],
      ["a flat array of short strings", `[${'"a",'.repeat((megabyte - 20) / 4)}"${HIGH}"]`],
      ["many empty arrays", `[${"[],".repeat((megabyte - 20) / 3)}"${HIGH}"]`],
      ["many small objects", `[${'{"a":1},'.repeat((megabyte - 24) / 8)}"${HIGH}"]`],
      ["one long string", `["${"a".repeat(megabyte - 20)}","${HIGH}"]`],
      [
        "many keys in one object",
        `{${Array.from({ length: 60_000 }, (_, index) => `"k${index}":"v"`).join(",")},"z":"${HIGH}"}`,
      ],
      [
        "a comb at the nesting limit",
        `[${`${"[".repeat(31)}${"]".repeat(31)},`.repeat(16_000)}"${HIGH}"]`,
      ],
    ];
    for (const [name, text] of shapes) {
      expect(utf8(text).byteLength, name).toBeLessThanOrEqual(megabyte);
      const started = performance.now();
      await expectRefused(text, ceiling);
      // A megabyte is read, scanned, parsed, and walked in well under a second on any machine.
      expect(performance.now() - started, name).toBeLessThan(1_500);
    }
    // The same shapes without the half are accepted: the walk refuses nothing by its size.
    const flat = `[${"0,".repeat((megabyte - 20) / 2)}"ok"]`;
    expect(await readJsonBody(jsonPost(flat), ceiling)).toHaveLength((megabyte - 20) / 2 + 1);
  }, 60_000);
});

describe("readJsonBody caps JSON nesting (SR-05 item 12, SEC-023)", () => {
  const TOO_DEEP_PUBLIC = {
    code: "VALIDATION_ERROR",
    message: "The request is invalid.",
    details: {
      fields: [
        {
          path: "",
          code: JSON_TOO_DEEP_FIELD_CODE,
          message: "The request body nests arrays and objects more than 32 levels deep.",
        },
      ],
    },
  };
  const arrays = (depth: number, inner = ""): string =>
    `${"[".repeat(depth)}${inner}${"]".repeat(depth)}`;
  const objects = (depth: number): string => `${'{"a":'.repeat(depth)}1${"}".repeat(depth)}`;
  const jsonPost = (text: string): Request => post(text, JSON_HEADERS);

  /** The depth of a parsed value, counted without recursion. */
  function depthOf(value: unknown): number {
    let deepest = 0;
    const stack: [unknown, number][] = [[value, 0]];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      const [current, depth] = next;
      if (typeof current !== "object" || current === null) continue;
      deepest = Math.max(deepest, depth + 1);
      for (const child of Object.values(current)) stack.push([child, depth + 1]);
    }
    return deepest;
  }

  it("the number is 32", () => {
    expect(MAX_JSON_NESTING_DEPTH).toBe(32);
  });

  it("the reproduction of SEC-023: 33 arrays inside one another are 400 VALIDATION_ERROR", async () => {
    const error = await thrownBy(() => readJsonBody(jsonPost(arrays(33))));
    expect(error.status).toBe(400);
    expect(error.toPublic()).toEqual(TOO_DEEP_PUBLIC);
    expect(error.cause).toBeUndefined();
  });

  it("accepts exactly 32 levels of arrays, of objects, and of both mixed", async () => {
    expect(depthOf(await readJsonBody(jsonPost(arrays(32))))).toBe(32);
    expect(depthOf(await readJsonBody(jsonPost(objects(32))))).toBe(32);
    const mixed = `${'[{"a":'.repeat(16)}1${"}]".repeat(16)}`;
    expect(depthOf(await readJsonBody(jsonPost(mixed)))).toBe(32);
  });

  it.each([
    ["33 arrays", arrays(33)],
    ["33 objects", objects(33)],
    ["17 arrays each holding an object", `${'[{"a":'.repeat(17)}1${"}]".repeat(17)}`],
    ["33 arrays behind a wide first level", `[1,2,3,{"a":"b"},${arrays(32)}]`],
    ["33 levels after blanks and line breaks", ` \n\t${arrays(33)}\n`],
    ["33 levels with blanks between the brackets", `${"[ ".repeat(33)}${"] ".repeat(33)}`],
  ])("refuses %s", async (_label, text) => {
    const error = await thrownBy(() => readJsonBody(jsonPost(text)));
    expect(error.toPublic()).toEqual(TOO_DEEP_PUBLIC);
  });

  it("counts the deepest point, not the number of brackets", async () => {
    // 1,000 arrays side by side are depth 2.
    const wide = `[${Array.from({ length: 1_000 }, () => "[]").join(",")}]`;
    expect(depthOf(await readJsonBody(jsonPost(wide)))).toBe(2);
    // Going down to 32 and back up, twice, is still 32.
    expect(depthOf(await readJsonBody(jsonPost(`[${arrays(31)},${arrays(31)}]`)))).toBe(32);
  });

  it("does not count brackets inside a string, and an escaped quote does not end the string", async () => {
    const brackets = "[{".repeat(100);
    expect(await readJsonBody(jsonPost(JSON.stringify({ a: brackets })))).toEqual({ a: brackets });
    const tricky = { a: `\\"${brackets}\\\\"`, 'k"[[[[': [brackets] };
    expect(await readJsonBody(jsonPost(JSON.stringify(tricky)))).toEqual(tricky);
    // A string cannot hide real nesting behind it either.
    for (const first of ['"\\\\"', '"a\\""', '"\\\\\\""']) {
      const hidden = `[${first},${arrays(32)}]`;
      expect(() => JSON.parse(hidden) as unknown).not.toThrow();
      expect((await thrownBy(() => readJsonBody(jsonPost(hidden)))).toPublic()).toEqual(
        TOO_DEEP_PUBLIC,
      );
    }
  });

  it("a text that is not JSON is refused with 400 whether or not it is deep", async () => {
    for (const text of ["[".repeat(33), "{".repeat(33), "]".repeat(40), `${arrays(33)}x`]) {
      expect((await thrownBy(() => readJsonBody(jsonPost(text)))).status).toBe(400);
    }
    // Closing brackets that open nothing do not buy extra depth.
    const closersFirst = `${"]".repeat(10)}${arrays(33)}`;
    expect((await thrownBy(() => readJsonBody(jsonPost(closersFirst)))).toPublic()).toEqual(
      TOO_DEEP_PUBLIC,
    );
  });

  it("is applied at the ceiling as well, and after the 413", async () => {
    const options = { maxBytes: MAX_JSON_BODY_LIMIT_BYTES };
    const half = MAX_JSON_BODY_LIMIT_BYTES / 2;
    const deepest = await thrownBy(() => readJsonBody(jsonPost(arrays(half)), options));
    expect(deepest.toPublic()).toEqual(TOO_DEEP_PUBLIC);
    // Too large and too deep is 413: the size is judged first.
    expect((await thrownBy(() => readJsonBody(jsonPost(arrays(half))))).status).toBe(413);
  });

  it("costs time in proportion to the body, also for the worst bodies at the ceiling", async () => {
    const options = { maxBytes: MAX_JSON_BODY_LIMIT_BYTES };
    const bodies = [
      // Never deeper than 32, so the whole text is scanned: down and up again all the way.
      `[${Array.from({ length: 15_000 }, () => arrays(31)).join(",")}]`,
      // One long string of brackets and backslashes.
      JSON.stringify({ a: "[\\".repeat(170_000) }),
    ];
    for (const body of bodies) {
      expect(utf8(body).byteLength).toBeGreaterThan(500_000);
      expect(utf8(body).byteLength).toBeLessThanOrEqual(MAX_JSON_BODY_LIMIT_BYTES);
      const started = performance.now();
      await readJsonBody(jsonPost(body), options);
      expect(performance.now() - started).toBeLessThan(2_000);
    }
  });

  it("the deepest value handed out can be walked by recursion", async () => {
    const walk = (value: unknown): number =>
      typeof value === "object" && value !== null
        ? 1 + Math.max(0, ...Object.values(value).map(walk))
        : 0;
    expect(walk(await readJsonBody(jsonPost(arrays(32))))).toBe(32);
  });

  it("writes no log line and echoes nothing of the body", async () => {
    const { logger, lines } = captureLog();
    const error = await thrownBy(() => readJsonBody(jsonPost(arrays(33, '"MARKER-IN-BODY"'))));
    const response = errorResponse(error, { requestId, logger });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("MARKER");
    expect(lines).toHaveLength(0);
  });
});

describe("a request body that stops arriving (SR-05 item 10, SEC-024)", () => {
  const MARKER = "QZXVMARKER";

  /** A body that delivers `chunksBefore` chunks holding the marker and then fails with `failure`. */
  function breakingOff(failure: unknown, chunksBefore = 2) {
    const taken = { reads: 0 };
    const request = postStream({
      pull(controller) {
        taken.reads += 1;
        if (taken.reads > chunksBefore) controller.error(failure);
        else controller.enqueue(utf8(`"${MARKER}`));
      },
    });
    return { request, taken };
  }

  /** A logger at the lowest level, so that nothing written is missed. */
  function captureAll() {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line), requestId });
    return { logger, lines };
  }

  it("the provisional answer is an existing code with a status below 500 (8.2-13)", () => {
    expect(ERROR_CODES).toContain(ABORTED_BODY_ERROR_CODE);
    expect(ERROR_STATUS[ABORTED_BODY_ERROR_CODE]).toBeGreaterThanOrEqual(400);
    expect(ERROR_STATUS[ABORTED_BODY_ERROR_CODE]).toBeLessThan(500);
    const error = requestBodyAborted(new Error("x"));
    expect(error.code).toBe(ABORTED_BODY_ERROR_CODE);
    expect(error.status).toBe(ERROR_STATUS[ABORTED_BODY_ERROR_CODE]);
  });

  it("the reproduction of SEC-024: below 500, one warn line, no stack, nothing of the body", async () => {
    const failure = Object.assign(new Error(`aborted after ${MARKER}`), { code: "ECONNRESET" });
    const { request, taken } = breakingOff(failure);
    const error = await rejectionOf(readJsonBody(request));

    expect(error).toBeInstanceOf(RequestBodyAbortedError);
    expect(error).toBeInstanceOf(AppError);
    const aborted = error as RequestBodyAbortedError;
    // The source's error is not kept: no cause, no message, no stack of it.
    expect(aborted.cause).toBeUndefined();
    expect(String(aborted)).not.toContain(MARKER);
    expect(JSON.stringify(aborted)).not.toContain(MARKER);
    expect(JSON.stringify(aborted)).not.toContain("ECONNRESET");
    // Nothing is read after the failure.
    expect(taken.reads).toBe(3);

    const { logger, lines } = captureAll();
    const response = errorResponse(error, { requestId, logger });
    expect(response.status).toBeLessThan(500);
    expect(response.status).toBe(ERROR_STATUS[ABORTED_BODY_ERROR_CODE]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("ECONNRESET");
    expect(text).not.toContain("INTERNAL_ERROR");

    expect(lines).toHaveLength(1);
    const logged = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(Object.keys(logged).sort()).toEqual([
      "code",
      "level",
      "message",
      "requestId",
      "sourceCode",
      "sourceError",
      "status",
      "timestamp",
    ]);
    expect(logged).toMatchObject({
      level: "warn",
      message: "Request body was not received completely",
      requestId,
      code: ABORTED_BODY_ERROR_CODE,
      status: response.status,
      sourceError: "Error",
      sourceCode: "ECONNRESET",
    });
    expect(lines[0]).not.toContain(MARKER);
    expect(lines[0]).not.toContain("stack");
    expect(lines[0]).not.toContain("http.ts");
    expect(lines[0]).not.toContain("clientIp");
  });

  it("the public answer is the provisional one and says nothing about the source", async () => {
    const { request } = breakingOff(new TypeError("terminated"));
    const error = await thrownBy(() => readJsonBody(request));
    expect(error.toPublic()).toEqual({
      code: "VALIDATION_ERROR",
      message: "The request is invalid.",
      details: {
        fields: [
          {
            path: "",
            code: "invalid_json",
            message: "The request body was not received completely.",
          },
        ],
      },
    });
  });

  it.each([
    ["before the first byte", 0],
    ["after one chunk", 1],
    ["after many chunks", 50],
  ])("a failure %s is the same client error", async (_label, chunksBefore) => {
    const { request, taken } = breakingOff(new Error("socket hang up"), chunksBefore);
    const error = await rejectionOf(readJsonBody(request));
    expect(error).toBeInstanceOf(RequestBodyAbortedError);
    expect(taken.reads).toBe(chunksBefore + 1);
  });

  it("a source whose pull throws, and one that rejects, are the same client error", async () => {
    const throwing = postStream({
      pull() {
        throw new RangeError("pull threw");
      },
    });
    const rejecting = postStream({
      pull() {
        return Promise.reject(new Error("pull rejected"));
      },
    });
    const first = await rejectionOf(readJsonBody(throwing));
    expect(first).toBeInstanceOf(RequestBodyAbortedError);
    expect((first as RequestBodyAbortedError).sourceErrorName).toBe("RangeError");
    expect(await rejectionOf(readJsonBody(rejecting))).toBeInstanceOf(RequestBodyAbortedError);
  });

  it("copies only a short class name and code, whatever the source failed with", () => {
    const labelsOf = (source: unknown) => {
      const error = requestBodyAborted(source);
      return [error.sourceErrorName, error.sourceErrorCode];
    };
    expect(labelsOf(new DOMException("gone", "AbortError"))).toEqual(["AbortError", "20"]);
    expect(labelsOf(Object.assign(new Error("x"), { code: "UND_ERR_SOCKET" }))).toEqual([
      "Error",
      "UND_ERR_SOCKET",
    ]);
    expect(labelsOf(Object.assign(new Error("x"), { code: 104 }))).toEqual(["Error", "104"]);
    // Not an error at all, or an error that carries nothing usable.
    for (const source of [
      undefined,
      null,
      "a text with MARKER",
      42,
      Symbol("s"),
      () => undefined,
    ]) {
      expect(labelsOf(source)).toEqual([undefined, undefined]);
    }
    expect(labelsOf({ name: { nested: true }, code: ["E"] })).toEqual([undefined, undefined]);
    expect(labelsOf({ name: "", code: Number.NaN })).toEqual([undefined, undefined]);
    // The longest label that is kept has 64 characters; a longer one is dropped, not cut
    // (SEC-027). A getter that throws is survived.
    expect(labelsOf({ name: "N".repeat(64), code: "C".repeat(64) })).toEqual([
      "N".repeat(64),
      "C".repeat(64),
    ]);
    expect(labelsOf({ name: "N".repeat(65), code: "C".repeat(65) })).toEqual([
      undefined,
      undefined,
    ]);
    expect(labelsOf({ name: "N".repeat(5_000), code: "C".repeat(5_000) })).toEqual([
      undefined,
      undefined,
    ]);
    const hostile = {
      get name(): string {
        throw new Error("name getter");
      },
      get code(): string {
        throw new Error("code getter");
      },
    };
    expect(labelsOf(hostile)).toEqual([undefined, undefined]);
    expect(requestBodyAborted().sourceErrorName).toBeUndefined();
  });

  it("the reproduction of SEC-027: a label that is free text is not written, and nothing stands in for it", async () => {
    const text = `${MARKER} free text, 0812345678, 12 Sukhumvit Road`;
    // Short enough to have been written whole before the fix.
    expect(text.length).toBeLessThanOrEqual(64);
    const { request } = breakingOff(Object.assign(new Error("x"), { name: text, code: text }));
    const error = await rejectionOf(readJsonBody(request));
    expect((error as RequestBodyAbortedError).sourceErrorName).toBeUndefined();
    expect((error as RequestBodyAbortedError).sourceErrorCode).toBeUndefined();
    const { logger, lines } = captureAll();
    errorResponse(error, { requestId, logger });
    // Still exactly the one line, with the fields absent: no placeholder, no note of the drop.
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(
      ["code", "level", "message", "requestId", "status", "timestamp"].sort(),
    );
    expect(line).toMatchObject({
      level: "warn",
      message: "Request body was not received completely",
    });
    for (const leaked of [MARKER, "free text", "0812345678", "Sukhumvit"]) {
      expect(lines[0]).not.toContain(leaked);
    }
  });

  it("keeps a label only when it has the form of a class name or of an error code (SEC-027)", () => {
    const nameOf = (name: unknown) => requestBodyAborted({ name }).sourceErrorName;
    const codeOf = (code: unknown) => requestBodyAborted({ code }).sourceErrorCode;

    for (const name of ["Error", "TypeError", "AbortError", "_Private", "$jq", "E", "Http2Error"]) {
      expect(nameOf(name), name).toBe(name);
    }
    for (const code of [
      "ECONNRESET",
      "UND_ERR_SOCKET",
      "ERR_STREAM_PREMATURE_CLOSE",
      "E",
      "20",
      "-4077",
      "a.b-c_d",
    ]) {
      expect(codeOf(code), code).toBe(code);
    }
    // A numeric code is written as its digits; a number is never a class name.
    expect(codeOf(104)).toBe("104");
    expect(codeOf(-4077)).toBe("-4077");
    expect(codeOf(0)).toBe("0");
    expect(codeOf(1.5)).toBe("1.5");
    expect(codeOf(1e21)).toBeUndefined(); // "1e+21": the `+` is not of the form
    expect(codeOf(Number.NaN)).toBeUndefined();
    expect(codeOf(Number.NEGATIVE_INFINITY)).toBeUndefined();
    expect(nameOf(12)).toBeUndefined();

    const refusedAsEither = [
      "",
      " ",
      "two words",
      "Error ",
      " Error",
      "Error\n",
      "\nError",
      "Error\r",
      "Error ",
      "Error\u0000",
      'a\n{"level":"error"}',
      "somchai@example.com",
      "0812345678 somchai",
      "12 Sukhumvit Road",
      "password=hunter2",
      "token:abc",
      "https://user:pw@host.example/",
      "a/b",
      "a\\b",
      "a,b",
      "(x)",
      '"quoted"',
      "<b>",
      "ก",
      "Ｅｒｒｏｒ",
      "Errór",
      "\u{1f600}",
    ];
    for (const text of refusedAsEither) {
      expect(nameOf(text), JSON.stringify(text)).toBeUndefined();
      expect(codeOf(text), JSON.stringify(text)).toBeUndefined();
    }
    // The two forms differ: a name is an identifier, a code may start with a digit or hold `.`
    // and `-`, and `$` belongs to names only.
    for (const text of ["1Error", "a.b", "a-b", "-4077", "0812345678", "."]) {
      expect(nameOf(text), text).toBeUndefined();
      expect(codeOf(text), text).toBe(text);
    }
    expect(nameOf("$jq")).toBe("$jq");
    expect(codeOf("$jq")).toBeUndefined();
    // Not a string and not a number: nothing is converted, so no `toString` of the value runs.
    let conversions = 0;
    const sly = {
      toString() {
        conversions += 1;
        return "Error";
      },
    };
    expect(nameOf(sly)).toBeUndefined();
    expect(codeOf(sly)).toBeUndefined();
    expect(codeOf(BigInt(10))).toBeUndefined();
    expect(codeOf(true)).toBeUndefined();
    expect(conversions).toBe(0);
  });

  it("never logs the source's message, stack, or other properties, and redacts the two it copies", async () => {
    const failure = Object.assign(new Error("password=hunter2 somchai@example.com"), {
      name: "somchai@example.com",
      code: "token=abc123SECRET",
      meta: { target: "User_email_key", row: MARKER },
      clientIp: "203.0.113.9",
    });
    const { request } = breakingOff(failure);
    const error = await rejectionOf(readJsonBody(request));
    const { logger, lines } = captureAll();
    errorResponse(error, { requestId, logger });
    expect(lines).toHaveLength(1);
    for (const leaked of [
      "hunter2",
      "somchai@example.com",
      "abc123SECRET",
      "User_email_key",
      MARKER,
      "203.0.113.9",
      "meta",
      "stack",
    ]) {
      expect(lines[0]).not.toContain(leaked);
    }
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "warn" });
  });

  it("writes nothing at error level, at any logger level, and needs no logger", async () => {
    const error = await rejectionOf(readJsonBody(breakingOff(new Error("aborted")).request));
    const calls: string[] = [];
    const recording = {
      error: () => calls.push("error"),
      warn: () => calls.push("warn"),
    };
    expect(errorResponse(error, { requestId, logger: recording }).status).toBeLessThan(500);
    expect(calls).toEqual(["warn"]);
    // A logger that drops warn lines writes nothing at all.
    const lines: string[] = [];
    const errorsOnly = createLogger({ level: "error", write: (line) => lines.push(line) });
    errorResponse(error, { requestId, logger: errorsOnly });
    expect(lines).toHaveLength(0);
    expect(errorResponse(error, { requestId }).status).toBeLessThan(500);
  });

  it("the reader's own refusals stay server faults at error level", async () => {
    const notBytes = postStream({
      pull(controller) {
        (controller as unknown as ReadableStreamDefaultController<unknown>).enqueue("text");
      },
    });
    const alreadyRead = post('{"quantity":2}', JSON_HEADERS);
    await alreadyRead.text();
    for (const request of [notBytes, alreadyRead]) {
      const error = await rejectionOf(readJsonBody(request));
      expect(error).toBeInstanceOf(TypeError);
      expect(error).not.toBeInstanceOf(AppError);
      const { logger, lines } = captureAll();
      expect(errorResponse(error, { requestId, logger }).status).toBe(500);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "error", code: "INTERNAL_ERROR" });
    }
  });

  it("a body that only ends early, without an error, is judged as what arrived", async () => {
    // A stream that closes in the middle of a document is not a failed read: it is not JSON.
    const closing = postStream({
      start(controller) {
        controller.enqueue(utf8('{"quantity":'));
        controller.close();
      },
    });
    const error = await thrownBy(() => readJsonBody(closing));
    expect(error).not.toBeInstanceOf(RequestBodyAbortedError);
    expect(error.toPublic()).toEqual(INVALID_JSON_PUBLIC);
  });
});

describe("handler pattern in the order of refusals (CR-09; D-031 point 4, D-032 point 1)", () => {
  const APP_ORIGIN = "https://shop.example";
  const RULE = { name: "pattern-test", limit: 2, windowMs: 60_000, maxKeys: 100 };

  interface TestActor {
    userId: string;
    role: "CUSTOMER" | "SELLER" | "ADMIN";
    storeStatus?: "APPROVED" | "SUSPENDED";
  }

  // Stand-ins for the guards that auth writes in T-015. Only their place in the order is tested.
  function requireActor(request: Request): TestActor {
    const session = request.headers.get("x-test-session");
    if (session === null) throw unauthenticated();
    return JSON.parse(session) as TestActor;
  }
  function assertRole(actor: TestActor, role: TestActor["role"]): void {
    if (actor.role !== role) throw forbidden();
  }
  function assertStoreApproved(actor: TestActor): void {
    if (actor.storeStatus !== "APPROVED") throw sellerNotApproved();
  }

  /** The pattern of the file comment of src/server/http.ts, call for call. */
  function makeHandler() {
    const limiter = createRateLimiter({ rules: [RULE] });
    const served: unknown[] = [];
    async function handler(request: Request): Promise<Response> {
      try {
        assertSameOrigin(request, APP_ORIGIN);
        assertContentType(request, JSON_CONTENT_TYPE);
        const actor = requireActor(request);
        assertRole(actor, "SELLER");
        assertStoreApproved(actor);
        const limit = await limiter.consume(actor.userId, RULE);
        if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds);
        const body = await readJsonBody(request, { maxBytes: 1_000 });
        const input = parseInput(cartSchema, body);
        served.push(input);
        return ok(input, { requestId });
      } catch (error) {
        return errorResponse(error, { requestId });
      }
    }
    return { handler, served };
  }

  const SELLER: TestActor = { userId: "u_seller", role: "SELLER", storeStatus: "APPROVED" };
  const SUSPENDED: TestActor = { userId: "u_suspended", role: "SELLER", storeStatus: "SUSPENDED" };
  const CUSTOMER: TestActor = { userId: "u_customer", role: "CUSTOMER" };

  interface Sent {
    origin?: string;
    contentType?: string;
    actor?: TestActor;
    body: string;
  }

  /** A request whose body records whether anything was taken from it. */
  function send(sent: Sent) {
    const taken = { reads: 0 };
    const headers = new Headers();
    if (sent.origin !== undefined) headers.set("origin", sent.origin);
    if (sent.contentType !== undefined) headers.set("content-type", sent.contentType);
    if (sent.actor !== undefined) headers.set("x-test-session", JSON.stringify(sent.actor));
    let done = false;
    const request = new Request(`${APP_ORIGIN}/api/v1/seller/products`, {
      method: "POST",
      headers,
      body: new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            taken.reads += 1;
            if (done) controller.close();
            else controller.enqueue(utf8(sent.body));
            done = true;
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: "half",
    } as RequestInit);
    return { request, taken };
  }

  async function answer(handler: (request: Request) => Promise<Response>, sent: Sent) {
    const { request, taken } = send(sent);
    const response = await handler(request);
    const body = (await read(response)) as { error?: { code: string } };
    return { status: response.status, code: body.error?.code, reads: taken.reads };
  }

  const INVALID = '{"quantity":"two","storeId":"s_other"}';
  const TOO_LARGE = `"${"a".repeat(5_000)}"`;
  const VALID = '{"quantity":2}';
  const good = { origin: APP_ORIGIN, contentType: "application/json", actor: SELLER };

  it("the file comment of http.ts shows the calls in the order of section 1.8", () => {
    const source = readFileSync(fileURLToPath(new URL("./http.ts", import.meta.url)), "utf8");
    const comment = source.slice(0, source.indexOf("\nimport "));
    const calls = [
      "assertSameOrigin(request, appOrigin)",
      "assertContentType(request, JSON_CONTENT_TYPE)",
      "requireActor(request)",
      "assertRole(actor",
      "assertStoreApproved(actor)",
      "rateLimiter.consume(actor.userId",
      "throw rateLimited(",
      "readJsonBody(request)",
      "parseInput(bodySchema, body)",
      "service(actor, input)",
      "errorResponse(error, { requestId, logger: log })",
    ];
    const positions = calls.map((call) => comment.indexOf(call));
    expect(positions.every((position) => position !== -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // The withdrawn order is gone.
    expect(comment).not.toContain("requireUser");
    expect(comment).not.toContain("size-limited read, schema validation");
  });

  it("a request that fails every check is answered by the first check, and each next one in turn", async () => {
    const { handler, served } = makeHandler();
    const steps: [Sent, number, string][] = [
      [{ body: TOO_LARGE }, 403, "FORBIDDEN"],
      [{ origin: "https://evil.example", body: TOO_LARGE }, 403, "FORBIDDEN"],
      [{ origin: APP_ORIGIN, body: TOO_LARGE }, 415, "UNSUPPORTED_MEDIA_TYPE"],
      [
        { origin: APP_ORIGIN, contentType: "text/plain", body: TOO_LARGE },
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      ],
      [
        { origin: APP_ORIGIN, contentType: "application/json", body: TOO_LARGE },
        401,
        "UNAUTHENTICATED",
      ],
      [{ ...good, actor: CUSTOMER, body: TOO_LARGE }, 403, "FORBIDDEN"],
      [{ ...good, actor: SUSPENDED, body: TOO_LARGE }, 403, "SELLER_NOT_APPROVED"],
    ];
    for (const [sent, status, code] of steps) {
      const outcome = await answer(handler, sent);
      expect([outcome.status, outcome.code]).toEqual([status, code]);
      // Steps 1 to 4 never touch the body.
      expect(outcome.reads).toBe(0);
    }
    // Step 6 before step 7: too large and invalid is 413.
    expect(await answer(handler, { ...good, body: TOO_LARGE })).toMatchObject({ status: 413 });
    expect(served).toHaveLength(0);
  });

  it("an anonymous caller, a wrong role, and a suspended seller are refused whatever the body is", async () => {
    const { handler } = makeHandler();
    for (const body of [VALID, INVALID, "not json", TOO_LARGE]) {
      const base = { origin: APP_ORIGIN, contentType: "application/json", body };
      expect(await answer(handler, base)).toEqual({
        status: 401,
        code: "UNAUTHENTICATED",
        reads: 0,
      });
      expect(await answer(handler, { ...base, actor: CUSTOMER })).toEqual({
        status: 403,
        code: "FORBIDDEN",
        reads: 0,
      });
      // D-032 point 1: not 400, also for an invalid body.
      expect(await answer(handler, { ...base, actor: SUSPENDED })).toEqual({
        status: 403,
        code: "SELLER_NOT_APPROVED",
        reads: 0,
      });
    }
  });

  it("the rate limit comes after the access level and before the body is read", async () => {
    const { handler, served } = makeHandler();
    // Refused at steps 1 to 4: none of the allowance is used, however often.
    for (let round = 0; round < 10; round += 1) {
      await answer(handler, { ...good, origin: "https://evil.example", body: VALID });
      await answer(handler, { ...good, contentType: "text/plain", body: VALID });
      await answer(handler, { ...good, actor: { ...SELLER, role: "ADMIN" }, body: VALID });
      await answer(handler, {
        ...good,
        actor: { ...SELLER, storeStatus: "SUSPENDED" },
        body: VALID,
      });
    }
    // A request that reaches step 5 uses one allowance whatever happens afterwards: 400, 413.
    expect(await answer(handler, { ...good, body: INVALID })).toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    expect(await answer(handler, { ...good, body: TOO_LARGE })).toMatchObject({ status: 413 });
    // The limit of 2 is used up: 429, and the body is not read, valid or not.
    expect(await answer(handler, { ...good, body: VALID })).toEqual({
      status: 429,
      code: "RATE_LIMITED",
      reads: 0,
    });
    expect(await answer(handler, { ...good, body: TOO_LARGE })).toEqual({
      status: 429,
      code: "RATE_LIMITED",
      reads: 0,
    });
    expect(served).toHaveLength(0);
  });

  it("a permitted, valid request reaches the service", async () => {
    const { handler, served } = makeHandler();
    const outcome = await answer(handler, { ...good, body: VALID });
    expect(outcome.status).toBe(200);
    expect(outcome.reads).toBeGreaterThan(0);
    expect(served).toEqual([{ quantity: 2 }]);
  });
});
