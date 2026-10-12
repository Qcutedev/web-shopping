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

/** No C0 or C1 control character, and so no U+0000, which a PostgreSQL text column cannot hold. */
const NO_CONTROL_CHARACTERS = /^[^\u0000-\u001F\u007F-\u009F]*$/u;

const email = z.string().trim().max(EMAIL_MAX).pipe(z.email());

export const signUpBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(NAME_MAX).regex(NO_CONTROL_CHARACTERS),
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
