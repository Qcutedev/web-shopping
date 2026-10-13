/**
 * Client-side validation of the profile and address forms. It uses the schemas of
 * `src/modules/profile/schema.ts`, the same ones the server uses, and exists only to give
 * feedback sooner: the server validates again and decides (CLAUDE.md rule 1).
 *
 * Messages are Thai copy from `th.ts`; the English messages of the schemas and of the server are
 * never shown.
 */
import { th } from "@/i18n/th";
import type { ApiFieldError } from "@/lib/api-client/http";
import {
  type CreateAddressBody,
  createAddressBodySchema,
  type UpdateProfileBody,
  updateProfileBodySchema,
} from "@/modules/profile/schema";

export const ADDRESS_TEXT_FIELDS = [
  "recipientName",
  "phone",
  "line1",
  "subdistrict",
  "district",
  "province",
  "postalCode",
] as const;
export type AddressTextField = (typeof ADDRESS_TEXT_FIELDS)[number];

export interface AddressFormValues {
  recipientName: string;
  phone: string;
  line1: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
  isDefault: boolean;
}

export const EMPTY_ADDRESS_VALUES: AddressFormValues = {
  recipientName: "",
  phone: "",
  line1: "",
  subdistrict: "",
  district: "",
  province: "",
  postalCode: "",
  isDefault: false,
};

export type ProfileField = "name" | "phone";
export type FieldErrors<K extends string> = Partial<Record<K, string>>;

type MessageKind = "required" | "tooLong" | "invalid";

function kindOfCode(code: string): MessageKind {
  if (code === "too_small") return "required";
  if (code === "too_big") return "tooLong";
  return "invalid";
}

function messageFor(field: ProfileField | AddressTextField, code: string): string {
  return th.account.fieldErrors[field][kindOfCode(code)];
}

type Validation<TBody, K extends string> =
  { ok: true; body: TBody } | { ok: false; errors: FieldErrors<K> };

export function validateAddressForm(
  values: AddressFormValues,
): Validation<CreateAddressBody, AddressTextField> {
  const errors: FieldErrors<AddressTextField> = {};
  for (const field of ADDRESS_TEXT_FIELDS) {
    if (values[field].trim() === "") errors[field] = th.account.fieldErrors[field].required;
  }
  const parsed = createAddressBodySchema.safeParse(values);
  if (parsed.success) {
    return Object.keys(errors).length === 0
      ? { ok: true, body: parsed.data }
      : { ok: false, errors };
  }
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (
      typeof field === "string" &&
      (ADDRESS_TEXT_FIELDS as readonly string[]).includes(field) &&
      errors[field as AddressTextField] === undefined
    ) {
      errors[field as AddressTextField] = messageFor(field as AddressTextField, issue.code);
    }
  }
  return { ok: false, errors };
}

export interface ProfileFormValues {
  name: string;
  phone: string;
}

export function validateProfileForm(
  values: ProfileFormValues,
): Validation<UpdateProfileBody, ProfileField> {
  const errors: FieldErrors<ProfileField> = {};
  if (values.name.trim() === "") errors.name = th.account.fieldErrors.name.required;
  const phone = values.phone.trim() === "" ? null : values.phone;
  const parsed = updateProfileBodySchema.safeParse({ name: values.name, phone });
  if (parsed.success) {
    return Object.keys(errors).length === 0
      ? { ok: true, body: parsed.data }
      : { ok: false, errors };
  }
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === "name" || field === "phone") && errors[field] === undefined) {
      errors[field] = messageFor(field, issue.code);
    }
  }
  return { ok: false, errors };
}

/**
 * Maps the field errors of a `400 VALIDATION_ERROR` to messages under the fields. Returns the
 * errors found and whether any error could not be placed under a field (an unknown key, a body
 * error), so the form can show a general message.
 */
export function serverFieldErrors<K extends string>(
  fields: readonly ApiFieldError[],
  known: readonly K[],
  message: (field: K, code: string) => string,
): { errors: FieldErrors<K>; unplaced: boolean } {
  const errors: FieldErrors<K> = {};
  let unplaced = fields.length === 0;
  for (const entry of fields) {
    const match = known.find((field) => field === entry.path);
    if (match === undefined) {
      unplaced = true;
    } else if (errors[match] === undefined) {
      errors[match] = message(match, entry.code);
    }
  }
  return { errors, unplaced };
}

export function addressServerMessage(field: AddressTextField, code: string): string {
  return messageFor(field, code);
}

export function profileServerMessage(field: ProfileField, code: string): string {
  return messageFor(field, code);
}
