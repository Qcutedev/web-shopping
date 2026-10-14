/**
 * Security review of T-032 (checkout, orders, mock payment), 2026-10-14. Owner: security.
 * Review: docs/reviews/T-032-security.md. The database cases are in t032-checkout.itest.ts.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040).
 *
 * Three parts, none of which needs a database:
 *   1. Static checks over the three route files: thin handlers, the checks of
 *      docs/API_CONTRACTS.md section 1.8 in order (origin, content type, session, rate limit,
 *      body, header, schema, service), no database import, the session actor passed first.
 *   2. Static checks over the modules: every raw statement is a tagged template, the guarded
 *      stock statement carries its three guards, no route can reach a payment transition.
 *   3. The request schemas: the body is strict (no amount, quantity, owner, or store), and the
 *      Idempotency-Key header has exactly one accepted form.
 * Open findings are `it.fails` cases whose body asserts the secure behaviour (SEC-055, SEC-056).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkoutBodySchema,
  IDEMPOTENCY_KEY_HEADER,
  parseIdempotencyKeyHeader,
} from "@/modules/checkout/schema";
import { getPaymentProvider } from "@/modules/payments/provider";
import { AppError } from "@/server/errors";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function filesUnder(directory: string, accept: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, accept));
    else if (accept(path)) out.push(path);
  }
  return out;
}

function posix(path: string): string {
  return relative(ROOT, path).split(sep).join("/");
}

/** The text of each exported handler, from its `export` to the next `export` or the end. */
function handlerBodies(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const starts: { name: string; index: number }[] = [];
  for (const match of source.matchAll(/export (?:async )?function ([A-Z]+)\(/g)) {
    starts.push({ name: match[1] ?? "", index: match.index });
  }
  starts.forEach((start, i) => {
    out.set(start.name, source.slice(start.index, starts[i + 1]?.index ?? source.length));
  });
  return out;
}

/** Index of `needle` in `body`; fails the case when it is missing. */
function at(body: string, needle: string): number {
  const index = body.indexOf(needle);
  expect(index, `missing: ${needle}`).toBeGreaterThan(-1);
  return index;
}

// ---------------------------------------------------------------------------------------------
// Part 1: the route files
// ---------------------------------------------------------------------------------------------

const CHECKOUT_ROUTE = "src/app/api/v1/checkout/route.ts";
const ORDERS_ROUTE = "src/app/api/v1/orders/route.ts";
const ORDER_ROUTE = "src/app/api/v1/orders/[id]/route.ts";

describe("T-032 review: the route files are thin", () => {
  for (const path of [CHECKOUT_ROUTE, ORDERS_ROUTE, ORDER_ROUTE]) {
    const source = read(path);
    it(`${path}: no database, no Prisma, no raw SQL, no identity from the request`, () => {
      expect(source).not.toMatch(
        /@\/server\/db|@prisma|prisma\/generated|\$transaction|\$queryRaw/,
      );
      // `actor.userId` (the session's) is the rate-limit subject; no other user id is read.
      expect(source.replaceAll("actor.userId", "")).not.toMatch(/userId|storeId|\brole\b|isActive/);
      expect(source).not.toMatch(/\.\.\.\s*(body|raw|request)/);
      expect(source).not.toMatch(/cookies\(|request\.json\(|request\.text\(/);
      expect(source).not.toMatch(/\bwhere\s*:|\bselect\s*:|\bdata\s*:/);
    });
    it(`${path}: no payment transition is reachable from a request (TM-12)`, () => {
      expect(source).not.toMatch(
        /completeOrderPayment|failOrderPayment|failOverdueOrders|markOrderPaid|failOrder\b|runPaymentTimeoutSweep|getPaymentProvider|mockPaymentProvider/,
      );
    });
  }

  it(`${CHECKOUT_ROUTE}: POST only, every check in the order of section 1.8`, () => {
    const handlers = handlerBodies(read(CHECKOUT_ROUTE));
    expect([...handlers.keys()]).toEqual(["POST"]);
    const body = handlers.get("POST") ?? "";
    expect(body).toMatch(/return handleRequest\(request, async/);
    const origin = at(body, "assertSameOrigin(request, env.appOrigin);");
    const contentType = at(body, "assertContentType(request, JSON_CONTENT_TYPE);");
    const guard = at(body, "const actor = await requireActor(request);");
    const limit = at(body, "rateLimiter.consume(actor.userId, RATE_LIMITS.CHECKOUT)");
    const refused = at(body, "throw rateLimited(");
    const readBody = at(body, "await readJsonBody(request)");
    const header = at(
      body,
      "parseIdempotencyKeyHeader(request.headers.get(IDEMPOTENCY_KEY_HEADER))",
    );
    const schema = at(body, "parseInput(checkoutBodySchema, raw)");
    const service = at(body, "await checkout(actor, idempotencyKey, body,");
    expect(contentType).toBeGreaterThan(origin);
    expect(guard).toBeGreaterThan(contentType);
    expect(limit).toBeGreaterThan(guard);
    expect(refused).toBeGreaterThan(limit);
    expect(readBody).toBeGreaterThan(refused);
    expect(header).toBeGreaterThan(readBody);
    expect(schema).toBeGreaterThan(header);
    expect(service).toBeGreaterThan(schema);
    expect(body.split("requireActor(").length - 1).toBe(1);
    expect(body.split("readJsonBody(").length - 1).toBe(1);
    // The client address goes only into the security event, never into a decision.
    expect(body.split("getClientAddress(").length - 1).toBe(1);
  });

  for (const [path, service] of [
    [ORDERS_ROUTE, "listOrders(actor, query)"],
    [ORDER_ROUTE, "getOrder(actor, id)"],
  ] as const) {
    it(`${path}: GET only, session before any parse, the actor passed to the service`, () => {
      const handlers = handlerBodies(read(path));
      expect([...handlers.keys()]).toEqual(["GET"]);
      const body = handlers.get("GET") ?? "";
      expect(body).toMatch(/return handleRequest\(request, async/);
      expect(body).not.toMatch(/assertSameOrigin|readJsonBody|rateLimiter/);
      const guard = at(body, "const actor = await requireActor(request);");
      const parse = at(body, "parseInput(");
      expect(parse).toBeGreaterThan(guard);
      expect(at(body, service)).toBeGreaterThan(parse);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Part 2: the modules
// ---------------------------------------------------------------------------------------------

const MODULE_DIRS = ["src/modules/checkout", "src/modules/orders", "src/modules/payments"];
const MODULE_FILES = MODULE_DIRS.flatMap((dir) =>
  filesUnder(join(ROOT, dir), (path) => path.endsWith(".ts") && !path.endsWith(".test.ts")),
);

describe("T-032 review: SQL is parameterised (TM-14)", () => {
  it("the three modules have source files", () => {
    expect(MODULE_FILES.length).toBeGreaterThanOrEqual(10);
    // The per-file check below would pass with no match; make sure it sees the raw statements.
    const raw = MODULE_FILES.map((path) => readFileSync(path, "utf8"))
      .join("\n")
      .match(/\$(queryRaw|executeRaw)/g);
    expect(raw?.length ?? 0).toBeGreaterThanOrEqual(14);
  });
  for (const path of MODULE_FILES) {
    it(`${posix(path)}: no unsafe raw statement, no Prisma.raw, raw calls are tagged templates`, () => {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(/);
      // `$queryRaw(` or `$executeRaw(` with parentheses would take a string; only the tagged
      // form (a backtick right after the name or its type argument) binds every value.
      for (const match of source.matchAll(/\$(queryRaw|executeRaw)(<[^`(]*?>)?([\s\S])/g)) {
        expect(match[3], `${posix(path)}: ${match[0]}`).toBe("`");
      }
    });
  }

  it("the guarded stock statement holds the visibility, own-store, and stock guards", () => {
    const source = read("src/modules/checkout/repository.ts");
    const start = source.indexOf("export async function takeStock(");
    const end = source.indexOf("export async function classifyCartLines(");
    const statement = source.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(statement).toMatch(/UPDATE "Product" p/);
    expect(statement).toMatch(/AND \$\{VISIBLE_PRODUCT_SQL\}/);
    expect(statement).toMatch(/AND s\."ownerId" <> \$\{buyerId\}/);
    expect(statement).toMatch(/AND p\."stock" >= \$\{quantity\}::int/);
    // The price charged is the one the locked row returns, not one from an earlier read.
    expect(statement).toMatch(
      /RETURNING p\."id" AS "productId", p\."priceSatang" AS "unitPriceSatang"/,
    );
  });

  it("the payment transitions are guarded by their source state", () => {
    const source = read("src/modules/orders/repository.ts");
    expect(source.match(/AND \$\{paymentStatusIn\((sources|paymentSources)\)\}/g)).toHaveLength(2);
    expect(source).toMatch(/oi\."stockRestoredAt" IS NULL/);
  });

  it("no file outside the orders and checkout modules calls a payment transition", () => {
    const callers = filesUnder(join(ROOT, "src"), (path) => /\.tsx?$/.test(path))
      .map(posix)
      .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
      .filter((path) => !path.startsWith("src/modules/orders/"))
      .filter((path) => !path.startsWith("src/modules/checkout/"))
      .filter((path) =>
        /completeOrderPayment|failOrderPayment|markOrderPaid|failOrder\(/.test(read(path)),
      );
    expect(callers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Part 3: the request schemas
// ---------------------------------------------------------------------------------------------

describe("T-032 review: the checkout body names only an address and the mock outcome (TM-08, TM-27)", () => {
  const base = { addressId: "addr_1", paymentMethod: "MOCK" };

  it("the minimal body is accepted and mockOutcome defaults to SUCCESS", () => {
    expect(checkoutBodySchema.parse(base)).toEqual({ ...base, mockOutcome: "SUCCESS" });
  });

  for (const key of [
    "userId",
    "storeId",
    "orderId",
    "items",
    "lines",
    "quantity",
    "priceSatang",
    "unitPriceSatang",
    "itemsSubtotalSatang",
    "shippingTotalSatang",
    "grandTotalSatang",
    "amountSatang",
    "discountSatang",
    "commissionRateBps",
    "paymentStatus",
    "providerReference",
    "isSimulated",
    "idempotencyKey",
    "AddressId",
    "addressId ",
  ]) {
    it(`an extra key ${JSON.stringify(key)} is refused`, () => {
      expect(checkoutBodySchema.safeParse({ ...base, [key]: 1 }).success).toBe(false);
    });
  }

  it("a literal __proto__ key and a constructor key are refused", () => {
    expect(
      checkoutBodySchema.safeParse(
        JSON.parse('{"addressId":"a","paymentMethod":"MOCK","__proto__":{"x":1}}'),
      ).success,
    ).toBe(false);
    expect(checkoutBodySchema.safeParse({ ...base, constructor: {} }).success).toBe(false);
  });

  for (const [field, value] of [
    ["paymentMethod", "mock"],
    ["paymentMethod", "STRIPE"],
    ["paymentMethod", undefined],
    ["mockOutcome", "PAID"],
    ["mockOutcome", "success"],
    ["mockOutcome", null],
    ["addressId", ""],
    ["addressId", "a".repeat(201)],
    ["addressId", `a${String.fromCodePoint(0)}b`],
    ["addressId", 12],
    ["addressId", ["a"]],
  ] as const) {
    it(`${field} = ${JSON.stringify(value)} is refused`, () => {
      expect(checkoutBodySchema.safeParse({ ...base, [field]: value }).success).toBe(false);
    });
  }
});

describe("T-032 review: the Idempotency-Key header (section 1.3)", () => {
  const key = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("the header name is the documented one", () => {
    expect(IDEMPOTENCY_KEY_HEADER).toBe("Idempotency-Key");
  });

  it("one key in either case is one normalised value", () => {
    expect(parseIdempotencyKeyHeader(key.toUpperCase())).toBe(key);
    expect(parseIdempotencyKeyHeader(key)).toBe(key);
  });

  for (const value of [
    null,
    "",
    ` ${key}`,
    `${key} `,
    `{${key}}`,
    `urn:uuid:${key}`,
    key.replaceAll("-", ""),
    key.slice(1),
    `${key}0`,
    `${key},${key}`,
    key.replace("0", "g"),
    // An Arabic-Indic digit zero in place of an ASCII one.
    key.replace("0", String.fromCodePoint(0x660)),
  ]) {
    it(`${JSON.stringify(value)} is a 400 invalid_header that does not echo the value`, () => {
      let thrown: unknown;
      try {
        parseIdempotencyKeyHeader(value);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppError);
      const error = thrown as AppError;
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.details).toEqual({
        fields: [expect.objectContaining({ path: "Idempotency-Key", code: "invalid_header" })],
      });
      if (value !== null && value.length > 0) {
        expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(
          value.trim(),
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Open findings
// ---------------------------------------------------------------------------------------------

describe("SEC-055: nothing fails an unpaid order", () => {
  it.fails("the start-up hook starts the payment timeout sweep", () => {
    const hook = read("src/instrumentation.ts");
    expect(hook).toMatch(/startPaymentTimeoutSweepSchedule\(/);
  });
});

describe("SEC-056: the mock provider pays any order in a production server", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("documented behaviour: outside production the mock is the provider", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(getPaymentProvider().name).toBe("MOCK");
    expect(getPaymentProvider().isSimulated).toBe(true);
  });

  // Pins remediation (a) of SEC-056. If the owner accepts the risk or chooses another control,
  // this case is replaced by one that asserts the chosen control, not deleted.
  it.fails("in production the mock provider is refused unless the owner switched it on", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getPaymentProvider()).toThrow();
  });
});
