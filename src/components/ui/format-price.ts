const thbFormatter = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });

/**
 * Formats an amount in integer satang as Thai baht, for example 29000 -> "฿290.00".
 *
 * Money is integer satang everywhere (CLAUDE.md, rule 4). The conversion to baht happens only
 * here, and without floating-point arithmetic: the satang integer is split into baht and satang
 * with integer operations and handed to Intl.NumberFormat as an exact decimal string.
 *
 * Negative integers are formatted with a minus sign. Anything that is not a safe integer
 * (a fraction, NaN, Infinity, or a value beyond Number.MAX_SAFE_INTEGER) throws a RangeError:
 * such a value means a bug upstream, and showing a rounded price would hide it.
 */
export function formatSatang(satang: number): string {
  if (!Number.isSafeInteger(satang)) {
    throw new RangeError(`formatSatang expects an integer number of satang, received ${satang}`);
  }
  const absolute = Math.abs(satang);
  const remainder = absolute % 100;
  // Exact: the dividend is a multiple of 100.
  const baht = (absolute - remainder) / 100;
  const sign = satang < 0 ? "-" : "";
  const decimal: `${number}` =
    `${sign}${baht}.${String(remainder).padStart(2, "0")}` as `${number}`;
  return thbFormatter.format(decimal);
}
