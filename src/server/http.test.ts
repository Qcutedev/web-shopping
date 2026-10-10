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
  created,
  errorResponse,
  ok,
  paginated,
  paginationMeta,
  parseInput,
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
