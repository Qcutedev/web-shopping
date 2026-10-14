/**
 * The one definition of "visible" (BR-05; DATA_MODEL.md section 5; docs/API_CONTRACTS.md
 * section 3.4), used by the catalog now and by the cart flags and checkout later. Nothing else
 * may restate the five conditions.
 *
 * A product is visible when all five hold:
 *   1. `Product.status` is `PUBLISHED`;
 *   2. `Product.moderationStatus` is `APPROVED` (so not awaiting first approval, not awaiting
 *      re-approval after an edit, not rejected, not taken down);
 *   3. its store's `status` is `APPROVED` (not suspended);
 *   4. the store owner's account is active (BR-27);
 *   5. its category is active (BR-23).
 *
 * Stock is not a condition (BR-24). Every condition reads the current row, so a reactivated
 * owner or a category switched on again brings the products back by itself (D-026, OQ-31).
 *
 * A store page is public when conditions 3 and 4 hold for the store.
 */
import { ModerationStatus, Prisma, ProductStatus, StoreStatus } from "@/server/db";

/** Conditions 3 and 4, on a `Store`. */
export const PUBLIC_STORE_WHERE = {
  status: StoreStatus.APPROVED,
  owner: { isActive: true },
} as const satisfies Prisma.StoreWhereInput;

/** All five conditions, on a `Product`. */
export const VISIBLE_PRODUCT_WHERE = {
  status: ProductStatus.PUBLISHED,
  moderationStatus: ModerationStatus.APPROVED,
  store: PUBLIC_STORE_WHERE,
  category: { isActive: true },
} as const satisfies Prisma.ProductWhereInput;

/**
 * The same five conditions as a raw SQL fragment, for the guarded statements that must decide
 * and write in one statement (checkout's stock decrement, the classification read and the
 * lowering of a refused checkout; DATA_MODEL.md sections 7.1 and 21.6). A Prisma `updateMany`
 * with a relation filter is not used there, because it may read the matching ids first and
 * update them in a second statement, which would let two checkouts both pass `stock >= q`.
 *
 * The fragment needs the four tables under these aliases, joined by the caller:
 * `p` = "Product", `s` = "Store" (`s.id = p."storeId"`), `u` = "User" (`u.id = s."ownerId"`),
 * `c` = "Category" (`c.id = p."categoryId"`). It holds no parameter. visibility.test.ts compares
 * its literals with VISIBLE_PRODUCT_WHERE above, so the two forms cannot drift apart.
 */
export const VISIBLE_PRODUCT_SQL = Prisma.sql`(p."status" = 'PUBLISHED'
  AND p."moderationStatus" = 'APPROVED'
  AND s."status" = 'APPROVED'
  AND u."isActive" = TRUE
  AND c."isActive" = TRUE)`;

/*
 * No pure restatement of the five conditions (a check on rows already loaded) exists: it would
 * be a second definition with no production caller (code-review finding CR-86). Code that needs
 * the answer for a row reads it with these conditions in its query. A caller that truly needs a
 * pure check adds one here, typed with the Prisma enums, with an integration test that compares
 * it to membership in the query's result.
 */

/** "สินค้าหมด" (BR-24): a visible product with no stock. */
export function isSoldOut(stock: number): boolean {
  return stock === 0;
}
