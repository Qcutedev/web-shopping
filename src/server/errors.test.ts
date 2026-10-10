import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AppError,
  conflict,
  ERROR_CODES,
  ERROR_STATUS,
  type ErrorCode,
  forbidden,
  formatFieldPath,
  fromZodError,
  insufficientStock,
  internalError,
  invalidHeader,
  invalidJsonBody,
  invalidStateTransition,
  isAppError,
  MAX_FIELD_ERRORS,
  MAX_FIELD_MESSAGE_LENGTH,
  MAX_FIELD_PATH_LENGTH,
  notFound,
  orderLimitExceeded,
  payloadTooLarge,
  productUnavailable,
  rateLimited,
  RateLimitedError,
  sellerNotApproved,
  unauthenticated,
  unsupportedMediaType,
  validationError,
} from "./errors";

// Copied by hand from the table in docs/API_CONTRACTS.md so a change to either side fails here.
const DOCUMENTED: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SELLER_NOT_APPROVED: 403,
  NOT_FOUND: 404,
  INSUFFICIENT_STOCK: 409,
  PRODUCT_UNAVAILABLE: 409,
  INVALID_STATE_TRANSITION: 409,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  ORDER_LIMIT_EXCEEDED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

describe("error codes", () => {
  it("contains exactly the documented codes with the documented statuses", () => {
    expect({ ...ERROR_STATUS }).toEqual(DOCUMENTED);
    expect([...ERROR_CODES].sort()).toEqual(Object.keys(DOCUMENTED).sort());
  });

  it.each(Object.entries(DOCUMENTED))("AppError(%s) has status %i", (code, status) => {
    const error = new AppError(code as ErrorCode);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.details).toEqual({});
  });

  it("has a helper per documented code", () => {
    const made: AppError[] = [
      validationError([]),
      unauthenticated(),
      forbidden(),
      sellerNotApproved(),
      notFound(),
      insufficientStock([]),
      productUnavailable(),
      invalidStateTransition(),
      conflict(),
      payloadTooLarge(),
      unsupportedMediaType(),
      orderLimitExceeded(),
      rateLimited(30),
      internalError(),
    ];
    expect(made.map((error) => error.code).sort()).toEqual(Object.keys(DOCUMENTED).sort());
    for (const error of made) {
      expect(error.status).toBe(DOCUMENTED[error.code]);
      expect(isAppError(error)).toBe(true);
      expect(error).toBeInstanceOf(Error);
    }
  });
});

describe("AppError serialisation", () => {
  it("exposes only code, message, and details", () => {
    const cause = new Error('duplicate key violates "Product_sku_key" postgresql://u:pw@db/app');
    const error = conflict({ message: "SKU already exists.", details: { field: "sku" }, cause });

    expect(error.toPublic()).toEqual({
      code: "CONFLICT",
      message: "SKU already exists.",
      details: { field: "sku" },
    });
    const json = JSON.stringify(error);
    expect(JSON.parse(json)).toEqual(error.toPublic());
    expect(json).not.toContain("Product_sku_key");
    expect(json).not.toContain("stack");
    expect(error.cause).toBe(cause);
  });

  it("internalError never carries the cause message", () => {
    const error = internalError(new Error("SELECT * FROM users failed"));
    expect(error.message).toBe("An unexpected error occurred.");
    expect(JSON.stringify(error)).not.toContain("SELECT");
  });

  it("INTERNAL_ERROR always has the fixed public message, whatever the caller passes", () => {
    const custom = 'relation "User" does not exist; postgresql://app:pw@db:5432/shop';
    const error = new AppError("INTERNAL_ERROR", { message: custom, cause: new Error(custom) });
    expect(error.message).toBe("An unexpected error occurred.");
    expect(error.toPublic().message).toBe("An unexpected error occurred.");
    expect(JSON.stringify(error)).not.toContain("User");
    expect(JSON.stringify(error)).not.toContain("postgresql");

    // Other codes keep the caller's public message.
    expect(new AppError("CONFLICT", { message: "SKU already exists." }).message).toBe(
      "SKU already exists.",
    );
  });

  it("isAppError rejects other values", () => {
    expect(isAppError(new Error("x"))).toBe(false);
    expect(isAppError({ code: "NOT_FOUND", status: 404 })).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe("specific helpers", () => {
  it("insufficientStock puts the items under details.items", () => {
    const items = [{ productId: "p1", available: 2 }];
    expect(insufficientStock(items).details).toEqual({ items });
  });

  it("rateLimited keeps a whole, positive number of seconds", () => {
    expect(rateLimited(12.2)).toBeInstanceOf(RateLimitedError);
    expect(rateLimited(12.2).retryAfterSeconds).toBe(13);
    expect(rateLimited(0).retryAfterSeconds).toBe(1);
    expect(rateLimited(-5).retryAfterSeconds).toBe(1);
    expect(rateLimited(Number.NaN).retryAfterSeconds).toBe(1);
  });

  it("validationError caps the number of reported fields", () => {
    const many = Array.from({ length: MAX_FIELD_ERRORS + 20 }, (_, index) => ({
      path: `items.${index}`,
      code: "custom",
      message: "Invalid.",
    }));
    const fields = validationError(many).details.fields;
    expect(Array.isArray(fields) && fields.length).toBe(MAX_FIELD_ERRORS);
  });

  it("validationError caps the length of every path and message", () => {
    const error = validationError([
      { path: "p".repeat(5_000), code: "c".repeat(5_000), message: "m".repeat(5_000) },
      { path: "quantity", code: "too_small", message: "Too small." },
    ]);
    const fields = error.details.fields as { path: string; code: string; message: string }[];
    expect(fields[0]?.path).toHaveLength(MAX_FIELD_PATH_LENGTH);
    expect(fields[0]?.path.endsWith("...")).toBe(true);
    expect(fields[0]?.message).toHaveLength(MAX_FIELD_MESSAGE_LENGTH);
    expect(fields[0]?.message.endsWith("...")).toBe(true);
    expect(fields[0]?.code.length).toBeLessThanOrEqual(64);
    // Short values are passed through untouched.
    expect(fields[1]).toEqual({ path: "quantity", code: "too_small", message: "Too small." });
  });
});

describe("formatFieldPath", () => {
  it("joins segments with dots and uses the empty string for the root", () => {
    expect(formatFieldPath([])).toBe("");
    expect(formatFieldPath(["address", "postalCode"])).toBe("address.postalCode");
    expect(formatFieldPath(["items", 3, "quantity"])).toBe("items.3.quantity");
  });

  it("tells a key that contains a dot apart from nesting", () => {
    expect(formatFieldPath(["a.b"])).toBe("a\\.b");
    expect(formatFieldPath(["a", "b"])).toBe("a.b");
    expect(formatFieldPath(["a.b"])).not.toBe(formatFieldPath(["a", "b"]));
    // The escape character is escaped too, so an escaped-looking key cannot collide either.
    expect(formatFieldPath(["a\\", "b"])).toBe("a\\\\.b");
    expect(formatFieldPath(["a\\.b"])).toBe("a\\\\\\.b");
    expect(formatFieldPath(["a\\", "b"])).not.toBe(formatFieldPath(["a\\.b"]));
  });

  it("stays bounded for a very deep path", () => {
    const deep = Array.from({ length: 100_000 }, () => "segment");
    expect(formatFieldPath(deep).length).toBeLessThan(MAX_FIELD_PATH_LENGTH + 20);
  });
});

describe("fromZodError", () => {
  const schema = z.strictObject({
    quantity: z.number().int().min(1),
    address: z.object({ postalCode: z.string().length(5) }),
    tags: z.array(z.string()),
  });

  function parseFailure(input: unknown): z.ZodError {
    const result = schema.safeParse(input);
    if (result.success) throw new Error("expected the input to be rejected");
    return result.error;
  }

  it("maps issues to details.fields with dotted paths", () => {
    const error = fromZodError(
      parseFailure({ quantity: 0, address: { postalCode: "123" }, tags: ["a", 5] }),
    );

    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(400);
    const fields = error.details.fields as { path: string; code: string; message: string }[];
    expect(fields.map((field) => field.path).sort()).toEqual([
      "address.postalCode",
      "quantity",
      "tags.1",
    ]);
    for (const field of fields) {
      expect(Object.keys(field).sort()).toEqual(["code", "message", "path"]);
      expect(field.code.length).toBeGreaterThan(0);
      expect(field.message.length).toBeGreaterThan(0);
    }
  });

  it("reports unknown keys on a strict object at the object's path", () => {
    const error = fromZodError(
      parseFailure({ quantity: 1, address: { postalCode: "10110" }, tags: [], role: "ADMIN" }),
    );
    expect(error.details.fields).toEqual([
      { path: "", code: "unrecognized_keys", message: expect.stringContaining("role") },
    ]);
  });

  it("distinguishes the key a.b from nested a then b in details.fields", () => {
    const dotted = z.object({ "a.b": z.string(), a: z.object({ b: z.string() }) });
    const result = dotted.safeParse({ "a.b": 1, a: { b: 2 } });
    if (result.success) throw new Error("expected the input to be rejected");
    const fields = fromZodError(result.error).details.fields as { path: string }[];
    expect(fields.map((field) => field.path).sort()).toEqual(["a.b", "a\\.b"]);
  });

  it("keeps the response small for a body with 5,000 unknown keys", () => {
    const hostile: Record<string, unknown> = {
      quantity: 1,
      address: { postalCode: "10110" },
      tags: [],
    };
    for (let index = 0; index < 5_000; index += 1) hostile[`unknownKey${index}`] = index;

    const error = fromZodError(parseFailure(hostile));
    const fields = error.details.fields as { path: string; code: string; message: string }[];
    expect(fields).toHaveLength(1);
    expect(fields[0]?.code).toBe("unrecognized_keys");
    expect(fields[0]?.message.length).toBeLessThanOrEqual(MAX_FIELD_MESSAGE_LENGTH);
    // Without the cap this body is about 44 kB, because Zod names every unknown key.
    expect(JSON.stringify(error).length).toBeLessThan(500);
  });

  it("keeps the response bounded for thousands of invalid values under long keys", () => {
    const longKey = "k".repeat(2_000);
    const wide = z.record(z.string(), z.number());
    const input: Record<string, unknown> = {};
    for (let index = 0; index < 5_000; index += 1) input[`${longKey}${index}`] = "not a number";
    const result = wide.safeParse(input);
    if (result.success) throw new Error("expected the input to be rejected");

    const error = fromZodError(result.error);
    const fields = error.details.fields as { path: string; message: string }[];
    expect(fields).toHaveLength(MAX_FIELD_ERRORS);
    for (const field of fields) {
      expect(field.path.length).toBeLessThanOrEqual(MAX_FIELD_PATH_LENGTH);
      expect(field.message.length).toBeLessThanOrEqual(MAX_FIELD_MESSAGE_LENGTH);
    }
    expect(JSON.stringify(error).length).toBeLessThan(
      MAX_FIELD_ERRORS * (MAX_FIELD_PATH_LENGTH + MAX_FIELD_MESSAGE_LENGTH + 120),
    );
  });

  it("does not copy the rejected value into the error", () => {
    const secret = "hunter2-super-secret-value";
    const error = fromZodError(
      parseFailure({ quantity: secret, address: { postalCode: secret }, tags: secret }),
    );
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});

describe("INTERNAL_ERROR never carries details (SEC-017)", () => {
  const details = { sql: "SELECT * FROM users", target: "somchai@example.com" };

  it("forces details to {} in the constructor, next to the fixed message", () => {
    const error = new AppError("INTERNAL_ERROR", { message: "query failed", details });
    expect(error.details).toEqual({});
    expect(error.toPublic()).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      details: {},
    });
    expect(JSON.stringify(error)).not.toContain("SELECT");
    expect(JSON.stringify(error)).not.toContain("somchai");
  });

  it("keeps the cause for the log", () => {
    const cause = new Error("connection reset");
    const error = new AppError("INTERNAL_ERROR", { details, cause });
    expect(error.cause).toBe(cause);
    expect(error.details).toEqual({});
  });

  it("applies to every code whose status is 500 or above, and to no other", () => {
    for (const code of ERROR_CODES) {
      const error = new AppError(code, { details: { field: "sku" } });
      expect(error.details).toEqual(ERROR_STATUS[code] >= 500 ? {} : { field: "sku" });
    }
  });
});

describe("invalidJsonBody and invalidHeader (docs/API_CONTRACTS.md, error envelope)", () => {
  it("invalidJsonBody is a 400 VALIDATION_ERROR with one root field error", () => {
    const error = invalidJsonBody();
    expect(error.status).toBe(400);
    expect(error.cause).toBeUndefined();
    expect(error.toPublic()).toEqual({
      code: "VALIDATION_ERROR",
      message: "The request is invalid.",
      details: {
        fields: [
          { path: "", code: "invalid_json", message: "The request body is not valid JSON." },
        ],
      },
    });
  });

  it("invalidHeader is a 400 VALIDATION_ERROR whose path is the header name", () => {
    const error = invalidHeader("Idempotency-Key", "The Idempotency-Key header is required.");
    expect(error.status).toBe(400);
    expect(error.toPublic()).toEqual({
      code: "VALIDATION_ERROR",
      message: "The request is invalid.",
      details: {
        fields: [
          {
            path: "Idempotency-Key",
            code: "invalid_header",
            message: "The Idempotency-Key header is required.",
          },
        ],
      },
    });
  });
});
