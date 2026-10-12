/**
 * Request schemas of the auth routes (`src/app/api/v1/auth/*`). Authoritative for those
 * endpoints; docs/API_CONTRACTS.md section 5.1 follows them.
 *
 * Every body is a strict object: an unknown key, `role`, `isActive`, `phone`, `storeId`, and
 * `userId` included, is `400 VALIDATION_ERROR` and nothing is created (docs/API_CONTRACTS.md
 * section 1.1; SECURITY.md TM-04).
 *
 * The bounds are the auth layer's (src/server/auth/config.ts): they are repeated here as numbers
 * because this module may not import the rest of the auth layer (D-022), and a unit test compares
 * the two.
 */
import { z } from "zod";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MAX = 100;
export const EMAIL_MAX = 254;

/**
 * Inclusive code point ranges a display name may not contain:
 *
 *   - C0 and C1 controls and DEL, and so U+0000, which a PostgreSQL text column cannot hold;
 *   - the bidirectional formatting characters (SEC-033): U+061C Arabic letter mark, U+200E and
 *     U+200F direction marks, U+202A to U+202E embeddings and overrides, U+2066 to U+2069
 *     isolates. With them a name is displayed in another order than it is stored, which can
 *     impersonate another name in admin and seller screens.
 *
 * U+200B (zero-width space) and U+200C (zero-width non-joiner) stay allowed: Thai text uses them.
 * Every later free-text name field (store name, address name) uses the same rule.
 *
 * The pattern is built from numbers so that this source file never contains one of these
 * characters itself (the same approach as src/server/logger.ts).
 */
export const NAME_FORBIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x061c, 0x061c],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

function unicodeEscape(code: number): string {
  return `${"\\"}u${code.toString(16).padStart(4, "0")}`;
}

/** Matches a whole name that contains no character of `NAME_FORBIDDEN_RANGES`. */
export const NAME_ALLOWED_TEXT = new RegExp(
  `^[^${NAME_FORBIDDEN_RANGES.map(([from, to]) => `${unicodeEscape(from)}-${unicodeEscape(to)}`).join("")}]*$`,
  "u",
);

const email = z.string().trim().max(EMAIL_MAX).pipe(z.email());

export const signUpBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(NAME_MAX).regex(NAME_ALLOWED_TEXT),
  email,
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});
export type SignUpBody = z.infer<typeof signUpBodySchema>;

/**
 * Sign-in accepts any password of 1 to 128 characters: the length policy is checked when a
 * password is chosen, and a sign-in answer must not depend on it.
 */
export const signInBodySchema = z.strictObject({
  email,
  password: z.string().min(1).max(PASSWORD_MAX),
});
export type SignInBody = z.infer<typeof signInBodySchema>;

/**
 * The per-email rate-limit subject (SR-01; docs/API_CONTRACTS.md section 6): the email as
 * typed, trimmed, lower-cased, and in Unicode NFKC, whether or not an account has it.
 */
export function emailRateLimitSubject(value: string): string {
  return value.trim().toLowerCase().normalize("NFKC");
}
