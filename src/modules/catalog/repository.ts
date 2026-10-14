/**
 * Catalog reads. Every product query here starts from VISIBLE_PRODUCT_WHERE and every store
 * query from PUBLIC_STORE_WHERE (visibility.ts), so no read can return a hidden row.
 *
 * Read-only: nothing in this file writes (D-029 point 1; SECURITY.md TM-16).
 *
 * No read here runs in an interactive transaction. A list reads its count, then its rows, as
 * two statements, so a write that commits between them can make `total` differ from the rows by
 * that write; for a public catalog that is accepted. Reason: Prisma 7.10 with
 * `@prisma/adapter-pg` sends the relation loads of one query (pictures, store, category) at the
 * same time on the transaction's single `pg` client, which `pg` 8.23 reports as deprecated
 * ("Calling client.query() when the client is already executing a query") and `pg` 9 removes.
 * Outside a transaction those loads go to the pool. The rule for code that must run in a
 * transaction is docs/API_CONTRACTS.md item 8.2-14.
 *
 * Ordering always ends with `id` (section 1.7; DATA_MODEL.md section 15). No query orders by a
 * Thai text column.
 */
import { db, type Prisma } from "@/server/db";

import { MAX_PRODUCT_IMAGES, type ProductSort } from "./schema";
import { PUBLIC_STORE_WHERE, VISIBLE_PRODUCT_WHERE } from "./visibility";

export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface PageResult<T> {
  rows: T[];
  total: number;
}

function offsetOf(request: PageRequest): number {
  return (request.page - 1) * request.pageSize;
}

// ---------------------------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------------------------

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  isSample: true,
} as const satisfies Prisma.CategorySelect;

export type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

export async function findActiveCategories(request: PageRequest): Promise<PageResult<CategoryRow>> {
  const where = { isActive: true } satisfies Prisma.CategoryWhereInput;
  const total = await db.category.count({ where });
  const skip = offsetOf(request);
  if (skip >= total) return { rows: [], total };
  const rows = await db.category.findMany({
    where,
    select: CATEGORY_SELECT,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    skip,
    take: request.pageSize,
  });
  return { rows, total };
}

/** The id of an active category with this slug, or null (unknown and inactive alike). */
export async function findActiveCategoryIdBySlug(slug: string): Promise<string | null> {
  const row = await db.category.findFirst({
    where: { slug, isActive: true },
    select: { id: true },
  });
  return row?.id ?? null;
}

const CATEGORY_SUMMARY_SELECT = {
  name: true,
  slug: true,
} as const satisfies Prisma.CategorySelect;

export type CategorySummaryRow = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_SUMMARY_SELECT;
}>;

/** The name and slug of the active category with this slug, or null (unknown and inactive alike). */
export async function findActiveCategoryBySlug(slug: string): Promise<CategorySummaryRow | null> {
  return db.category.findFirst({
    where: { slug, isActive: true },
    select: CATEGORY_SUMMARY_SELECT,
  });
}

// ---------------------------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------------------------

const STORE_SUMMARY_SELECT = {
  name: true,
  slug: true,
  isSample: true,
} as const satisfies Prisma.StoreSelect;

const IMAGE_SELECT = {
  upload: { select: { storageKey: true } },
} as const satisfies Prisma.ProductImageSelect;

const PRODUCT_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  priceSatang: true,
  stock: true,
  isSample: true,
  store: { select: STORE_SUMMARY_SELECT },
  images: {
    select: IMAGE_SELECT,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    take: 1,
  },
} as const satisfies Prisma.ProductSelect;

export type ProductListRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>;

export interface ProductFilter {
  /** Plain text, matched case-insensitively anywhere in the title. */
  search?: string;
  categoryId?: string;
  storeId?: string;
  minPriceSatang?: number;
  maxPriceSatang?: number;
}

/**
 * `%`, `_`, and `\` are wildcards and the escape of `LIKE`. Each is escaped so that the search
 * text is matched as written (backslash is PostgreSQL's default `LIKE` escape).
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function productWhere(filter: ProductFilter): Prisma.ProductWhereInput {
  const conditions: Prisma.ProductWhereInput[] = [VISIBLE_PRODUCT_WHERE];
  if (filter.storeId !== undefined) conditions.push({ storeId: filter.storeId });
  if (filter.categoryId !== undefined) conditions.push({ categoryId: filter.categoryId });
  if (filter.minPriceSatang !== undefined) {
    conditions.push({ priceSatang: { gte: filter.minPriceSatang } });
  }
  if (filter.maxPriceSatang !== undefined) {
    conditions.push({ priceSatang: { lte: filter.maxPriceSatang } });
  }
  if (filter.search !== undefined) {
    conditions.push({
      title: { contains: escapeLikePattern(filter.search), mode: "insensitive" },
    });
  }
  return { AND: conditions };
}

const PRODUCT_ORDER: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }, { id: "desc" }],
  price_asc: [{ priceSatang: "asc" }, { id: "asc" }],
  price_desc: [{ priceSatang: "desc" }, { id: "asc" }],
};

export async function findVisibleProducts(
  filter: ProductFilter,
  sort: ProductSort,
  request: PageRequest,
): Promise<PageResult<ProductListRow>> {
  const where = productWhere(filter);
  const total = await db.product.count({ where });
  const skip = offsetOf(request);
  if (skip >= total) return { rows: [], total };
  const rows = await db.product.findMany({
    where,
    select: PRODUCT_LIST_SELECT,
    orderBy: PRODUCT_ORDER[sort],
    skip,
    take: request.pageSize,
  });
  return { rows, total };
}

const PRODUCT_DETAIL_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  priceSatang: true,
  stock: true,
  isSample: true,
  category: { select: { name: true, slug: true } },
  store: { select: STORE_SUMMARY_SELECT },
  images: {
    select: IMAGE_SELECT,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    take: MAX_PRODUCT_IMAGES,
  },
} as const satisfies Prisma.ProductSelect;

export type ProductDetailRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_DETAIL_SELECT }>;

export interface ReviewAggregate {
  count: number;
  ratingSum: number;
}

/** The visible product with this slug and its review figures, or null. */
export async function findVisibleProductBySlug(
  slug: string,
): Promise<{ product: ProductDetailRow; reviews: ReviewAggregate } | null> {
  const product = await db.product.findFirst({
    where: { AND: [VISIBLE_PRODUCT_WHERE, { slug }] },
    select: PRODUCT_DETAIL_SELECT,
  });
  if (product === null) return null;
  const aggregate = await db.review.aggregate({
    where: { productId: product.id },
    _count: { _all: true },
    _sum: { rating: true },
  });
  return {
    product,
    reviews: { count: aggregate._count._all, ratingSum: aggregate._sum.rating ?? 0 },
  };
}

/** The id of the visible product with this slug, or null. */
async function findVisibleProductIdBySlug(slug: string): Promise<string | null> {
  const row = await db.product.findFirst({
    where: { AND: [VISIBLE_PRODUCT_WHERE, { slug }] },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------------

const REVIEW_SELECT = {
  id: true,
  rating: true,
  comment: true,
  createdAt: true,
} as const satisfies Prisma.ReviewSelect;

export type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>;

/**
 * Reviews of a product, newest first. Returns null when the product is not visible.
 */
export async function findReviewsOfVisibleProduct(
  slug: string,
  request: PageRequest,
): Promise<PageResult<ReviewRow> | null> {
  const productId = await findVisibleProductIdBySlug(slug);
  if (productId === null) return null;
  const where = { productId } satisfies Prisma.ReviewWhereInput;
  const total = await db.review.count({ where });
  const skip = offsetOf(request);
  if (skip >= total) return { rows: [], total };
  const rows = await db.review.findMany({
    where,
    select: REVIEW_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take: request.pageSize,
  });
  return { rows, total };
}

// ---------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------

const STORE_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isSample: true,
  logoUpload: { select: { storageKey: true } },
} as const satisfies Prisma.StoreSelect;

export type StoreRow = Prisma.StoreGetPayload<{ select: typeof STORE_SELECT }>;

/** The public store with this slug, or null (unknown, suspended, and owner deactivated alike). */
export async function findPublicStoreBySlug(slug: string): Promise<StoreRow | null> {
  return db.store.findFirst({
    where: { AND: [PUBLIC_STORE_WHERE, { slug }] },
    select: STORE_SELECT,
  });
}

/** The id of the public store with this slug, or null. */
export async function findPublicStoreIdBySlug(slug: string): Promise<string | null> {
  const row = await db.store.findFirst({
    where: { AND: [PUBLIC_STORE_WHERE, { slug }] },
    select: { id: true },
  });
  return row?.id ?? null;
}
