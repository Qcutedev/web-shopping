/**
 * Pure helpers of the admin forms: what the person typed to the body of the request. Money is typed
 * in baht and converted to integer satang with integer math, never floats (CLAUDE.md rule 4); the
 * commission is typed as a whole percent and sent as basis points. Nothing here computes a value
 * the server trusts: the server validates every body again.
 */
import { parsePriceInput } from "@/components/seller/product-form-model";
import {
  createCategoryFormSchema,
  updateCategoryFormSchema,
  updateSettingsFormSchema,
} from "./client-schemas";

export type IntegerText =
  { ok: true; value: number } | { ok: false; kind: "required" | "invalid" | "tooLong" };

/** A whole non-negative number typed in a field: digits only, at most `maxDigits` of them. */
export function parseWholeNumber(text: string, maxDigits: number): IntegerText {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, kind: "required" };
  if (!/^\d+$/.test(trimmed)) return { ok: false, kind: "invalid" };
  if (trimmed.length > maxDigits) return { ok: false, kind: "tooLong" };
  return { ok: true, value: Number(trimmed) };
}

/** Basis points of a typed whole percent: "5" is 500. A decimal is `invalid` (BR-28). */
export function percentToBps(text: string): IntegerText {
  const parsed = parseWholeNumber(text, 3);
  return parsed.ok ? { ok: true, value: parsed.value * 100 } : parsed;
}

/** The percent text of stored basis points. The server stores whole percents only. */
export function bpsToPercent(bps: number): string {
  return String(Math.floor(bps / 100));
}

/**
 * The input of the create-category schema. A blank sort order is left out so the category goes
 * last. An unreadable one is passed on as the text itself, which the schema refuses with the
 * field's own issue.
 */
export function createCategoryInput(name: string, sortOrderText: string): Record<string, unknown> {
  const input: Record<string, unknown> = { name };
  if (sortOrderText.trim() === "") return input;
  const parsed = parseWholeNumber(sortOrderText, 7);
  input.sortOrder = parsed.ok ? parsed.value : sortOrderText;
  return input;
}

/** Only the fields that differ from the stored category are sent. */
export function categoryChanges(
  saved: { name: string; sortOrder: number },
  values: { name: string; sortOrderText: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (values.name.trim() !== saved.name) body.name = values.name;
  const parsed = parseWholeNumber(values.sortOrderText, 7);
  if (!parsed.ok) body.sortOrder = values.sortOrderText.trim() === "" ? "" : values.sortOrderText;
  else if (parsed.value !== saved.sortOrder) body.sortOrder = parsed.value;
  return body;
}

/**
 * Only the settings that differ from the stored ones are sent. A value that cannot be read is
 * passed on as the text, which the schema refuses with the field's own issue.
 */
export function settingsChanges(
  saved: { flatShippingFeeSatang: number; commissionRateBps: number },
  values: { feeText: string; percentText: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const fee = parsePriceInput(values.feeText);
  if (!fee.ok) body.flatShippingFeeSatang = values.feeText;
  else if (fee.satang !== saved.flatShippingFeeSatang) body.flatShippingFeeSatang = fee.satang;
  const percent = percentToBps(values.percentText);
  if (!percent.ok) body.commissionRateBps = values.percentText;
  else if (percent.value !== saved.commissionRateBps) body.commissionRateBps = percent.value;
  return body;
}

export { createCategoryFormSchema, updateCategoryFormSchema, updateSettingsFormSchema };
