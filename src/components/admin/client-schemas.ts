/**
 * Schemas for the admin forms, for user feedback only: the server validates the same bodies again
 * with `src/modules/admin/schema.ts` and decides (CLAUDE.md rule 1).
 *
 * Why this file exists: `src/modules/admin/schema.ts` imports the module services (and so the
 * database) for its status lists, so a Client Component cannot import it at run time. The numbers
 * below are copies of its bounds; `client-schemas.test.ts` compares them with the real constants and
 * with the real schemas, so a change of a bound on one side fails a test on the other. The reason
 * schema is not copied: it comes from the sellers schema file, which is safe for the browser.
 */
import { z } from "zod";
import { NAME_ALLOWED_TEXT } from "@/modules/auth/schema";

export const CATEGORY_NAME_MAX = 100;
export const CATEGORY_SORT_ORDER_MIN = 0;
export const CATEGORY_SORT_ORDER_MAX = 1_000_000;
export const MIN_SHIPPING_FEE_SATANG = 0;
export const MAX_SHIPPING_FEE_SATANG = 100_000;
export const MIN_COMMISSION_RATE_BPS = 0;
export const MAX_COMMISSION_RATE_BPS = 10_000;
export const COMMISSION_RATE_STEP_BPS = 100;

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(CATEGORY_NAME_MAX)
  .regex(NAME_ALLOWED_TEXT);

export const categorySortOrderSchema = z
  .number()
  .int()
  .min(CATEGORY_SORT_ORDER_MIN)
  .max(CATEGORY_SORT_ORDER_MAX);

export const createCategoryFormSchema = z.strictObject({
  name: categoryNameSchema,
  sortOrder: categorySortOrderSchema.optional(),
});

export const updateCategoryFormSchema = z
  .strictObject({
    name: categoryNameSchema.optional(),
    sortOrder: categorySortOrderSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined));

export const updateSettingsFormSchema = z
  .strictObject({
    flatShippingFeeSatang: z
      .number()
      .int()
      .min(MIN_SHIPPING_FEE_SATANG)
      .max(MAX_SHIPPING_FEE_SATANG)
      .optional(),
    commissionRateBps: z
      .number()
      .int()
      .min(MIN_COMMISSION_RATE_BPS)
      .max(MAX_COMMISSION_RATE_BPS)
      .multipleOf(COMMISSION_RATE_STEP_BPS)
      .optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined));
