/**
 * Client-side validation of the sign-in and sign-up forms with the server's own schemas
 * (`src/modules/auth/schema.ts`). It gives feedback sooner and decides nothing: the server
 * validates again. Messages are Thai from `th.ts`; the schema's English messages are never shown.
 */
import { serverFieldErrors, type FieldErrors } from "@/components/account/validation";
import { th } from "@/i18n/th";
import { signInBodySchema, signUpBodySchema } from "@/modules/auth/schema";
import type { SignInBody, SignUpBody } from "@/modules/auth/schema";

export type { FieldErrors };
export { serverFieldErrors };

export type SignUpField = "name" | "email" | "password";
export type SignInField = "email" | "password";

export const SIGN_UP_FIELDS: readonly SignUpField[] = ["name", "email", "password"];
export const SIGN_IN_FIELDS: readonly SignInField[] = ["email", "password"];

export function authFieldMessage(field: SignUpField, code: string, empty = false): string {
  const messages = th.auth.fieldErrors[field];
  if (empty) return messages.required;
  if (code === "too_big") return messages.tooLong;
  if (field === "password")
    return code === "too_small" ? th.auth.fieldErrors.password.tooShort : messages.invalid;
  if (code === "too_small") return messages.required;
  return messages.invalid;
}

type Validation<TBody, K extends string> =
  { ok: true; body: TBody } | { ok: false; errors: FieldErrors<K> };

function collect<K extends SignUpField>(
  issues: readonly { path: PropertyKey[]; code: string }[],
  values: Record<K, string>,
  known: readonly K[],
  signIn: boolean,
): FieldErrors<K> {
  const errors: FieldErrors<K> = {};
  for (const issue of issues) {
    const field = issue.path[0];
    const match = known.find((candidate) => candidate === field);
    if (match === undefined || errors[match] !== undefined) continue;
    // Sign-in never states a length policy: an empty password is the only password error there.
    errors[match] =
      signIn && match === "password"
        ? th.auth.fieldErrors.password.required
        : authFieldMessage(
            match,
            issue.code,
            match === "password" ? values[match] === "" : values[match].trim() === "",
          );
  }
  return errors;
}

export function validateSignUp(values: SignUpBody): Validation<SignUpBody, SignUpField> {
  const parsed = signUpBodySchema.safeParse(values);
  if (parsed.success) return { ok: true, body: parsed.data };
  return { ok: false, errors: collect(parsed.error.issues, values, SIGN_UP_FIELDS, false) };
}

export function validateSignIn(values: SignInBody): Validation<SignInBody, SignInField> {
  const parsed = signInBodySchema.safeParse(values);
  if (parsed.success) return { ok: true, body: parsed.data };
  return {
    ok: false,
    errors: collect(parsed.error.issues, values, SIGN_IN_FIELDS, true),
  };
}
