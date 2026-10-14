import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ABORTED_BODY_ERROR_CODE,
  AppError,
  cartEmpty,
  conflict,
  CONFLICT_REASON_PATTERN,
  describeErrorForLog,
  ERROR_CODES,
  ERROR_STATUS,
  type ErrorCode,
  forbidden,
  formatFieldPath,
  fromZodError,
  insufficientStock,
  internalError,
  INVALID_JSON_CODE,
  invalidHeader,
  invalidJsonBody,
  invalidStateTransition,
  isAppError,
  JSON_STRING_NOT_WELL_FORMED_FIELD_CODE,
  JSON_TOO_DEEP_FIELD_CODE,
  jsonBodyTooDeep,
  jsonStringNotWellFormed,
  MAX_CONFLICT_REASON_LENGTH,
  MAX_FIELD_ERRORS,
  MAX_FIELD_MESSAGE_LENGTH,
  MAX_FIELD_PATH_LENGTH,
  notFound,
  orderLimitExceeded,
  payloadTooLarge,
  productUnavailable,
  rateLimited,
  RateLimitedError,
  requestBodyAborted,
  RequestBodyAbortedError,
  sellerNotApproved,
  unauthenticated,
  UNKNOWN_ERROR_CLASS,
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
  CART_EMPTY: 409,
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
      cartEmpty(),
      invalidStateTransition(),
      conflict("DUPLICATE_SKU"),
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
    const error = conflict("DUPLICATE_SKU", { message: "SKU already exists.", cause });

    expect(error.toPublic()).toEqual({
      code: "CONFLICT",
      message: "SKU already exists.",
      details: { reason: "DUPLICATE_SKU" },
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

describe("conflict requires a reason (CR-02; docs/API_CONTRACTS.md section 2.3)", () => {
  // The reasons the contract lists today. The list is not in the code yet (item 8.2-10).
  const DOCUMENTED_REASONS = [
    "DUPLICATE_SKU",
    "OPEN_APPLICATION",
    "DUPLICATE_REVIEW",
    "NOT_DELIVERED",
    "UPLOAD_IN_USE",
    "STALE_REVISION",
    "NEGATIVE_STOCK",
    "STOCK_LIMIT",
    "CATEGORY_INACTIVE",
    "CATEGORY_HAS_PRODUCTS",
    "SELF_DEACTIVATION",
    "LAST_ADMIN",
    "APPLICANT_NOT_CUSTOMER",
  ];

  it.each(DOCUMENTED_REASONS)("carries %s as details.reason and nothing else", (reason) => {
    const error = conflict(reason);
    expect(error.status).toBe(409);
    expect(error.toPublic()).toEqual({
      code: "CONFLICT",
      message: "The request conflicts with existing data.",
      details: { reason },
    });
  });

  it("keeps a public message and a cause, and never lets details replace the reason", () => {
    const cause = new Error("Product_storeId_sku_key");
    const error = conflict("DUPLICATE_SKU", { message: "SKU already exists.", cause });
    expect(error.message).toBe("SKU already exists.");
    expect(error.cause).toBe(cause);
    expect(error.details).toEqual({ reason: "DUPLICATE_SKU" });

    // A caller without type checking cannot pass details that drop or replace the reason.
    const untyped = conflict as unknown as (reason: string, options: object) => AppError;
    expect(untyped("LAST_ADMIN", { details: { reason: "OTHER", userId: "u_1" } }).details).toEqual({
      reason: "LAST_ADMIN",
    });
  });

  it.each([
    ["no argument", []],
    ["undefined", [undefined]],
    ["null", [null]],
    ["an empty string", [""]],
    ["blanks", ["   "]],
    ["the old options object", [{ message: "SKU already exists." }]],
    ["an options object with details", [{ details: { reason: "DUPLICATE_SKU" } }]],
    ["a number", [409]],
    ["lower case", ["duplicate_sku"]],
    ["a sentence", ["SKU already exists."]],
    ["a leading underscore", ["_DUPLICATE"]],
    ["a trailing underscore", ["DUPLICATE_"]],
    ["a doubled underscore", ["DUPLICATE__SKU"]],
    ["a leading digit", ["1DUPLICATE"]],
    ["a line break at the end", ["DUPLICATE_SKU\n"]],
    ["a reason that is too long", ["A".repeat(MAX_CONFLICT_REASON_LENGTH + 1)]],
  ])("throws a TypeError for %s", (_label, args) => {
    const untyped = conflict as unknown as (...given: unknown[]) => AppError;
    expect(() => untyped(...args)).toThrow(TypeError);
    try {
      untyped(...args);
    } catch (error) {
      // A programming error, not a domain error: it becomes a 500, never a 409 without a reason.
      expect(isAppError(error)).toBe(false);
      expect(String(error)).toBe(
        "TypeError: conflict: a reason is required, in upper case with underscores (for example DUPLICATE_SKU).",
      );
    }
  });

  it("accepts a reason of exactly the longest length", () => {
    const reason = "A".repeat(MAX_CONFLICT_REASON_LENGTH);
    expect(conflict(reason).details).toEqual({ reason });
    expect(CONFLICT_REASON_PATTERN.test("STALE_REVISION")).toBe(true);
  });
});

describe("jsonBodyTooDeep and requestBodyAborted (provisional, items 8.2-12 and 8.2-13)", () => {
  it("jsonBodyTooDeep is a 400 VALIDATION_ERROR with one root field error and no cause", () => {
    const error = jsonBodyTooDeep(32);
    expect(error.status).toBe(400);
    expect(error.cause).toBeUndefined();
    expect(error.toPublic()).toEqual({
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
    });
  });

  it("jsonStringNotWellFormed is a 400 VALIDATION_ERROR with one root field error and no cause", () => {
    const error = jsonStringNotWellFormed();
    expect(error.status).toBe(400);
    expect(error.cause).toBeUndefined();
    expect(error.toPublic()).toEqual({
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
    });
  });

  it("the provisional choices add no public code: all reuse what the contract already has", () => {
    expect(JSON_TOO_DEEP_FIELD_CODE).toBe(INVALID_JSON_CODE);
    // SEC-028 as ruled: the existing field code for a refused JSON body, until 8.2-12 is ruled.
    expect(JSON_STRING_NOT_WELL_FORMED_FIELD_CODE).toBe(INVALID_JSON_CODE);
    expect(ABORTED_BODY_ERROR_CODE).toBe("VALIDATION_ERROR");
    expect(Object.keys(DOCUMENTED)).toContain(ABORTED_BODY_ERROR_CODE);
    expect(DOCUMENTED[ABORTED_BODY_ERROR_CODE]).toBeLessThan(500);
  });

  it("requestBodyAborted is a client error that keeps nothing of the source but two labels", () => {
    const source = Object.assign(new Error("read ECONNRESET at 10.0.0.7:5432"), {
      code: "ECONNRESET",
    });
    const error = requestBodyAborted(source);
    expect(error).toBeInstanceOf(RequestBodyAbortedError);
    expect(isAppError(error)).toBe(true);
    expect(error.name).toBe("RequestBodyAbortedError");
    expect(error.status).toBeLessThan(500);
    expect(error.cause).toBeUndefined();
    expect(error.sourceErrorName).toBe("Error");
    expect(error.sourceErrorCode).toBe("ECONNRESET");
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
    // Neither label, and nothing else of the source, is in what may leave the server.
    const json = JSON.stringify(error);
    expect(JSON.parse(json)).toEqual(error.toPublic());
    for (const hidden of ["ECONNRESET", "10.0.0.7", "sourceError", "stack"]) {
      expect(json).not.toContain(hidden);
    }
    expect(error.message).not.toContain("10.0.0.7");
    expect(error.stack ?? "").not.toContain("10.0.0.7");
  });

  it("requestBodyAborted drops a label that is not a class name or an error code (SEC-027)", () => {
    const text = "MARKER free text, 0812345678, 12 Sukhumvit Road";
    const error = requestBodyAborted(Object.assign(new Error("x"), { name: text, code: text }));
    // Absent, not cut and not replaced: nothing of the text is anywhere on the error.
    expect(error.sourceErrorName).toBeUndefined();
    expect(error.sourceErrorCode).toBeUndefined();
    const everything = Reflect.ownKeys(error)
      .map((key) => String((error as unknown as Record<PropertyKey, unknown>)[key]))
      .join("\n");
    for (const leaked of ["MARKER", "0812345678", "Sukhumvit"]) {
      expect(everything).not.toContain(leaked);
    }
    // One label of the right form beside one of the wrong form: each is judged by itself.
    const mixed = requestBodyAborted({ name: "TypeError", code: "socket hang up" });
    expect([mixed.sourceErrorName, mixed.sourceErrorCode]).toEqual(["TypeError", undefined]);
    const other = requestBodyAborted({ name: "not a name", code: "ECONNRESET" });
    expect([other.sourceErrorName, other.sourceErrorCode]).toEqual([undefined, "ECONNRESET"]);
    // Each property is read once.
    const reads = { name: 0, code: 0 };
    requestBodyAborted({
      get name() {
        reads.name += 1;
        return "Error";
      },
      get code() {
        reads.code += 1;
        return "E1";
      },
    });
    expect(reads).toEqual({ name: 1, code: 1 });
  });
});

describe("describeErrorForLog (SEC-048, SR-04)", () => {
  const CANARY = "Zq7SECRETcanary";
  const QUOTED = `Invalid entry: "${CANARY}"; password=${CANARY}; somchai@example.com`;

  /** Everything a record holds, own keys included, as one text. */
  function everything(record: object): string {
    return JSON.stringify(record) + Reflect.ownKeys(record).map(String).join(",");
  }

  class BetterAuthLikeError extends Error {
    constructor(message: string) {
      super(message, { cause: new Error(QUOTED) });
      this.name = "BetterAuthError";
    }
  }
  class APIError extends Error {
    readonly status = "BAD_REQUEST";
    readonly statusCode = 400;
    readonly body = { code: "FAILED_TO_CREATE_USER", message: QUOTED };
  }
  class PrismaClientKnownRequestError extends Error {
    readonly code = "P2002";
    readonly meta = { target: [CANARY] };
    readonly clientVersion = "7.0.0";
    constructor(message: string) {
      super(message);
      this.name = "PrismaClientKnownRequestError";
    }
  }
  class UnnamedError extends Error {}

  it.each<[string, unknown, object]>([
    ["an Error", new Error(QUOTED), { errorClass: "Error" }],
    ["a TypeError", new TypeError(QUOTED), { errorClass: "TypeError" }],
    [
      "a library error with a nested cause",
      new BetterAuthLikeError(QUOTED),
      { errorClass: "BetterAuthError" },
    ],
    [
      "an APIError-like error",
      new APIError(QUOTED),
      { errorClass: "APIError", status: 400, code: "FAILED_TO_CREATE_USER" },
    ],
    [
      "a Prisma-like error",
      new PrismaClientKnownRequestError(QUOTED),
      { errorClass: "PrismaClientKnownRequestError", code: "P2002" },
    ],
    ["a subclass that sets no name", new UnnamedError(QUOTED), { errorClass: "UnnamedError" }],
    ["a thrown string", QUOTED, { errorClass: "string" }],
    ["a thrown number", 42, { errorClass: "number" }],
    ["null", null, { errorClass: "null" }],
    ["undefined", undefined, { errorClass: "undefined" }],
    [
      "a plain object",
      { message: QUOTED, stack: QUOTED, name: "somchai", status: 418, code: "P2021" },
      { errorClass: "Object", status: 418, code: "P2021" },
    ],
    [
      "an AppError",
      internalError(new Error(QUOTED)),
      { errorClass: "AppError", status: 500, code: "INTERNAL_ERROR" },
    ],
  ])("%s is reduced to its labels, with nothing of its text", (_label, value, expected) => {
    const record = describeErrorForLog(value);
    expect(record).toEqual(expected);
    expect(Object.isFrozen(record)).toBe(true);
    for (const leaked of [CANARY, "password", "somchai", "Invalid entry", "    at "]) {
      expect(everything(record)).not.toContain(leaked);
    }
  });

  it("drops each label that is not of the right form, and keeps the others", () => {
    const named = Object.assign(new Error("x"), {
      name: `Error: ${CANARY}`,
      code: "socket hang up",
      statusCode: 1000,
      status: "500",
    });
    expect(describeErrorForLog(named)).toEqual({ errorClass: "Error" });
    const longCode = Object.assign(new Error("x"), { code: "A".repeat(65), status: 503 });
    expect(describeErrorForLog(longCode)).toEqual({ errorClass: "Error", status: 503 });
    const numericCode = Object.assign(new Error("x"), { code: -4077, statusCode: 502 });
    expect(describeErrorForLog(numericCode)).toEqual({
      errorClass: "Error",
      status: 502,
      code: "-4077",
    });
  });

  it("the name of an object that is not an Error is never used as its class", () => {
    expect(describeErrorForLog({ name: "Somchai" })).toEqual({ errorClass: "Object" });
    expect(
      describeErrorForLog(Object.assign(Object.create(null) as object, { name: "Somchai" })),
    ).toEqual({
      errorClass: UNKNOWN_ERROR_CLASS,
    });
  });

  it("is idempotent, and keeps a record made by the auth code", () => {
    const once = describeErrorForLog(new APIError(QUOTED));
    expect(describeErrorForLog(once)).toEqual(once);
    expect(describeErrorForLog({ errorClass: "BetterAuthError" })).toEqual({
      errorClass: "BetterAuthError",
    });
    // A record whose class is not of the right form is not trusted.
    expect(describeErrorForLog({ errorClass: QUOTED })).toEqual({ errorClass: "Object" });
  });

  it("never throws, whatever the value does when it is read", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error(QUOTED);
        },
        getPrototypeOf() {
          throw new Error(QUOTED);
        },
      },
    );
    expect(describeErrorForLog(hostile)).toEqual({ errorClass: UNKNOWN_ERROR_CLASS });
    const getters = new Error("x");
    Object.defineProperty(getters, "name", {
      get() {
        throw new Error(QUOTED);
      },
    });
    Object.defineProperty(getters, "code", {
      get() {
        throw new Error(QUOTED);
      },
    });
    expect(describeErrorForLog(getters)).toEqual({ errorClass: "Error" });
  });
});
