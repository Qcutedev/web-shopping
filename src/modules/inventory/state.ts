/**
 * The seller's product state machine and the moderation effect of a seller save (REQUIREMENTS.md
 * "Product moderation", BR-17 to BR-19; DATA_MODEL.md section 4.2; docs/API_CONTRACTS.md section
 * 3.3; D-024, D-026 OQ-35 and OQ-36, D-028, D-031 point 2). The one place where these are defined:
 * every guarded status statement of this module takes its allowed source states from the table
 * below, and anything not listed is refused with `409 INVALID_STATE_TRANSITION`.
 *
 * `Product.status` is the seller's switch. `Product.moderationStatus` is the admin's decision; a
 * seller never sets it directly. The only seller effect on it is `classifySave`: a save of
 * moderated content (or, on a rejected or taken-down product, of the price) sends the product
 * back to `PENDING`. No seller request can produce `APPROVED`.
 *
 * Pure: no database and no framework import.
 */
import { invalidStateTransition } from "@/server/errors";

export const PRODUCT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ProductStatusValue = (typeof PRODUCT_STATUSES)[number];

export const MODERATION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "TAKEN_DOWN"] as const;
export type ModerationStatusValue = (typeof MODERATION_STATUSES)[number];

/** The three seller actions that move `Product.status` (section 3.3). */
export type ProductAction = "publish" | "unpublish" | "archive";

export interface ProductTransition {
  readonly action: ProductAction;
  readonly from: ProductStatusValue;
  readonly to: ProductStatusValue;
}

/**
 * Every seller move of `Product.status` (DATA_MODEL.md section 4.2). `ARCHIVED` is final. Deleting
 * a product that an order references uses the `archive` rows (BR-12).
 */
export const PRODUCT_TRANSITIONS: readonly ProductTransition[] = Object.freeze([
  { action: "publish", from: "DRAFT", to: "PUBLISHED" },
  { action: "unpublish", from: "PUBLISHED", to: "DRAFT" },
  { action: "archive", from: "DRAFT", to: "ARCHIVED" },
  { action: "archive", from: "PUBLISHED", to: "ARCHIVED" },
]);

/** The target of `action` from `from`, or null when the table has no such row. */
export function productTransitionTarget(
  action: ProductAction,
  from: ProductStatusValue,
): ProductStatusValue | null {
  return PRODUCT_TRANSITIONS.find((row) => row.action === action && row.from === from)?.to ?? null;
}

/** The states `action` may start from (the guard of its statement). */
export function productActionSourceStates(action: ProductAction): ProductStatusValue[] {
  return PRODUCT_TRANSITIONS.filter((row) => row.action === action).map((row) => row.from);
}

/** 409 INVALID_STATE_TRANSITION unless the table allows `action` from `from`; else the target. */
export function assertProductTransition(
  action: ProductAction,
  from: ProductStatusValue,
): ProductStatusValue {
  const to = productTransitionTarget(action, from);
  if (to === null) throw invalidStateTransition();
  return to;
}

/**
 * A product's fields as they bear on moderation: the four moderated things (title, description,
 * category, the set of pictures), the price (a correction only on a rejected or taken-down
 * product), and the picture order (never moderated). Texts are compared as the service stores
 * them, after the schema's normalisation.
 */
export interface ModerationView {
  readonly title: string;
  readonly description: string;
  readonly categoryId: string;
  readonly priceSatang: number;
  /** Upload ids of the pictures in display order. */
  readonly uploadIds: readonly string[];
}

export interface SaveEffect {
  /** Title, description, category, or the set of pictures differs (BR-18). */
  readonly moderatedContentChanged: boolean;
  /** The save resubmits a `REJECTED` or `TAKEN_DOWN` product (BR-19). */
  readonly resubmits: boolean;
  /** `moderationStatus` after the save. */
  readonly moderationStatus: ModerationStatusValue;
  /** `contentRevision` rises by one (D-031 point 2). */
  readonly bumpRevision: boolean;
  /** `moderationRequestedAt` is set to the database's `now()`: the product entered `PENDING`. */
  readonly setRequestedAt: boolean;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((id) => left.has(id));
}

/**
 * The moderation effect of one seller save (DATA_MODEL.md section 4.2, "How a save is
 * classified"):
 *
 *   - moderated content differs: revision + 1; `APPROVED`, `REJECTED`, `TAKEN_DOWN` become
 *     `PENDING` and the request time is set; `PENDING` stays and keeps its place in the queue;
 *   - moderated content the same, price differs, stored status `REJECTED` or `TAKEN_DOWN`: a
 *     correction; revision + 1, `PENDING`, request time set;
 *   - anything else (price on `APPROVED` or `PENDING`, stock, SKU, picture order, nothing):
 *     moderation untouched.
 *
 * Status `ARCHIVED` is refused before this is asked.
 */
export function classifySave(
  storedStatus: ModerationStatusValue,
  stored: ModerationView,
  next: ModerationView,
): SaveEffect {
  const moderatedContentChanged =
    stored.title !== next.title ||
    stored.description !== next.description ||
    stored.categoryId !== next.categoryId ||
    !sameSet(stored.uploadIds, next.uploadIds);
  const correctable = storedStatus === "REJECTED" || storedStatus === "TAKEN_DOWN";
  const priceChanged = stored.priceSatang !== next.priceSatang;

  if (moderatedContentChanged) {
    return {
      moderatedContentChanged,
      resubmits: correctable,
      moderationStatus: "PENDING",
      bumpRevision: true,
      setRequestedAt: storedStatus !== "PENDING",
    };
  }
  if (priceChanged && correctable) {
    return {
      moderatedContentChanged,
      resubmits: true,
      moderationStatus: "PENDING",
      bumpRevision: true,
      setRequestedAt: true,
    };
  }
  return {
    moderatedContentChanged,
    resubmits: false,
    moderationStatus: storedStatus,
    bumpRevision: false,
    setRequestedAt: false,
  };
}
