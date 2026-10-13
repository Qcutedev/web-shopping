/**
 * Profile and address contract (docs/API_CONTRACTS.md section 5.3; REQ-C-03, REQ-C-04): the Zod
 * schemas of the request input and the types of every response shape. Authoritative for
 * `/api/v1/me` and `/api/v1/me/addresses*`; the document must match them.
 *
 * Every body is a strict object (section 1.1): an unknown key, `id`, `userId`, `email`, `role`,
 * `isActive`, `storeId`, and timestamps included, is `400 VALIDATION_ERROR` and nothing is
 * changed. The acting user always comes from the session, never from the request.
 *
 * Text that is shown to people (the display name, every address field except the postal code)
 * follows the display-name rule of the auth module, `NAME_ALLOWED_TEXT` (SEC-033, SEC-037,
 * SEC-039): no control, format, bidirectional, line-separator, private-use, unassigned, or
 * default-ignorable character, and at least one visible character. Surrounding white space is
 * removed first. That rule also refuses U+0000 and lone surrogates, which a PostgreSQL text
 * column cannot hold as sent.
 */
import { z } from "zod";

import { NAME_ALLOWED_TEXT, NAME_MAX } from "@/modules/auth/schema";
import type { Role } from "@/server/auth/actor";

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type Page,
  type PaginationQuery,
  paginationQuerySchema,
  queryRecord,
} from "@/modules/catalog/schema";

// ---------------------------------------------------------------------------------------------
// Limits (docs/API_CONTRACTS.md item 8.2-7, settled for these endpoints in T-030)
// ---------------------------------------------------------------------------------------------

/** Display name of the user: the same bound as at sign-up (src/modules/auth/schema.ts). */
export const PROFILE_NAME_MAX = NAME_MAX;
/** Recipient of an address. */
export const RECIPIENT_NAME_MAX = 100;
/** The address line (house number, building, street). */
export const ADDRESS_LINE_MAX = 200;
/** Subdistrict, district, and province, each. */
export const ADDRESS_AREA_MAX = 100;
/** Longest phone number as typed, before spaces and hyphens are removed. */
export const PHONE_INPUT_MAX = 32;
/**
 * Longest id accepted in a path. Ids are opaque (section 1.4); the bound only stops absurd input
 * and never refuses a real id (a `cuid(2)` is 24 characters).
 */
export const MAX_ID_LENGTH = 200;

/**
 * A Thai phone number after spaces and hyphens are removed: domestic `0` and 9 or 10 digits in
 * total (`021234567`, `0812345678`), or `+66` and the same number without its leading `0`
 * (`+6621234567`, `+66812345678`). ASCII digits only.
 */
export const PHONE_PATTERN = /^(?:0[1-9][0-9]{7,8}|\+66[1-9][0-9]{7,8})$/;

/** Exactly five ASCII digits (REQ-C-04; DATA_MODEL.md section 6.2, `Address_postalCode_check`). */
export const POSTAL_CODE_PATTERN = /^[0-9]{5}$/;

// ---------------------------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------------------------

const DISPLAY_TEXT_MESSAGE =
  "Must contain a visible character and no control, format, or invisible character.";

/** Trimmed display text of 1 to `max` characters under the display-name rule. */
function displayText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(NAME_ALLOWED_TEXT, { error: DISPLAY_TEXT_MESSAGE });
}

/**
 * A phone number as typed: at most PHONE_INPUT_MAX characters; surrounding white space, inner
 * spaces, and hyphens are removed; what is left must match PHONE_PATTERN. The stored value is
 * the form without separators, so `081-234-5678` is stored as `0812345678`.
 */
export const phoneSchema = z
  .string()
  .max(PHONE_INPUT_MAX)
  .transform((text) => text.trim().replace(/[ -]/g, ""))
  .pipe(
    z.string().regex(PHONE_PATTERN, {
      error: "Must be a Thai phone number: 0 and 8 or 9 digits, or +66 and 8 or 9 digits.",
    }),
  );

/** Five ASCII digits; surrounding white space is removed first. */
export const postalCodeSchema = z
  .string()
  .trim()
  .regex(POSTAL_CODE_PATTERN, { error: "Must be exactly five digits." });

export const profileNameSchema = displayText(PROFILE_NAME_MAX);

/** Every key a partial update may carry must be present at least once. */
function hasAnyKey(value: Record<string, unknown>): boolean {
  return Object.values(value).some((entry) => entry !== undefined);
}

const NO_FIELD_MESSAGE = "At least one field must be given.";

// ---------------------------------------------------------------------------------------------
// PATCH /me
// ---------------------------------------------------------------------------------------------

/**
 * `name` and `phone` only (REQ-C-03). `phone: null` clears the phone. A body with neither key is
 * 400 (path `""`, code `custom`). `email`, `role`, `isActive`, and every other key are unknown
 * keys.
 */
export const updateProfileBodySchema = z
  .strictObject({
    name: profileNameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
  })
  .refine(hasAnyKey, { error: NO_FIELD_MESSAGE });
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

// ---------------------------------------------------------------------------------------------
// /me/addresses
// ---------------------------------------------------------------------------------------------

const addressFields = {
  recipientName: displayText(RECIPIENT_NAME_MAX),
  phone: phoneSchema,
  line1: displayText(ADDRESS_LINE_MAX),
  subdistrict: displayText(ADDRESS_AREA_MAX),
  district: displayText(ADDRESS_AREA_MAX),
  province: displayText(ADDRESS_AREA_MAX),
  postalCode: postalCodeSchema,
};

/** POST /me/addresses: every field required except `isDefault` (default `false`). */
export const createAddressBodySchema = z.strictObject({
  ...addressFields,
  isDefault: z.boolean().default(false),
});
export type CreateAddressBody = z.infer<typeof createAddressBodySchema>;

/** PATCH /me/addresses/{id}: any of the fields, at least one. */
export const updateAddressBodySchema = z
  .strictObject({
    recipientName: addressFields.recipientName.optional(),
    phone: addressFields.phone.optional(),
    line1: addressFields.line1.optional(),
    subdistrict: addressFields.subdistrict.optional(),
    district: addressFields.district.optional(),
    province: addressFields.province.optional(),
    postalCode: addressFields.postalCode.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine(hasAnyKey, { error: NO_FIELD_MESSAGE });
export type UpdateAddressBody = z.infer<typeof updateAddressBodySchema>;

/**
 * The `{id}` path parameter: an opaque id (section 1.4), validated for its form only. No U+0000
 * and no lone surrogate, which no stored id contains and the query could not carry as sent.
 */
export const addressIdParamsSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(MAX_ID_LENGTH)
    .refine((value) => !value.includes("\u0000") && value.isWellFormed(), {
      error: "Must not contain U+0000 or a lone surrogate.",
    }),
});
export type AddressIdParams = z.infer<typeof addressIdParamsSchema>;

// ---------------------------------------------------------------------------------------------
// Response shapes (section 5.3)
// ---------------------------------------------------------------------------------------------

export type StoreStatusValue = "APPROVED" | "SUSPENDED";
export type ApplicationStatusValue = "PENDING" | "APPROVED" | "REJECTED";

export interface ProfileDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  /** The user's own store, or null (every `CUSTOMER`, every `ADMIN`). */
  store: { id: string; name: string; slug: string; status: StoreStatusValue } | null;
  /** The user's latest seller application, or null. */
  sellerApplication: { id: string; status: ApplicationStatusValue } | null;
}

export interface AddressDto {
  id: string;
  recipientName: string;
  phone: string;
  line1: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
  isDefault: boolean;
}

export interface AddressDeletedDto {
  deleted: true;
}
