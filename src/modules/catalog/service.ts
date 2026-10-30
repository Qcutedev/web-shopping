/**
 * Catalog service (docs/API_CONTRACTS.md section 5.2; REQ-C-05 to REQ-C-09, REQ-N-06, BR-05,
 * BR-23, BR-24, BR-27).
 *
 * Every function is a public read: none takes an actor, because what it returns is the same for
 * every caller, logged in or not, whatever the role. A seller sees their own hidden products
 * through the seller endpoints, never here. Nothing here writes (D-029 point 1).
 *
 * Every refusal is `catalogNotFound()` (errors.ts). Money is integer satang, read from the
 * database and passed on unchanged.
 */
import { catalogNotFound } from "./errors";
import { imageRef } from "./image";
import {
  type CategoryRow,
  type FeaturedStoreRow,
  type CategorySummaryRow,
  findActiveCategories,
  findActiveCategoryBySlug,
  findActiveCategoryIdBySlug,
  findFeaturedStores,
  findPublicStoreBySlug,
  findPublicStoreIdBySlug,
  findReviewsOfVisibleProduct,
  findVisibleProductBySlug,
  findVisibleProducts,
  type ProductDetailRow,
  type ProductFilter,
  type ProductListRow,
  type ReviewAggregate,
  type ReviewRow,
  type StoreRow,
} from "./repository";
import type {
  CategoryDto,
  CategorySummaryDto,
  FeaturedStoreDto,
  ListCategoriesQuery,
  ListProductReviewsQuery,
  ListProductsQuery,
  Page,
  ProductDetailDto,
  ProductListItemDto,
  ReviewDto,
  ReviewSummaryDto,
  StoreDto,
} from "./schema";
import { isSoldOut } from "./visibility";

// ---------------------------------------------------------------------------------------------
// Mapping from rows to response shapes (pure; unit-tested)
// ---------------------------------------------------------------------------------------------

export function toCategoryDto(row: CategoryRow): CategoryDto {
  return { id: row.id, name: row.name, slug: row.slug, isSample: row.isSample };
}

export function toCategorySummaryDto(row: CategorySummaryRow): CategorySummaryDto {
  return { name: row.name, slug: row.slug };
}

export function toProductListItemDto(row: ProductListRow): ProductListItemDto {
  const first = row.images[0];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    priceSatang: row.priceSatang,
    image: first === undefined ? null : imageRef(first.upload.storageKey),
    soldOut: isSoldOut(row.stock),
    isSample: row.isSample,
    createdAt: row.createdAt.toISOString(),
    reviewSummary: toReviewSummary(row.reviews),
    store: { name: row.store.name, slug: row.store.slug, isSample: row.store.isSample },
  };
}

/**
 * `null` when there is no review (REQ-C-08). The mean is rounded to one decimal place, half
 * away from zero; ratings are integers 1 to 5, so the result is between 1.0 and 5.0.
 */
export function toReviewSummary(aggregate: ReviewAggregate): ReviewSummaryDto | null {
  if (aggregate.count === 0) return null;
  const averageRating = Math.round((aggregate.ratingSum * 10) / aggregate.count) / 10;
  return { averageRating, count: aggregate.count };
}

export function toProductDetailDto(
  row: ProductDetailRow,
  reviews: ReviewAggregate,
): ProductDetailDto {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    priceSatang: row.priceSatang,
    stock: row.stock,
    soldOut: isSoldOut(row.stock),
    images: row.images.map((image) => imageRef(image.upload.storageKey)),
    category: { name: row.category.name, slug: row.category.slug },
    store: { name: row.store.name, slug: row.store.slug, isSample: row.store.isSample },
    reviewSummary: toReviewSummary(reviews),
    isSample: row.isSample,
  };
}

export function toStoreDto(row: StoreRow): StoreDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    logo: row.logoUpload === null ? null : imageRef(row.logoUpload.storageKey),
    isSample: row.isSample,
  };
}

export function toFeaturedStoreDto(row: FeaturedStoreRow): FeaturedStoreDto {
  return {
    name: row.name,
    slug: row.slug,
    logo: row.logoUpload === null ? null : imageRef(row.logoUpload.storageKey),
    productCount: row._count.products,
    isSample: row.isSample,
  };
}

export function toReviewDto(row: ReviewRow): ReviewDto {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** GET /categories: active categories, by `sortOrder` then `id`. */
export async function listCategories(query: ListCategoriesQuery): Promise<Page<CategoryDto>> {
  const { rows, total } = await findActiveCategories(query);
  return { items: rows.map(toCategoryDto), page: query.page, pageSize: query.pageSize, total };
}

/**
 * GET /categories/{slug}: the name and slug of an active category, else 404 (unknown and
 * inactive alike, REQ-C-07). One read, no transaction (repository.ts).
 */
export async function getCategory(slug: string): Promise<CategorySummaryDto> {
  const row = await findActiveCategoryBySlug(slug);
  if (row === null) throw catalogNotFound();
  return toCategorySummaryDto(row);
}

/**
 * The filter shared by both product lists. An unknown or inactive `category` is 404
 * (REQ-C-07), never an empty list.
 */
async function productFilter(
  query: ListProductsQuery,
  storeId: string | undefined,
): Promise<ProductFilter> {
  const filter: ProductFilter = {};
  if (storeId !== undefined) filter.storeId = storeId;
  if (query.category !== undefined) {
    const categoryId = await findActiveCategoryIdBySlug(query.category);
    if (categoryId === null) throw catalogNotFound();
    filter.categoryId = categoryId;
  }
  if (query.q !== undefined) filter.search = query.q;
  if (query.minPriceSatang !== undefined) filter.minPriceSatang = query.minPriceSatang;
  if (query.maxPriceSatang !== undefined) filter.maxPriceSatang = query.maxPriceSatang;
  return filter;
}

async function listProductPage(
  query: ListProductsQuery,
  storeId: string | undefined,
): Promise<Page<ProductListItemDto>> {
  const filter = await productFilter(query, storeId);
  const { rows, total } = await findVisibleProducts(filter, query.sort, query);
  return {
    items: rows.map(toProductListItemDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

/** GET /products: visible products, searched, filtered, sorted, and paginated. */
export async function listProducts(query: ListProductsQuery): Promise<Page<ProductListItemDto>> {
  return listProductPage(query, undefined);
}

/** Stores for the home page row. Not an endpoint: only the storefront page reads it. */
export async function listFeaturedStores(limit: number): Promise<FeaturedStoreDto[]> {
  return (await findFeaturedStores(limit)).map(toFeaturedStoreDto);
}

/** GET /products/{slug}: a visible product, else 404. */
export async function getProduct(slug: string): Promise<ProductDetailDto> {
  const found = await findVisibleProductBySlug(slug);
  if (found === null) throw catalogNotFound();
  return toProductDetailDto(found.product, found.reviews);
}

/** GET /products/{slug}/reviews: newest first; product not visible: 404. */
export async function listProductReviews(
  slug: string,
  query: ListProductReviewsQuery,
): Promise<Page<ReviewDto>> {
  const found = await findReviewsOfVisibleProduct(slug, query);
  if (found === null) throw catalogNotFound();
  return {
    items: found.rows.map(toReviewDto),
    page: query.page,
    pageSize: query.pageSize,
    total: found.total,
  };
}

/** GET /stores/{slug}: a public store, else 404 (suspended or owner deactivated alike). */
export async function getStore(slug: string): Promise<StoreDto> {
  const row = await findPublicStoreBySlug(slug);
  if (row === null) throw catalogNotFound();
  return toStoreDto(row);
}

/** GET /stores/{slug}/products: the store's visible products; store not public: 404. */
export async function listStoreProducts(
  slug: string,
  query: ListProductsQuery,
): Promise<Page<ProductListItemDto>> {
  const storeId = await findPublicStoreIdBySlug(slug);
  if (storeId === null) throw catalogNotFound();
  return listProductPage(query, storeId);
}
