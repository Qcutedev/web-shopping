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
import { ModerationStatus, type Prisma, ProductStatus, StoreStatus } from "@/server/db";

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

/** The same five conditions as a pure check, for unit tests and for rows already loaded. */
export interface VisibilityFacts {
  status: string;
  moderationStatus: string;
  storeStatus: string;
  ownerIsActive: boolean;
  categoryIsActive: boolean;
}

export function isPublicStore(facts: Pick<VisibilityFacts, "storeStatus" | "ownerIsActive">) {
  return facts.storeStatus === StoreStatus.APPROVED && facts.ownerIsActive;
}

export function isVisibleProduct(facts: VisibilityFacts): boolean {
  return (
    facts.status === ProductStatus.PUBLISHED &&
    facts.moderationStatus === ModerationStatus.APPROVED &&
    isPublicStore(facts) &&
    facts.categoryIsActive
  );
}

/** "สินค้าหมด" (BR-24): a visible product with no stock. */
export function isSoldOut(stock: number): boolean {
  return stock === 0;
}
