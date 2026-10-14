/**
 * Cart service (docs/API_CONTRACTS.md section 5.4; REQ-C-10, BR-03, BR-12, BR-16, BR-22, BR-30,
 * BR-31, BR-38).
 *
 * Every function takes the acting user as `actor` (CLAUDE.md rule 2). The access level is `user`:
 * every role may hold a cart (a seller buys from other stores), so no role is refused here.
 * Ownership is the control: every query is scoped by `actor.userId`, and nothing of the request
 * can name another user's cart. A line the actor does not own is 404, exactly like one that does
 * not exist (section 1.8). BR-16 compares the product's store with `actor.storeId`, which the
 * session guard read from the database for this request; nothing of the request names a store.
 *
 * Amounts come from the database only (CLAUDE.md rule 3): prices, stock, and the flat fee are read
 * when the request is served, and no price is stored in the cart. Stock is never changed here.
 *
 * Writes run in one transaction each, under the lock of the user's cart row (repository.ts). The
 * checks of a write, in order, each refusing before anything is stored:
 *
 *   add (POST /cart/items)            set (PATCH /cart/items/{itemId})
 *   1. product visible, else 404      1. line is the actor's, else 404
 *   2. not own store, else 409        2. product visible, else 409 NOT_AVAILABLE (BR-38)
 *   3. earlier + sent <= 99, else 400 3. not own store, else 409
 *   4. stock >= 1, else 409           4. stock >= 1, else 409 (BR-38)
 *   5. store min(requested, stock)    5. store min(sent, stock)
 *
 * The 1 to 99 limit comes before the stock (BR-31 (3)). A request for more than a stock of 1 or
 * more succeeds with the stock stored and `quantityLowered: true` (BR-31 (2)).
 */
import type { Actor } from "@/server/auth/actor";
import type { DbTransaction } from "@/server/db";

import {
  cartLineNotFound,
  hiddenLineQuantityChange,
  lineQuantityTooBig,
  ownStoreProduct,
  productNotFound,
  soldOut,
} from "./errors";
import { buildCart, type CartLineInput, priceLine, resolveWriteQuantity } from "./pricing";
import {
  type CartLineRow,
  deleteLineInCart,
  findCartLines,
  findFirstImageKey,
  findLineForProduct,
  findLineInCart,
  findVisibleProduct,
  findVisibleProductIds,
  inCartTransaction,
  insertLine,
  readFlatShippingFee,
  setLineQuantity,
  type WriteProductRow,
} from "./repository";
import {
  type AddCartItemBody,
  type CartDto,
  type CartItemDeletedDto,
  type CartWriteLineDto,
  MAX_LINE_QUANTITY,
  type UpdateCartItemBody,
} from "./schema";

// ---------------------------------------------------------------------------------------------
// Mapping (pure; unit-tested)
// ---------------------------------------------------------------------------------------------

export function toLineInput(row: CartLineRow, visibleIds: ReadonlySet<string>): CartLineInput {
  return {
    id: row.id,
    productId: row.productId,
    storedQuantity: row.quantity,
    slug: row.product.slug,
    title: row.product.title,
    imageKey: row.product.images[0]?.upload.storageKey ?? null,
    priceSatang: row.product.priceSatang,
    stock: row.product.stock,
    visible: visibleIds.has(row.productId),
    store: row.product.store,
  };
}

/** True when the product belongs to the actor's own store (BR-16). */
export function isOwnStore(actor: Actor, productStoreId: string): boolean {
  return actor.storeId !== null && actor.storeId === productStoreId;
}

// ---------------------------------------------------------------------------------------------
// GET /cart
// ---------------------------------------------------------------------------------------------

/** The actor's cart, grouped by store, with server-computed totals. Writes nothing. */
export async function getCart(actor: Actor): Promise<CartDto> {
  const rows = await findCartLines(actor.userId);
  const visibleIds = await findVisibleProductIds([...new Set(rows.map((row) => row.productId))]);
  const fee = await readFlatShippingFee();
  return buildCart(
    rows.map((row) => toLineInput(row, visibleIds)),
    fee,
  );
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

interface WriteOutcome {
  lineId: string;
  storedQuantity: number;
  requestedQuantity: number;
  product: WriteProductRow;
  created: boolean;
}

export interface AddCartItemResult {
  line: CartWriteLineDto;
  /** True when this request created the line (201), false when it changed an existing one (200). */
  created: boolean;
}

/** The response line of a successful write, from what the transaction read and stored. */
async function toWriteLine(outcome: WriteOutcome): Promise<CartWriteLineDto> {
  const imageKey = await findFirstImageKey(outcome.product.id);
  const line = priceLine({
    id: outcome.lineId,
    productId: outcome.product.id,
    storedQuantity: outcome.storedQuantity,
    slug: outcome.product.slug,
    title: outcome.product.title,
    imageKey,
    priceSatang: outcome.product.priceSatang,
    stock: outcome.product.stock,
    visible: true,
  });
  return {
    ...line,
    quantityLowered: outcome.storedQuantity < outcome.requestedQuantity,
    requestedQuantity: outcome.requestedQuantity,
  };
}

/** POST /cart/items: adds to the actor's line for the product, or creates it. */
export async function addCartItem(
  actor: Actor,
  input: AddCartItemBody,
): Promise<AddCartItemResult> {
  const outcome = await inCartTransaction(
    actor.userId,
    { createCart: true },
    async (tx, cartId): Promise<WriteOutcome> => {
      const product = await findVisibleProduct(tx, input.productId);
      if (product === null) throw productNotFound();
      const existing = await findLineForProduct(tx, cartId, product.id);
      const requestedQuantity = (existing?.quantity ?? 0) + input.quantity;
      if (isOwnStore(actor, product.storeId)) {
        // Always null on an add (API_CONTRACTS 5.4, CR-T031-03): the request names a product, not
        // a line, even when the actor still holds a line for it from before the store existed.
        throw ownStoreProduct({
          cartItemId: null,
          productId: product.id,
          // The resulting quantity, as in every other answer of an add (CR-T031-04).
          requestedQuantity,
        });
      }
      if (requestedQuantity > MAX_LINE_QUANTITY) throw lineQuantityTooBig();
      if (product.stock < 1) {
        throw soldOut({
          cartItemId: existing?.id ?? null,
          productId: product.id,
          requestedQuantity,
        });
      }
      const { quantity } = resolveWriteQuantity(requestedQuantity, product.stock);
      const line =
        existing === null
          ? await insertLine(tx, cartId, product.id, quantity)
          : await setLineQuantity(tx, cartId, existing.id, quantity);
      // Null: the product was hard-deleted after it was read (its delete does not take the cart
      // lock, and cascades to the line). It is gone, so the answer is the missing product's 404.
      if (line === null) throw productNotFound();
      return {
        lineId: line.id,
        storedQuantity: line.quantity,
        requestedQuantity,
        product,
        created: existing === null,
      };
    },
  );
  // createCart is true, so the transaction always has a cart to lock.
  if (outcome === null) throw new Error("addCartItem: the cart row was not created.");
  return { line: await toWriteLine(outcome), created: outcome.created };
}

/** PATCH /cart/items/{itemId}: sets the quantity of the actor's own line. */
export async function updateCartItem(
  actor: Actor,
  itemId: string,
  input: UpdateCartItemBody,
): Promise<CartWriteLineDto> {
  const outcome = await inCartTransaction(
    actor.userId,
    { createCart: false },
    async (tx, cartId): Promise<WriteOutcome> => setOwnedLine(tx, actor, cartId, itemId, input),
  );
  if (outcome === null) throw cartLineNotFound();
  return toWriteLine(outcome);
}

async function setOwnedLine(
  tx: DbTransaction,
  actor: Actor,
  cartId: string,
  itemId: string,
  input: UpdateCartItemBody,
): Promise<WriteOutcome> {
  const line = await findLineInCart(tx, cartId, itemId);
  if (line === null) throw cartLineNotFound();
  const requestedQuantity = input.quantity;
  const product = await findVisibleProduct(tx, line.productId);
  if (product === null) {
    throw hiddenLineQuantityChange({
      cartItemId: line.id,
      productId: line.productId,
      requestedQuantity,
    });
  }
  if (isOwnStore(actor, product.storeId)) {
    throw ownStoreProduct({ cartItemId: line.id, productId: product.id, requestedQuantity });
  }
  if (product.stock < 1) {
    throw soldOut({ cartItemId: line.id, productId: product.id, requestedQuantity });
  }
  const { quantity } = resolveWriteQuantity(requestedQuantity, product.stock);
  const stored = await setLineQuantity(tx, cartId, line.id, quantity);
  // Null: a product hard delete removed the line after it was read (CR-T031-02). The line no
  // longer exists, so it is answered like any line the actor does not have.
  if (stored === null) throw cartLineNotFound();
  return {
    lineId: stored.id,
    storedQuantity: stored.quantity,
    requestedQuantity,
    product,
    created: false,
  };
}

/**
 * DELETE /cart/items/{itemId}: removes the actor's own line, whatever its product's state (a
 * sold-out or hidden line can always be removed, BR-38).
 */
export async function deleteCartItem(actor: Actor, itemId: string): Promise<CartItemDeletedDto> {
  const deleted = await inCartTransaction(actor.userId, { createCart: false }, (tx, cartId) =>
    deleteLineInCart(tx, cartId, itemId),
  );
  if (deleted !== true) throw cartLineNotFound();
  return { deleted: true };
}
