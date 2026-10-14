import { MAX_PRICE_FILTER_SATANG } from "@/modules/catalog/schema";

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Names of the baht inputs of the filter form. The query string keeps satang (`minPriceSatang`). */
export const MIN_PRICE_FIELD = "minPrice";
export const MAX_PRICE_FIELD = "maxPrice";

/** Digits, then optionally a dot and one or two digits. No sign, no exponent, no separators. */
const BAHT_PATTERN = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

export type BahtParse = { ok: true; satang: number | undefined } | { ok: false };

/**
 * Baht text to integer satang with integer math only (no float multiplication). Blank is "no
 * bound". Anything that is not a plain non-negative amount with at most two decimals, or that is
 * above the catalog's price limit, is refused. The server schema still has the final say.
 */
export function parseBaht(text: string): BahtParse {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, satang: undefined };
  const match = BAHT_PATTERN.exec(trimmed);
  if (match === null) return { ok: false };
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const satang = whole * 100 + fraction;
  if (!Number.isSafeInteger(satang) || satang > MAX_PRICE_FILTER_SATANG) return { ok: false };
  return { ok: true, satang };
}

/** Integer satang to the text of a baht input: "12" or "12.5" or "12.05". Integer math only. */
export function satangToBaht(satang: number): string {
  const whole = Math.floor(satang / 100);
  const fraction = satang % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

export type PriceFilterError = "min-invalid" | "max-invalid" | "range";

export interface PriceFilterResult {
  /** The query record to hand to `parseListQuery`: baht fields removed, valid satang set. */
  raw: RawSearchParams;
  /** What the inputs should show. An invalid entry is echoed so the visitor can fix it. */
  minText: string;
  maxText: string;
  errors: PriceFilterError[];
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Reads the baht fields of a filter-form submission and turns them into the satang parameters the
 * catalog schema takes. An invalid or inconsistent entry is dropped (the list is shown without
 * it) and reported in `errors`, so the page still renders with a message instead of failing.
 * Baht fields win over satang parameters when both are present.
 */
export function applyPriceFilter(input: RawSearchParams): PriceFilterResult {
  const raw: RawSearchParams = { ...input };
  delete raw[MIN_PRICE_FIELD];
  delete raw[MAX_PRICE_FIELD];
  const errors: PriceFilterError[] = [];

  const bahtMin = input[MIN_PRICE_FIELD];
  const bahtMax = input[MAX_PRICE_FIELD];

  const bound = (
    baht: string | string[] | undefined,
    satangKey: "minPriceSatang" | "maxPriceSatang",
    error: PriceFilterError,
  ): string | undefined => {
    if (baht === undefined) return undefined;
    const text = single(baht);
    const parsed = text === undefined ? ({ ok: false } as const) : parseBaht(text);
    delete raw[satangKey];
    if (!parsed.ok) {
      errors.push(error);
      return text ?? "";
    }
    if (parsed.satang !== undefined) raw[satangKey] = String(parsed.satang);
    return text ?? "";
  };

  let minText = bound(bahtMin, "minPriceSatang", "min-invalid");
  let maxText = bound(bahtMax, "maxPriceSatang", "max-invalid");

  const minS = single(raw.minPriceSatang);
  const maxS = single(raw.maxPriceSatang);
  if (
    errors.length === 0 &&
    minS !== undefined &&
    maxS !== undefined &&
    /^\d+$/.test(minS) &&
    /^\d+$/.test(maxS) &&
    Number(maxS) < Number(minS)
  ) {
    errors.push("range");
    delete raw.minPriceSatang;
    delete raw.maxPriceSatang;
  }

  // Without baht fields, show the satang parameters of the link (sort and page links) in baht.
  if (minText === undefined) {
    const value = single(raw.minPriceSatang);
    minText = value !== undefined && /^\d{1,9}$/.test(value) ? satangToBaht(Number(value)) : "";
  }
  if (maxText === undefined) {
    const value = single(raw.maxPriceSatang);
    maxText = value !== undefined && /^\d{1,9}$/.test(value) ? satangToBaht(Number(value)) : "";
  }
  return { raw, minText, maxText, errors };
}
