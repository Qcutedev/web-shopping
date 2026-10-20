/**
 * Seller product and inventory contract (docs/API_CONTRACTS.md section 5.7.2; REQ-S-04, REQ-S-06,
 * BR-02, BR-12, BR-14, BR-17 to BR-19, BR-23, BR-25, BR-34): the Zod schemas of the request input
 * and the types of every response shape. Authoritative for `/api/v1/seller/products/**`; the
 * document must match them.
 *
 * Every body is a strict object (section 1.1): an unknown key, `storeId`, `slug`, `status`,
 * `moderationStatus`, `moderationNote`, `contentRevision`, `isSample`, and (on an edit) `stock`
 * included, is `400 VALIDATION_ERROR` and nothing is created or changed. The store always comes
 * from the session.
 *
 * Text limits (item 8.2-7, set for these endpoints in T-042; **provisional** until the owner or
 * the orchestrator rules, each one constant below):
 *
 *   - `title`: one line, trimmed, 1 to 200 characters, the display-name rule (`NAME_ALLOWED_TEXT`);
 *   - `description`: multi-line, 1 to 5000 characters after the normalisation of the store
 *     description (`normaliseMultiLineText`), every non-empty line under `NAME_ALLOWED_TEXT`;
 *   - `sku`: one line, trimmed, 1 to 64 characters, `NAME_ALLOWED_TEXT`; compared exactly (case
 *     sensitive) for uniqueness;
 *   - ids and storage keys: opaque, 1 to 200 characters, no U+0000, no lone surrogate (section 1.4).
 */
import { z } from "zod";

import { NAME_ALLOWED_TEXT } from "@/modules/auth/schema";
import {
  type ImageRef,
  MAX_PRODUCT_IMAGES,
  paginationQuerySchema,
  queryRecord,
} from "@/modules/catalog/schema";
import { normaliseMultiLineText } from "@/modules/sellers/schema";

import {
  MODERATION_STATUSES,
  type ModerationStatusValue,
  PRODUCT_STATUSES,
  type ProductStatusValue,
} from "./state";

export {
  MODERATION_STATUSES,
  type ModerationStatusValue,
  PRODUCT_STATUSES,
  type ProductStatusValue,
} from "./state";
export { MAX_PRODUCT_IMAGES, queryRecord };

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** BR-02: 1.00 to 1,000,000.00 THB, in satang. */
export const MIN_PRICE_SATANG = 100;
export const MAX_PRICE_SATANG = 100_000_000;

/** BR-34: the largest stock a seller may enter, on create, on `set`, and as the result of `adjust`. */
export const MAX_SELLER_STOCK = 1_000_000;

/**
 * BR-25: "low stock" is 1 to `LOW_STOCK_THRESHOLD` inclusive, on a product that is on sale. The
 * one constant DATA_MODEL.md section 5.1 asks for; nothing else repeats the number.
 */
export const LOW_STOCK_THRESHOLD = 5;

/** Provisional text limits (file comment). */
export const PRODUCT_TITLE_MAX = 200;
export const PRODUCT_DESCRIPTION_MAX = 5000;
export const PRODUCT_SKU_MAX = 64;
/** Longest id or storage key accepted (section 1.4; the same bound as the other modules). */
export const MAX_ID_LENGTH = 200;

// ---------------------------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------------------------

const DISPLAY_TEXT_MESSAGE =
  "Must contain a visible character and no control, format, or invisible character.";
const MULTI_LINE_MESSAGE =
  "Every line must contain a visible character, or be empty, and no control, format, or invisible character.";

function oneLineText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(NAME_ALLOWED_TEXT, { error: DISPLAY_TEXT_MESSAGE });
}

function linesAreAllowed(text: string): boolean {
  return text.split("\n").every((line) => line === "" || NAME_ALLOWED_TEXT.test(line));
}

function multiLineText(max: number) {
  return z
    .string()
    .transform(normaliseMultiLineText)
    .pipe(z.string().min(1).max(max).refine(linesAreAllowed, { error: MULTI_LINE_MESSAGE }));
}

/** An opaque value without U+0000 and without a lone surrogate (section 1.4). */
function opaqueText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\u0000") && value.isWellFormed(), {
      error: "Must not contain U+0000 or a lone surrogate.",
    });
}

export const productTitleSchema = oneLineText(PRODUCT_TITLE_MAX);
export const productDescriptionSchema = multiLineText(PRODUCT_DESCRIPTION_MAX);
export const productSkuSchema = oneLineText(PRODUCT_SKU_MAX);
export const categoryIdSchema = opaqueText(MAX_ID_LENGTH);
export const priceSatangSchema = z.number().int().min(MIN_PRICE_SATANG).max(MAX_PRICE_SATANG);
export const createStockSchema = z.number().int().min(0).max(MAX_SELLER_STOCK);

/**
 * `imageKeys`: the whole ordered set of pictures, at most 8 (REQ-S-05), each a storage key of the
 * caller's store, no key twice. An empty array removes every picture.
 */
export const imageKeysSchema = z
  .array(opaqueText(MAX_ID_LENGTH))
  .max(MAX_PRODUCT_IMAGES)
  .refine((keys) => new Set(keys).size === keys.length, {
    error: "A storage key may appear only once.",
  });

function hasAnyKey(value: Record<string, unknown>): boolean {
  return Object.values(value).some((entry) => entry !== undefined);
}

// ---------------------------------------------------------------------------------------------
// Path parameters
// ---------------------------------------------------------------------------------------------

/** The `{id}` path parameter of a product: an opaque id, form only (section 1.4). */
export const productIdParamsSchema = z.object({ id: opaqueText(MAX_ID_LENGTH) });
export type ProductIdParams = z.infer<typeof productIdParamsSchema>;

// ---------------------------------------------------------------------------------------------
// POST /seller/products
// ---------------------------------------------------------------------------------------------

/** REQ-S-04: every field but `imageKeys` is required. */
export const createProductBodySchema = z.strictObject({
  title: productTitleSchema,
  description: productDescriptionSchema,
  sku: productSkuSchema,
  categoryId: categoryIdSchema,
  priceSatang: priceSatangSchema,
  stock: createStockSchema,
  imageKeys: imageKeysSchema.optional(),
});
export type CreateProductBody = z.infer<typeof createProductBodySchema>;

// ---------------------------------------------------------------------------------------------
// PATCH /seller/products/{id}
// ---------------------------------------------------------------------------------------------

/**
 * Any of `title`, `description`, `sku`, `categoryId`, `priceSatang`, `imageKeys`, at least one (an
 * empty object is 400, path `""`, code `custom`). Stock changes only through the stock endpoint.
 */
export const updateProductBodySchema = z
  .strictObject({
    title: productTitleSchema.optional(),
    description: productDescriptionSchema.optional(),
    sku: productSkuSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    priceSatang: priceSatangSchema.optional(),
    imageKeys: imageKeysSchema.optional(),
  })
  .refine(hasAnyKey, { error: "At least one field must be given." });
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;

// ---------------------------------------------------------------------------------------------
// PATCH /seller/products/{id}/stock
// ---------------------------------------------------------------------------------------------

/**
 * REQ-S-06, BR-34: exactly one of `set` (the new absolute value, 0 to 1,000,000) and `adjust` (a
 * non-zero delta, -1,000,000 to 1,000,000). Both or neither is 400 (path `""`, code `custom`).
 */
export const stockBodySchema = z
  .strictObject({
    set: z.number().int().min(0).max(MAX_SELLER_STOCK).optional(),
    adjust: z
      .number()
      .int()
      .min(-MAX_SELLER_STOCK)
      .max(MAX_SELLER_STOCK)
      .refine((delta) => delta !== 0, { error: "Must not be zero." })
      .optional(),
  })
  .refine((body) => (body.set === undefined) !== (body.adjust === undefined), {
    error: "Exactly one of set and adjust must be given.",
  });
export type StockBody = z.infer<typeof stockBodySchema>;

// ---------------------------------------------------------------------------------------------
// GET /seller/products
// ---------------------------------------------------------------------------------------------

const queryString = z.string({ error: "Must be given at most once." });

/** A flag filter: only the value `true` is accepted (section 5.7.2 names `lowStock=true`). */
const trueFlag = queryString
  .pipe(z.literal("true", { error: "Must be true." }))
  .transform(() => true as const);

/**
 * Page, page size (section 1.7), and the filters `status`, `moderationStatus`, `lowStock=true`,
 * `soldOut=true`. Filters combine with AND. Unknown parameters (a `storeId` included) are not
 * interpreted: the schema strips them.
 */
export const listSellerProductsQuerySchema = paginationQuerySchema.extend({
  status: queryString.pipe(z.enum(PRODUCT_STATUSES)).optional(),
  moderationStatus: queryString.pipe(z.enum(MODERATION_STATUSES)).optional(),
  lowStock: trueFlag.optional(),
  soldOut: trueFlag.optional(),
});
export type ListSellerProductsQuery = z.infer<typeof listSellerProductsQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Response shapes (section 5.7.2). Money is integer satang.
// ---------------------------------------------------------------------------------------------

export interface SellerProductCategoryDto {
  id: string;
  name: string;
  isActive: boolean;
}

/** A product as its seller sees it. TypeScript type of every product response of section 5.7.2. */
export interface SellerProductDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  sku: string;
  category: SellerProductCategoryDto;
  priceSatang: number;
  stock: number;
  /** On sale (PUBLISHED and APPROVED) and stock 1 to LOW_STOCK_THRESHOLD (BR-25). */
  lowStock: boolean;
  /** On sale and stock 0 (BR-25); never also low stock. */
  soldOut: boolean;
  status: ProductStatusValue;
  moderationStatus: ModerationStatusValue;
  /** The reason of the last rejection or takedown, or null. */
  moderationNote: string | null;
  /** In display order; the first is the primary picture. */
  images: ImageRef[];
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export const DELETE_OUTCOMES = ["DELETED", "ARCHIVED"] as const;
export type DeleteOutcome = (typeof DELETE_OUTCOMES)[number];

/** `DELETE /seller/products/{id}` (BR-12). */
export interface DeleteProductDto {
  outcome: DeleteOutcome;
}
