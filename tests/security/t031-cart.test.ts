/**
 * Security review of T-031 (cart), commit 7ddfcd1. docs/reviews/T-031-security.md.
 *
 * The real cart service and repository run against an in-memory stand-in for the Prisma client.
 * The stand-in honours the `where` of each query as Prisma would for the shapes the repository
 * uses (equality on `id`, `cartId`, `productId`, `cart.userId`, and the visibility rule passed as
 * `AND: [VISIBLE_PRODUCT_WHERE, ...]`), and records every call. So these cases show that the
 * repository's queries carry the scoping, and that the service acts on what they return. They do
 * NOT show what PostgreSQL does: the cart lock, the transaction, the constraints, and concurrency
 * are only shown by tests/integration/cart (code-review finding CR-T031-01), which did not exist
 * when this file was written.
 *
 * SEC-053 (a cart holds any number of distinct lines) is FIXED (re-checked 2026-10-22 at 3e2f4d1):
 * its cases are plain `it` and assert the cap of 50 lines.
 *
 * SEC-054 (a hidden line showed the product's current picture, slug, and title) is fixed by
 * backend-api: a NOT_AVAILABLE line carries `image`, `slug`, and `title` as null. Its `it.fails`
 * case is flipped to `it` and extended to the title; awaiting the security re-check.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VISIBLE_PRODUCT_WHERE } from "@/modules/catalog/visibility";
import type { Actor } from "@/server/auth/actor";
import { AppError } from "@/server/errors";

// ---------------------------------------------------------------------------------------------
// In-memory stand-in for the Prisma client
// ---------------------------------------------------------------------------------------------

interface FakeProduct {
  id: string;
  slug: string;
  title: string;
  priceSatang: number;
  stock: number;
  storeId: string;
  visible: boolean;
  /** Storage key of the first picture, or null. */
  imageKey: string | null;
}

interface FakeCart {
  id: string;
  userId: string;
}

interface FakeLine {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  createdAt: number;
}

interface Call {
  model: string;
  method: string;
  args: unknown;
}

const state = vi.hoisted(() => ({
  products: new Map<string, FakeProduct>(),
  carts: [] as FakeCart[],
  lines: [] as FakeLine[],
  calls: [] as Call[],
  rawLocks: [] as { sql: string; values: unknown[] }[],
  seq: 0,
}));

function next(prefix: string): string {
  state.seq += 1;
  return `${prefix}_${state.seq}`;
}

type Where = Record<string, unknown>;

/** Equality on the plain keys the cart repository uses; anything else is a test failure. */
function lineMatches(line: FakeLine, where: Where): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "id" || key === "cartId" || key === "productId") {
      if ((line as unknown as Record<string, unknown>)[key] !== value) return false;
    } else if (key === "cart") {
      const userId = (value as { userId: string }).userId;
      const cart = state.carts.find((c) => c.id === line.cartId);
      if (cart?.userId !== userId) return false;
    } else {
      throw new Error(`fake cartItem: unsupported where key ${key}`);
    }
  }
  return true;
}

function pickLine(line: FakeLine) {
  return { id: line.id, productId: line.productId, quantity: line.quantity };
}

/** Returns the product id the visibility query names, after checking the rule is applied. */
function visibleWhereIds(where: Where): string[] {
  const and = (where as { AND?: unknown[] }).AND;
  if (!Array.isArray(and) || and[0] !== VISIBLE_PRODUCT_WHERE) {
    throw new Error("fake product: query does not apply VISIBLE_PRODUCT_WHERE");
  }
  const idPart = (and[1] as { id: string | { in: string[] } }).id;
  return typeof idPart === "string" ? [idPart] : idPart.in;
}

function record(model: string, method: string, args: unknown): void {
  state.calls.push({ model, method, args });
}

const client = vi.hoisted(() => ({}) as Record<string, unknown>);

function buildClient() {
  const cartItem = {
    findFirst: async (args: { where: Where }) => {
      record("cartItem", "findFirst", args);
      const line = state.lines.find((l) => lineMatches(l, args.where));
      return line === undefined ? null : pickLine(line);
    },
    findMany: async (args: { where: Where }) => {
      record("cartItem", "findMany", args);
      return state.lines
        .filter((l) => lineMatches(l, args.where))
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((l) => {
          const p = state.products.get(l.productId);
          if (p === undefined) throw new Error("fake: dangling line");
          return {
            ...pickLine(l),
            product: {
              slug: p.slug,
              title: p.title,
              priceSatang: p.priceSatang,
              stock: p.stock,
              store: { id: p.storeId, name: p.storeId, slug: p.storeId, isSample: false },
              images: p.imageKey === null ? [] : [{ upload: { storageKey: p.imageKey } }],
            },
          };
        });
    },
    create: async (args: { data: { cartId: string; productId: string; quantity: number } }) => {
      record("cartItem", "create", args);
      const { cartId, productId, quantity } = args.data;
      if (state.lines.some((l) => l.cartId === cartId && l.productId === productId)) {
        throw new Error("fake: CartItem_cartId_productId_key");
      }
      if (quantity < 1 || quantity > 99) throw new Error("fake: CartItem_quantity_check");
      const line = { id: next("line"), cartId, productId, quantity, createdAt: state.seq };
      state.lines.push(line);
      return pickLine(line);
    },
    update: async (args: { where: Where; data: { quantity: number } }) => {
      record("cartItem", "update", args);
      const line = state.lines.find((l) => lineMatches(l, args.where));
      if (line === undefined) throw new Error("fake: P2025 record to update not found");
      line.quantity = args.data.quantity;
      return pickLine(line);
    },
    updateMany: async (args: { where: Where; data: { quantity: number } }) => {
      record("cartItem", "updateMany", args);
      const hit = state.lines.filter((l) => lineMatches(l, args.where));
      for (const l of hit) l.quantity = args.data.quantity;
      return { count: hit.length };
    },
    updateManyAndReturn: async (args: { where: Where; data: { quantity: number } }) => {
      record("cartItem", "updateManyAndReturn", args);
      const hit = state.lines.filter((l) => lineMatches(l, args.where));
      for (const l of hit) l.quantity = args.data.quantity;
      return hit.map(pickLine);
    },
    deleteMany: async (args: { where: Where }) => {
      record("cartItem", "deleteMany", args);
      const before = state.lines.length;
      state.lines = state.lines.filter((l) => !lineMatches(l, args.where));
      return { count: before - state.lines.length };
    },
  };
  const product = {
    findFirst: async (args: { where: Where }) => {
      record("product", "findFirst", args);
      const [id] = visibleWhereIds(args.where);
      const p = id === undefined ? undefined : state.products.get(id);
      if (p === undefined || !p.visible) return null;
      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        priceSatang: p.priceSatang,
        stock: p.stock,
        storeId: p.storeId,
      };
    },
    findMany: async (args: { where: Where }) => {
      record("product", "findMany", args);
      return visibleWhereIds(args.where)
        .map((id) => state.products.get(id))
        .filter((p): p is FakeProduct => p !== undefined && p.visible)
        .map((p) => ({ id: p.id }));
    },
  };
  const cart = {
    createMany: async (args: { data: { userId: string }[] }) => {
      record("cart", "createMany", args);
      for (const { userId } of args.data) {
        if (!state.carts.some((c) => c.userId === userId)) {
          state.carts.push({ id: next("cart"), userId });
        }
      }
      return { count: 1 };
    },
  };
  const $queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.rawLocks.push({ sql: strings.join("?"), values });
    const cartRow = state.carts.find((c) => c.userId === values[0]);
    return cartRow === undefined ? [] : [{ id: cartRow.id }];
  };
  // No product has a picture in these cases; both the HEAD read (after commit, on `db`) and a
  // read inside the transaction (on `tx`) find none.
  const productImage = { findFirst: async () => null };
  const upload = { findUnique: async () => null };
  const tx = { cartItem, product, cart, productImage, upload, $queryRaw };
  Object.assign(client, {
    ...tx,
    $transaction: async (work: (t: typeof tx) => Promise<unknown>) => work(tx),
    marketplaceSettings: {
      findUnique: async () => ({ flatShippingFeeSatang: 4_000 }),
    },
  });
}

vi.mock("@/server/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/db")>();
  return { ...original, db: client };
});

const { addCartItem, deleteCartItem, getCart, updateCartItem, addCartItemBodySchema } =
  await import("@/modules/cart");
const { updateCartItemBodySchema, cartItemIdParamsSchema } = await import("@/modules/cart");
const cartSchema = await import("@/modules/cart/schema");

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function actor(userId: string, storeId: string | null = null): Actor {
  return Object.freeze({
    userId,
    role: storeId === null ? "CUSTOMER" : "SELLER",
    storeId,
    storeStatus: storeId === null ? null : "APPROVED",
  }) as Actor;
}

const ALICE = actor("user_alice");
const BOB = actor("user_bob");
const SELLER_S = actor("user_seller", "store_s");

function addProduct(p: Partial<FakeProduct> & { id: string }): FakeProduct {
  const full: FakeProduct = {
    slug: p.id,
    title: p.id,
    priceSatang: 25_900,
    stock: 10,
    storeId: "store_s",
    visible: true,
    imageKey: null,
    ...p,
  };
  state.products.set(full.id, full);
  return full;
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  state.products.clear();
  state.carts = [];
  state.lines = [];
  state.calls = [];
  state.rawLocks = [];
  state.seq = 0;
  buildClient();
  addProduct({ id: "p1" });
  addProduct({ id: "p_hidden", visible: false });
});

// ---------------------------------------------------------------------------------------------
// IDOR: a line id of another user
// ---------------------------------------------------------------------------------------------

describe("T-031 ownership: a foreign cart line id", () => {
  it("PATCH by another user with a cart is 404 and the owner's line is unchanged", async () => {
    const { line } = await addCartItem(ALICE, { productId: "p1", quantity: 2 });
    await addCartItem(BOB, { productId: "p1", quantity: 1 });
    const error = await refusal(updateCartItem(BOB, line.id, { quantity: 9 }));
    expect(error.status).toBe(404);
    expect(error.toPublic()).toEqual({
      code: "NOT_FOUND",
      message: error.message,
      details: {},
    });
    expect(state.lines.find((l) => l.id === line.id)?.quantity).toBe(2);
  });

  it("PATCH by another user without a cart is 404 and creates no cart", async () => {
    const { line } = await addCartItem(ALICE, { productId: "p1", quantity: 2 });
    const error = await refusal(updateCartItem(BOB, line.id, { quantity: 9 }));
    expect(error.status).toBe(404);
    expect(state.carts.some((c) => c.userId === BOB.userId)).toBe(false);
    expect(state.lines.find((l) => l.id === line.id)?.quantity).toBe(2);
  });

  it("DELETE by another user is 404 and the owner's line survives", async () => {
    const { line } = await addCartItem(ALICE, { productId: "p1", quantity: 2 });
    await addCartItem(BOB, { productId: "p1", quantity: 1 });
    const error = await refusal(deleteCartItem(BOB, line.id));
    expect(error.status).toBe(404);
    expect(state.lines.some((l) => l.id === line.id)).toBe(true);
  });

  it("a foreign line id and an unknown id give the same public error", async () => {
    const { line } = await addCartItem(ALICE, { productId: "p1", quantity: 2 });
    await addCartItem(BOB, { productId: "p1", quantity: 1 });
    const foreign = await refusal(updateCartItem(BOB, line.id, { quantity: 3 }));
    const unknown = await refusal(updateCartItem(BOB, "line_does_not_exist", { quantity: 3 }));
    expect(foreign.toPublic()).toEqual(unknown.toPublic());
    const foreignDel = await refusal(deleteCartItem(BOB, line.id));
    const unknownDel = await refusal(deleteCartItem(BOB, "line_does_not_exist"));
    expect(foreignDel.toPublic()).toEqual(unknownDel.toPublic());
  });

  it("GET shows only the actor's own lines", async () => {
    await addCartItem(ALICE, { productId: "p1", quantity: 2 });
    const bobCart = await getCart(BOB);
    expect(bobCart.stores).toEqual([]);
    expect(bobCart.grandTotalSatang).toBe(0);
  });

  it("every cart-line query inside a write is scoped by the actor's own cart id", async () => {
    await addCartItem(ALICE, { productId: "p1", quantity: 2 });
    const { line } = await addCartItem(BOB, { productId: "p1", quantity: 1 });
    state.calls = [];
    await updateCartItem(BOB, line.id, { quantity: 3 });
    await deleteCartItem(BOB, line.id);
    const bobCartId = state.carts.find((c) => c.userId === BOB.userId)?.id;
    const lineCalls = state.calls.filter((c) => c.model === "cartItem");
    expect(lineCalls.length).toBeGreaterThan(0);
    for (const call of lineCalls) {
      const where = (call.args as { where: Where }).where;
      expect(where.cartId, `${call.method} where`).toBe(bobCartId);
    }
  });

  it("the cart lock is a parameterised query on the session user id only", async () => {
    await addCartItem(ALICE, { productId: "p1", quantity: 1 });
    for (const lock of state.rawLocks) {
      expect(lock.sql).not.toContain("user_alice");
      expect(lock.sql).toMatch(/FOR UPDATE/);
      expect(lock.values).toEqual([ALICE.userId]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Mass assignment and quantity bounds (schema)
// ---------------------------------------------------------------------------------------------

describe("T-031 input: nothing but productId and quantity reaches the service", () => {
  const smuggled = [
    "priceSatang",
    "unitPriceSatang",
    "lineTotalSatang",
    "grandTotalSatang",
    "shippingFeeSatang",
    "userId",
    "storeId",
    "cartId",
    "stock",
    "__proto__",
    "constructor",
  ];

  it.each(smuggled)("POST body with %s is refused", (key) => {
    const body = JSON.parse(`{"productId":"p1","quantity":1,${JSON.stringify(key)}:1}`);
    expect(addCartItemBodySchema.safeParse(body).success).toBe(false);
  });

  it.each(smuggled)("PATCH body with %s is refused", (key) => {
    const body = JSON.parse(`{"quantity":1,${JSON.stringify(key)}:1}`);
    expect(updateCartItemBodySchema.safeParse(body).success).toBe(false);
  });

  const badQuantities: unknown[] = [
    0,
    -1,
    100,
    1.5,
    "5",
    1e308,
    -0.5,
    2 ** 31,
    2 ** 53,
    Number.MAX_SAFE_INTEGER + 2,
    null,
    true,
    [1],
    { valueOf: 1 },
  ];
  it.each(badQuantities)("quantity %j is refused on POST and PATCH", (quantity) => {
    expect(addCartItemBodySchema.safeParse({ productId: "p1", quantity }).success).toBe(false);
    expect(updateCartItemBodySchema.safeParse({ quantity }).success).toBe(false);
  });

  it("an item id with NUL, a lone surrogate, or over 200 characters is refused", () => {
    for (const itemId of ["a\u0000b", "a\ud800", "x".repeat(201), ""]) {
      expect(cartItemIdParamsSchema.safeParse({ itemId }).success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Server-side amounts and quantity rules
// ---------------------------------------------------------------------------------------------

describe("T-031 amounts come from the database at read time", () => {
  it("a price change after the add is what GET charges", async () => {
    await addCartItem(ALICE, { productId: "p1", quantity: 3 });
    const product = state.products.get("p1");
    if (product === undefined) throw new Error("fixture");
    product.priceSatang = 1;
    const cart = await getCart(ALICE);
    expect(cart.itemsSubtotalSatang).toBe(3);
    expect(cart.grandTotalSatang).toBe(3 + 4_000);
  });

  it("an add that would pass 99 is refused and leaves the line unchanged", async () => {
    addProduct({ id: "p_big", stock: 1_000 });
    await addCartItem(ALICE, { productId: "p_big", quantity: 60 });
    const error = await refusal(addCartItem(ALICE, { productId: "p_big", quantity: 40 }));
    expect(error.status).toBe(400);
    expect(state.lines.find((l) => l.productId === "p_big")?.quantity).toBe(60);
  });

  it("a request above stock stores the stock, never more", async () => {
    addProduct({ id: "p_low", stock: 3 });
    const { line } = await addCartItem(ALICE, { productId: "p_low", quantity: 50 });
    expect(line.quantity).toBe(3);
    expect(state.lines.find((l) => l.productId === "p_low")?.quantity).toBe(3);
  });

  it("no cart write changes product stock", async () => {
    addProduct({ id: "p_low", stock: 3 });
    const { line } = await addCartItem(ALICE, { productId: "p_low", quantity: 2 });
    await updateCartItem(ALICE, line.id, { quantity: 3 });
    expect(state.products.get("p_low")?.stock).toBe(3);
    expect(state.calls.some((c) => c.model === "product" && /update|upsert/.test(c.method))).toBe(
      false,
    );
  });

  it("a hidden product is answered exactly like a missing one", async () => {
    const hidden = await refusal(addCartItem(ALICE, { productId: "p_hidden", quantity: 1 }));
    const missing = await refusal(addCartItem(ALICE, { productId: "nope", quantity: 1 }));
    expect(hidden.toPublic()).toEqual(missing.toPublic());
    expect(state.lines).toEqual([]);
  });

  it("a seller cannot add a product of their own store (BR-16)", async () => {
    addProduct({ id: "p_own", storeId: "store_s" });
    const error = await refusal(addCartItem(SELLER_S, { productId: "p_own", quantity: 1 }));
    expect(error.status).toBe(409);
    expect(state.lines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-053: unbounded number of distinct lines
// ---------------------------------------------------------------------------------------------

describe("SEC-053 a cart holds any number of distinct lines", () => {
  const DISTINCT = 1_000;

  // Flipped from `it.fails` on 2026-10-22 after the re-check of 3e2f4d1 (SEC-053 FIXED).
  it("a cart refuses new distinct lines past a fixed maximum", async () => {
    for (let i = 0; i < DISTINCT; i += 1) addProduct({ id: `bulk_${i}`, stock: 99 });
    const refused: AppError[] = [];
    for (let i = 0; i < DISTINCT; i += 1) {
      try {
        await addCartItem(ALICE, { productId: `bulk_${i}`, quantity: 99 });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        refused.push(error);
      }
    }
    // The fix introduces a cap (for example MAX_CART_LINES) below DISTINCT.
    expect(refused.length).toBeGreaterThan(0);
    const max = (cartSchema as Record<string, unknown>).MAX_CART_LINES;
    expect(typeof max).toBe("number");
    expect(state.lines.length).toBe(max);
  }, 60_000);

  // Replaces "documents the present behaviour: 1,000 distinct lines are stored" (2026-10-22).
  it("the cap is 50 lines: the 51st new line is 409 CONFLICT CART_LINE_LIMIT, nothing stored", async () => {
    expect(cartSchema.MAX_CART_LINES).toBe(50);
    for (let i = 0; i < 51; i += 1) addProduct({ id: `bulk_${i}`, stock: 99 });
    for (let i = 0; i < 50; i += 1) {
      await addCartItem(ALICE, { productId: `bulk_${i}`, quantity: 1 });
    }
    expect(state.lines.length).toBe(50);

    const error = await refusal(addCartItem(ALICE, { productId: "bulk_50", quantity: 1 }));
    expect(error.status).toBe(409);
    expect(error.toPublic()).toEqual({
      code: "CONFLICT",
      message: error.message,
      details: { reason: "CART_LINE_LIMIT" },
    });
    expect(state.lines.length).toBe(50);
    expect(state.lines.some((l) => l.productId === "bulk_50")).toBe(false);

    // A quantity change of an existing line is never refused for the cap.
    await addCartItem(ALICE, { productId: "bulk_0", quantity: 1 });
    expect(state.lines.find((l) => l.productId === "bulk_0")?.quantity).toBe(2);
    expect(state.lines.length).toBe(50);

    // The cap is per cart: another account is not affected.
    await addCartItem(BOB, { productId: "bulk_50", quantity: 1 });

    // Removing a line frees a place.
    const first = state.lines.find((l) => l.productId === "bulk_1");
    if (first === undefined) throw new Error("fixture");
    await deleteCartItem(ALICE, first.id);
    await addCartItem(ALICE, { productId: "bulk_50", quantity: 1 });

    const cart = await getCart(ALICE);
    const lines = cart.stores.reduce((n, s) => n + s.items.length, 0);
    expect(lines).toBe(50);
  });
});

// ---------------------------------------------------------------------------------------------
// SEC-054: a hidden line shows content no admin approved
// ---------------------------------------------------------------------------------------------

describe("SEC-054 a hidden line shows the product's current picture, slug, and title", () => {
  /** A visible product in Alice's cart, then edited by its seller and hidden pending re-approval. */
  async function editedAfterApproval() {
    addProduct({ id: "p_edit", title: "Approved title", imageKey: "approved-key" });
    await addCartItem(ALICE, { productId: "p_edit", quantity: 1 });
    const product = state.products.get("p_edit");
    if (product === undefined) throw new Error("fixture");
    product.title = "Unapproved text from the seller";
    product.slug = "unapproved-slug";
    product.imageKey = "unapproved-key";
    product.visible = false; // OQ-05: an edit of title or pictures hides it until re-approved
    const cart = await getCart(ALICE);
    const line = cart.stores[0]?.items[0];
    if (line === undefined) throw new Error("expected the hidden line");
    return line;
  }

  it("a NOT_AVAILABLE line carries no picture, no slug, and no title", async () => {
    const line = await editedAfterApproval();
    expect(line.unbuyableReason).toBe("NOT_AVAILABLE");
    expect(line.image).toBeNull();
    expect(line.slug).not.toBe("unapproved-slug");
    expect(line.slug).toBeNull();
    expect(line.title).toBeNull();
  });

  it("no unapproved value appears anywhere in the cart answer", async () => {
    await editedAfterApproval();
    const body = JSON.stringify(await getCart(ALICE));
    expect(body).not.toContain("Unapproved text from the seller");
    expect(body).not.toContain("unapproved-slug");
    expect(body).not.toContain("unapproved-key");
  });

  it("the hidden line keeps its id, product id, quantity, and store group, and can be removed", async () => {
    const line = await editedAfterApproval();
    const cart = await getCart(ALICE);
    expect(cart.stores[0]?.store.name).toBe("store_s");
    expect(line.id).toMatch(/^line_/);
    expect(line.productId).toBe("p_edit");
    expect(line.quantity).toBe(1);
    expect(line.buyable).toBe(false);
    // Price, total, and stock are withheld as the contract says.
    expect(line.unitPriceSatang).toBeNull();
    expect(line.lineTotalSatang).toBeNull();
    expect(line.stock).toBeNull();
    expect(cart.canCheckout).toBe(false);
    await expect(deleteCartItem(ALICE, line.id)).resolves.toEqual({ deleted: true });
    expect((await getCart(ALICE)).stores).toEqual([]);
  });

  it("a take-down with unchanged content also withholds title, slug, and picture", async () => {
    addProduct({ id: "p_down", title: "Taken down title", imageKey: "taken-down-key" });
    await addCartItem(ALICE, { productId: "p_down", quantity: 2 });
    const product = state.products.get("p_down");
    if (product === undefined) throw new Error("fixture");
    product.visible = false; // an admin takes it down; nothing of its content changes
    const line = (await getCart(ALICE)).stores[0]?.items[0];
    expect(line?.unbuyableReason).toBe("NOT_AVAILABLE");
    expect(line?.title).toBeNull();
    expect(line?.slug).toBeNull();
    expect(line?.image).toBeNull();
  });

  it("a hidden line that is also sold out is NOT_AVAILABLE with no content", async () => {
    addProduct({ id: "p_both", title: "Hidden and empty", imageKey: "k", stock: 5 });
    await addCartItem(ALICE, { productId: "p_both", quantity: 1 });
    const product = state.products.get("p_both");
    if (product === undefined) throw new Error("fixture");
    product.visible = false;
    product.stock = 0;
    const line = (await getCart(ALICE)).stores[0]?.items[0];
    expect(line?.unbuyableReason).toBe("NOT_AVAILABLE");
    expect([line?.title, line?.slug, line?.image]).toEqual([null, null, null]);
  });

  it("a visible line next to the hidden one keeps its title, slug, and picture", async () => {
    addProduct({ id: "p_ok", title: "Visible title", imageKey: "visible-key" });
    await addCartItem(ALICE, { productId: "p_ok", quantity: 1 });
    await editedAfterApproval();
    const items = (await getCart(ALICE)).stores.flatMap((s) => s.items);
    const visible = items.find((i) => i.productId === "p_ok");
    expect(visible?.buyable).toBe(true);
    expect(visible?.title).toBe("Visible title");
    expect(visible?.slug).toBe("p_ok");
    expect(visible?.image?.key).toBe("visible-key");
  });

  it("the line shows the product's content again once it is visible again (re-approved)", async () => {
    await editedAfterApproval();
    const product = state.products.get("p_edit");
    if (product === undefined) throw new Error("fixture");
    product.visible = true; // an admin approved the edit
    const line = (await getCart(ALICE)).stores[0]?.items[0];
    expect(line?.buyable).toBe(true);
    expect(line?.title).toBe("Unapproved text from the seller");
    expect(line?.slug).toBe("unapproved-slug");
    expect(line?.image?.key).toBe("unapproved-key");
  });

  it("a quantity change of the hidden line is refused and names no content", async () => {
    const line = await editedAfterApproval();
    const error = await refusal(updateCartItem(ALICE, line.id, { quantity: 2 }));
    expect(error.status).toBe(409);
    const text = JSON.stringify({ message: error.message, details: error.details });
    expect(text).not.toContain("Unapproved text from the seller");
    expect(text).not.toContain("unapproved-slug");
    expect(text).not.toContain("unapproved-key");
  });
});
