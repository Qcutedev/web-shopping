/**
 * Security review of T-042 (seller product and inventory), commits 9c0ff06 and 7aef770,
 * 2026-10-20. Owner: security. Review: docs/reviews/T-042-security.md. The database cases are in
 * tests/security/t042-inventory.itest.ts.
 *
 * This file holds no character outside printable ASCII and no backslash-u escape (SEC-040):
 * special characters are built with String.fromCodePoint.
 *
 * No database. These cases read the six route files as text (order of the guards, no database
 * import) and run the real schemas and the real state table of src/modules/inventory.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProductBodySchema,
  listSellerProductsQuerySchema,
  MAX_SELLER_STOCK,
  productIdParamsSchema,
  stockBodySchema,
  updateProductBodySchema,
} from "@/modules/inventory";
import {
  classifySave,
  MODERATION_STATUSES,
  type ModerationView,
  PRODUCT_TRANSITIONS,
} from "@/modules/inventory/state";

const ROOT = process.cwd();
const BASE = join(ROOT, "src", "app", "api", "v1", "seller", "products");

// ---------------------------------------------------------------------------------------------
// The route files
// ---------------------------------------------------------------------------------------------

interface RouteFile {
  path: string;
  /** Exported handlers and whether each is a write (needs an approved store). */
  handlers: Record<string, "read" | "write-body" | "write-nobody">;
}

const ROUTE_FILES: RouteFile[] = [
  { path: "route.ts", handlers: { GET: "read", POST: "write-body" } },
  {
    path: join("[id]", "route.ts"),
    handlers: { GET: "read", PATCH: "write-body", DELETE: "write-nobody" },
  },
  { path: join("[id]", "stock", "route.ts"), handlers: { PATCH: "write-body" } },
  { path: join("[id]", "publish", "route.ts"), handlers: { POST: "write-nobody" } },
  { path: join("[id]", "unpublish", "route.ts"), handlers: { POST: "write-nobody" } },
  { path: join("[id]", "archive", "route.ts"), handlers: { POST: "write-nobody" } },
];

/** The text of each exported handler, from its `export async function` to the next one. */
function handlerBodies(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = source.split(/(?=export async function )/);
  for (const part of parts) {
    const match = /^export async function (GET|POST|PATCH|PUT|DELETE)\(/.exec(part);
    if (match?.[1] !== undefined) out[match[1]] = part;
  }
  return out;
}

function positions(body: string, needles: string[]): number[] {
  return needles.map((needle) => body.indexOf(needle));
}

describe("T-042 review: the six seller product route files", () => {
  for (const file of ROUTE_FILES) {
    const source = readFileSync(join(BASE, file.path), "utf8");
    const bodies = handlerBodies(source);

    it(`${file.path}: exports exactly ${Object.keys(file.handlers).join(", ")}; no database import; inside the frame`, () => {
      expect(Object.keys(bodies).sort()).toEqual(Object.keys(file.handlers).sort());
      expect(source).not.toMatch(/@\/server\/db|@prisma|prisma\/generated/);
      // No store id is read from the request anywhere in the code (comments aside).
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/storeId/);
      for (const body of Object.values(bodies)) {
        expect(body).toMatch(/return handleRequest\(request, async/);
      }
    });

    for (const [method, kind] of Object.entries(file.handlers)) {
      const body = bodies[method] ?? "";
      if (kind === "read") {
        it(`${file.path} ${method}: session, then role SELLER, before any input is parsed or the service runs`, () => {
          const [actor, role, parse] = positions(body, [
            "requireActor(request)",
            'requireRole(actor, "SELLER")',
            "parseInput(",
          ]);
          expect(actor).toBeGreaterThan(-1);
          expect(role).toBeGreaterThan(actor ?? 0);
          expect(parse).toBeGreaterThan(role ?? 0);
          expect(body).not.toMatch(/assertSameOrigin|readJsonBody/);
        });
      } else {
        it(`${file.path} ${method}: Origin, Content-Type, session, approved store, then the body and the path`, () => {
          const [origin, type, actor, approved] = positions(body, [
            "assertSameOrigin(request, getEnv().appOrigin)",
            "assertContentType(request, JSON_CONTENT_TYPE)",
            "requireActor(request)",
            "requireApprovedSeller(actor)",
          ]);
          expect(origin).toBeGreaterThan(-1);
          expect(type).toBeGreaterThan(origin ?? 0);
          expect(actor).toBeGreaterThan(type ?? 0);
          expect(approved).toBeGreaterThan(actor ?? 0);
          const firstInput = Math.min(
            ...["readJsonBody(", "parseInput(", "context.params"]
              .map((needle) => body.indexOf(needle))
              .filter((index) => index > -1),
          );
          expect(firstInput).toBeGreaterThan(approved ?? 0);
          if (kind === "write-nobody") expect(body).not.toMatch(/readJsonBody/);
          else expect(body).toMatch(/readJsonBody\(request\)/);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Mass assignment: every key a seller must not set is refused, as an own JSON key too
// ---------------------------------------------------------------------------------------------

const VALID_CREATE = {
  title: "Shirt",
  description: "Cotton",
  sku: "S-1",
  categoryId: "cat-1",
  priceSatang: 25_900,
  stock: 4,
};

const FORBIDDEN_KEYS = [
  "storeId",
  "store",
  "ownerId",
  "userId",
  "id",
  "slug",
  "status",
  "moderationStatus",
  "moderationNote",
  "moderationRequestedAt",
  "contentRevision",
  "isSample",
  "createdAt",
  "updatedAt",
  "images",
  "uploadIds",
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

describe("T-042 review: no body can set the store, the slug, a status, or moderation", () => {
  for (const key of FORBIDDEN_KEYS) {
    it(`"${key}" is refused on create, edit, and stock change`, () => {
      const value = key === "__proto__" ? { status: "PUBLISHED" } : "APPROVED";
      expect(createProductBodySchema.safeParse(parsedWith(VALID_CREATE, key, value)).success).toBe(
        false,
      );
      expect(
        updateProductBodySchema.safeParse(parsedWith({ title: "New" }, key, value)).success,
      ).toBe(false);
      expect(stockBodySchema.safeParse(parsedWith({ set: 1 }, key, value)).success).toBe(false);
    });
  }

  it("stock cannot be changed through the edit body", () => {
    expect(updateProductBodySchema.safeParse({ title: "New", stock: 5 }).success).toBe(false);
  });

  it("a parsed body never carries an inherited or injected status", () => {
    const parsed = createProductBodySchema.parse(
      JSON.parse(JSON.stringify(VALID_CREATE)) as unknown,
    ) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(VALID_CREATE).sort());
    expect(({} as Record<string, unknown>).status).toBeUndefined();
  });

  it("the list query ignores storeId and keeps only its own keys", () => {
    const parsed = listSellerProductsQuerySchema.parse({
      storeId: "other-store",
      ownerId: "other-owner",
      status: "DRAFT",
    }) as Record<string, unknown>;
    expect(parsed.storeId).toBeUndefined();
    expect(parsed.ownerId).toBeUndefined();
    expect(parsed.status).toBe("DRAFT");
  });
});

// ---------------------------------------------------------------------------------------------
// Money and stock bounds
// ---------------------------------------------------------------------------------------------

describe("T-042 review: price and stock are bounded integers", () => {
  const badPrices: unknown[] = [
    99,
    100_000_001,
    100.5,
    "25900",
    -100,
    0,
    1e21,
    Number.MAX_SAFE_INTEGER,
    2 ** 31,
    null,
    true,
    [25_900],
    { value: 25_900 },
  ];
  for (const price of badPrices) {
    it(`priceSatang ${JSON.stringify(price)} is refused on create and edit`, () => {
      expect(
        createProductBodySchema.safeParse({ ...VALID_CREATE, priceSatang: price }).success,
      ).toBe(false);
      expect(updateProductBodySchema.safeParse({ priceSatang: price }).success).toBe(false);
    });
  }

  it("the bounds themselves are accepted (BR-02)", () => {
    expect(createProductBodySchema.safeParse({ ...VALID_CREATE, priceSatang: 100 }).success).toBe(
      true,
    );
    expect(
      createProductBodySchema.safeParse({ ...VALID_CREATE, priceSatang: 100_000_000 }).success,
    ).toBe(true);
  });

  const badStocks: unknown[] = [-1, MAX_SELLER_STOCK + 1, 1.5, "4", 2 ** 31, null];
  for (const stock of badStocks) {
    it(`create stock ${JSON.stringify(stock)} and set ${JSON.stringify(stock)} are refused`, () => {
      expect(createProductBodySchema.safeParse({ ...VALID_CREATE, stock }).success).toBe(false);
      expect(stockBodySchema.safeParse({ set: stock }).success).toBe(false);
    });
  }

  const badAdjusts: unknown[] = [0, -0, MAX_SELLER_STOCK + 1, -MAX_SELLER_STOCK - 1, 0.5, "1"];
  for (const adjust of badAdjusts) {
    it(`adjust ${String(adjust)} is refused`, () => {
      expect(stockBodySchema.safeParse({ adjust }).success).toBe(false);
    });
  }

  it("set and adjust together, and neither, are refused", () => {
    expect(stockBodySchema.safeParse({ set: 1, adjust: 1 }).success).toBe(false);
    expect(stockBodySchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Text fields: no control, bidi, or invisible character; ids opaque but bounded
// ---------------------------------------------------------------------------------------------

describe("T-042 review: title, description, SKU, and ids refuse hidden characters", () => {
  const hidden: [string, string][] = [
    ["U+0000", String.fromCodePoint(0)],
    ["U+202E right-to-left override", String.fromCodePoint(0x202e)],
    ["U+2066 left-to-right isolate", String.fromCodePoint(0x2066)],
    ["U+2028 line separator", String.fromCodePoint(0x2028)],
    ["U+2029 paragraph separator", String.fromCodePoint(0x2029)],
    ["U+FEFF byte order mark", String.fromCodePoint(0xfeff)],
    ["U+0007 bell", String.fromCodePoint(7)],
    ["U+001B escape", String.fromCodePoint(0x1b)],
  ];
  for (const [label, character] of hidden) {
    it(`${label} is refused in title, description, and SKU`, () => {
      const text = `Shirt${character}x`;
      expect(createProductBodySchema.safeParse({ ...VALID_CREATE, title: text }).success).toBe(
        false,
      );
      expect(
        createProductBodySchema.safeParse({ ...VALID_CREATE, description: text }).success,
      ).toBe(false);
      expect(createProductBodySchema.safeParse({ ...VALID_CREATE, sku: text }).success).toBe(false);
    });
  }

  it("U+200B and U+200C stay accepted (Thai word breaks; SEC-033 ruling), so a title may hold them", () => {
    for (const code of [0x200b, 0x200c]) {
      const title = `Shirt${String.fromCodePoint(code)}x`;
      expect(createProductBodySchema.safeParse({ ...VALID_CREATE, title }).success).toBe(true);
    }
  });

  it("markup is accepted as text (React escapes it on output; no HTML renderer exists for it)", () => {
    const markup = "<img src=x onerror=alert(1)>";
    const parsed = createProductBodySchema.parse({ ...VALID_CREATE, description: markup });
    expect(parsed.description).toBe(markup);
  });

  it("a product id of 201 characters, with U+0000, or with a lone surrogate is refused", () => {
    expect(productIdParamsSchema.safeParse({ id: "a".repeat(201) }).success).toBe(false);
    expect(productIdParamsSchema.safeParse({ id: `a${String.fromCodePoint(0)}` }).success).toBe(
      false,
    );
    expect(productIdParamsSchema.safeParse({ id: `a${String.fromCharCode(0xd800)}` }).success).toBe(
      false,
    );
  });

  it("more than 8 image keys, or one key twice, is refused", () => {
    const keys = Array.from({ length: 9 }, (_, index) => `k${index}`);
    expect(createProductBodySchema.safeParse({ ...VALID_CREATE, imageKeys: keys }).success).toBe(
      false,
    );
    expect(
      createProductBodySchema.safeParse({ ...VALID_CREATE, imageKeys: ["k", "k"] }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Moderation: no seller save produces APPROVED, and no status move touches moderation
// ---------------------------------------------------------------------------------------------

describe("T-042 review: a seller can never reach APPROVED", () => {
  const stored: ModerationView = {
    title: "T",
    description: "D",
    categoryId: "c",
    priceSatang: 100,
    uploadIds: ["u1", "u2"],
  };
  const variants: ModerationView[] = [
    stored,
    { ...stored, title: "T2" },
    { ...stored, description: "D2" },
    { ...stored, categoryId: "c2" },
    { ...stored, priceSatang: 200 },
    { ...stored, uploadIds: ["u2", "u1"] },
    { ...stored, uploadIds: ["u1"] },
    { ...stored, uploadIds: ["u1", "u3"] },
    { ...stored, uploadIds: [] },
    { ...stored, title: "T2", priceSatang: 200, uploadIds: ["u2", "u1"] },
  ];

  for (const status of MODERATION_STATUSES) {
    it(`from ${status}: every save leaves ${status} or goes to PENDING, never to APPROVED unless already APPROVED`, () => {
      for (const next of variants) {
        const effect = classifySave(status, stored, next);
        expect([status, "PENDING"]).toContain(effect.moderationStatus);
        if (status !== "APPROVED") expect(effect.moderationStatus).not.toBe("APPROVED");
      }
    });
  }

  it("an APPROVED product stays APPROVED only for price, picture order, or nothing", () => {
    const keeps = variants.filter(
      (next) => classifySave("APPROVED", stored, next).moderationStatus === "APPROVED",
    );
    expect(keeps).toEqual([
      stored,
      { ...stored, priceSatang: 200 },
      { ...stored, uploadIds: ["u2", "u1"] },
    ]);
  });

  it("the state table moves Product.status only, and ARCHIVED is final", () => {
    for (const row of PRODUCT_TRANSITIONS) {
      expect(Object.keys(row).sort()).toEqual(["action", "from", "to"]);
      expect(row.from).not.toBe("ARCHIVED");
    }
  });
});
