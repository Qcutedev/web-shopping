/**
 * Security review of T-043 (seller orders, fulfilment, dashboard summary), commits fcd2de8,
 * dcae7b9, 2bcc4d1, 0938b7e, 2026-10-20. Owner: security. Review: docs/reviews/T-043-security.md.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040):
 * special characters are built with String.fromCodePoint.
 *
 * No database. These cases read the four route files and the seller service and repository as
 * text (order of the guards, no store id from the request, every statement scoped by the
 * session's store and a paid order, no store-status check), and run the real schemas, the real
 * state table, and the real detail mapping of src/modules/orders. The database behaviour (cross-
 * store 404, unpaid 404, suspended store allowed, races) is exercised by the author's
 * tests/integration/seller-orders/endpoints.test.ts, which this review ran but did not write.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CARRIER_NAME_MAX,
  FULFILMENT_STATUSES,
  FULFILMENT_TRANSITIONS,
  type FulfilmentStatusValue,
  fulfilmentSourceStates,
  isFulfilmentTransitionAllowed,
  listSellerOrdersQuerySchema,
  sellerOrderIdParamsSchema,
  sellerOrderStatusBodySchema,
  TRACKING_NUMBER_MAX,
  toSellerOrderViewDto,
} from "@/modules/orders";
import { assertFulfilmentTransition } from "@/modules/orders/state";
import { AppError } from "@/server/errors";

const ROOT = process.cwd();
const API = join(ROOT, "src", "app", "api", "v1", "seller");
const MODULE = join(ROOT, "src", "modules", "orders");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Source without block and line comments, so prose about a rule never satisfies a check. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The text of each exported route handler, from its `export async function` to the next one. */
function handlerBodies(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of source.split(/(?=export async function )/)) {
    const match = /^export async function (GET|POST|PATCH|PUT|DELETE)\(/.exec(part);
    if (match?.[1] !== undefined) out[match[1]] = part;
  }
  return out;
}

/** The text of one top-level function of a module, up to the next top-level declaration. */
function functionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  if (start < 0) return "";
  const rest = source.slice(start + 1);
  const next = rest.search(/\n(?:export |function |async function |const |interface |type )/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

// ---------------------------------------------------------------------------------------------
// The route files
// ---------------------------------------------------------------------------------------------

interface RouteFile {
  path: string;
  handlers: Record<string, "read" | "read-noinput" | "write-body">;
}

const ROUTE_FILES: RouteFile[] = [
  { path: join("orders", "route.ts"), handlers: { GET: "read" } },
  { path: join("orders", "[id]", "route.ts"), handlers: { GET: "read" } },
  { path: join("orders", "[id]", "status", "route.ts"), handlers: { POST: "write-body" } },
  { path: join("summary", "route.ts"), handlers: { GET: "read-noinput" } },
];

describe("T-043 review: the four seller order and summary route files", () => {
  for (const file of ROUTE_FILES) {
    const source = read(join(API, file.path));
    const bodies = handlerBodies(source);

    it(`${file.path}: exports exactly ${Object.keys(file.handlers).join(", ")}; no database import; inside the frame; no store id or store status`, () => {
      expect(Object.keys(bodies).sort()).toEqual(Object.keys(file.handlers).sort());
      expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated/);
      const stripped = code(source);
      // The store is the session's (CLAUDE.md rule 6) and its status is not judged (BR-14).
      expect(stripped).not.toMatch(/storeId|storeStatus/);
      expect(stripped).not.toMatch(/requireApprovedSeller|requireApprovedStoreForWrite/);
      for (const body of Object.values(bodies)) {
        expect(body).toMatch(/return handleRequest\(request, async/);
      }
    });

    for (const [method, kind] of Object.entries(file.handlers)) {
      const body = bodies[method] ?? "";
      if (kind === "read" || kind === "read-noinput") {
        it(`${file.path} ${method}: session, then role SELLER, before any input or the service; no body read`, () => {
          const actor = body.indexOf("requireActor(request)");
          const role = body.indexOf('requireRole(actor, "SELLER")');
          expect(actor).toBeGreaterThan(-1);
          expect(role).toBeGreaterThan(actor);
          const firstInput = Math.min(
            ...["parseInput(", "context.params", "searchParams"]
              .map((needle) => body.indexOf(needle))
              .filter((index) => index > -1),
          );
          if (kind === "read") expect(firstInput).toBeGreaterThan(role);
          else expect(firstInput).toBe(Infinity);
          expect(body).not.toMatch(/readJsonBody|request\.json\(|request\.text\(/);
        });
      } else {
        it(`${file.path} ${method}: Origin, Content-Type, session, role SELLER, then the body and the path`, () => {
          const origin = body.indexOf("assertSameOrigin(request, getEnv().appOrigin)");
          const type = body.indexOf("assertContentType(request, JSON_CONTENT_TYPE)");
          const actor = body.indexOf("requireActor(request)");
          const role = body.indexOf('requireRole(actor, "SELLER")');
          expect(origin).toBeGreaterThan(-1);
          expect(type).toBeGreaterThan(origin);
          expect(actor).toBeGreaterThan(type);
          expect(role).toBeGreaterThan(actor);
          const firstInput = Math.min(
            ...["readJsonBody(", "parseInput(", "context.params"]
              .map((needle) => body.indexOf(needle))
              .filter((index) => index > -1),
          );
          expect(firstInput).toBeGreaterThan(role);
          expect(body).toMatch(/readJsonBody\(request\)/);
          expect(body).toMatch(/parseInput\(sellerOrderStatusBodySchema, raw\)/);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// The service: the actor's role and the session's store, never the store's status
// ---------------------------------------------------------------------------------------------

describe("T-043 review: the seller service checks the role and scopes by the session", () => {
  const service = code(read(join(MODULE, "seller-service.ts")));

  it("sellerScope requires SELLER and takes store and owner from the actor only", () => {
    const scope = functionBody(service, "sellerScope");
    expect(scope).toMatch(/requireRole\(actor, "SELLER"\)/);
    expect(scope).toMatch(/storeId: actor\.storeId, userId: actor\.userId/);
  });

  for (const name of [
    "listOwnSellerOrders",
    "getOwnSellerOrder",
    "changeSellerOrderStatus",
    "getSellerSummary",
  ]) {
    it(`${name}: first statement is sellerScope(actor); no store-status check (BR-14)`, () => {
      const body = functionBody(service, name);
      expect(body).not.toBe("");
      const firstStatement = body.slice(body.indexOf("{", body.indexOf(")")) + 1).trim();
      expect(firstStatement.startsWith("const scope = sellerScope(actor);")).toBe(true);
    });
  }

  it("nothing in the service reads the store's status or the approved-store guard", () => {
    expect(service).not.toMatch(/storeStatus|requireApprovedSeller|requireApprovedStoreForWrite/);
  });

  it("a status change locks, judges the table, then runs the guarded move with the table's sources, in one transaction", () => {
    const body = functionBody(service, "changeSellerOrderStatus");
    const tx = body.indexOf("db.$transaction(");
    const lock = body.indexOf("lockOwnPaidSellerOrder(tx, scope, sellerOrderId)");
    const notFound = body.indexOf("throw sellerOrderNotFound()");
    const judge = body.indexOf(
      'assertFulfilmentTransition(locked.fulfilmentStatus, body.to, "SELLER")',
    );
    const move = body.indexOf("moveSellerOrderStatus(");
    const sources = body.indexOf('fulfilmentSourceStates(body.to, "SELLER")');
    const zeroRows = body.indexOf("if (!moved) throw invalidStateTransition()");
    expect(tx).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(tx);
    expect(notFound).toBeGreaterThan(lock);
    expect(judge).toBeGreaterThan(notFound);
    expect(move).toBeGreaterThan(judge);
    expect(sources).toBeGreaterThan(move);
    expect(zeroRows).toBeGreaterThan(sources);
  });
});

// ---------------------------------------------------------------------------------------------
// The repository: every statement scoped by store, owner, and paid order; bound values only
// ---------------------------------------------------------------------------------------------

describe("T-043 review: every seller order statement is scoped and parameterised", () => {
  const repository = code(read(join(MODULE, "seller-repository.ts")));

  it("no unsafe raw SQL and no SQL text built from a value", () => {
    expect(repository).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\(/);
    // Prisma.sql is used once, for the IN list of source states, with Prisma.join (bound).
    expect(count(repository, "Prisma.sql`")).toBe(1);
    expect(repository).toMatch(
      /Prisma\.sql`so\."fulfilmentStatus"::text IN \(\$\{Prisma\.join\(states\)\}\)`/,
    );
  });

  it("the Prisma filter of every read holds the session's store, its owner, and a PAID order", () => {
    const where = functionBody(repository, "ownPaidSellerOrderWhere");
    expect(where).toMatch(/storeId: scope\.storeId/);
    expect(where).toMatch(/store: \{ is: \{ ownerId: scope\.userId \} \}/);
    expect(where).toMatch(/order: \{ is: \{ paymentStatus: "PAID" \} \}/);
    // Every Prisma read of SellerOrder goes through that filter: the detail spreads it, the list
    // builds `where` from it and passes that `where` to both its count and its page.
    expect(count(repository, "...ownPaidSellerOrderWhere(scope)")).toBe(2);
    expect(count(repository, ".sellerOrder.")).toBe(3);
    expect(repository).toMatch(
      /sellerOrder\.findFirst\(\{\s*where: \{ id: sellerOrderId, \.\.\.ownPaidSellerOrderWhere\(scope\) \}/,
    );
    expect(repository).toMatch(/sellerOrder\.count\(\{ where \}\)/);
    expect(repository).toMatch(/sellerOrder\.findMany\(\{\s*where,/);
  });

  it("the row lock names the id, the session's store and owner, a PAID order, and locks the seller order row", () => {
    const lock = functionBody(repository, "lockOwnPaidSellerOrder");
    expect(lock).toMatch(/so\."id" = \$\{sellerOrderId\}/);
    expect(lock).toMatch(/so\."storeId" = \$\{scope\.storeId\}/);
    expect(lock).toMatch(/s\."ownerId" = \$\{scope\.userId\}/);
    expect(lock).toMatch(/o\."paymentStatus" = 'PAID'/);
    expect(lock).toMatch(/FOR UPDATE OF so/);
  });

  it("the guarded move repeats the store, the table's source states, and the paid-order condition (OQ-41)", () => {
    const move = functionBody(repository, "moveSellerOrderStatus");
    expect(move).toMatch(/so\."id" = \$\{sellerOrderId\}/);
    expect(move).toMatch(/so\."storeId" = \$\{scope\.storeId\}/);
    expect(move).toMatch(/\$\{fulfilmentStatusIn\(sources\)\}/);
    expect(move).toMatch(/o\."id" = so\."orderId" AND o\."paymentStatus" = 'PAID'/);
    expect(move).toMatch(/return updated === 1;/);
  });

  it("every summary statement is scoped by the session's store and owner; order figures by a PAID order", () => {
    const summary = functionBody(repository, "readSellerSummaryRows");
    expect(count(summary, "${scope.storeId}")).toBe(4);
    expect(count(summary, 's."ownerId" = ${scope.userId}')).toBe(4);
    expect(count(summary, "o.\"paymentStatus\" = 'PAID'")).toBe(2);
    expect(summary).toMatch(/so\."fulfilmentStatus" <> 'CANCELLED'/);
    expect(summary).toMatch(/SET TRANSACTION READ ONLY/);
  });

  it("no statement judges the store's status (BR-14), and nothing in the seller files logs", () => {
    expect(repository).not.toMatch(/s\."status"|Store"\."status"|store: \{ is: \{ status/);
    for (const file of [
      "seller-repository.ts",
      "seller-service.ts",
      "seller-mapping.ts",
      "seller-schema.ts",
    ]) {
      expect(read(join(MODULE, file))).not.toMatch(/@\/server\/logger|console\./);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The status body and the query: no mass assignment, no store from the request
// ---------------------------------------------------------------------------------------------

const FORBIDDEN_KEYS = [
  "storeId",
  "store",
  "ownerId",
  "userId",
  "id",
  "orderId",
  "sellerOrderId",
  "from",
  "status",
  "fulfilmentStatus",
  "paymentStatus",
  "paidAt",
  "shippedAt",
  "deliveredAt",
  "isSimulated",
  "itemsSubtotalSatang",
  "shippingFeeSatang",
  "commissionRateBps",
  "stockRestoredAt",
  "reason",
  "role",
  "__proto__",
  "constructor",
  "prototype",
];

/** The body as the server receives it: JSON text parsed, so `__proto__` is an own key. */
function parsedWith(base: Record<string, unknown>, key: string, value: unknown): unknown {
  const text =
    JSON.stringify(base).slice(0, -1) + `,${JSON.stringify(key)}:${JSON.stringify(value)}}`;
  return JSON.parse(text) as unknown;
}

describe("T-043 review: the status body is strict and the target is limited", () => {
  for (const key of FORBIDDEN_KEYS) {
    it(`"${key}" is refused next to a valid target`, () => {
      const value = key === "__proto__" ? { to: "DELIVERED" } : "DELIVERED";
      expect(
        sellerOrderStatusBodySchema.safeParse(parsedWith({ to: "PROCESSING" }, key, value)).success,
      ).toBe(false);
    });
  }

  it("PENDING, an unknown status, a lower-case status, a missing or non-string target are refused", () => {
    for (const to of ["PENDING", "REFUNDED", "processing", "", null, 1, ["SHIPPED"], undefined]) {
      expect(sellerOrderStatusBodySchema.safeParse({ to }).success).toBe(false);
    }
    expect(sellerOrderStatusBodySchema.safeParse({}).success).toBe(false);
    expect(sellerOrderStatusBodySchema.safeParse(null).success).toBe(false);
    expect(sellerOrderStatusBodySchema.safeParse([]).success).toBe(false);
  });

  it("carrier and tracking are accepted only with SHIPPED", () => {
    expect(
      sellerOrderStatusBodySchema.safeParse({
        to: "SHIPPED",
        carrierName: "Kerry",
        trackingNumber: "T1",
      }).success,
    ).toBe(true);
    for (const to of ["PROCESSING", "DELIVERED", "CANCELLED"]) {
      expect(sellerOrderStatusBodySchema.safeParse({ to, carrierName: "Kerry" }).success).toBe(
        false,
      );
      expect(sellerOrderStatusBodySchema.safeParse({ to, trackingNumber: "T1" }).success).toBe(
        false,
      );
    }
  });

  it("carrier and tracking: 1 to 100 characters after trimming; blank, longer, and non-strings refused", () => {
    expect(CARRIER_NAME_MAX).toBe(100);
    expect(TRACKING_NUMBER_MAX).toBe(100);
    for (const key of ["carrierName", "trackingNumber"]) {
      const ok = (value: unknown): boolean =>
        sellerOrderStatusBodySchema.safeParse({ to: "SHIPPED", [key]: value }).success;
      expect(ok("a".repeat(100))).toBe(true);
      expect(ok("a".repeat(101))).toBe(false);
      expect(ok("")).toBe(false);
      expect(ok("   ")).toBe(false);
      expect(ok(123)).toBe(false);
      expect(ok(["a"])).toBe(false);
      expect(ok(null)).toBe(false);
    }
  });

  const hidden: [string, string][] = [
    ["U+0000", String.fromCodePoint(0)],
    ["U+000A line feed", String.fromCodePoint(10)],
    ["U+202E right-to-left override", String.fromCodePoint(0x202e)],
    ["U+2066 left-to-right isolate", String.fromCodePoint(0x2066)],
    ["U+2028 line separator", String.fromCodePoint(0x2028)],
    ["U+FEFF byte order mark", String.fromCodePoint(0xfeff)],
    ["U+001B escape", String.fromCodePoint(0x1b)],
  ];
  for (const [label, character] of hidden) {
    it(`${label} is refused in carrier and tracking`, () => {
      const text = `Kerry${character}x`;
      expect(
        sellerOrderStatusBodySchema.safeParse({ to: "SHIPPED", carrierName: text }).success,
      ).toBe(false);
      expect(
        sellerOrderStatusBodySchema.safeParse({ to: "SHIPPED", trackingNumber: text }).success,
      ).toBe(false);
    });
  }

  it("markup and a URL are accepted as text: escaping on output is the control (no page renders them yet)", () => {
    const parsed = sellerOrderStatusBodySchema.parse({
      to: "SHIPPED",
      carrierName: "<img src=x onerror=alert(1)>",
      trackingNumber: "javascript:alert(1)",
    });
    expect(parsed.carrierName).toBe("<img src=x onerror=alert(1)>");
    expect(parsed.trackingNumber).toBe("javascript:alert(1)");
  });

  it("the seller order id: 201 characters, U+0000, a lone surrogate, and empty are refused", () => {
    expect(sellerOrderIdParamsSchema.safeParse({ id: "a".repeat(201) }).success).toBe(false);
    expect(sellerOrderIdParamsSchema.safeParse({ id: `a${String.fromCodePoint(0)}` }).success).toBe(
      false,
    );
    expect(
      sellerOrderIdParamsSchema.safeParse({ id: `a${String.fromCharCode(0xd800)}` }).success,
    ).toBe(false);
    expect(sellerOrderIdParamsSchema.safeParse({ id: "" }).success).toBe(false);
  });

  it("the list query strips storeId, ownerId, paymentStatus; refuses a repeated or unknown filter; caps the page size", () => {
    const parsed = listSellerOrdersQuerySchema.parse({
      storeId: "other-store",
      ownerId: "other-owner",
      paymentStatus: "PENDING",
      fulfilmentStatus: "SHIPPED",
    }) as Record<string, unknown>;
    expect(parsed.storeId).toBeUndefined();
    expect(parsed.ownerId).toBeUndefined();
    expect(parsed.paymentStatus).toBeUndefined();
    expect(parsed.fulfilmentStatus).toBe("SHIPPED");
    expect(
      listSellerOrdersQuerySchema.safeParse({ fulfilmentStatus: ["SHIPPED", "PENDING"] }).success,
    ).toBe(false);
    expect(listSellerOrdersQuerySchema.safeParse({ fulfilmentStatus: "shipped" }).success).toBe(
      false,
    );
    expect(listSellerOrdersQuerySchema.safeParse({ pageSize: "51" }).success).toBe(false);
    expect(listSellerOrdersQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The transition table as the seller sees it
// ---------------------------------------------------------------------------------------------

describe("T-043 review: the seller's transitions are exactly the table of section 3.2", () => {
  const sellerMoves = FULFILMENT_TRANSITIONS.filter((row) => row.by.includes("SELLER"))
    .map((row) => `${row.from}->${row.to}`)
    .sort();

  it("five moves, none into PENDING, none out of SHIPPED except DELIVERED, none out of a final state", () => {
    expect(sellerMoves).toEqual(
      [
        "PENDING->PROCESSING",
        "PROCESSING->SHIPPED",
        "SHIPPED->DELIVERED",
        "PENDING->CANCELLED",
        "PROCESSING->CANCELLED",
      ].sort(),
    );
  });

  it("every pair outside the table is a 409 INVALID_STATE_TRANSITION, SHIPPED to CANCELLED included (BR-29)", () => {
    for (const from of FULFILMENT_STATUSES) {
      for (const to of FULFILMENT_STATUSES) {
        const allowed = sellerMoves.includes(`${from}->${to}`);
        expect(isFulfilmentTransitionAllowed(from, to, "SELLER")).toBe(allowed);
        if (allowed) continue;
        let thrown: unknown;
        try {
          assertFulfilmentTransition(from, to, "SELLER");
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(AppError);
        expect((thrown as AppError).status).toBe(409);
        expect((thrown as AppError).code).toBe("INVALID_STATE_TRANSITION");
      }
    }
  });

  it("the guarded statement's source states equal the table's, so the two cannot disagree", () => {
    const expected: Record<string, FulfilmentStatusValue[]> = {
      PROCESSING: ["PENDING"],
      SHIPPED: ["PROCESSING"],
      DELIVERED: ["SHIPPED"],
      CANCELLED: ["PENDING", "PROCESSING"],
      PENDING: [],
    };
    for (const [to, from] of Object.entries(expected)) {
      expect(fulfilmentSourceStates(to as FulfilmentStatusValue, "SELLER").sort()).toEqual(
        [...from].sort(),
      );
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The detail shape: built key by key, never an unpaid order, no other party's data
// ---------------------------------------------------------------------------------------------

describe("T-043 review: the detail mapping never shows an unpaid order or a field outside the shape", () => {
  const order = {
    orderNumber: "ORD-1",
    createdAt: new Date("2026-10-20T01:00:00Z"),
    paidAt: new Date("2026-10-20T01:05:00Z") as Date | null,
    paymentStatus: "PAID" as "PAID" | "PENDING" | "FAILED",
    shipRecipientName: "Somchai",
    shipPhone: "0812345678",
    shipLine1: "1 Road",
    shipSubdistrict: "A",
    shipDistrict: "B",
    shipProvince: "C",
    shipPostalCode: "10110",
  };
  const row = {
    id: "so-1",
    storeName: "Shop",
    fulfilmentStatus: "PENDING" as FulfilmentStatusValue,
    itemsSubtotalSatang: 10_000,
    shippingFeeSatang: 4_000,
    shippingFeeIsSimulated: true,
    commissionRateBps: 500,
    order,
    shipment: null,
    items: [],
  };

  it("PENDING and FAILED orders, or a PAID one without a paid time, never become a shape", () => {
    for (const paymentStatus of ["PENDING", "FAILED"] as const) {
      expect(() => toSellerOrderViewDto({ ...row, order: { ...order, paymentStatus } })).toThrow();
    }
    expect(() => toSellerOrderViewDto({ ...row, order: { ...order, paidAt: null } })).toThrow();
  });

  it("extra fields on the row (another store, the buyer's account, the grand total) are not copied", () => {
    const wide = {
      ...row,
      storeId: "store-x",
      orderId: "order-x",
      order: {
        ...order,
        userId: "buyer-1",
        email: "buyer@example.test",
        totalSatang: 99_999,
        paymentReference: "mock-ref",
      },
    };
    const dto = toSellerOrderViewDto(wide) as unknown as Record<string, unknown>;
    const text = JSON.stringify(dto);
    for (const leaked of [
      "store-x",
      "order-x",
      "buyer-1",
      "buyer@example.test",
      "99999",
      "mock-ref",
    ]) {
      expect(text).not.toContain(leaked);
    }
    for (const key of [
      "storeId",
      "orderId",
      "userId",
      "email",
      "totalSatang",
      "grandTotalSatang",
    ]) {
      expect(Object.keys(dto)).not.toContain(key);
    }
    expect(dto.paymentStatus).toBe("PAID");
  });
});
