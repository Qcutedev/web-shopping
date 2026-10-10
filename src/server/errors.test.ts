import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AppError,
  conflict,
  ERROR_CODES,
  ERROR_STATUS,
  type ErrorCode,
  forbidden,
  fromZodError,
  insufficientStock,
  internalError,
  invalidStateTransition,
  isAppError,
  MAX_FIELD_ERRORS,
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

  it("does not copy the rejected value into the error", () => {
    const secret = "hunter2-super-secret-value";
    const error = fromZodError(
      parseFailure({ quantity: secret, address: { postalCode: secret }, tags: secret }),
    );
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
