/**
 * Seller application and store contract (docs/API_CONTRACTS.md sections 5.7.1 and 5.9.2;
 * REQ-S-01, REQ-S-02, REQ-S-09, REQ-A-03, BR-06, BR-14): the Zod schemas of the request input and
 * the types of every response shape. Authoritative for `/api/v1/seller/application` and
 * `/api/v1/seller/store`, and for the input of the admin approve and reject services that T-050
 * exposes; the document must match them.
 *
 * Every body is a strict object (section 1.1): an unknown key, `userId`, `storeId`, `sellerId`,
 * `role`, `status`, `slug`, `isSample`, `statusReason`, and `reviewNote` included, is
 * `400 VALIDATION_ERROR` and nothing is created or changed. The acting user and the store always
 * come from the session, never from the request.
 *
 * Text rules (item 8.2-7, settled for these endpoints in T-040):
 *
 *   - one-line text (the store name) follows the display-name rule of the auth module,
 *     `NAME_ALLOWED_TEXT` (SEC-033, SEC-037, SEC-039, SEC-041, SEC-042), after surrounding white
 *     space is removed;
 *   - multi-line text (the description, an admin's reason) may contain line breaks. CR LF and a
 *     lone CR become LF; trailing white space of every line and surrounding white space of the
 *     whole text are removed; then every line that is not empty must satisfy `NAME_ALLOWED_TEXT`.
 *     So LF is the only control character that can be stored, and U+2028, U+2029, bidirectional
 *     controls, and invisible characters are refused on every line as in a name.
 */
import { z } from "zod";

import { NAME_ALLOWED_TEXT } from "@/modules/auth/schema";
import type { ImageRef } from "@/modules/catalog/schema";
import { phoneSchema } from "@/modules/profile/schema";

import type { ApplicationStatusValue, StoreStatusValue } from "./state";

export {
  APPLICATION_STATUSES,
  type ApplicationStatusValue,
  STORE_STATUSES,
  type StoreStatusValue,
} from "./state";

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** Store name, on the application and on the store. */
export const STORE_NAME_MAX = 100;
/** Store description, on the application and on the store, after line breaks are normalised. */
export const STORE_DESCRIPTION_MAX = 2000;
/** An admin's reason for a rejection. */
export const REVIEW_REASON_MAX = 500;
/**
 * Longest storage key accepted as `logoKey`. The key pattern itself is T-041's (item 8.2-8); here
 * the key is checked for its form only and then looked up as an upload of the caller's store.
 */
export const STORAGE_KEY_MAX = 200;
/** Longest id accepted in a path (section 1.4; the same bound as the other modules). */
export const MAX_ID_LENGTH = 200;

// ---------------------------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------------------------

const DISPLAY_TEXT_MESSAGE =
  "Must contain a visible character and no control, format, or invisible character.";
const MULTI_LINE_MESSAGE =
  "Every line must contain a visible character, or be empty, and no control, format, or invisible character.";

/** Trimmed one-line text of 1 to `max` characters under the display-name rule. */
function oneLineText(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(NAME_ALLOWED_TEXT, { error: DISPLAY_TEXT_MESSAGE });
}

/** The normal form of multi-line text (file comment). Pure; exported for the unit test. */
export function normaliseMultiLineText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function linesAreAllowed(text: string): boolean {
  return text.split("\n").every((line) => line === "" || NAME_ALLOWED_TEXT.test(line));
}

/** Multi-line text of 1 to `max` characters after normalisation (file comment). */
function multiLineText(max: number) {
  return z
    .string()
    .transform(normaliseMultiLineText)
    .pipe(
      z.string().min(1).max(max).refine(linesAreAllowed, {
        error: MULTI_LINE_MESSAGE,
      }),
    );
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

export const storeNameSchema = oneLineText(STORE_NAME_MAX);
export const storeDescriptionSchema = multiLineText(STORE_DESCRIPTION_MAX);
export const reviewReasonSchema = multiLineText(REVIEW_REASON_MAX);

function hasAnyKey(value: Record<string, unknown>): boolean {
  return Object.values(value).some((entry) => entry !== undefined);
}

// ---------------------------------------------------------------------------------------------
// POST /seller/application
// ---------------------------------------------------------------------------------------------

/** REQ-S-01: store name, description, contact phone; all three required. */
export const submitApplicationBodySchema = z.strictObject({
  storeName: storeNameSchema,
  description: storeDescriptionSchema,
  contactPhone: phoneSchema,
});
export type SubmitApplicationBody = z.infer<typeof submitApplicationBodySchema>;

// ---------------------------------------------------------------------------------------------
// PATCH /seller/store
// ---------------------------------------------------------------------------------------------

/**
 * REQ-S-02: any of `name`, `description`, `contactPhone`, `logoKey`, at least one. `description:
 * null` clears the description and `logoKey: null` removes the logo (the upload itself stays,
 * section 5.8). A body with none of them is 400 (path `""`, code `custom`).
 */
export const updateStoreBodySchema = z
  .strictObject({
    name: storeNameSchema.optional(),
    description: storeDescriptionSchema.nullable().optional(),
    contactPhone: phoneSchema.optional(),
    logoKey: opaqueText(STORAGE_KEY_MAX).nullable().optional(),
  })
  .refine(hasAnyKey, { error: "At least one field must be given." });
export type UpdateStoreBody = z.infer<typeof updateStoreBodySchema>;

// ---------------------------------------------------------------------------------------------
// Admin decisions (exposed by T-050 as POST /admin/applications/{id}/approve and /reject)
// ---------------------------------------------------------------------------------------------

/** The `{id}` path parameter of an application: an opaque id, form only. */
export const applicationIdParamsSchema = z.object({ id: opaqueText(MAX_ID_LENGTH) });
export type ApplicationIdParams = z.infer<typeof applicationIdParamsSchema>;

/** REQ-A-03: a rejection without a reason is rejected (blank counts as none). */
export const rejectApplicationBodySchema = z.strictObject({ reason: reviewReasonSchema });
export type RejectApplicationBody = z.infer<typeof rejectApplicationBodySchema>;

// ---------------------------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------------------------

/** `{ key, url }` of a stored picture (section 4), the same shape as in the catalog. */
export type ImageRefDto = ImageRef;

/** `GET` and `POST /seller/application`: the applicant's own view of an application. */
export interface SellerApplicationDto {
  id: string;
  storeName: string;
  description: string;
  contactPhone: string;
  status: ApplicationStatusValue;
  /** The rejection reason; null unless `REJECTED`. */
  reviewNote: string | null;
  /** When an admin decided; null while `PENDING`. */
  reviewedAt: string | null;
  createdAt: string;
}

/** `GET` and `PATCH /seller/store`: the seller's own store. */
export interface SellerStoreDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo: ImageRefDto | null;
  contactPhone: string;
  status: StoreStatusValue;
  /** The reason of the last suspension or reinstatement, or null. */
  statusReason: string | null;
  isSample: boolean;
}

/** What the approve and reject services return to the admin layer (T-050). */
export interface ApplicationDecisionDto {
  application: {
    id: string;
    userId: string;
    status: ApplicationStatusValue;
    reviewNote: string | null;
    reviewedAt: string;
  };
  /** The store the approval created; null for a rejection. */
  store: { id: string; name: string; slug: string; status: StoreStatusValue } | null;
}
