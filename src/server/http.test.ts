import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError, conflict, ERROR_CODES, ERROR_STATUS, notFound, rateLimited } from "./errors";
import { created, errorResponse, ok, paginated, paginationMeta, toAppError } from "./http";
import { createLogger } from "./logger";
import { REQUEST_ID_HEADER } from "./request-id";

const requestId = "req-test-0001";

async function read(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

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
      headers: { "Cache-Control": "no-store", "X-Request-Id": "spoofed-value" },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
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

  it("maps a ZodError to VALIDATION_ERROR with details.fields", async () => {
    const result = z.strictObject({ quantity: z.number().int().min(1) }).safeParse({
      quantity: "two",
      priceSatang: 1,
    });
    if (result.success) throw new Error("expected the input to be rejected");

    const response = errorResponse(result.error, { requestId });
    expect(response.status).toBe(400);
    const body = (await read(response)) as {
      error: { code: string; details: { fields: { path: string }[] }; requestId: string };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.requestId).toBe(requestId);
    expect(body.error.details.fields.map((field) => field.path).sort()).toEqual(["", "quantity"]);
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

  it("logs the original error on the server for 5xx, and nothing for 4xx", () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (line) => lines.push(line), requestId });

    errorResponse(notFound(), { requestId, logger });
    expect(lines).toHaveLength(0);

    errorResponse(new Error("database exploded"), { requestId, logger });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as {
      level: string;
      requestId: string;
      code: string;
      err: { message: string; stack: string };
    };
    expect(entry).toMatchObject({ level: "error", requestId, code: "INTERNAL_ERROR" });
    expect(entry.err.message).toBe("database exploded");
    expect(typeof entry.err.stack).toBe("string");
  });
});
