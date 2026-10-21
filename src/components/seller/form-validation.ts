/**
 * Client-side validation for the seller forms. It uses the schemas of the modules, the same ones
 * the server uses, and exists only to give feedback sooner: the server validates again and
 * decides (CLAUDE.md rule 1). Messages are Thai copy from `th.ts`; the English messages of the
 * schemas and of the server are never shown.
 */
import type { ZodType } from "zod";
import type { FieldErrors } from "@/components/account/validation";

export type { FieldErrors };
export { serverFieldErrors } from "@/components/account/validation";

/** Copy for one field: empty, over the limit, or any other rule not met. */
export interface FieldCopy {
  required: string;
  tooLong: string;
  invalid: string;
}

export type FieldCopyMap<K extends string> = Readonly<Record<K, FieldCopy>>;

export function messageForCode(copy: FieldCopy, code: string): string {
  if (code === "too_small") return copy.required;
  if (code === "too_big") return copy.tooLong;
  return copy.invalid;
}

export type Validation<T, K extends string> =
  { ok: true; body: T } | { ok: false; errors: FieldErrors<K> };

/**
 * Runs `schema` on `input` and maps the first issue of each known field to its Thai copy. An
 * issue that belongs to no known field (for example a body-level rule) is returned as
 * `unplaced`, so the form can show a general message.
 */
export function validateWith<T, K extends string>(
  schema: ZodType<T>,
  input: unknown,
  fields: readonly K[],
  copy: FieldCopyMap<K>,
): Validation<T, K> & { unplaced?: boolean } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, body: parsed.data };
  const errors: FieldErrors<K> = {};
  let unplaced = false;
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    const match = fields.find((known) => known === field);
    if (match === undefined) unplaced = true;
    else if (errors[match] === undefined) errors[match] = messageForCode(copy[match], issue.code);
  }
  return { ok: false, errors, unplaced };
}
