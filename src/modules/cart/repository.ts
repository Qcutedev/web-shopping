/**
 * Prisma queries of the cart module. Every query is scoped by the user id the service passes,
 * which is always `actor.userId` from the session (CLAUDE.md rules 2 and 6). A cart line is looked
 * up with its cart, and the cart with the user, inside the `WHERE`, so a foreign line id and an
 * unknown one take the same path (docs/API_CONTRACTS.md section 1.8, "Not found over forbidden").
 *
 * Reads (`GET /cart`) run outside any transaction and take no lock; nothing in them writes
 * (D-029 point 1; DATA_MODEL.md section 6.9). They are three statements (the lines, which of their
 * products are visible, the fee), so a write that commits between them can show in one and not
 * the other; the next read is consistent again, and checkout re-reads everything under its lock.
 *
 * Writes run in one interactive transaction each (CLAUDE.md rule 5), opened by `inCartTransaction`:
 *
 *   1. On an add only, the cart row is created if missing with `INSERT ... ON CONFLICT DO NOTHING`
 *      (`createMany` with `skipDuplicates`), so two concurrent first adds of one user do not
 *      collide on `Cart_userId_key` (code-review finding CR-22 b).
 *   2. The cart row is locked with `SELECT ... FOR UPDATE`: the first lock of the lock order
 *      (DATA_MODEL.md section 7.5). Every cart write of one user, and checkout, therefore run one
 *      after the other, so two adds of one product cannot both insert a line, and a line cannot
 *      change while checkout reads it.
 *   3. The service decides, using the statements below, and writes.
 *
 * Inside a transaction every `tx` query selects scalar fields only and the statements are awaited
 * one after the other (docs/API_CONTRACTS.md item 8.2-14; DATA_MODEL.md section 7.8). A relation
 * condition in a `where` (the visibility rule) is part of one statement and is not a relation load.
 *
 * No statement here changes `Product.stock`, and no statement reads it under a lock: a cart never
 * takes or reserves stock (REQ-C-10; checkout does, T-032).
 */
import { VISIBLE_PRODUCT_WHERE } from "@/modules/catalog/visibility";
import { db, type DbTransaction, Prisma } from "@/server/db";

/** The id of the single settings row (`MarketplaceSettings_id_check`). */
const SETTINGS_ID = 1;

// ---------------------------------------------------------------------------------------------
// Reads (no transaction, no lock, no write)
// ---------------------------------------------------------------------------------------------

const CART_LINE_SELECT = {
  id: true,
  productId: true,
  quantity: true,
  product: {
    select: {
      slug: true,
      title: true,
      priceSatang: true,
      stock: true,
      store: { select: { id: true, name: true, slug: true, isSample: true } },
      images: {
        select: { upload: { select: { storageKey: true } } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        take: 1,
      },
    },
  },
} as const satisfies Prisma.CartItemSelect;

export type CartLineRow = Prisma.CartItemGetPayload<{ select: typeof CART_LINE_SELECT }>;

/**
 * Every line of the user's cart with its product, oldest line first (then by id). An empty list
 * when the user has no cart or no line. Not paginated: the cart is one resource (section 1.7).
 */
export async function findCartLines(userId: string): Promise<CartLineRow[]> {
  return db.cartItem.findMany({
    where: { cart: { userId } },
    select: CART_LINE_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** Which of these products are visible now (section 3.4), by the one query form of the rule. */
export async function findVisibleProductIds(productIds: readonly string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const rows = await db.product.findMany({
    where: { AND: [VISIBLE_PRODUCT_WHERE, { id: { in: [...productIds] } }] },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * The current flat shipping fee in satang (BR-08). The settings row is created by the migration
 * and never deleted; its absence is a server fault.
 */
export async function readFlatShippingFee(): Promise<number> {
  const row = await db.marketplaceSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { flatShippingFeeSatang: true },
  });
  if (row === null) throw new Error("cart: the marketplace settings row is missing.");
  return row.flatShippingFeeSatang;
}

// ---------------------------------------------------------------------------------------------
// Writes (one transaction each)
// ---------------------------------------------------------------------------------------------

export interface CartTransactionOptions {
  /** Create the user's cart row when it does not exist (an add). Otherwise a missing cart is null. */
  createCart: boolean;
}

/**
 * Runs `work` in one transaction holding the lock on the user's cart row, and returns its result.
 * When the user has no cart and `createCart` is false, `work` is not called and the result is
 * null. Anything `work` throws rolls the whole transaction back, the created cart row included,
 * and leaves the transaction unchanged (DATA_MODEL.md section 21.5: a callback never catches a
 * database error and carries on).
 */
export async function inCartTransaction<T>(
  userId: string,
  options: CartTransactionOptions,
  work: (tx: DbTransaction, cartId: string) => Promise<T>,
): Promise<T | null> {
  return db.$transaction(async (tx) => {
    if (options.createCart) {
      await tx.cart.createMany({ data: [{ userId }], skipDuplicates: true });
    }
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Cart" WHERE "userId" = ${userId} FOR UPDATE`;
    const cart = locked[0];
    if (cart === undefined) return null;
    return work(tx, cart.id);
  });
}

const WRITE_PRODUCT_SELECT = {
  id: true,
  slug: true,
  title: true,
  priceSatang: true,
  stock: true,
  storeId: true,
} as const satisfies Prisma.ProductSelect;

export type WriteProductRow = Prisma.ProductGetPayload<{ select: typeof WRITE_PRODUCT_SELECT }>;

/** The product if it is visible now, else null (missing and hidden alike). Scalars only. */
export async function findVisibleProduct(
  tx: DbTransaction,
  productId: string,
): Promise<WriteProductRow | null> {
  return tx.product.findFirst({
    where: { AND: [VISIBLE_PRODUCT_WHERE, { id: productId }] },
    select: WRITE_PRODUCT_SELECT,
  });
}

/**
 * Storage key of the product's first picture, or null. Read inside the write's transaction, before
 * it commits, so that a failed read rolls the write back instead of answering 500 for a stored
 * write that a retry would add again (CR-T031-06). Two scalar statements, awaited one after the
 * other, instead of one relation load (DATA_MODEL.md section 7.8).
 */
export async function findFirstImageKey(
  tx: DbTransaction,
  productId: string,
): Promise<string | null> {
  const image = await tx.productImage.findFirst({
    where: { productId },
    select: { uploadId: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  if (image === null) return null;
  const upload = await tx.upload.findUnique({
    where: { id: image.uploadId },
    select: { storageKey: true },
  });
  return upload?.storageKey ?? null;
}

export interface LineRow {
  id: string;
  productId: string;
  quantity: number;
}

const LINE_SELECT = { id: true, productId: true, quantity: true } as const;

/** The line of this cart with this id, or null (unknown and another cart's alike). */
export async function findLineInCart(
  tx: DbTransaction,
  cartId: string,
  lineId: string,
): Promise<LineRow | null> {
  return tx.cartItem.findFirst({ where: { id: lineId, cartId }, select: LINE_SELECT });
}

/** The line of this cart for this product, or null. */
export async function findLineForProduct(
  tx: DbTransaction,
  cartId: string,
  productId: string,
): Promise<LineRow | null> {
  return tx.cartItem.findFirst({ where: { cartId, productId }, select: LINE_SELECT });
}

/** A foreign key of the inserted row points at no row (P2003). */
function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

/**
 * Inserts a line, or returns null when its product no longer exists (CR-T031-02).
 *
 * The product was read as visible earlier in this transaction, but a product hard delete does not
 * take the Cart lock, so it can commit in between (READ COMMITTED). The insert then fails on the
 * `productId` foreign key (P2003). The `cartId` foreign key cannot fail: the cart row is locked by
 * this transaction (`FOR UPDATE` blocks its delete). The failed statement has aborted the
 * transaction, so the caller must throw at once and let it roll back; null carries no other
 * meaning and no further statement may run (DATA_MODEL.md section 21.5).
 */
export async function insertLine(
  tx: DbTransaction,
  cartId: string,
  productId: string,
  quantity: number,
): Promise<LineRow | null> {
  try {
    return await tx.cartItem.create({
      data: { cartId, productId, quantity },
      select: LINE_SELECT,
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) return null;
    throw error;
  }
}

/**
 * Sets the quantity of a line of this cart and returns it, or null when the cart has no line with
 * this id (CR-T031-02).
 *
 * The cart lock stops every other cart write and checkout, but not a product hard delete:
 * `CartItem.product` is `onDelete: Cascade`, so deleting the product removes the line without
 * touching the Cart row. A line read earlier in this transaction can therefore be gone here. The
 * conditional `updateManyAndReturn` answers that with no row instead of a P2025 error.
 */
export async function setLineQuantity(
  tx: DbTransaction,
  cartId: string,
  lineId: string,
  quantity: number,
): Promise<LineRow | null> {
  const rows = await tx.cartItem.updateManyAndReturn({
    where: { id: lineId, cartId },
    data: { quantity },
    select: LINE_SELECT,
  });
  return rows[0] ?? null;
}

/** Deletes a line of this cart. False when the cart has no line with this id. */
export async function deleteLineInCart(
  tx: DbTransaction,
  cartId: string,
  lineId: string,
): Promise<boolean> {
  const { count } = await tx.cartItem.deleteMany({ where: { id: lineId, cartId } });
  return count > 0;
}
