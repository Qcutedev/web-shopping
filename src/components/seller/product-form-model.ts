/**
 * Pure model of the product form (REQ-S-04): form values, conversion to the request body, and
 * validation with the module's own schemas. Kept apart from the component so it is unit tested.
 * The browser only gives feedback sooner; the server validates again and decides, and every
 * price is typed in baht and converted to integer satang here with integer math, never floats.
 */
import { satangToBaht } from "@/components/catalog/price-filter";
import { th } from "@/i18n/th";
import type { ImageRef } from "@/modules/catalog/schema";
import {
  type CreateProductBody,
  createProductBodySchema,
  MAX_PRICE_SATANG,
  type SellerProductDto,
  type UpdateProductBody,
  updateProductBodySchema,
} from "@/modules/inventory/schema";
import { normaliseMultiLineText } from "@/modules/sellers/schema";
import { type FieldErrors, validateWith } from "./form-validation";

export const PRODUCT_FIELDS = [
  "title",
  "description",
  "sku",
  "categoryId",
  "priceSatang",
  "stock",
  "imageKeys",
] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];

export interface ProductFormValues {
  title: string;
  description: string;
  sku: string;
  categoryId: string;
  /** Baht as typed. */
  price: string;
  /** Pieces as typed; create only. */
  stock: string;
  images: ImageRef[];
}

export const EMPTY_PRODUCT_VALUES: ProductFormValues = {
  title: "",
  description: "",
  sku: "",
  categoryId: "",
  price: "",
  stock: "",
  images: [],
};

export function valuesOfProduct(stored: SellerProductDto): ProductFormValues {
  return {
    title: stored.title,
    description: stored.description,
    sku: stored.sku,
    categoryId: stored.category.id,
    price: satangToBaht(stored.priceSatang),
    stock: String(stored.stock),
    images: stored.images.map((image) => ({ ...image })),
  };
}

export type PriceInput =
  { ok: true; satang: number } | { ok: false; kind: "required" | "invalid" | "tooLong" };

/** Digits, then optionally a dot and one or two digits. No sign, no exponent, no separators. */
const BAHT_PATTERN = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/**
 * Baht text to integer satang with integer math only. Blank is `required`; anything but digits and
 * at most two decimals is `invalid`; above the largest price is `tooLong`. The schema still
 * judges the lower bound and the server judges everything.
 */
export function parsePriceInput(text: string): PriceInput {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, kind: "required" };
  const match = BAHT_PATTERN.exec(trimmed);
  if (match === null) return { ok: false, kind: "invalid" };
  const satang = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (satang > MAX_PRICE_SATANG) return { ok: false, kind: "tooLong" };
  return { ok: true, satang };
}

export type IntegerInput =
  { ok: true; value: number } | { ok: false; kind: "required" | "invalid" };

/** A whole number typed in a field. `signed` allows a leading minus (stock adjustment). */
export function parseIntegerInput(text: string, signed = false): IntegerInput {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, kind: "required" };
  const pattern = signed ? /^-?\d{1,7}$/ : /^\d{1,7}$/;
  if (!pattern.test(trimmed)) return { ok: false, kind: "invalid" };
  return { ok: true, value: Number(trimmed) };
}

/** Messages of the product form: its description has its own limit (5,000, not the store's 2,000). */
export const PRODUCT_COPY = {
  ...th.seller.fieldErrors,
  description: th.seller.fieldErrors.productDescription,
};
const COPY = PRODUCT_COPY;

export type ProductValidation<T> =
  { ok: true; body: T } | { ok: false; errors: FieldErrors<ProductField>; unplaced: boolean };

function priceError(price: PriceInput): string | undefined {
  return price.ok ? undefined : COPY.priceSatang[price.kind];
}

export function validateCreate(values: ProductFormValues): ProductValidation<CreateProductBody> {
  const price = parsePriceInput(values.price);
  const stock = parseIntegerInput(values.stock);
  const result = validateWith<CreateProductBody, ProductField>(
    createProductBodySchema,
    {
      title: values.title,
      description: values.description,
      sku: values.sku,
      categoryId: values.categoryId,
      priceSatang: price.ok ? price.satang : undefined,
      stock: stock.ok ? stock.value : undefined,
      ...(values.images.length > 0 ? { imageKeys: values.images.map((image) => image.key) } : {}),
    },
    PRODUCT_FIELDS,
    COPY,
  );
  const errors: FieldErrors<ProductField> = result.ok ? {} : { ...result.errors };
  const pricing = priceError(price);
  if (pricing !== undefined) errors.priceSatang = pricing;
  if (!stock.ok) errors.stock = COPY.stock[stock.kind];
  if (result.ok && Object.keys(errors).length === 0) return { ok: true, body: result.body };
  return { ok: false, errors, unplaced: result.ok ? false : (result.unplaced ?? false) };
}

function sameKeys(a: readonly ImageRef[], b: readonly ImageRef[]): boolean {
  return a.length === b.length && a.every((image, index) => image.key === b[index]?.key);
}

/**
 * The fields of the form that differ from the stored product, validated as an edit body. `null`
 * body means nothing changed. A pure reorder of pictures is a change (the server rewrites the
 * order without sending the product back to review).
 */
export function validateEdit(
  saved: SellerProductDto,
  values: ProductFormValues,
): { kind: "nochange" } | ({ kind: "checked" } & ProductValidation<UpdateProductBody>) {
  const changes: Record<string, unknown> = {};
  const errors: FieldErrors<ProductField> = {};

  if (values.title !== saved.title) changes.title = values.title;
  if (normaliseMultiLineText(values.description) !== saved.description) {
    changes.description = values.description;
  }
  if (values.sku !== saved.sku) changes.sku = values.sku;
  if (values.categoryId !== saved.category.id) changes.categoryId = values.categoryId;
  const price = parsePriceInput(values.price);
  if (!price.ok) errors.priceSatang = COPY.priceSatang[price.kind];
  else if (price.satang !== saved.priceSatang) changes.priceSatang = price.satang;
  if (!sameKeys(values.images, saved.images)) {
    changes.imageKeys = values.images.map((image) => image.key);
  }

  if (Object.keys(changes).length === 0 && Object.keys(errors).length === 0) {
    return { kind: "nochange" };
  }
  const result = validateWith<UpdateProductBody, ProductField>(
    updateProductBodySchema,
    changes,
    PRODUCT_FIELDS,
    COPY,
  );
  const merged: FieldErrors<ProductField> = result.ok ? {} : { ...result.errors };
  Object.assign(merged, errors);
  if (result.ok && Object.keys(merged).length === 0) {
    return { kind: "checked", ok: true, body: result.body };
  }
  return {
    kind: "checked",
    ok: false,
    errors: merged,
    unplaced: result.ok ? false : (result.unplaced ?? false),
  };
}
