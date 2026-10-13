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
 * Characters a display name may not contain anywhere:
 *
 *   - `Cc` controls: C0, DEL, and C1, and so U+0000, which a PostgreSQL text column cannot hold;
 *   - `Cf` format characters, except U+200B zero-width space, U+200C zero-width non-joiner (Thai
 *     text uses both, SEC-033), and U+200D zero-width joiner (emoji sequences). `Cf` holds the
 *     twelve bidirectional formatting characters of SEC-033 (with them a name is displayed in
 *     another order than it is stored) and the invisible characters of SEC-037: U+00AD soft
 *     hyphen, U+180E, U+FEFF, U+2060 to U+2064, U+206A to U+206F, U+FFF9 to U+FFFB, and the tag
 *     characters U+E0001 and U+E0020 to U+E007F (hidden ASCII text);
 *   - `Zl` U+2028 and `Zp` U+2029, mandatory line breaks (SEC-037: "Admin" over "Verified seller");
 *   - `Cs` lone surrogates, which are not text;
 *   - `Cn` unassigned code points and noncharacters, and `Co` private-use characters (SEC-039):
 *     no agreed glyph, and an unassigned one can later be assigned with any property;
 *   - `Default_Ignorable_Code_Point`, except U+200B to U+200D (above) and the emoji variation
 *     selectors U+FE0E (text style) and U+FE0F (emoji style) (SEC-039). This refuses U+034F,
 *     U+17B4, U+17B5, U+180B to U+180F, the Hangul fillers U+115F, U+1160, U+3164, U+FFA0, and the
 *     variation selectors U+FE00 to U+FE0D and U+E0100 to U+E01EF, which map one-to-one onto
 *     bytes and so could carry hidden data in a name.
 *
 * The exceptions are written first as a negative lookahead; the source uses escapes only.
 */
const NAME_FORBIDDEN_CHAR = String.raw`(?![\u200B-\u200D\uFE0E\uFE0F])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Cn}\p{Co}\p{Default_Ignorable_Code_Point}]`;

/**
 * A character that is visibly drawn: a letter, number, punctuation, or symbol, but not one of the
 * blank-looking U+115F, U+1160, U+3164, U+FFA0 (Hangul fillers, also refused above), U+2800
 * (braille blank), and U+1D159 (musical symbol null notehead, SEC-039). A name needs at least one
 * (SEC-037: no name that looks blank, such as U+200B alone).
 */
const NAME_VISIBLE_CHAR = String.raw`(?![\u115F\u1160\u3164\uFFA0\u2800\u{1D159}])[\p{L}\p{N}\p{P}\p{S}]`;

/**
 * SEC-041, SEC-042 (owner, D-036 item 7): at most this many combining marks (`\p{M}`, which
 * includes the variation selectors U+FE00 to U+FE0F and the keycap U+20E3) or kept invisible
 * characters (U+200B to U+200D) may follow each other. Natural Thai needs up to three on one
 * consonant (a vowel above or below, a tone mark, and rarely U+0E4C), so three is kept and a fourth
 * is refused: that closes stacks drawn far above and below the line ("Zalgo") and long invisible
 * runs that carry hidden data or make invisible duplicates of a name.
 */
export const NAME_MAX_MARK_RUN = 3;

/** One character of such a run. Escapes only (SEC-040). */
const NAME_MARK_OR_KEPT_INVISIBLE = String.raw`[\p{M}\u200B-\u200D]`;

/**
 * Matches a whole name that contains no forbidden character, at least one visible one, and no
 * run of more than NAME_MAX_MARK_RUN combining marks or kept invisible characters. Every
 * later free-text name field (store name, address name) uses the same rule. The source is
 * written with escapes only, so this file never contains one of these characters itself
 * (SEC-040; tests/security/sec037-038-recheck.test.ts checks every non-test file under src).
 */
export const NAME_ALLOWED_TEXT = new RegExp(
  String.raw`^(?![\s\S]*?${NAME_MARK_OR_KEPT_INVISIBLE}{${NAME_MAX_MARK_RUN + 1}})(?=[\s\S]*?${NAME_VISIBLE_CHAR})(?:(?!${NAME_FORBIDDEN_CHAR})[\s\S])*$`,
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
