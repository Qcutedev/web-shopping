/**
 * Reviews contract (docs/API_CONTRACTS.md section 5.6; REQ-C-14, BR-11): the Zod schemas of the
 * input of `POST /api/v1/orders/{id}/items/{itemId}/review` and the type of the review it answers.
 * Authoritative for that endpoint; the document must match them. The public list of a product's
 * reviews (`GET /products/{slug}/reviews`) is the catalog module's and returns the same shape.
 *
 * The body is a strict object (section 1.1): an unknown key, `productId`, `userId`, `orderItemId`,
 * `storeId`, and `createdAt` included, is `400 VALIDATION_ERROR` and nothing is written. The
 * product and the reviewer always come from the order item and the session.
 *
 * Text limit of `comment` (item 8.2-7, set for this endpoint in T-035; **provisional** until the
 * owner or the orchestrator rules): multi-line, at most REVIEW_COMMENT_MAX characters after the
 * normalisation of the store description (`normaliseMultiLineText`: CR LF and a lone CR become LF,
 * trailing white space of every line and surrounding white space of the whole text are removed),
 * every non-empty line under the display-name rule `NAME_ALLOWED_TEXT`. A comment that is absent,
 * `null`, or blank after normalisation is stored as `null` (no comment). The stored text is plain
 * text and is returned exactly as stored; it is never interpreted as markup.
 */
import { z } from "zod";

import { NAME_ALLOWED_TEXT } from "@/modules/auth/schema";
import type { ReviewDto } from "@/modules/catalog/schema";
import { normaliseMultiLineText } from "@/modules/sellers/schema";

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** REQ-C-14: a rating is a whole number from 1 to 5 (the database check is the backstop). */
export const MIN_RATING = 1;
export const MAX_RATING = 5;

/** Provisional (file comment). */
export const REVIEW_COMMENT_MAX = 2000;

/** Longest id accepted in a path (section 1.4; the same bound as the other modules). */
export const MAX_ID_LENGTH = 200;

// ---------------------------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------------------------

const NUL = String.fromCodePoint(0);

const MULTI_LINE_MESSAGE =
  "Every line must contain a visible character, or be empty, and no control, format, or invisible character.";

function linesAreAllowed(text: string): boolean {
  return text.split("\n").every((line) => line === "" || NAME_ALLOWED_TEXT.test(line));
}

/** An opaque id without U+0000 and without a lone surrogate (section 1.4), form only. */
const opaqueIdSchema = z
  .string()
  .min(1)
  .max(MAX_ID_LENGTH)
  .refine((value) => !value.includes(NUL) && value.isWellFormed(), {
    error: "Must not contain U+0000 or a lone surrogate.",
  });

export const ratingSchema = z.number().int().min(MIN_RATING).max(MAX_RATING);

/**
 * The comment: normalised, then blank becomes `null`; otherwise at most REVIEW_COMMENT_MAX
 * characters with every non-empty line under `NAME_ALLOWED_TEXT`.
 */
export const reviewCommentSchema = z
  .string()
  .transform(normaliseMultiLineText)
  .pipe(
    z
      .string()
      .max(REVIEW_COMMENT_MAX)
      .refine(linesAreAllowed, { error: MULTI_LINE_MESSAGE })
      .transform((text) => (text === "" ? null : text)),
  );

// ---------------------------------------------------------------------------------------------
// POST /orders/{id}/items/{itemId}/review
// ---------------------------------------------------------------------------------------------

/** The `{id}` and `{itemId}` path parameters. */
export const reviewTargetParamsSchema = z.object({ id: opaqueIdSchema, itemId: opaqueIdSchema });
export type ReviewTargetParams = z.infer<typeof reviewTargetParamsSchema>;

/** REQ-C-14: `{ rating, comment? }`. `comment: null` is the same as no comment. */
export const createReviewBodySchema = z.strictObject({
  rating: ratingSchema,
  comment: reviewCommentSchema.nullable().optional(),
});
export type CreateReviewBody = z.infer<typeof createReviewBodySchema>;

// ---------------------------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------------------------

/**
 * `{ id, rating, comment, createdAt }`: the shape of the catalog's review list and of `review` on
 * an order item (sections 5.2 and 5.5.2). It carries no reviewer name or id and no product id.
 */
export type CreatedReviewDto = ReviewDto;
