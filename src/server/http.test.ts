import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AppError,
  conflict,
  ERROR_CODES,
  ERROR_STATUS,
  fromZodError,
  notFound,
  rateLimited,
} from "./errors";
import {
  assertContentType,
  assertSameOrigin,
  created,
  errorResponse,
  JSON_CONTENT_TYPE,
  MULTIPART_CONTENT_TYPE,
  ok,
  paginated,
  paginationMeta,
  parseInput,
  readJsonBody,
  toAppError,
} from "./http";
import { createLogger } from "./logger";
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
    const error = conflict({
      message: "SKU already exists.",
      details: { field: "sku" },
      cause: new Error('Unique constraint failed on "Product_storeId_sku_key"'),
    });
    const response = errorResponse(error, { requestId });
    const text = await response.text();

    expect(response.status).toBe(409);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "CONFLICT",
        message: "SKU already exists.",
        details: { field: "sku" },
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
    const response = errorResponse(conflict({ message: "SKU already exists.", cause }), {
      requestId,
      logger,
    });

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
