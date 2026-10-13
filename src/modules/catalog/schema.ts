/**
 * Catalog contract (docs/API_CONTRACTS.md section 5.2): the Zod schemas of the request input
 * and the types of every response shape. Once built, these are authoritative for the catalog
 * endpoints and the document must match them.
 *
 * All catalog endpoints are public `GET`s. Their input is the query string and the `{slug}`
 * path parameter only; there is no body. Unknown query parameters are not interpreted (section
 * 1.1): the query schemas strip them. A `storeId`, `userId`, or `role` in a query therefore
 * changes nothing.
 *
 * A known query parameter that appears more than once arrives as a list (`queryRecord`) and is
 * refused with 400 VALIDATION_ERROR, so `page=1&page=2` is never resolved by guessing which
 * value was meant.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// Limits (docs/API_CONTRACTS.md sections 1.7 and 5.2; 8.2-7 for the text limits)
// ---------------------------------------------------------------------------------------------

/** Default page size of every list (section 1.7). */
export const DEFAULT_PAGE_SIZE = 20;
/** Largest page size a request may ask for (REQ-N-06). A larger value is 400, not clamped. */
export const MAX_PAGE_SIZE = 50;
/**
 * Most digits a `page` may have. Not a product rule: it keeps the offset a safe integer. The
 * largest page, 14 nines, times MAX_PAGE_SIZE is about 5.0e15, below 2^53 (about 9.0e15); 15
 * digits would reach about 5.0e16, above it (code-review finding CR-84). A page beyond the last
 * one is an empty page, so this bound never hides a row.
 */
export const MAX_PAGE_DIGITS = 14;

/** Bounds of the price filter, in satang (section 5.2; BR-02 upper bound). */
export const MIN_PRICE_FILTER_SATANG = 0;
export const MAX_PRICE_FILTER_SATANG = 100_000_000;

/** Longest search text, in characters, after surrounding white space is removed. */
export const MAX_SEARCH_TEXT_LENGTH = 100;
/**
 * Longest slug accepted in a path or in the `category` parameter, in characters, after
 * decoding. A generated slug is at most 40 + 1 + 8 = 49 characters (DATA_MODEL.md section 9);
 * the bound is generous so that it never refuses a real slug and only stops absurd input.
 */
export const MAX_SLUG_LENGTH = 200;

export const PRODUCT_SORTS = ["newest", "price_asc", "price_desc"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];
export const DEFAULT_PRODUCT_SORT: ProductSort = "newest";

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

/**
 * Text that PostgreSQL can store and compare as the client sent it: no U+0000 (a `text` value
 * cannot hold it, so the query would fail with a server error) and no surrogate half without
 * its other half (SECURITY.md SR-05 item 11).
 */
function isStorableText(value: string): boolean {
  return !value.includes("\u0000") && value.isWellFormed();
}

const STORABLE_TEXT_MESSAGE = "Must not contain U+0000 or a lone surrogate.";

/**
 * A query value as `URLSearchParams` hands it over. A parameter given twice is a list, which
 * no schema below accepts.
 */
const queryString = z.string({ error: "Must be given at most once." });

/** Decimal digits only: no sign, no blank, no fraction, no exponent, no hexadecimal. */
function integerParam(options: { min: number; max: number; maxDigits: number }) {
  const pattern = new RegExp(`^[0-9]{1,${options.maxDigits}}$`);
  return queryString
    .regex(pattern, { error: "Must be a whole number written with digits only." })
    .transform((text) => Number(text))
    .pipe(z.number().int().min(options.min).max(options.max));
}

/** The largest `page` a request may ask for. */
export const MAX_PAGE = Number("9".repeat(MAX_PAGE_DIGITS));

/** `page` and `pageSize` (section 1.7). */
export const paginationQuerySchema = z.object({
  page: integerParam({ min: 1, max: MAX_PAGE, maxDigits: MAX_PAGE_DIGITS }).default(1),
  pageSize: integerParam({ min: 1, max: MAX_PAGE_SIZE, maxDigits: 2 }).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * A slug as it arrives in a path segment or in `category`. The framework may hand the segment
 * over still percent-encoded; a generated slug never contains `%`, so a value with `%` is
 * decoded once. A broken escape cannot name any slug and is refused. The result is normalised
 * to Unicode NFC (section 1.4; DATA_MODEL.md section 9), then matched exactly.
 */
export const slugSchema = z
  .string()
  .transform((raw, context) => {
    let decoded = raw;
    if (raw.includes("%")) {
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        context.addIssue({ code: "custom", message: "Must be a valid percent-encoded slug." });
        return z.NEVER;
      }
    }
    return decoded.normalize("NFC");
  })
  .pipe(
    z.string().min(1).max(MAX_SLUG_LENGTH).refine(isStorableText, { error: STORABLE_TEXT_MESSAGE }),
  );

/** The `{slug}` path parameter of the product and store endpoints. */
export const slugParamsSchema = z.object({ slug: slugSchema });
export type SlugParams = z.infer<typeof slugParamsSchema>;

// ---------------------------------------------------------------------------------------------
// GET /categories
// ---------------------------------------------------------------------------------------------

export const listCategoriesQuerySchema = paginationQuerySchema;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

// ---------------------------------------------------------------------------------------------
// GET /products and GET /stores/{slug}/products
// ---------------------------------------------------------------------------------------------

/**
 * `q`: surrounding white space is removed; what is left is matched as plain text, case
 * insensitively, anywhere in the title (D-013). `%`, `_`, and `\` are ordinary characters.
 * An empty or blank `q` is the same as no `q`.
 */
const searchTextSchema = queryString
  .transform((text) => text.trim())
  .pipe(
    z.string().max(MAX_SEARCH_TEXT_LENGTH).refine(isStorableText, { error: STORABLE_TEXT_MESSAGE }),
  )
  .transform((text) => (text === "" ? undefined : text));

const priceParam = integerParam({
  min: MIN_PRICE_FILTER_SATANG,
  max: MAX_PRICE_FILTER_SATANG,
  maxDigits: 9,
});

export const listProductsQuerySchema = paginationQuerySchema
  .extend({
    q: searchTextSchema.optional(),
    category: queryString.pipe(slugSchema).optional(),
    minPriceSatang: priceParam.optional(),
    maxPriceSatang: priceParam.optional(),
    sort: queryString.pipe(z.enum(PRODUCT_SORTS)).default(DEFAULT_PRODUCT_SORT),
  })
  .superRefine((query, context) => {
    if (
      query.minPriceSatang !== undefined &&
      query.maxPriceSatang !== undefined &&
      query.maxPriceSatang < query.minPriceSatang
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxPriceSatang"],
        message: "Must not be lower than minPriceSatang.",
      });
    }
  });
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

/** The store's list takes the same query as `GET /products` (section 5.2). */
export const listStoreProductsQuerySchema = listProductsQuerySchema;
export type ListStoreProductsQuery = ListProductsQuery;

// ---------------------------------------------------------------------------------------------
// GET /products/{slug}/reviews
// ---------------------------------------------------------------------------------------------

export const listProductReviewsQuerySchema = paginationQuerySchema;
export type ListProductReviewsQuery = z.infer<typeof listProductReviewsQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Query string to schema input
// ---------------------------------------------------------------------------------------------

/**
 * The query string as a plain record for a query schema: a parameter given once is a string, a
 * parameter given more than once is the list of its values (and so refused by every schema
 * above). Keys are not filtered here; the schemas strip what they do not name.
 */
export function queryRecord(searchParams: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = Object.create(null) as Record<
    string,
    string | string[]
  >;
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    record[key] = values.length === 1 ? (values[0] as string) : values;
  }
  return record;
}

// ---------------------------------------------------------------------------------------------
// Response shapes (section 5.2). Money is integer satang.
// ---------------------------------------------------------------------------------------------

/** A stored picture: its storage key and where to load it (section 4). */
export interface ImageRef {
  key: string;
  url: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  isSample: boolean;
}

export interface StoreSummaryDto {
  name: string;
  slug: string;
  isSample: boolean;
}

export interface ProductListItemDto {
  id: string;
  slug: string;
  title: string;
  priceSatang: number;
  image: ImageRef | null;
  soldOut: boolean;
  isSample: boolean;
  store: StoreSummaryDto;
}

export interface ReviewSummaryDto {
  /** Mean rating rounded to one decimal place. Not money. */
  averageRating: number;
  count: number;
}

export interface ProductDetailDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  priceSatang: number;
  stock: number;
  soldOut: boolean;
  images: ImageRef[];
  category: { name: string; slug: string };
  store: StoreSummaryDto;
  reviewSummary: ReviewSummaryDto | null;
  isSample: boolean;
}

export interface StoreDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo: ImageRef | null;
  isSample: boolean;
}

export interface ReviewDto {
  id: string;
  rating: number;
  comment: string | null;
  /** ISO 8601 in UTC with `Z` (section 1.6). */
  createdAt: string;
}

/** A page of a list, before the envelope (section 2.1). */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
